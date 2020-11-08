package com.openbexi.timeline.data_browser;

public class db_oracle_watcher extends data_watcher {
    private db_oracle_manager _table;

    /**
     * Check periodically if the json_files_manager has changed, If changed refresh the openBEXI timeline with new events
     *
     * @param table
     */
    public db_oracle_watcher(db_oracle_manager table) {
        super();
        _table = table;
    }

    @Override
    public void run() {
        while (true) {
            try {
                //Update client regarding  HTTP service
                boolean able_to_send_data = _table.onDataChange();
                if (able_to_send_data == false) {
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