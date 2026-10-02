// Only built-in icons are loaded; arbitrary record URLs keep the established fallback.
const icons = new Set([
    "icon/ob_error.png",
    "icon/ob_warning.png",
    "icon/ob_info.png",
    "icon/ob_install.png",
    "icon/ob_uninstall.png",
    "icon/ob_start.png",
    "icon/ob_stop.png",
    "icon/ob_check_failed.png",
    "icon/ob_check_aborted.png",
    "icon/ob_check_ok.png",
    "icon/ob_check_warning.png",
    "icon/ob_phone.png",
    "icon/ob_bug.png",
    "icon/ob_lost_connection.png",
    "icon/ob_swap.png",
    "icon/ob_gate_open.png",
    "icon/ob_gate_close.png",
    "icon/ob_red_flag.png",
    "icon/ob_green_flag.png",
    "icon/ob_yellow_flag.png",
    "icon/ob_orange_flag.png",
    "icon/ob_yellow_square.png",
    "icon/ob_orange_square.png",
    "icon/ob_red_square.png",
    "icon/ob_purple_square.png",
    "icon/ob_green_square.png",
    "icon/ob_blue_square.png",
    "icon/ob_script.png",
    "icon/ob_crontab.png",
    "icon/ob_clock.png",
    "icon/ob_info2.png",
    "icon/ob_delete.png",
    "icon/ob_yellow_ring.png",
    "icon/ob_data_issue.png",
    "icon/ob_data.png",
    "icon/ob_data_source.png",
    "icon/ob_sync.png",
    "icon/ob_out_of_sync.png",
    "icon/ob_emergency.png",
    "icon/ob_clone.png",
    "icon/ob_view.png",
    "icon/ob_connect.png",
    "icon/ob_no_connect.png",
    "icon/ob_satellite.png",
    "icon/ob_no_satellite.png",
    "icon/ob_no_tlm_red.png",
    "icon/ob_tlm_red.png",
    "icon/ob_tlm_green.png",
    "icon/ob_tlm_orange.png",
    "icon/ob_earthquake_mag_red.png",
    "icon/ob_earthquake_mag_9_red.png",
    "icon/ob_earthquake_mag_8_red.png",
    "icon/ob_earthquake_mag_7_red.png",
    "icon/ob_earthquake_mag_6_red.png",
    "icon/ob_earthquake_mag_black.png",
    "icon/ob_earthquake_mag_5_black.png",
    "icon/ob_earthquake_mag_4_black.png",
    "icon/ob_earthquake_mag_3_black.png",
    "icon/ob_earthquake_mag_2_black.png",
    "icon/ob_earthquake_mag_1_black.png",
    "icon/ob_volcano_very_active.png",
    "icon/ob_volcano_active.png",
    "icon/ob_volcano.png",
    "icon/ob_volcano_no_active.png"
]);

/** One timeline owns its textures across scene rebuilds and releases them on teardown. */
export class TimelineTextureCache {
    constructor(loader, onLoad = () => {}) {
        this.loader = loader;
        this.onLoad = onLoad;
        this.entries = new Map();
    }

    get(image) {
        if (!icons.has(image)) return undefined;
        if (!this.entries.has(image)) {
            const entry = {};
            this.entries.set(image, entry);
            try {
                entry.texture = this.loader.load(image, () => {
                    // An image may finish after this timeline has been removed.
                    if (this.entries.get(image) === entry) this.onLoad();
                });
            } catch (error) {
                this.entries.delete(image);
                throw error;
            }
        }
        return this.entries.get(image).texture;
    }

    dispose() {
        for (const entry of this.entries.values()) entry.texture?.dispose();
        this.entries.clear();
    }
}
