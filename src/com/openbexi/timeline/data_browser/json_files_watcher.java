package com.openbexi.timeline.data_browser;

public class json_files_watcher extends data_watcher {
    private final json_files_manager _json_files_manager;
    private final String _ob_scene;

    /**
     * Check periodically if the json_files_manager has changed, If changed refresh the openBEXI timeline with new events
     *
     * @param json_files_manager
     */
    public json_files_watcher(json_files_manager json_files_manager, String ob_scene) {
        super();
        _json_files_manager = json_files_manager;
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
        Boolean is_checksum_changed = false;
        while (true) {
            try {
                // Call checkIfJsonFilesChanged
                is_checksum_changed = _json_files_manager.checkIfJsonFilesChanged();
                if (is_checksum_changed) {
                    //Update client regarding request from HTTP service
                    boolean able_to_send_data = _json_files_manager.onDataChange(_ob_scene);
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