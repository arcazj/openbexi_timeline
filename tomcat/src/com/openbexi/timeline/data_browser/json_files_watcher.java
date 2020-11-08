package com.openbexi.timeline.data_browser;

import java.io.File;

public class json_files_watcher extends data_watcher {
    private json_files_manager _json_files_manager;

    /**
     * Check periodically if the json_files_manager has changed, If changed refresh the openBEXI timeline with new events
     *
     * @param json_files_manager
     */
    public json_files_watcher(json_files_manager json_files_manager) {
        super();
        _json_files_manager = json_files_manager;
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
                    boolean able_to_send_data = _json_files_manager.onDataChange();
                    if (able_to_send_data == false) {
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