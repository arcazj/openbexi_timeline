package com.openbexi.timeline.api;

import java.io.File;
import java.io.IOException;
import java.io.InterruptedIOException;
import java.nio.file.*;

/** Preserve atomic replacement while tolerating brief Windows file-handle contention. */
final class TimelineAtomicFiles {
    private TimelineAtomicFiles() {}

    static void replace(Path temporary, Path target) throws IOException {
        replace(temporary, target, File.separatorChar == '\\', Files::move, Thread::sleep);
    }

    @FunctionalInterface interface Move {
        Path run(Path source, Path target, CopyOption... options) throws IOException;
    }
    @FunctionalInterface interface Pause { void run(long millis) throws InterruptedException; }

    static void replace(Path temporary, Path target, boolean windows, Move move, Pause pause) throws IOException {
        for (int retry = 0; ; retry++) {
            try {
                move.run(temporary, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
                return;
            } catch (AccessDeniedException denied) {
                // External Windows handles can briefly prevent replacement even
                // after our own channel closes. Never fall back to delete/copy.
                if (!windows || retry == 5) throw denied;
                try { pause.run(20L * (retry + 1)); }
                catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    InterruptedIOException failure = new InterruptedIOException("Interrupted while replacing saved data atomically.");
                    failure.initCause(interrupted);
                    failure.addSuppressed(denied);
                    throw failure;
                }
            }
        }
    }
}
