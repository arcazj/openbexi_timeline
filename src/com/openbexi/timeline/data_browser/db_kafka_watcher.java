package com.openbexi.timeline.data_browser;

public class db_kafka_watcher extends data_watcher {

    private final db_kafka_manager _db_kafka_manager;
    private final String _ob_scene;

    public db_kafka_watcher(db_kafka_manager db_kafka_manager, String ob_scene) {
        super();
        _db_kafka_manager = db_kafka_manager;
        _ob_scene = ob_scene;
    }

    @Override
    public void run() {
        super.run();
    }

    @Override
    public boolean cancel() {
        return super.cancel();
    }

    @Override
    public long scheduledExecutionTime() {
        return super.scheduledExecutionTime();
    }

    @Override
    public int hashCode() {
        return super.hashCode();
    }

    @Override
    public boolean equals(Object obj) {
        return super.equals(obj);
    }

    @Override
    protected Object clone() throws CloneNotSupportedException {
        return super.clone();
    }

    @Override
    public String toString() {
        return super.toString();
    }
}
