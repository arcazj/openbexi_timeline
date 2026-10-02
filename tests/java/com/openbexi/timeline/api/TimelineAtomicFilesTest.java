package com.openbexi.timeline.api;

import com.sun.nio.file.ExtendedOpenOption;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.io.*;
import java.nio.channels.FileChannel;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class TimelineAtomicFilesTest {
    @TempDir Path directory;

    @Test void transientDenialRetriesTheSameAtomicReplacementWithBoundedBackoff() throws Exception {
        Path source=directory.resolve("new.tmp"),target=directory.resolve("saved.json");
        AtomicInteger attempts=new AtomicInteger();List<Long> waits=new ArrayList<>();
        TimelineAtomicFiles.replace(source,target,true,(from,to,options)->{
            assertEquals(source,from);assertEquals(target,to);
            assertArrayEquals(new CopyOption[]{StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING},options);
            if(attempts.incrementAndGet()<3)throw new AccessDeniedException(from.toString(),to.toString(),null);
            return to;
        },waits::add);
        assertEquals(3,attempts.get());assertEquals(List.of(20L,40L),waits);
    }

    @Test void permanentDenialKeepsBothFilesAndPropagatesAfterThreeHundredMillisecondsOfBackoff() throws Exception {
        Path source=Files.writeString(directory.resolve("new.tmp"),"new"),target=Files.writeString(directory.resolve("saved.json"),"old");
        AccessDeniedException failure=new AccessDeniedException(source.toString(),target.toString(),"denied");
        AtomicInteger attempts=new AtomicInteger();List<Long> waits=new ArrayList<>();
        assertSame(failure,assertThrows(AccessDeniedException.class,()->TimelineAtomicFiles.replace(source,target,true,(from,to,options)->{
            attempts.incrementAndGet();throw failure;
        },waits::add)));
        assertEquals(6,attempts.get());assertEquals(List.of(20L,40L,60L,80L,100L),waits);
        assertEquals("old",Files.readString(target));assertEquals("new",Files.readString(source));
    }

    @Test void otherPlatformsAndOtherErrorsAreNotRetriedOrDowngraded() {
        Path source=directory.resolve("new.tmp"),target=directory.resolve("saved.json");
        for(IOException failure:List.of(new AccessDeniedException(source.toString()),
                new AtomicMoveNotSupportedException(source.toString(),target.toString(),"unsupported"),new IOException("storage failed"))) {
            AtomicInteger attempts=new AtomicInteger();
            boolean windows=!(failure instanceof AccessDeniedException);
            assertSame(failure,assertThrows(IOException.class,()->TimelineAtomicFiles.replace(source,target,windows,(from,to,options)->{
                attempts.incrementAndGet();throw failure;
            },millis->fail("This error must not be retried"))));
            assertEquals(1,attempts.get());
        }
    }

    @Test void interruptedBackoffStopsImmediatelyAndRestoresTheInterruptFlag() {
        Path source=directory.resolve("new.tmp"),target=directory.resolve("saved.json");
        AtomicInteger attempts=new AtomicInteger();AccessDeniedException denied=new AccessDeniedException(source.toString());
        InterruptedException interruption=new InterruptedException("cancelled");
        try {
            InterruptedIOException failure=assertThrows(InterruptedIOException.class,()->TimelineAtomicFiles.replace(source,target,true,(from,to,options)->{
                attempts.incrementAndGet();throw denied;
            },millis->{throw interruption;}));
            assertSame(interruption,failure.getCause());assertArrayEquals(new Throwable[]{denied},failure.getSuppressed());
            assertTrue(Thread.currentThread().isInterrupted());assertEquals(1,attempts.get());
        } finally {Thread.interrupted();}
    }

    @Test void windowsReplacementWaitsForAnActualOpenHandleWithoutRemovingTheOldFile() throws Exception {
        assumeTrue(File.separatorChar=='\\',"Windows sharing rules are required");
        Path source=Files.writeString(directory.resolve("new.tmp"),"new"),target=Files.writeString(directory.resolve("saved.json"),"old");
        CountDownLatch denied=new CountDownLatch(1),released=new CountDownLatch(1);
        ExecutorService executor=Executors.newSingleThreadExecutor();
        try {
            Future<?> replacement;
            try(FileChannel held=FileChannel.open(target,StandardOpenOption.READ,ExtendedOpenOption.NOSHARE_DELETE)) {
                replacement=executor.submit(()->{
                    TimelineAtomicFiles.replace(source,target,true,(from,to,options)->{
                        try {return Files.move(from,to,options);}
                        catch(AccessDeniedException busy) {denied.countDown();throw busy;}
                    },millis->{
                        assertTrue(released.await(5,TimeUnit.SECONDS),"The test must release its blocking handle");
                        Thread.sleep(millis);
                    });
                    return null;
                });
                assertTrue(denied.await(5,TimeUnit.SECONDS),"An open handle must produce the denial being retried");
                assertEquals("old",Files.readString(target));assertEquals("new",Files.readString(source));
            } finally {released.countDown();}
            replacement.get(5,TimeUnit.SECONDS);
        } finally {executor.shutdownNow();assertTrue(executor.awaitTermination(5,TimeUnit.SECONDS));}
        assertEquals("new",Files.readString(target));assertFalse(Files.exists(source));
    }
}
