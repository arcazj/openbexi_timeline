package com.openbexi.timeline.data_browser;

public class db_oracle_watcher extends data_watcher {
    private final db_oracle_manager _table;
    private final String _ob_scene;

    /**
     * Check periodically if the json_files_manager has changed, If changed refresh the openBEXI timeline with new events
     *
     * @param table
     */
    public db_oracle_watcher(db_oracle_manager table, String ob_scene) {
        super();
        _table = table;
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
        while (true) {
            try {
                //Update client regarding  HTTP service
                boolean able_to_send_data = _table.onDataChange(_ob_scene);
                if (!able_to_send_data) {
                    Thread.sleep(1000);
                    // Stop sending data_manager, port has been closed.
                    break;
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