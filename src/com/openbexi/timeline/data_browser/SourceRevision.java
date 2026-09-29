package com.openbexi.timeline.data_browser;

import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.util.*;

/** Shared metadata inventory for conditional reads and live change notifications. */
public final class SourceRevision {
    private record Cached(long checked, String revision) {}
    private static final Map<String, Cached> CACHE = new LinkedHashMap<>();
    private SourceRevision() {}

    public static synchronized String current(data_configuration configuration) throws IOException {
        JSONArray sources=(JSONArray)configuration.getConfiguration().get("startup configuration");
        String key=sources.toJSONString();
        long now=System.nanoTime();
        Cached cached=CACHE.get(key);
        if(cached!=null && now-cached.checked<1_000_000_000L)return cached.revision;
        SortedMap<String,String> files=new TreeMap<>();
        for(Object item:sources) {
            JSONObject source=(JSONObject)item;
            if(!"json_file".equals(source.get("type")) || "false".equals(String.valueOf(source.get("enable"))))continue;
            String model=Objects.toString(source.get("data_model"),"").replace('\\','/');
            if(model.isBlank())continue;
            Path root=Path.of(model.split("/(?:yyyy|mm|dd)(?:/|$)",2)[0]).toAbsolutePath().normalize();
            if(files.containsKey(root.toString()))continue;
            if(Files.isRegularFile(root)) {
                BasicFileAttributes attributes=Files.readAttributes(root,BasicFileAttributes.class);
                files.put(root.toString(),attributes.size()+":"+attributes.lastModifiedTime());
                continue;
            }
            files.put(root.toString(),Files.isDirectory(root)?"directory":"unavailable");
            if(!Files.isDirectory(root))continue;
            Files.walkFileTree(root,EnumSet.noneOf(FileVisitOption.class),32,new SimpleFileVisitor<>() {
                private int visited;
                @Override public FileVisitResult preVisitDirectory(Path path,BasicFileAttributes attributes) throws IOException {
                    String name=path.getFileName().toString();
                    if(name.startsWith("descriptors") || name.contains("noises") || name.startsWith("."))return FileVisitResult.SKIP_SUBTREE;
                    checkLimit();return FileVisitResult.CONTINUE;
                }
                private void checkLimit() throws IOException {
                    if(++visited>100000 || files.size()>100000)throw new IOException("Source inventory limit reached.");
                }
                @Override public FileVisitResult visitFile(Path path,BasicFileAttributes attributes) throws IOException {
                    checkLimit();String name=path.getFileName().toString();
                    if(attributes.isRegularFile() && name.endsWith(".json") && !name.startsWith("."))
                        files.put(path.toString(),attributes.size()+":"+attributes.lastModifiedTime());
                    return FileVisitResult.CONTINUE;
                }
                @Override public FileVisitResult visitFileFailed(Path path,IOException error) {
                    files.put(path.toString(),"unavailable");return FileVisitResult.CONTINUE;
                }
            });
        }
        String revision=digest(key+files);
        if(CACHE.size()>=32)CACHE.remove(CACHE.keySet().iterator().next());
        CACHE.put(key,new Cached(System.nanoTime(),revision));
        return revision;
    }

    public static String digest(String text) {
        try {return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));}
        catch(java.security.NoSuchAlgorithmException error) {throw new IllegalStateException(error);}
    }
}
