package com.openbexi.timeline;
/** Compatibility entry point: generators are now independently built HBDS plugins. */
@Deprecated
public final class event_generator_zone {
    public static void main(String... args) throws Exception {
        java.nio.file.Path root = java.nio.file.Path.of("").toAbsolutePath();
        java.nio.file.Path python = root.resolve(".venv/Scripts/python.exe");
        if (!java.nio.file.Files.exists(python)) python = root.resolve(".venv/bin/python");
        if (!java.nio.file.Files.exists(python)) throw new IllegalStateException("Install timeline_data_collector; use timeline-convert-default --workspace <workspace.json>.");
        java.util.List<String> command = new java.util.ArrayList<>(java.util.List.of(python.toString(), "-m", "timeline_data_collector", "run", "--plugin", "default"));
        command.addAll(java.util.List.of(args));
        System.exit(new ProcessBuilder(command).inheritIO().start().waitFor());
    }
}
