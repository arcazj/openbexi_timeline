package com.openbexi.timeline.data_browser;

public class db_mongo_watcher extends data_watcher {
    private final db_mongo_manager _db_mongo_manager;
    private final String _ob_scene;

    public db_mongo_watcher(db_mongo_manager db_mongo_manager, String ob_scene) {
        super();
        _db_mongo_manager = db_mongo_manager;
        _ob_scene = ob_scene;
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

    @Override
    public void run() {
        Boolean is_data_changed = false;
        while (true) {
            try {
                // Call checkIfJsonFilesChanged
                is_data_changed = _db_mongo_manager.onDataChange(_ob_scene);
                if (is_data_changed) {
                    //Update client regarding request from HTTP service
                    boolean able_to_send_data = _db_mongo_manager.onDataChange(_ob_scene);
                    if (!able_to_send_data) {
                        Thread.sleep(1000);
                        // Stop sending data_manager, port has been closed.
                        break;
                    }
                }
                Thread.sleep(5000);
            } catch (Exception e) {
                e.getMessage();
                break;
            }
        }
        this.cancel();
    }
}
