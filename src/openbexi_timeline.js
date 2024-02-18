/**
 * This notice must be untouched at all times.
 *
 * Copyright (c) 2024 arcazj All rights reserved.
 *     OpenBEXI Timeline version 1.0
 * The latest version is available at https://github.com/arcazj/openbexi_timeline.
 *
 *     This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License
 * as published by the Free Software Foundation; either version 1 and 2
 * of the License, or (at your option) any later version.
 *
 *     This program is distributed in the hope that it will be useful,
 *     but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 *     You should have received a copy of the GNU General Public License
 * as long with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
 */

import * as THREE from 'three';
import {DragControls} from 'drag_controls';
import SpriteText from "three-spritetext";

const ob_MAX_SCENES = 3;
const ob_timelines = [];


window.get_ob_timeline = function (ob_timeline_name) {
    for (let i = 0; ob_timelines.length; i++) {
        if (ob_timelines[i].name === ob_timeline_name)
            return ob_timelines[i];
    }
    return null;
}

class ResourceTracker {
    constructor() {
        this.resources = new Set();
    }

    track(resource) {
        if (resource.dispose || resource instanceof THREE.Object3D) {
            this.resources.add(resource);
        }
        return resource;
    }

    dispose() {
        for (const resource of this.resources) {
            if (resource instanceof THREE.Object3D) {
                if (resource.parent) {
                    resource.parent.remove(resource);
                }
            }
            if (resource.dispose && typeof resource.dispose === "function") {
                try {
                    resource.dispose();
                } catch (err) {
                    // Handle any potential errors during resource disposal
                }
            }
        }
        this.resources.clear();
    }
}

function OB_TIMELINE() {

    const ob_texture = new Map();

    // global texture
    ob_texture.set("icon/ob_error.png", new THREE.TextureLoader().load("icon/ob_error.png"));
    ob_texture.set("icon/ob_warning.png", new THREE.TextureLoader().load("icon/ob_warning.png"));
    ob_texture.set("icon/ob_info.png", new THREE.TextureLoader().load("icon/ob_info.png"));
    ob_texture.set("icon/ob_start.png", new THREE.TextureLoader().load("icon/ob_start.png"));
    ob_texture.set("icon/ob_stop.png", new THREE.TextureLoader().load("icon/ob_stop.png"));
    ob_texture.set("icon/ob_check_failed.png", new THREE.TextureLoader().load("icon/ob_check_failed.png"));
    ob_texture.set("icon/ob_check_aborted.png", new THREE.TextureLoader().load("icon/ob_check_aborted.png"));
    ob_texture.set("icon/ob_check_ok.png", new THREE.TextureLoader().load("icon/ob_check_ok.png"));
    ob_texture.set("icon/ob_check_warning.png", new THREE.TextureLoader().load("icon/ob_check_warning.png"));
    ob_texture.set("icon/ob_phone.png", new THREE.TextureLoader().load("icon/ob_phone.png"));
    ob_texture.set("icon/ob_bug.png", new THREE.TextureLoader().load("icon/ob_bug.png"));
    ob_texture.set("icon/ob_lost_connection.png", new THREE.TextureLoader().load("icon/ob_lost_connection.png"));
    ob_texture.set("icon/ob_swap.png", new THREE.TextureLoader().load("icon/ob_swap.png"));
    ob_texture.set("icon/ob_gate_open.png", new THREE.TextureLoader().load("icon/ob_gate_open.png"));
    ob_texture.set("icon/ob_gate_close.png", new THREE.TextureLoader().load("icon/ob_gate_close.png"));
    ob_texture.set("icon/ob_red_flag.png", new THREE.TextureLoader().load("icon/ob_red_flag.png"));
    ob_texture.set("icon/ob_green_flag.png", new THREE.TextureLoader().load("icon/ob_green_flag.png"));
    ob_texture.set("icon/ob_yellow_flag.png", new THREE.TextureLoader().load("icon/ob_yellow_flag.png"));
    ob_texture.set("icon/ob_orange_flag.png", new THREE.TextureLoader().load("icon/ob_orange_flag.png"));
    ob_texture.set("icon/ob_yellow_square.png", new THREE.TextureLoader().load("icon/ob_yellow_square.png"));
    ob_texture.set("icon/ob_orange_square.png", new THREE.TextureLoader().load("icon/ob_orange_square.png"));
    ob_texture.set("icon/ob_red_square.png", new THREE.TextureLoader().load("icon/ob_red_square.png"));
    ob_texture.set("icon/ob_purple_square.png", new THREE.TextureLoader().load("icon/ob_purple_square.png"));
    ob_texture.set("icon/ob_green_square.png", new THREE.TextureLoader().load("icon/ob_green_square.png"));
    ob_texture.set("icon/ob_blue_square.png", new THREE.TextureLoader().load("icon/ob_blue_square.png"));
    ob_texture.set("icon/ob_script.png", new THREE.TextureLoader().load("icon/ob_script.png"));
    ob_texture.set("icon/ob_crontab.png", new THREE.TextureLoader().load("icon/ob_crontab.png"));
    ob_texture.set("icon/ob_clock.png", new THREE.TextureLoader().load("icon/ob_clock.png"));
    ob_texture.set("icon/ob_info2.png", new THREE.TextureLoader().load("icon/ob_info2.png"));
    ob_texture.set("icon/ob_delete.png", new THREE.TextureLoader().load("icon/ob_delete.png"));
    ob_texture.set("icon/ob_yellow_ring.png", new THREE.TextureLoader().load("icon/ob_yellow_ring.png"));


    // Satellite/Communication texture
    ob_texture.set("icon/ob_connect.png", new THREE.TextureLoader().load("icon/ob_connect.png"));
    ob_texture.set("icon/ob_no_connect.png", new THREE.TextureLoader().load("icon/ob_no_connect.png"));
    ob_texture.set("icon/ob_satellite.png", new THREE.TextureLoader().load("icon/ob_satellite.png"));
    ob_texture.set("icon/ob_no_satellite.png", new THREE.TextureLoader().load("icon/ob_no_satellite.png"));
    ob_texture.set("icon/ob_no_tlm_red.png", new THREE.TextureLoader().load("icon/ob_no_tlm_red.png"));
    ob_texture.set("icon/ob_tlm_red.png", new THREE.TextureLoader().load("icon/ob_tlm_red.png"));
    ob_texture.set("icon/ob_tlm_green.png", new THREE.TextureLoader().load("icon/ob_tlm_green.png"));
    ob_texture.set("icon/ob_tlm_orange.png", new THREE.TextureLoader().load("icon/ob_tlm_orange.png"));

    OB_TIMELINE.prototype.get_synced_time = function () {
        try {
            if (this.date === "current_time" || this.date === "Date.now()") {
                return this.timeZone === "UTC" ? this.getUTCTime(Date.now()) : Date.now();
            } else if (this.date.length === 4) {
                return this.getUTCFullYearTime(parseInt(this.date));
            } else {
                return this.getUTCTime(Date.parse(this.date));
            }
        } catch (err) {
            console.log("get_synced_time(): Invalid timeline date - set to default: current date");
            return this.timeZone === "UTC" ? this.getUTCTime(Date.now()) : Date.now();
        }
    };

    OB_TIMELINE.prototype.get_current_time = function () {
        return this.timeZone === "UTC" ? this.getUTCTime(Date.now()) : Date.now();
    };

    OB_TIMELINE.prototype.reset_synced_time = function (ob_case, ob_scene_index) {
        clearInterval(this.ob_interval_clock);
        try {
            if (ob_case === "new_view") {
                this.ob_scene.sync_time = Date.parse(this.ob_markerDate.toString());
                this.ob_scene[ob_scene_index].date = new Date(this.ob_scene.sync_time);
                this.ob_scene[ob_scene_index].offset = this.ob_scene[ob_scene_index].width;
                this.set_bands(ob_scene_index);
                this.update_bands_MinDate(ob_scene_index, this.ob_scene[ob_scene_index].date);
                this.update_bands_MaxDate(ob_scene_index, this.ob_scene[ob_scene_index].date);
            } else if (ob_case === "new_sync") {
                this.ob_set_scene(ob_scene_index);
                this.ob_scene_init(ob_scene_index);
                this.setGregorianUnitLengths(ob_scene_index);
                this.ob_scene.sync_time = this.get_synced_time();
                this.ob_scene[ob_scene_index].date = new Date(this.ob_scene.sync_time);
                this.set_bands(ob_scene_index);
                this.update_bands_MinDate(ob_scene_index, this.ob_scene[ob_scene_index].date);
                this.update_bands_MaxDate(ob_scene_index, this.ob_scene[ob_scene_index].date);
                this.ob_scene[ob_scene_index].minDate = this.iniMinDate;
                this.ob_scene[ob_scene_index].maxDate = this.iniMaxDate;
            } else if (ob_case === "re_sync") {
                this.ob_set_scene(ob_scene_index);
                this.ob_scene_init(ob_scene_index);
                this.setGregorianUnitLengths(ob_scene_index);
                this.ob_scene.sync_time = this.get_synced_time();
                this.ob_scene[ob_scene_index].date = new Date(this.ob_scene.sync_time);
                this.set_bands(ob_scene_index);
                this.update_bands_MinDate(ob_scene_index, this.ob_scene[ob_scene_index].date);
                this.update_bands_MaxDate(ob_scene_index, this.ob_scene[ob_scene_index].date);
            } else if (ob_case === "new_search") {
                this.ob_scene.sync_time = Date.parse(this.ob_markerDate.toString());
            } else if (ob_case === "new_calendar_date") {
                this.first_sync = true;
                if (this.timeZone === "UTC")
                    this.ob_scene.sync_time =
                        this.getUTCTime(Date.parse(this.ob_scene[ob_scene_index].date_cal));
                else
                    this.ob_scene.sync_time = Date.parse(this.ob_scene[ob_scene_index].date_cal);
                this.ob_scene[ob_scene_index].date = this.ob_scene[ob_scene_index].date_cal;
                this.set_bands(ob_scene_index);
                this.update_bands_MinDate(ob_scene_index, this.ob_scene[ob_scene_index].date);
                this.update_bands_MaxDate(ob_scene_index, this.ob_scene[ob_scene_index].date);
            } else {
                this.ob_scene.sync_time = Date.parse(this.ob_markerDate.toString());
            }
        } catch (err) {
            console.log("reset_synced_time(): Exception - Cannot sync time");
            if (this.timeZone === "UTC")
                this.ob_scene.sync_time = this.getUTCTime(Date.now());
            else
                this.ob_scene.sync_time = Date.now();
        }
    };

    OB_TIMELINE.prototype.ob_get_url_head = function () {
        this.data_head = this.data.split("?");
        if (this.data.match(/_sse/))
            return this.data_head[0].replace(this.data_default_port, this.data_sse_port).split("?");
        else
            return this.data_head[0].replace("63342", this.data_default_port).split("?");
    };

    OB_TIMELINE.prototype.getTimeZone = function () {
        this.timeZoneOffset = new Date().getTimezoneOffset();
        this.timeZone = "";
        if (this.date.includes("UTC"))
            this.timeZone = "UTC";
        if (this.params[0].timeZone === "UTC")
            this.timeZone = this.params[0].timeZone;
    };

    OB_TIMELINE.prototype.ob_init = function () {
        // Set all timeline parameters:
        if (this.ob_user_name === undefined)
            this.getLocalStorage();
        this.name = this.params[0].name;
        this.date = this.params[0].date;
        this.timeZone = this.params[0].timeZone;
        this.data_default_port = this.params[0].data_default_port;
        this.data_sse_port = this.params[0].data_sse_port;
        this.data = this.params[0].data.replace("data_default_port",
            this.data_default_port).replace("data_sse_port", this.data_sse_port);
        if (this.params[0].title !== undefined)
            this.title = this.params[0].title;
        else
            this.title = "";
        // -- set time zone --
        this.getTimeZone();
        this.camera = this.params[0].camera;
        this.descriptor = this.params[0].descriptor;
        this.top = parseInt(this.params[0].top);
        this.left = parseInt(this.params[0].left);
        this.width = parseInt(this.params[0].width);
        this.height = parseInt(this.params[0].height);
        this.backgroundColor = this.params[0].backgroundColor;
        this.fontSize = this.params[0].fontSize;
        if (this.fontSize !== undefined && !isNaN(this.fontSize)) {
            try {
                this.fontSizeInt = this.params[0].fontSize.replace("px", "");
            } catch (e) {
                this.fontSizeInt = this.params[0].fontSize;
            }
            this.fontSize = this.fontSizeInt + "px";
        } else {
            this.fontSize = "12px";
            this.fontSizeInt = "12";
        }
        if (this.params[0].fontFamily === undefined) {
            this.fontFamily = 'Arial';
        } else {
            this.fontFamily = this.params[0].fontFamily;
        }
        if (this.params[0].fontStyle === undefined) {
            this.fontStyle = 'Normal';
        } else {
            this.fontStyle = this.params[0].fontStyle;
        }
        if (this.params[0].fontWeight === undefined) {
            this.fontWeight = 'Normal';
        } else {
            this.fontWeight = this.params[0].fontWeight;
        }
    }
    OB_TIMELINE.prototype.ob_scene_init = function (ob_scene_index) {
        // Set all timeline scene parameters:
        this.ob_scene[ob_scene_index].multiples = 45;
        this.ob_scene[ob_scene_index].increment = 20;

        if (this.ob_scene[ob_scene_index].ob_filter_name === undefined)
            this.ob_scene[ob_scene_index].ob_filter_name = "ALL";
        if (this.ob_scene[ob_scene_index].ob_filter_value === undefined)
            this.ob_scene[ob_scene_index].ob_filter_value = "";
        if (this.ob_scene[ob_scene_index].ob_search_value === undefined)
            this.ob_scene[ob_scene_index].ob_search_value = "";
        this.regex = "^(?=.*(?:--|--))(?!.*(?:--|--)).*$";

        this.ob_scene[ob_scene_index].ob_camera_type = this.camera;
        this.ob_scene[ob_scene_index].ob_pos_camera_y = this.ob_scene[ob_scene_index].ob_height / 2;
        if (this.ob_scene[ob_scene_index].ob_height > 2000) {
            this.ob_scene[ob_scene_index].ob_pos_camera_x = -1500;
        } else if (this.ob_scene[ob_scene_index].ob_height > 1000) {
            this.ob_scene[ob_scene_index].ob_pos_camera_x = -1000;
        } else {
            this.ob_scene[ob_scene_index].ob_pos_camera_x = -100;
        }
        this.ob_scene[ob_scene_index].ob_pos_camera_z = this.ob_scene[ob_scene_index].ob_height / 2;

        this.ob_scene[ob_scene_index].ob_far = 50000;
        this.ob_scene[ob_scene_index].ob_near = 1;
        this.ob_scene[ob_scene_index].ob_fov = 70;
        this.ob_scene[ob_scene_index].ob_lookAt_x = 0;
        this.ob_scene[ob_scene_index].ob_lookAt_y = this.ob_scene[ob_scene_index].ob_height / 2;
        this.ob_scene[ob_scene_index].ob_lookAt_z = 0;

        this.ob_scene[ob_scene_index].descriptor = this.descriptor;
        this.ob_scene[ob_scene_index].center = "center";
        this.ob_scene[ob_scene_index].font_align = "right";

        // -- set timeline top --
        try {
            if (this.top !== undefined && !isNaN(this.top)) {
                this.ob_scene[ob_scene_index].top = this.top;
            } else {
                console.log("ob_scene_init(): timeline top not defined - set to default : 0");
                this.top = 0;
                this.ob_scene[ob_scene_index].top = this.top;
            }
        } catch (err) {
            console.log("ob_scene_init(): Wrong timeline top - set to default : 0");
            this.ob_scene[ob_scene_index].top = 0;
        }

        // -- set timeline height --
        try {

            if (this.height !== undefined && !isNaN(this.height)) {
                this.ob_scene[ob_scene_index].ob_height = parseInt(this.height);
            } else {
                console.log("ob_scene_init(): timeline height not defined - set to default : 800");
                this.height = 800;
                this.ob_scene[ob_scene_index].ob_height = this.height;
            }
        } catch (err) {
            console.log("ob_scene_init(): Wrong timeline height - set to default : 800");
            this.ob_scene[ob_scene_index].ob_height = 800;
        }

        // -- set timeline width --
        try {
            if (this.width !== undefined && !isNaN(this.width)) {
                this.ob_scene[ob_scene_index].width = this.width;
            } else {
                console.log("ob_scene_init(): timeline width not defined - set to default : 800");
                this.width = 1350;
                this.ob_scene[ob_scene_index].width = this.width;
            }
        } catch (err) {
            console.log("ob_scene_init(): Wrong timeline width - set to default : 800");
            this.ob_scene[ob_scene_index].width = 800;
        }
        // -- set timeline left --
        try {
            if (this.left !== undefined && !isNaN(this.left)) {
                this.ob_scene[ob_scene_index].left = this.left;
            } else {
                console.log("ob_scene_init(): timeline left not defined - set to default : 0");
                this.left = 0;
                this.ob_scene[ob_scene_index].left = this.left;
            }
        } catch (err) {
            console.log("ob_scene_init(): Wrong timeline width - set to default : 0");
            this.ob_scene[ob_scene_index].left = 0;
        }
    };

    OB_TIMELINE.prototype.ob_apply_timeline_info = function (ob_scene_index) {
        this.top = parseInt(document.getElementById(this.name + "_top").value);
        this.left = parseInt(document.getElementById(this.name + "_left").value);
        this.height = parseInt(document.getElementById(this.name + "_height").value);
        this.width = parseInt(document.getElementById(this.name + "_width").value);
        this.update_scene(ob_scene_index, this.header, this.params, this.ob_scene[ob_scene_index].bands,
            this.ob_scene[ob_scene_index].model, this.ob_scene[ob_scene_index].sessions,
            this.ob_scene[ob_scene_index].ob_camera_type, null, false);
    };

    OB_TIMELINE.prototype.ob_apply_timeline_sorting = function (ob_scene_index) {
        try {
            this.ob_scene[ob_scene_index].bands[0].model[0].sortBy = document.getElementById("ob_sort_by").value;
            if (this.ob_scene[ob_scene_index].bands[0].model[0].sortBy === "NONE") {
                this.ob_view.style.visibility = "visible";
                this.ob_no_view.style.visibility = "visible";
            } else {
                this.ob_view.style.visibility = "hidden";
                this.ob_no_view.style.visibility = "hidden";
            }
            this.update_scene(ob_scene_index, this.header, this.params, this.ob_scene[ob_scene_index].bands,
                this.ob_scene[ob_scene_index].model, this.ob_scene[ob_scene_index].sessions,
                this.ob_scene[ob_scene_index].ob_camera_type, null, false);
        } catch (err) {
        }
    };
    OB_TIMELINE.prototype.ob_apply_orthographic_camera = function (ob_scene_index) {
        this.ob_scene[ob_scene_index].ob_camera_type = "Orthographic";
        this.update_scene(ob_scene_index, this.header, this.params, this.ob_scene[ob_scene_index].bands,
            this.ob_scene[ob_scene_index].model, this.ob_scene[ob_scene_index].sessions,
            this.ob_scene[ob_scene_index].ob_camera_type, null, false);
    };
    OB_TIMELINE.prototype.ob_apply_perspective_camera = function (ob_scene_index) {
        this.ob_scene[ob_scene_index].ob_camera_type = "Perspective";
        this.update_scene(ob_scene_index, this.header, this.params, this.ob_scene[ob_scene_index].bands,
            this.ob_scene[ob_scene_index].model, this.ob_scene[ob_scene_index].sessions,
            this.ob_scene[ob_scene_index].ob_camera_type, null, false);
    };
    OB_TIMELINE.prototype.ob_cancel_setting = function (ob_scene_index) {
        this.ob_remove_setting();
        this.update_scene(ob_scene_index, this.header, this.params, this.ob_scene[ob_scene_index].bands,
            this.ob_scene[ob_scene_index].model, this.ob_scene[ob_scene_index].sessions,
            this.ob_scene[ob_scene_index].ob_camera_type, null, false);
    };
    OB_TIMELINE.prototype.ob_add_event = function (ob_scene_index) {
        let title = document.getElementById(this.name + "_addEvent").value;
        let startEventUTC;
        try {
            let startEvent = document.getElementById(this.name + "_start").value;
            startEventUTC = new Date(this.getUTCTime(Date.parse(startEvent))).toString().substring(0, 24) + " UTC";
            if (startEventUTC.includes("Invalid")) return;
        } catch (e) {
            startEventUTC = "";
        }
        let endEventUTC = "";
        try {
            let endEvent = document.getElementById(this.name + "_end").value;
            endEventUTC = new Date(this.getUTCTime(Date.parse(endEvent))).toString().substring(0, 24) + " UTC";
            if (endEventUTC.includes("Invalid")) endEventUTC = "";
        } catch (e) {
            endEventUTC = "";
        }
        let description = document.getElementById(this.name + "_description").value;
        let icon = document.getElementById(this.name + "_icon").value;

        this.data = this.ob_get_url_head(ob_scene_index) +
            "?ob_request=" + "addEvent" +
            "&scene=" + ob_scene_index +
            "&title=" + title +
            "&startEvent=" + startEventUTC +
            "&endEvent=" + endEventUTC +
            "&description=" + description +
            "&startDate=" + this.ob_scene[ob_scene_index].minDate +
            "&endDate=" + this.ob_scene[ob_scene_index].maxDate +
            "&icon=" + icon +
            "&filterName=" + this.ob_scene[ob_scene_index].ob_filter_name +
            "&filter=" + this.ob_scene[ob_scene_index].ob_filter_value +
            "&search=" + this.ob_scene[ob_scene_index].ob_search_value +
            "&timelineName=" + this.name +
            "&userName=" + this.ob_user_name;
        this.load_data(ob_scene_index);
    };
    OB_TIMELINE.prototype.ob_get_all_sorting_options = function (ob_scene_index) {
        let OB_MAX_ATT_VALUE = 15;
        let ob_build_all_sorting_options = "<option value='" + "NONE" + "'>" + "NONE" + "</option>\n";
        try {
            for (let [key, value] of this.ob_scene[ob_scene_index].model.entries()) {
                let ob_key_display = true;
                let value_items = value.split(",");

                if (value_items.length > 1) {
                    for (let i = 0; i < value_items.length; i++) {
                        if (value_items[i].length > OB_MAX_ATT_VALUE) {
                            ob_key_display = false;
                            break;
                        }
                    }
                    // Allow only Sorting for short attribute value not longer than OB_MAX_ATT_VALUE
                    if (ob_key_display === true) {
                        ob_build_all_sorting_options += "  <option value='" + key + "'>" + key + " </option>\n";
                    }
                }
            }
        } catch (err) {
            return "";
        }
        return ob_build_all_sorting_options;
    };

    OB_TIMELINE.prototype.ob_help_filters = function () {
        const helpMessage = `
        Usage: <Include filters>|<Exclude filters>

        Example 1: Include only sessions with the status SCHEDULE:
        status=SCHEDULE

        Example 2: Include sessions with type0, type1, and type2:
        type=type0;type=type1;type=type2

        Example 3: Exclude sessions with type0, type1, and type2:
        |type=type0;type=type1;type=type2

        Example 4: Include sessions with type0, type1, and type2, and exclude sessions with type0 and status STARTED:
        type=type0;type=type1;type=type2|type0+status=STARTED
    `;

        alert(helpMessage);
    };

    OB_TIMELINE.prototype.ob_get_filter_value = function (ob_scene_index, ob_filter_index) {
        try {
            let ob_filter_value;
            if (this.ob_filters !== undefined && ob_filter_index !== undefined) {
                ob_filter_value = document.getElementById("textarea2_" + this.name + "_" + this.ob_filters[ob_filter_index].name).value;
            } else {
                ob_filter_value = document.getElementById("textarea2_" + this.name + "_new").value;
            }
            ob_filter_value = ob_filter_value.replace(/[^a-zA-Z0-9;|\\\/\-+=:_()% ]/g, "");
            ob_filter_value = ob_filter_value.replaceAll("|", "_PIPE_")
                .replaceAll("+", "_PLUS_")
                .replaceAll("%", "_PERC_")
                .replaceAll("(", "_PARL_")
                .replaceAll(")", "_PARR_");
            return ob_filter_value;
        } catch (err) {
            try {
                let ob_filter_value = this.ob_filters[ob_filter_index].filter_value;
                if (ob_filter_value === undefined) {
                    ob_filter_value = this.ob_scene[ob_scene_index].ob_filter_value;
                }
                ob_filter_value = ob_filter_value.replaceAll("|", "_PIPE_")
                    .replaceAll("+", "_PLUS_")
                    .replaceAll("%", "_PERC_")
                    .replaceAll(")", "_PARR_")
                    .replaceAll("(", "_PARL_");
                return ob_filter_value;
            } catch (err) {
                return "";
            }
        }
    };


    OB_TIMELINE.prototype.ob_get_filter_name = function (ob_scene_index, ob_filter_index) {
        let ob_filter_name = "";
        try {
            if (this.ob_filters !== undefined && ob_filter_index !== undefined) {
                ob_filter_name = this.ob_filters[ob_filter_index].name;
            } else
                ob_filter_name = document.getElementById("textarea_" + this.name + "_new").value;
            ob_filter_name = ob_filter_name.replaceAll(" ", "_").replace(/[^a-zA-Z0-9_]/g, "");
            this.ob_scene[ob_scene_index].ob_filter_value = ob_filter_name;
            return ob_filter_name;
        } catch (err) {
        }
        return ob_filter_name;
    };

    OB_TIMELINE.prototype.ob_add_filters = function (ob_scene_index) {
        this.ob_create_filters(ob_scene_index, undefined, "add_filter");
    };

    OB_TIMELINE.prototype.ob_read_filter = function (ob_scene_index, ob_filter_index) {
        this.ob_load_filters("readFilters", ob_scene_index, ob_filter_index, false);
    };

    OB_TIMELINE.prototype.ob_update_filter = function (ob_scene_index, ob_filter_index) {
        document.getElementById("ob_sort_by").value = this.ob_filters[ob_filter_index].sortBy;
        this.ob_load_filters("updateFilter", ob_scene_index, ob_filter_index, false);
    };

    OB_TIMELINE.prototype.ob_save_filter = function (ob_scene_index, ob_filter_index) {
        this.ob_load_filters("saveFilter", ob_scene_index, ob_filter_index, true);
    };

    OB_TIMELINE.prototype.ob_delete_filters = function (ob_scene_index, ob_filter_index) {
        this.ob_load_filters("deleteFilter", ob_scene_index, ob_filter_index, true);
    };

    OB_TIMELINE.prototype.ob_load_filters = function (ob_request, ob_scene_index, ob_filter_index, ob_show) {
        let backgroundColor = "";
        if (this.backgroundColor !== undefined)
            backgroundColor = this.backgroundColor;
        if (this.ob_scene[ob_scene_index].ob_camera_type === undefined)
            this.ob_scene[ob_scene_index].ob_camera_type = "Orthographic";
        let ob_filter_name = this.ob_get_filter_name(ob_scene_index, ob_filter_index);
        let ob_filter_value = this.ob_get_filter_value(ob_scene_index, ob_filter_index);
        let ob_sortBy;
        try {
            if (ob_request === "saveFilter") {
                ob_sortBy = document.getElementById("ob_sort_by").value;
                if (ob_sortBy === "") ob_sortBy = "NONE";
                document.getElementById("ob_sort_by").value = ob_sortBy;
            } else
                ob_sortBy = this.ob_filters[ob_filter_index].sortBy;
        } catch (err) {
            ob_sortBy = "NONE";
        }
        if (this.ob_filters !== undefined && this.ob_filters[ob_filter_index] !== undefined) {
            backgroundColor = this.ob_filters[ob_filter_index].backgroundColor;
        }
        backgroundColor = backgroundColor.replaceAll("#", "@");

        this.data = this.ob_get_url_head(ob_scene_index) + "?ob_request=" + ob_request +
            "&filterName=" + ob_filter_name +
            "&scene=" + ob_scene_index +
            "&timelineName=" + this.name +
            "&title=" + this.title +
            "&backgroundColor=" + backgroundColor +
            "&userName=" + this.ob_user_name +
            "&email=" + this.ob_email_name +
            "&top=" + this.ob_scene[ob_scene_index].top +
            "&left=" + this.ob_scene[ob_scene_index].left +
            "&width=" + this.ob_scene[ob_scene_index].width +
            "&height=" + this.ob_scene[ob_scene_index].height +
            "&camera=" + this.ob_scene[ob_scene_index].ob_camera_type +
            "&sortBy=" + ob_sortBy +
            "&filter=" + ob_filter_value;
        this.load_data(ob_scene_index);
        this.show_filters = ob_show;
    };

    OB_TIMELINE.prototype.ob_edit_filters = function (ob_scene_index, ob_filter_index) {
        this.ob_create_filters(ob_scene_index, ob_filter_index, "edit_filter");
    };

    OB_TIMELINE.prototype.ob_select_filters = function (ob_scene_index, ob_filter_index) {
        this.ob_create_filters(ob_scene_index, ob_filter_index, "select_filter");
        if (ob_filter_index !== undefined)
            this.ob_update_filter(ob_scene_index, ob_filter_index);
        this.show_filters = true;
    };

    OB_TIMELINE.prototype.ob_get_all_filters = function (ob_scene_index, ob_filter_index, ob_request) {
        let ob_build_all_filters = "<div>";
        ob_build_all_filters += "<table><tr>\n";
        try {
            if (this.ob_filters !== undefined) {
                for (let i = 0; i < this.ob_filters.length; i++) {
                    try {
                        ob_build_all_filters += "<tr>";
                        ob_build_all_filters += "<td>";
                        if (ob_filter_index === i) {
                            ob_build_all_filters += "<label class='ob_filter_checkbox_container'><input type='radio' checked='checked' id=checkbox_" + this.name + "_" + this.ob_filters[i].name + " onclick=\"get_ob_timeline(\'" + this.name + "\').ob_select_filters(" + ob_scene_index + "," + i + ")\"><span class='ob_filter_span_checkmark'></span></label>";
                            ob_build_all_filters += "</td><td>";
                            ob_build_all_filters += "<textarea disabled class='ob_filter_name id=textarea_" + this.name + "_" + this.ob_filters[i].name + " rows=' 1' >" + this.ob_filters[i].name + "</textarea>";
                            ob_build_all_filters += "</td><td>";
                            if (ob_request === "edit_filter") {
                                ob_build_all_filters += "<img alt='' class='ob_filter_save' id=save_" + this.name + "_" + this.ob_filters[i].name + " onclick=\"get_ob_timeline(\'" + this.name + "\').ob_save_filter(" + ob_scene_index + "," + i + ")\">";
                            } else {
                                ob_build_all_filters += "<img alt='' class='ob_filter_edit' id=edit_" + this.name + "_" + this.ob_filters[i].name + " onclick=\"get_ob_timeline(\'" + this.name + "\').ob_edit_filters(" + ob_scene_index + "," + i + ")\">";
                            }
                            ob_build_all_filters += "</td><td>";
                            ob_build_all_filters += "<img alt='' class='ob_filter_delete' alt='' id=delete" + this.name + "_" + this.ob_filters[i].name + " onclick=\"get_ob_timeline(\'" + this.name + "\').ob_delete_filters(" + ob_scene_index + "," + i + ")\">";
                        } else {
                            ob_build_all_filters += "<label class='ob_filter_checkbox_container'><input type='radio' id=checkbox_" + this.name + "_" + this.ob_filters[i].name + " onclick=\"get_ob_timeline(\'" + this.name + "\').ob_select_filters(" + ob_scene_index + "," + i + ")\"><span class='ob_filter_span_checkmark'></span></label>";
                            ob_build_all_filters += "</td><td>";
                            ob_build_all_filters += "<textarea disabled class='ob_filter_name id=textarea_" + this.name + "_" + this.ob_filters[i].name + " rows=' 1'" + ">" + this.ob_filters[i].name + "</textarea>";
                            ob_build_all_filters += "</td ><td>";
                            ob_build_all_filters += "</td ><td>";
                            ob_build_all_filters += "</td><td>";
                            ob_build_all_filters += "</td ><td>";
                        }
                        ob_build_all_filters += "</td>";
                        ob_build_all_filters += "</tr>";
                        if (ob_request === "edit_filter" && i === ob_filter_index) {
                            ob_build_all_filters += "<tr>";
                            ob_build_all_filters += "<td>";
                            ob_build_all_filters += "</td><td>";
                            ob_build_all_filters += "<textarea class='ob_filter_text' id=textarea2_" + this.name + "_" + this.ob_filters[i].name + " rows='2' >" + this.ob_filters[i].filter_value + "</textarea>";
                            ob_build_all_filters += "</td><td>";
                            ob_build_all_filters += "</td><td>";
                            ob_build_all_filters += "</td>";
                            ob_build_all_filters += "</tr>";
                        }
                    } catch (e) {
                        return "";
                    }
                }
                ob_build_all_filters += "<tr>";
                ob_build_all_filters += "<td>";
                if (ob_filter_index === undefined) {
                    ob_build_all_filters += "<label class='ob_filter_checkbox_container'><input type='radio' checked='checked' id=checkbox_" + this.name + "_" + "new" + " onclick=\"get_ob_timeline(\'" + this.name + "\').ob_add_filters(" + ob_scene_index + "," + undefined + ")\"><span class='ob_filter_span_checkmark'></span></label>";
                } else {
                    ob_build_all_filters += "<label class='ob_filter_checkbox_container'><input type='radio' id=checkbox_" + this.name + "_" + "new" + " onclick=\"get_ob_timeline(\'" + this.name + "\').ob_select_filters(" + ob_scene_index + ")\"><span class='ob_filter_span_checkmark'></span></label>";
                }
                ob_build_all_filters += "</td><td>";
                if (ob_request === "edit_filter" && ob_filter_index === undefined) {
                    ob_build_all_filters += "<textarea class='ob_filter_name' id=textarea_" + this.name + "_new rows='1' >" + "<Add a new filter>" + "</textarea>";
                } else {
                    ob_build_all_filters += "<textarea disabled class='ob_filter_name' id=textarea_" + this.name + "_new rows='1' >" + "<Add a new filter>" + "</textarea>";
                }
                ob_build_all_filters += "</td><td>";
                if (ob_request === "select_filter" && ob_filter_index === undefined) {
                    ob_build_all_filters += "<img alt='' class='ob_filter_edit' alt='' id=edit_" + "new" + " onclick=\"get_ob_timeline(\'" + this.name + "\').ob_edit_filters(" + ob_scene_index + "," + undefined + ")\">";
                }
                if (ob_request === "edit_filter" && ob_filter_index === undefined) {
                    ob_build_all_filters += "<img class='ob_filter_save' alt='' id=save_" + this.name + "_" + "new" + " onclick=\"get_ob_timeline(\'" + this.name + "\').ob_save_filter(" + ob_scene_index + "," + undefined + ")\">";
                }
                ob_build_all_filters += "</td><td>";
                ob_build_all_filters += "<img alt='' class='ob_filter_help' alt='' id=help_" + this.name + " onclick=\"get_ob_timeline(\'" + this.name + "\').ob_help_filters(" + ob_scene_index + ")\">";
                ob_build_all_filters += "</td>";
                ob_build_all_filters += "</tr>";
                if (ob_request === "edit_filter" && ob_filter_index === undefined) {
                    ob_build_all_filters += "<tr>";
                    ob_build_all_filters += "<td>";
                    ob_build_all_filters += "</td><td>";
                    ob_build_all_filters += "<textarea class='ob_filter_text' id=textarea2_" + this.name + "_new rows='2' >" + "" + "</textarea>";
                    ob_build_all_filters += "</td><td>";
                    ob_build_all_filters += "</td><td>";
                    ob_build_all_filters += "</td>";
                    ob_build_all_filters += "</tr>";
                }
            }
        } catch (err) {
            return "";
        }
        ob_build_all_filters += "</table>";
        return ob_build_all_filters;
    };


    OB_TIMELINE.prototype.ob_create_filters = function (ob_scene_index, ob_filter_index, ob_request) {
        this.show_filters = false;
        let ob_sorting_by = "NONE";
        let ob_filtering = "";
        this.ob_remove_descriptor();
        this.ob_remove_calendar();
        this.ob_remove_help();
        this.ob_remove_setting();
        this.ob_remove_login();
        try {
            ob_sorting_by = this.ob_scene[ob_scene_index].bands[0].model[0].sortBy;
        } catch (err) {
            ob_filtering = "NONE";
        }
        try {
            if (document.getElementById(this.name + "_setting") !== null) {
                this.ob_remove_sorting();
                return;
            }
            this.ob_timeline_right_panel.style.visibility = "visible";
            let div = document.createElement("div");
            div.className = "ob_descriptor";
            div.id = this.name + '_setting';
            if (window.innerHeight > parseInt(this.ob_scene[ob_scene_index].ob_height) +
                parseInt(this.ob_timeline_header.style.height))
                div.style.height = parseInt(this.ob_scene[ob_scene_index].ob_height) +
                    parseInt(this.ob_timeline_header.style.height) + "px";
            else
                div.style.height = window.innerHeight + "px";
            div.style.width = "100%";

            div.innerHTML = "" +
                "<div class='ob_descriptor_head' >Sorting & Filtering<\div>\n" +
                "<div class='ob_form1'>\n" +
                "<form>\n" +
                "<fieldset>\n" +
                "<legend><span class='number'>1 - </span>Timeline sorting by " + ob_sorting_by + "</legend>\n" +
                "<input class='ob_sort_by' type='label' disabled value='Sort by :'>\n" +
                "<select id='ob_sort_by' name='ob_sorting_by'>\n" +
                this.ob_get_all_sorting_options(ob_scene_index) +
                "</select>      \n" +
                "</fieldset>\n" +
                "<fieldset>" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_apply_timeline_sorting(" + ob_scene_index + ");\" value='Apply' />\n" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_cancel_setting(" + ob_scene_index + ");\" value='Close' />\n" +
                "</fieldset>\n" +
                "<legend><span class='number'>2 - </span>Timeline Filtering " + ob_filtering + "</legend>\n" +
                "<fieldset>\n" +
                //this.ob_get_all_filtering_options(ob_scene_index) +
                this.ob_get_all_filters(ob_scene_index, ob_filter_index, ob_request) +
                "</fieldset>\n" +
                "<fieldset>" +
                "</form>\n" +
                "<div class='ob_gui_iframe_container' id='" + this.name + "_gui_iframe_container' style='position:absolute;'> </div>\n" +
                "</div>";

            this.ob_timeline_right_panel.style.top = this.ob_timeline_panel.offsetTop + "px";
            this.ob_timeline_right_panel.style.left = this.ob_timeline_panel.offsetLeft + parseInt(this.ob_timeline_panel.style.width) + "px";
            this.ob_timeline_right_panel.appendChild(div);
            try {
                document.getElementById("ob_sort_by").value = this.ob_scene[ob_scene_index].bands[0].model[0].sortBy;
            } catch (err) {
            }
        } catch
            (err) {
        }
    };

    OB_TIMELINE.prototype.ob_remove_sorting = function () {
        try {
            this.ob_timeline_right_panel.style.visibility = "hidden";
            this.ob_timeline_right_panel.removeChild(document.getElementById(this.name + "_sorting"));
        } catch (err) {
        }
    };
    OB_TIMELINE.prototype.ob_create_setting = function (ob_scene_index) {
        this.ob_remove_descriptor();
        this.ob_remove_calendar();
        this.ob_remove_help();
        this.ob_remove_sorting();
        this.ob_remove_login();
        try {
            if (document.getElementById(this.name + "_setting") !== null) {
                this.ob_remove_setting();
                return;
            }
            this.ob_timeline_right_panel.style.visibility = "visible";
            let div = document.createElement("div");
            div.className = "ob_head_panel";
            div.id = this.name + '_setting';
            let now = new Date();
            now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
            div.innerHTML = "" +
                "<div style='padding:8px;text-align:center;'>Setting<\div>\n" +
                "<div class='ob_form1'>\n" +
                "<form>\n" +
                "<fieldset>\n" +
                "<legend><span class='number'>1 - </span>Timeline Info</legend>\n" +
                "<input type='label' disabled value='Top :'>\n" +
                "<input type='number' id=" + this.name + "_top value='" + this.ob_scene[ob_scene_index].top + "'>\n" +
                "<input type='label' disabled value='Left :'>\n" +
                "<input type='number' id=" + this.name + "_left value='" + this.ob_scene[ob_scene_index].left + "'>\n" +
                "<input type='label' disabled value='Width :'>\n" +
                "<input type='number' id=" + this.name + "_width value='" + this.ob_scene[ob_scene_index].width + "'>\n" +
                "<input type='label' disabled value='Height :'>\n" +
                "<input type='number' id=" + this.name + "_height value='" + this.ob_scene[ob_scene_index].ob_height + "'>\n" +
                "</fieldset>\n" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_apply_timeline_info(" + ob_scene_index + ");\" value='Apply Timeline Info' />\n" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_cancel_setting(" + ob_scene_index + ");\" value='Close' />\n" +
                "<fieldset>\n" +
                "<legend><span class='number'>2 - </span>Timeline Camera Info</legend>\n" +
                "</fieldset>\n" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_apply_orthographic_camera(" + ob_scene_index + ");\" value='Orthographic' />\n" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_apply_perspective_camera(" + ob_scene_index + ");\" value='Perspective' />\n" +
                "</form>\n" +
                "<div class='ob_gui_iframe_container' id='" + this.name + "_gui_iframe_container2' style='position:absolute;'> </div>\n" +
                "</div>";
            this.ob_timeline_right_panel.style.top = this.ob_timeline_panel.offsetTop + "px";
            this.ob_timeline_right_panel.style.left = this.ob_timeline_panel.offsetLeft + parseInt(this.ob_timeline_panel.style.width) + "px";
            this.ob_timeline_right_panel.appendChild(div);
            document.getElementById(this.name + "_start").value = now.toISOString().slice(0, 16);

        } catch (err) {
        }
    };

    OB_TIMELINE.prototype.ob_remove_setting = function () {
        try {
            this.ob_timeline_right_panel.style.visibility = "hidden";
            this.ob_timeline_right_panel.removeChild(document.getElementById(this.name + "_setting"));
        } catch (err) {
        }
    };

    OB_TIMELINE.prototype.ob_connected = function (ob_scene_index) {
        if (this.ob_start === undefined) return;
        this.ob_start.style.visibility = "visible";
        this.ob_stop.style.visibility = "hidden";
        this.ob_scene[ob_scene_index].connected = true;
    };

    OB_TIMELINE.prototype.ob_not_connected = function (ob_scene_index) {
        if (this.ob_start === undefined) return;
        this.ob_start.style.visibility = "hidden";
        this.ob_stop.style.visibility = "visible";
        this.ob_scene[ob_scene_index].connected = false;
    };

    OB_TIMELINE.prototype.ob_save_user = function (ob_scene_index) {
        this.ob_user_name = document.getElementById(this.name + "_user").value.toLowerCase();
        this.ob_email_name = document.getElementById(this.name + "_email").value.toLowerCase();
        if (this.ob_user_name.replace(/ /g, "") !== "") {
            localStorage.user = JSON.stringify({name: this.ob_user_name.toLowerCase()});
            localStorage.email = JSON.stringify({name: this.ob_email_name.toLowerCase()});
        }
        this.ob_remove_login();
        this.ob_read_filter(ob_scene_index, 0);
    };

    OB_TIMELINE.prototype.ob_cancel_user = function () {
        this.ob_remove_login();
    };

    OB_TIMELINE.prototype.ob_login = function (ob_scene_index) {
        this.ob_remove_descriptor();
        this.ob_remove_calendar();
        this.ob_remove_setting();
        this.ob_remove_sorting();
        this.ob_remove_help();
        this.ob_remove_login();
        try {
            if (document.getElementById(this.name + "_help") !== null) {
                return;
            }
            this.ob_timeline_right_panel.style.visibility = "visible";
            let div = document.createElement("div");
            div.className = "ob_head_panel";
            div.id = this.name + '_login';
            div.innerHTML = "<div style='padding:8px;text-align: center;'>OpenBEXI timeline<\div>\n" +
                "<div class=\"ob_form1\">\n" +
                "<br>" + "<br>" +
                "<form>\n" +
                "<legend><span class='number'></span>User</legend>\n" +
                "<br>" +
                "<input type='label' disabled value='Name :'>\n" +
                "<input type='string' id=" + this.name + "_user value='" + this.ob_user_name.toLowerCase() + "'>\n" +
                "<br>" +
                "<input type='label' disabled value='email :'>\n" +
                "<input type='string' id=" + this.name + "_email value='" + this.ob_email_name.toLowerCase() + "'>\n" +
                "<fieldset>\n" +
                "<br>" + "<br>" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_save_user(" + ob_scene_index + ");\" value='Save user data' />\n" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_cancel_user(" + ob_scene_index + ");\" value='Close' />\n" +
                "<fieldset>\n" +
                "</form>\n" +
                "<fieldset>\n" +
                "</div>";

            this.ob_timeline_right_panel.style.top = this.ob_timeline_panel.offsetTop + "px";
            this.ob_timeline_right_panel.style.left = this.ob_timeline_panel.offsetLeft + parseInt(this.ob_timeline_panel.style.width) + "px";
            this.ob_timeline_right_panel.appendChild(div);
        } catch (err) {
        }
    };

    OB_TIMELINE.prototype.ob_remove_login = function () {
        try {
            this.ob_timeline_right_panel.style.visibility = "hidden";
            this.ob_timeline_right_panel.removeChild(document.getElementById(this.name + "_login"));
        } catch (err) {
        }
    };

    OB_TIMELINE.prototype.ob_create_help = function (ob_scene_index) {
        this.ob_remove_descriptor();
        this.ob_remove_calendar();
        this.ob_remove_setting();
        this.ob_remove_sorting();
        this.ob_remove_login();
        try {
            if (document.getElementById(this.name + "_help") !== null) {
                this.ob_remove_help();
                return;
            }
            this.ob_timeline_right_panel.style.visibility = "visible";
            let div = document.createElement("div");
            div.className = "ob_head_panel";
            div.id = this.name + '_help';
            div.innerHTML = "<div style='padding:8px;text-align: center;'>OpenBEXI timeline<\div>\n" +
                "<div class=\"ob_form1\">\n" +
                "</form>\n" +
                "<form>\n" +
                "<legend> version 1.0</legend>\n" +
                "<br>" + "<br>" +
                "</form>\n" +
                "<a  href='https://github.com/arcazj/openbexi_timeline'>https://github.com/arcazj/openbexi_timeline</a >\n" +
                "<img src='openbexi_logo.png' alt='OpenBexi Timeline' width=250 height=210 style='vertical-align:middle;margin:0 50px'>" +
                "<br>" + "<br>" +
                "<form>\n" +
                "<input type='button' onclick=\"get_ob_timeline('" + this.name + "').ob_cancel_user(" + ob_scene_index + ");\" value='Close' />\n"
            "<fieldset>\n" +
            "</form>\n" +
            "<fieldset>\n" +
            "</div>";

            this.ob_timeline_right_panel.style.top = this.ob_timeline_panel.offsetTop + "px";
            this.ob_timeline_right_panel.style.left = this.ob_timeline_panel.offsetLeft + parseInt(this.ob_timeline_panel.style.width) + "px";
            this.ob_timeline_right_panel.appendChild(div);
        } catch (err) {
        }
    };

    OB_TIMELINE.prototype.ob_remove_help = function () {
        try {
            this.ob_timeline_right_panel.style.visibility = "hidden";
            this.ob_timeline_right_panel.removeChild(document.getElementById(this.name + "_help"));
        } catch (err) {
        }
    };

    OB_TIMELINE.prototype.ob_start_clock = function (ob_scene_index) {
        let that_clock = this;
        this.ob_sec_incr = 0;
        try {
            clearInterval(this.ob_interval_clock);
            this.ob_interval_clock = setInterval(function () {
                that_clock.ob_sec_incr++;
                let ob_current_date = new Date(that_clock.get_current_time());
                that_clock.update_time_marker(ob_current_date);
                if (that_clock.ob_sec_incr === 10) {
                    that_clock.ob_sec_incr = 0;
                    that_clock.center_bands(ob_scene_index);
                }
            }, 1000);
        } catch (e) {
        }
    };

    OB_TIMELINE.prototype.ob_create_calendar = function (ob_scene_index, date) {
        if (date === undefined || date === "current_time") date = "now";
        this.ob_remove_descriptor();
        this.ob_remove_help();
        this.ob_remove_setting();
        this.ob_remove_sorting();
        this.ob_remove_login();

        try {
            if (document.getElementById(this.name + "_cal") !== null) {
                this.ob_remove_calendar();
                //return;
            }

            let div = document.createElement("div");
            div.className = "ob_head_panel";
            div.id = this.name + '_help';
            div.innerHTML = "<div style='padding:8px;text-align: center;'>Calendar</div>";
            this.ob_timeline_right_panel.appendChild(div);

            this.ob_timeline_right_panel.style.visibility = "visible";

            this.div_cal = document.createElement("div");
            this.div_cal.id = this.name + "_cal";
            this.div_cal.className = "auto-jsCalendar";
            this.ob_cal = jsCalendar.new(this.div_cal, date, {
                navigator: true,
                navigatorPosition: "both",
                zeroFill: true,
                monthFormat: "MONTH YYYY",
                dayFormat: "DDD",
                firstDayOfTheWeek: "2",
                language: "en"
            });

            let that = this;

            this.ob_cal.onDateClick(function (event, date) {
                if (that.ob_scene[ob_scene_index].ob_interval_move !== undefined)
                    clearInterval(that.ob_scene[ob_scene_index].ob_interval_move);
                that.ob_scene[ob_scene_index].date_cal = date.toString();
                that.ob_scene[ob_scene_index].show_calendar = true;
                that.reset_synced_time("new_calendar_date", ob_scene_index);
                that.ob_remove_calendar();
                if (that.data && (that.data.match(/^(http?):\/\//) || that.data.match(/^(https?):\/\//))) {
                    that.data_head = that.ob_get_url_head(that.ob_scene[ob_scene_index]);
                    that.update_scene(ob_scene_index, that.header, that.params, that.ob_scene[ob_scene_index].bands,
                        that.ob_scene[ob_scene_index].model, that.ob_scene[ob_scene_index].sessions,
                        that.ob_scene[ob_scene_index].ob_camera_type, null, true);
                } else {
                    that.update_scene(ob_scene_index, that.header, that.params, that.ob_scene[ob_scene_index].bands,
                        that.ob_scene[ob_scene_index].model, that.ob_scene[ob_scene_index].sessions,
                        that.ob_scene[ob_scene_index].ob_camera_type, null, false);
                }
            });

            this.ob_cal.onMonthChange(function (event, date) {
                if (that.ob_scene[ob_scene_index].ob_interval_move !== undefined)
                    clearInterval(that.ob_scene[ob_scene_index].ob_interval_move);
                that.ob_scene[ob_scene_index].date_cal = date.toString();
                that.ob_scene[ob_scene_index].show_calendar = true;
                that.reset_synced_time("new_calendar_date", ob_scene_index);
                if (that.data && (that.data.match(/^(http?):\/\//) || that.data.match(/^(https?):\/\//))) {
                    that.data_head = that.ob_get_url_head(that.ob_scene[ob_scene_index]);
                    that.update_scene(ob_scene_index, that.header, that.params, that.ob_scene[ob_scene_index].bands,
                        that.ob_scene[ob_scene_index].model, that.ob_scene[ob_scene_index].sessions,
                        that.ob_scene[ob_scene_index].ob_camera_type, null, true);
                } else {
                    that.update_scene(ob_scene_index, that.header, that.params, that.ob_scene[ob_scene_index].bands,
                        that.ob_scene[ob_scene_index].model, that.ob_scene[ob_scene_index].sessions,
                        that.ob_scene[ob_scene_index].ob_camera_type, null, false);
                }
            });

            this.ob_timeline_right_panel.style.top = this.ob_timeline_panel.offsetTop + "px";
            this.ob_timeline_right_panel.style.left = this.ob_timeline_panel.offsetLeft +
                parseInt(this.ob_timeline_panel.style.width) + "px";

            let ob_add_event_div = document.createElement("div");
            ob_add_event_div.innerHTML = "<br><div style='padding:8px;text-align: left;' class='ob_form1'>\n" +
                "<form>\n" +
                "<fieldset>\n" +
                "<legend><span class='number'> </span><b>Add an event or session:</b></legend>\n" +
                "<input type='label' disabled value='Title:'>\n" +
                "<input type='text' id=" + this.name + "_addEvent value='title1'>\n" +
                "<br>" +
                "<input type='label' disabled value='Start:'>\n" +
                "<input type='datetime-local' id=" + this.name + "_start value=''>\n" +
                "<br>" +
                "<input type='label' disabled value='End:'>\n" +
                "<input type='datetime-local' id=" + this.name + "_end value=''>\n" +
                "<br>" +
                "<input type='label' disabled value='Description:'>\n" +
                "<input type='text' id=" + this.name + "_description value=''>\n" +
                "<br>" +
                "<input type='label' disabled value='Icon:'>\n" +
                "<input type='text' id=" + this.name + "_icon value=''>\n" +
                "<br>" +
                "</fieldset>\n" +
                "<br>" +
                "<input type='button' onclick=\"get_ob_timeline('" + this.name + "').ob_add_event(" + ob_scene_index + ");\" value='Add' />\n" +
                "<input type='button' onclick=\"get_ob_timeline('" + this.name + "').ob_cancel_setting(" + ob_scene_index + ");\" value='Close' />\n" +
                "<fieldset>\n" +
                "</form>\n" +
                "<div class='ob_gui_iframe_container2' id='" + this.name + "_gui_iframe_container2' style='position:absolute;'> </div>\n" +
                "</div>";

            this.div_cal.appendChild(ob_add_event_div);
            this.ob_timeline_right_panel.appendChild(this.div_cal);
        } catch (err) {
            // Handle the error if needed
        }
    };

    OB_TIMELINE.prototype.ob_remove_calendar = function () {
        try {
            this.ob_timeline_right_panel.style.visibility = "hidden";
            this.ob_timeline_right_panel.removeChild(document.getElementById(this.name + "_cal"));
        } catch (err) {
        }
    };

    OB_TIMELINE.prototype.ob_read_descriptor = function (ob_scene_index, ob_event_id, start) {
        this.data = this.ob_get_url_head(ob_scene_index) +
            "?ob_request=" + "readDescriptor" +
            "&scene=" + ob_scene_index +
            "&event_id=" + ob_event_id +
            "&start=" + start +
            "&filterName=" + this.ob_scene[ob_scene_index].ob_filter_name +
            "&filter=" + this.ob_scene[ob_scene_index].ob_filter_value +
            "&search=" + this.ob_scene[ob_scene_index].ob_search_value +
            "&timelineName=" + this.name +
            "&userName=" + this.ob_user_name;
        this.load_data(ob_scene_index);
    };

    OB_TIMELINE.prototype.ob_open_descriptor = function (ob_scene_index, data) {

        this.ob_remove_help();
        this.ob_remove_calendar();
        this.ob_remove_setting();
        this.ob_remove_sorting();
        this.ob_remove_login();

        try {
            this.ob_timeline_right_panel.removeChild(document.getElementById(this.name + "_descriptor"));
        } catch (err) {
        }

        try {
            if (data !== undefined && data.data.description !== "") {
                this.ob_createDescriptor(ob_scene_index, data);
            } else {
                this.ob_createDescriptor(ob_scene_index, data);
                this.ob_read_descriptor(ob_scene_index, data.id, data.start);
            }
        } catch (err) {
        }
    };

    OB_TIMELINE.prototype.ob_remove_descriptor = function () {
        try {
            this.ob_timeline_right_panel.style.visibility = "hidden";
            this.ob_timeline_right_panel.removeChild(document.getElementById(this.name + "_descriptor"));
        } catch (err) {
        }
    };

    OB_TIMELINE.prototype.ob_createDescriptor = function (ob_scene_index, descriptor) {
        // Use default descriptor if a specific descriptor has not been defined somewhere for events or sessions
        if (document.getElementById(this.name + "_descriptor") === null) {
            this.ob_timeline_right_panel.style.visibility = "visible";
            let div = document.createElement("div");
            div.id = this.name + "_descriptor";
            div.className = "ob_descriptor";
            div.style.height = window.innerHeight + "px";
            if (this.ob_scene[ob_scene_index].descriptor === undefined) {
                if (descriptor.id === undefined) descriptor.id = "";
                if (descriptor.end === undefined) descriptor.end = "";
                let ob_descriptor_body = "";
                for (let [key, value] of Object.entries(descriptor.data)) {
                    if (key !== "sortByValue" && key !== "description" && key !== "analyze" && key !== "title" &&
                        value.trim() !== "" && value !== "NA" && value !== "?" && value !== undefined)
                        ob_descriptor_body += "<tr><td class=ob_descriptor_td>" + key + ":</td><td>" + value +
                            "</td></tr>";
                }
                let innerHTML = "<div class=ob_descriptor_head >" + "data" + "<\div><br><br>" +
                    "<table class=ob_descriptor_table id=" + this.name + "_table_start_end" + ">" +
                    "<tr class=ob_descriptor_tr><td class=ob_descriptor_td>id : </td><td class=ob_descriptor_td2>" +
                    descriptor.id + "</td></tr>";
                if (descriptor.original_start !== undefined) {
                    innerHTML = innerHTML + "<tr class=ob_descriptor_tr><td class=ob_descriptor_td>original_start : </td><td class=ob_descriptor_td2>" +
                        descriptor.original_start + "</td></tr>"
                }
                innerHTML = innerHTML + "<tr class=ob_descriptor_tr><td class=ob_descriptor_td>start : </td><td class=ob_descriptor_td2>" +
                    descriptor.start + "</td></tr>";
                if (descriptor.original_end !== undefined) {
                    innerHTML = innerHTML + "<tr class=ob_descriptor_tr><td class=ob_descriptor_td>original_end : </td><td class=ob_descriptor_td2>" +
                        descriptor.original_end + "</td></tr>"
                }
                innerHTML = innerHTML + "<tr class=ob_descriptor_tr><td class=ob_descriptor_td>end : </td><td class=ob_descriptor_td2>" +
                    descriptor.end + "</td></tr>" +
                    "<tr class=ob_descriptor_tr><td></td></tr>" +
                    "<tr class=ob_descriptor_tr><td class=ob_descriptor_td>title:</td><td class=ob_descriptor_td2>" +
                    descriptor.data.title + "</td></tr>" +
                    ob_descriptor_body +
                    "<tr><td></td></tr>" +
                    "<tr class=ob_descriptor_tr><td class=ob_descriptor_td>description:</td><td class=ob_descriptor_td2>" +
                    descriptor.data.description + "</td></tr>" +
                    "</table>";
                div.innerHTML = innerHTML;
                this.ob_timeline_right_panel.appendChild(div);
            } else {
                // Build, eval and display the descriptor
                this.ob_scene[ob_scene_index].descriptor = "this." +
                    this.ob_scene[ob_scene_index].descriptor.replace(".js",
                        "(descriptor)").replace("this.", "");
                this.ob_timeline_right_panel.appendChild(eval(this.ob_scene[ob_scene_index].descriptor));
            }
        }
    };

    OB_TIMELINE.prototype.ob_createTimelineHeader = function (ob_scene_index) {
        let that2 = this;
        this.ob_timeline_header = document.getElementById(this.name + "_header");
        if (this.ob_timeline_header === null || this.ob_timeline_header === undefined) {
            this.ob_timeline_header = document.createElement("div");
            this.ob_timeline_header.className = "ob_head_panel";
            this.ob_timeline_header.style.position = "absolute";
            this.ob_timeline_header.id = this.name + "_header";
            //this.ob_timeline_header.innerText = this.name;
            this.ob_timeline_panel.appendChild(this.ob_timeline_header);
            this.ob_timeline_header.onmousedown = function (event) {
                that2.moving = true;
                // get the mouse cursor position at startup:
                that2.pos3 = event.clientX;
                that2.pos4 = event.clientY;
            };
            this.ob_timeline_header.onmousemove = function (event) {
                that2.ob_timeline_header.style.cursor = "move";
                if (that2.moving !== true) return;
                that2.ob_remove_help();
                that2.ob_remove_calendar();
                that2.ob_remove_descriptor();
                that2.ob_remove_setting();
                that2.ob_remove_login();
                that2.pos1 = that2.pos3 - event.clientX;
                that2.pos2 = that2.pos4 - event.clientY;
                that2.pos3 = event.clientX;
                that2.pos4 = event.clientY;
                that2.ob_timeline_panel.style.top = that2.ob_timeline_panel.offsetTop - that2.pos2 + "px";
                that2.ob_timeline_panel.style.left = that2.ob_timeline_panel.offsetLeft - that2.pos1 + "px";
                that2.ob_timeline_panel_resizer.style.top = (that2.ob_timeline_panel.offsetHeight - 8) + "px";
                that2.ob_timeline_panel_resizer.style.left = (that2.ob_timeline_panel.offsetWidth - 8) + "px";
            };
            this.ob_timeline_header.onmouseup = function () {
                that2.ob_timeline_panel.style.top = that2.ob_timeline_panel.offsetTop - that2.pos2 + "px";
                that2.ob_timeline_panel.style.left = that2.ob_timeline_panel.offsetLeft - that2.pos1 + "px";
                that2.moving = false;
                //that2.ob_timeline_header.style.zIndex = "0";
            };
            this.ob_timeline_header.onmouseout = function () {
                that2.moving = false;
                that2.ob_timeline_header.style.cursor = "default";
                //that2.ob_timeline_header.style.zIndex = "0";
            };

            // Build header menu
            this.ob_start = document.createElement("IMG");
            this.ob_start.className = "ob_start";
            this.ob_start.alt = "Connected to server";
            this.ob_start.style.left = "5px";
            this.ob_start.style.height = 32 + "px";
            this.ob_start.style.width = 32 + "px";
            this.ob_start.onclick = function () {
                if (that2.ob_scene[ob_scene_index].ob_interval_move !== undefined)
                    clearInterval(that2.ob_scene[ob_scene_index].ob_interval_move);
                that2.moving = false;
                that2.ob_login(ob_scene_index);
            };
            this.ob_start.onmousemove = function () {
                that2.moving = false;
                that2.ob_start.style.cursor = "pointer";
            };

            this.ob_stop = document.createElement("IMG");
            this.ob_stop.className = "ob_stop";
            this.ob_stop.alt = "Not connected to server";
            this.ob_stop.style.left = "5px";
            this.ob_stop.style.height = 32 + "px";
            this.ob_stop.style.width = 32 + "px";
            this.ob_stop.onclick = function () {
                if (that2.ob_scene[ob_scene_index].ob_interval_move !== undefined)
                    clearInterval(that2.ob_scene[ob_scene_index].ob_interval_move);
                that2.moving = false;
                that2.ob_login();
            };
            this.ob_stop.onmousemove = function () {
                that2.moving = false;
                that2.ob_stop.style.cursor = "pointer";
            };

            this.ob_calendar = document.createElement("IMG");
            this.ob_calendar.className = "ob_calendar";
            this.ob_calendar.alt = "Calendar browser";
            this.ob_calendar.style.left = "47px";
            this.ob_calendar.style.height = 32 + "px";
            this.ob_calendar.style.width = 32 + "px";
            this.ob_calendar.onclick = function () {
                that2.moving = false;
                //if (that2.ob_scene[ob_scene_index].show_calendar === undefined)
                that2.ob_scene[ob_scene_index].show_calendar = true;
                if (that2.ob_scene[ob_scene_index].show_calendar === true) {
                    that2.ob_create_calendar(ob_scene_index, that2.ob_markerDate);
                    that2.ob_scene[ob_scene_index].show_calendar = false;
                }
            };
            this.ob_calendar.onmousemove = function () {
                that2.moving = false;
                that2.ob_calendar.style.cursor = "pointer";
            };

            this.ob_sync = document.createElement("IMG");
            this.ob_sync.className = "ob_sync";
            this.ob_sync.alt = "Go to current time";
            this.ob_sync.style.left = "89px";
            this.ob_sync.style.height = 32 + "px";
            this.ob_sync.style.width = 32 + "px";
            this.ob_sync.onclick = function () {
                that2.ob_scene.sync_view = true;
                if (that2.ob_scene[ob_scene_index].ob_interval_move !== undefined)
                    clearInterval(that2.ob_scene[ob_scene_index].ob_interval_move);
                that2.moving = false;
                that2.first_sync = undefined;
                that2.reset_synced_time("new_sync", ob_scene_index);
                that2.update_scene(ob_scene_index, that2.header, that2.params, that2.ob_scene[ob_scene_index].bands,
                    that2.ob_scene[ob_scene_index].model, that2.ob_scene[ob_scene_index].sessions,
                    that2.ob_scene[ob_scene_index].ob_camera_type, null, false);
            };
            this.ob_sync.onmousemove = function () {
                that2.moving = false;
                that2.ob_sync.style.cursor = "pointer";
            };

            this.ob_filter = document.createElement("IMG");
            this.ob_filter.className = "ob_filter";
            this.ob_filter.alt = "Filtering&Sorting menu3";
            this.ob_filter.style.left = "131px";
            this.ob_filter.style.height = 32 + "px";
            this.ob_filter.style.width = 32 + "px";
            this.ob_filter.onclick = function () {
                that2.moving = false;
                that2.ob_settings.style.zIndex = "9999";
                if (that2.ob_scene[ob_scene_index].ob_interval_move !== undefined)
                    clearInterval(that2.ob_scene[ob_scene_index].ob_interval_move);
                that2.ob_create_filters(ob_scene_index, 0, "select_filter");
            };
            this.ob_filter.onmousemove = function () {
                that2.moving = false;
                that2.ob_filter.style.cursor = "pointer";
            };

            this.ob_search = document.createElement("IMG");
            this.ob_search.className = "ob_search";
            this.ob_search.alt = "Sessions&Events search";
            this.ob_search.style.left = "173px";
            this.ob_search.style.height = 32 + "px";
            this.ob_search.style.width = 32 + "px";
            this.ob_search.onclick = function () {
                that2.moving = false;
                that2.ob_settings.style.zIndex = "9999";
                that2.reset_synced_time("new_search", ob_scene_index);
                clearInterval(that2.ob_scene[ob_scene_index].ob_interval_move);
                that2.ob_scene[ob_scene_index].ob_search_value = that2.ob_search_input.value;
                that2.update_scene(ob_scene_index, that2.header, that2.params,
                    that2.ob_scene[ob_scene_index].bands, that2.ob_scene[ob_scene_index].model,
                    that2.ob_scene[ob_scene_index].sessions, that2.ob_scene[ob_scene_index].ob_camera_type, null, true);
            };
            this.ob_search.onmousemove = function () {
                that2.moving = false;
                that2.ob_search.style.cursor = "pointer";
            };

            this.ob_marker = document.createElement("IMG");
            this.ob_marker.className = "ob_marker";
            this.ob_marker.alt = "";
            this.ob_marker.style.zIndex = "10";
            this.ob_marker.style.height = 20 + "px";
            this.ob_marker.style.width = 16 + "px";
            this.ob_marker.style.visibility = "visible";

            this.ob_time_marker = document.createElement("DIV");
            this.ob_time_marker.id = this.name + "_time_marker";
            this.ob_time_marker.className = "ob_time_marker";
            this.ob_time_marker.style.zIndex = "10";
            this.ob_time_marker.style.visibility = "visible";

            this.ob_view = document.createElement("IMG");
            this.ob_no_view = document.createElement("IMG");
            this.ob_view.className = "ob_view";
            this.ob_no_view.className = "ob_no_view";
            this.ob_view.alt = "Overview";
            this.ob_no_view.alt = "No overview";
            this.ob_view.style.visibility = "hidden";
            this.ob_no_view.style.visibility = "visible";
            this.ob_view.style.zIndex = "10";
            this.ob_no_view.style.zIndex = "10";
            this.ob_view.style.height = 32 + "px";
            this.ob_no_view.style.height = 32 + "px";
            this.ob_view.style.width = 32 + "px";
            this.ob_no_view.style.width = 32 + "px";
            this.ob_view.onmouseenter = function (e) {
            };
            this.ob_no_view.onmouseenter = function (e) {
            };
            this.ob_view.onclick = function () {
                that2.moving = false;
                that2.ob_view.style.zIndex = "9999";
                clearInterval(that2.ob_scene[ob_scene_index].ob_interval_move);
                that2.ob_view.className = "ob_view";
                if (that2.ob_view.style.visibility === "visible") {
                    that2.ob_view.style.visibility = "hidden";
                    that2.ob_no_view.style.visibility = "visible";
                    that2.ob_visible_view = false;
                    that2.update_scene(ob_scene_index, that2.header, that2.params,
                        that2.ob_scene[ob_scene_index].bands, that2.ob_scene[ob_scene_index].model,
                        that2.ob_scene[ob_scene_index].sessions, that2.ob_scene[ob_scene_index].ob_camera_type,
                        null, false);
                }
            }
            this.ob_no_view.onclick = function () {
                that2.moving = false;
                that2.ob_no_view.style.zIndex = "9999";
                clearInterval(that2.ob_scene[ob_scene_index].ob_interval_move);
                that2.ob_view.className = "ob_view";
                if (that2.ob_no_view.style.visibility === "visible") {
                    that2.ob_no_view.style.visibility = "hidden";
                    that2.ob_view.style.visibility = "visible";
                    that2.ob_visible_view = true;
                    that2.update_scene(ob_scene_index, that2.header, that2.params,
                        that2.ob_scene[ob_scene_index].bands, that2.ob_scene[ob_scene_index].model,
                        that2.ob_scene[ob_scene_index].sessions, that2.ob_scene[ob_scene_index].ob_camera_type,
                        null, false);
                }
            }
            this.ob_view.onmousemove = function () {
                that2.moving = false;
                that2.ob_view.style.cursor = "pointer";
            };
            this.ob_no_view.onmousemove = function () {
                that2.moving = false;
                that2.ob_no_view.style.cursor = "pointer";
            };

            this.ob_3d = document.createElement("IMG");
            this.ob_3d.className = "ob_3d";
            this.ob_3d.alt = "2D or 3D view";
            this.ob_3d.style.zIndex = "10";
            this.ob_3d.style.height = 32 + "px";
            this.ob_3d.style.width = 32 + "px";
            this.ob_3d.onmouseenter = function (e) {
            };
            this.ob_3d.onclick = function () {
                that2.moving = false;
                that2.ob_3d.style.zIndex = "9999";
                clearInterval(that2.ob_scene[ob_scene_index].ob_interval_move);
                if (that2.ob_scene[ob_scene_index].ob_camera_type === "Perspective") {
                    get_ob_timeline(that2.name).ob_apply_orthographic_camera(ob_scene_index);
                    that2.ob_camera_type = "Orthographic";
                    that2.ob_3d.className = "ob_3d";
                } else {
                    get_ob_timeline(that2.name).ob_apply_perspective_camera(ob_scene_index);
                    that2.ob_scene[ob_scene_index].ob_camera_type = "Perspective";
                    that2.ob_3d.className = "ob_2d";
                }
            };
            this.ob_3d.onmousemove = function () {
                that2.moving = false;
                that2.ob_3d.style.cursor = "pointer";
            };

            this.ob_settings = document.createElement("IMG");
            this.ob_settings.className = "ob_settings";
            this.ob_settings.alt = "Settings";
            this.ob_settings.style.zIndex = "10";
            this.ob_settings.style.height = 32 + "px";
            this.ob_settings.style.width = 32 + "px";
            this.ob_settings.onmouseenter = function (e) {
            };
            this.ob_settings.onclick = function () {
                that2.moving = false;
                that2.ob_settings.style.zIndex = "9999";
                clearInterval(that2.ob_scene[ob_scene_index].ob_interval_move);
                that2.ob_create_setting(ob_scene_index);
            };
            this.ob_settings.onmousemove = function () {
                that2.moving = false;
                that2.ob_settings.style.cursor = "pointer";
            };

            this.ob_help = document.createElement("IMG");
            this.ob_help.className = "ob_help";
            this.ob_help.alt = "Help";
            this.ob_help.style.height = 32 + "px";
            this.ob_help.style.width = 32 + "px";
            this.ob_help.onclick = function () {
                clearInterval(that2.ob_scene[ob_scene_index].ob_interval_move);
                that2.moving = false;
                that2.ob_create_help(ob_scene_index);
            };
            this.ob_help.onmousemove = function () {
                that2.moving = false;
                that2.ob_help.style.cursor = "pointer";
            };

            this.ob_search_input = document.createElement("INPUT");
            this.ob_search_input.id = this.name + "_label";
            this.ob_search_input.type = "search";
            this.ob_search_label = document.createElement("label");
            this.ob_search_label.setAttribute("for", this.ob_search_input.id);
            this.ob_search_input.className = "ob_search_input";
            this.ob_search_input.style.left = "214px";
            this.ob_search_input.onmousemove = function () {
                that2.moving = false;
                that2.ob_search_input.style.cursor = "default";
            };
            this.ob_search_input.onkeydown = function (event) {
                if (event.key === "Enter") {
                    that2.moving = false;
                    that2.ob_settings.style.zIndex = "9999";
                    that2.reset_synced_time("new_search", ob_scene_index);
                    clearInterval(that2.ob_scene[ob_scene_index].ob_interval_move);
                    that2.ob_scene[ob_scene_index].ob_search_value = that2.ob_search_input.value;
                    that2.update_scene(ob_scene_index, that2.header, that2.params,
                        that2.ob_scene[ob_scene_index].bands, that2.ob_scene[ob_scene_index].model,
                        that2.ob_scene[ob_scene_index].sessions, that2.ob_scene[ob_scene_index].ob_camera_type,
                        null, true);
                }
            };
            this.ob_timeline_header.appendChild(this.ob_start);
            this.ob_timeline_header.appendChild(this.ob_stop);
            this.ob_timeline_header.appendChild(this.ob_calendar);
            this.ob_timeline_header.appendChild(this.ob_sync);
            this.ob_timeline_header.appendChild(this.ob_filter);
            this.ob_timeline_header.appendChild(this.ob_search);
            this.ob_timeline_header.appendChild(this.ob_marker);
            this.ob_timeline_header.appendChild(this.ob_time_marker);
            this.ob_timeline_header.appendChild(this.ob_view);
            this.ob_timeline_header.appendChild(this.ob_no_view);
            this.ob_timeline_header.appendChild(this.ob_3d);
            this.ob_timeline_header.appendChild(this.ob_settings);
            this.ob_timeline_header.appendChild(this.ob_help);
            this.ob_timeline_header.appendChild(this.ob_search_input);
            this.ob_timeline_header.appendChild(this.ob_search_label);
            this.ob_connected(ob_scene_index);
        }

        if (this.header !== undefined) {
            if (this.header[0].description !== undefined)
                this.ob_timeline_header.innerText = this.header[0].description;
            if (this.header[0].background !== undefined)
                this.ob_timeline_header.style.background = this.header[0].background;
            else
                this.ob_timeline_header.style.background = "#383838";
            if (this.header[0].color !== undefined)
                this.ob_timeline_header.style.color = this.header[0].color;
            if (this.header[0].textAlign !== undefined)
                this.ob_timeline_header.style.textAlign = this.header[0].textAlign;
            if (this.header[0].fontFamily !== undefined)
                this.ob_timeline_header.style.fontFamily = this.header[0].fontFamily;
            if (this.header[0].fontSize !== undefined)
                this.ob_timeline_header.style.fontSize = this.header[0].fontSize;
            if (this.header[0].width !== undefined)
                this.ob_timeline_header.style.width = this.header[0].width;
            if (this.header[0].height !== undefined)
                this.ob_timeline_header.style.height = this.header[0].height;
        } else
            this.header = {};
        if (this.ob_timeline_header.style.height === undefined || this.ob_timeline_header.style.height === "")
            this.ob_timeline_header.style.height = "40px";
        if (this.ob_timeline_header.style.width === undefined || this.ob_timeline_header.style.width === "")
            this.ob_timeline_header.style.width = "100%";

        // Mouse events
        //this.ob_timeline_header.addEventListener('mousedown', this.ob_onMouseDown);
        //this.ob_timeline_header.addEventListener('mousemove', this.ob_onMove);
        //this.ob_timeline_header.addEventListener('mouseup', this.ob_onUp);

        // Touch events
        //this.ob_timeline_panel.addEventListener('touchstart', this.ob_onTouchDown);
        //this.ob_timeline_header.addEventListener('touchmove', this.onTouchMove);
        //this.ob_timeline_header.addEventListener('touchend', this.ob_onTouchEnd);

    };

    OB_TIMELINE.prototype.ob_set_body_menu = function (ob_scene_index) {
        // If timeline header already define, do not rebuild
        let that2 = this;
        this.ob_timeline_panel = document.getElementById(this.name + "_panel");
        if (this.ob_timeline_panel === null || this.ob_timeline_panel === undefined) {
            this.ob_timeline_panel = document.createElement("div");
            this.ob_timeline_panel.id = this.name + "_panel";
            this.ob_timeline_panel.className = "ob_timeline_panel";
            this.ob_timeline_panel.style.position = "absolute";
            document.body.appendChild(this.ob_timeline_panel);

            this.ob_timeline_panel_resizer = document.createElement("div");
            this.ob_timeline_panel_resizer.id = this.name + "_resize";
            this.ob_timeline_panel_resizer.className = "ob_timeline_panel_resizer";
            this.ob_timeline_panel_resizer.style.position = "absolute";
            this.ob_timeline_panel_resizer.style.visibility = "visible";
            this.ob_timeline_panel.appendChild(this.ob_timeline_panel_resizer);

            this.ob_timeline_panel_resizer.onmousedown = function (event) {
                that2.moving = true;
                that2.ob_timeline_panel_resizer.style.width = "100px";
                that2.ob_timeline_panel_resizer.style.height = "100px";

                // get the mouse cursor position at startup:
                that2.pos3 = event.clientX;
                that2.pos4 = event.clientY;
                that2.ob_timeline_panel_resizer.style.cursor = "nw-resize";
                that2.ob_timeline_panel_resizer.style.visibility = "visible";
                that2.ob_remove_help();
                that2.ob_remove_calendar();
                that2.ob_remove_descriptor();
                that2.ob_remove_setting();
                that2.ob_remove_login();
            };
            this.ob_timeline_panel_resizer.onmousemove = function (event) {
                if (that2.moving !== true) return;
                that2.pos1 = that2.pos3 - event.clientX;
                that2.pos2 = that2.pos4 - event.clientY;
                that2.pos3 = event.clientX;
                that2.pos4 = event.clientY;

                that2.ob_timeline_panel.style.height = (that2.ob_timeline_panel_resizer.offsetTop - that2.pos2) + "px";
                that2.ob_timeline_panel.style.width = (that2.ob_timeline_panel_resizer.offsetLeft - that2.pos1) + "px";
                that2.ob_timeline_panel_resizer.style.top = (that2.ob_timeline_panel_resizer.offsetTop - that2.pos2) + "px";
                that2.ob_timeline_panel_resizer.style.left = (that2.ob_timeline_panel_resizer.offsetLeft - that2.pos1) + "px";
            };
            this.ob_timeline_panel_resizer.onmouseup = function () {
                that2.moving = false;
                that2.ob_timeline_panel_resizer.style.width = "20px";
                that2.ob_timeline_panel_resizer.style.height = "20px";
                that2.ob_timeline_panel.style.height = (that2.ob_timeline_panel_resizer.offsetTop - that2.pos2) + "px";
                that2.ob_timeline_panel.style.width = (that2.ob_timeline_panel_resizer.offsetLeft - that2.pos1) + "px";
                that2.ob_timeline_panel_resizer.style.top = (that2.ob_timeline_panel_resizer.offsetTop - that2.pos2) + "px";
                that2.ob_timeline_panel_resizer.style.left = (that2.ob_timeline_panel_resizer.offsetLeft - that2.pos1) + "px";
                that2.ob_scene[ob_scene_index].width = parseInt(that2.ob_timeline_panel.style.width);
                that2.ob_scene[ob_scene_index].height = parseInt(that2.ob_timeline_panel.style.height);
                that2.update_scene(ob_scene_index, that2.header, that2.params,
                    that2.ob_scene[ob_scene_index].bands, that2.ob_scene[ob_scene_index].model,
                    that2.ob_scene[ob_scene_index].sessions, that2.ob_scene[ob_scene_index].ob_camera_type,
                    null, false);
                that2.pos1 = undefined;
            };
            this.ob_timeline_panel_resizer.onmouseenter = function () {
                that2.ob_timeline_panel_resizer.style.cursor = "nw-resize";
                that2.pos1 = undefined;
                that2.moving = false;
            };
            this.ob_timeline_panel_resizer.onmouseout = function () {
                that2.ob_timeline_panel_resizer.style.width = "20px";
                that2.ob_timeline_panel_resizer.style.height = "20px";
                if (that2.pos1 === undefined) return;
                that2.ob_timeline_panel.style.height = (that2.ob_timeline_panel_resizer.offsetTop - that2.pos2) + "px";
                that2.ob_timeline_panel.style.width = (that2.ob_timeline_panel_resizer.offsetLeft - that2.pos1) + "px";
                that2.ob_timeline_panel_resizer.style.top = (that2.ob_timeline_panel_resizer.offsetTop - that2.pos2) + "px";
                that2.ob_timeline_panel_resizer.style.left = (that2.ob_timeline_panel_resizer.offsetLeft - that2.pos1) + "px";
                that2.ob_scene[ob_scene_index].width = parseInt(that2.ob_timeline_panel.style.width);
                that2.ob_scene[ob_scene_index].height = parseInt(that2.ob_timeline_panel.style.height);
                that2.update_scene(ob_scene_index, that2.header, that2.params,
                    that2.ob_scene[ob_scene_index].bands, that2.ob_scene[ob_scene_index].model,
                    that2.ob_scene[ob_scene_index].sessions, that2.ob_scene[ob_scene_index].ob_camera_type,
                    null, false);
            };
            // Set Header description if any otherwise keep default
            this.ob_createTimelineHeader(ob_scene_index);
        }

        // Set ob_timeline body
        if (this.ob_timeline_body_frame === undefined) {
            this.ob_timeline_body_frame = document.createElement("div");
            this.ob_timeline_body_frame.id = this.name + "_body_frame";
            this.ob_timeline_body_frame.style.position = "absolute";

            this.ob_timeline_body = document.createElement("div");
            this.ob_timeline_body.className = "ob_timeline_body";
            this.ob_timeline_body.id = this.name + "_body";
            this.ob_timeline_body.style.position = "relative";

            this.ob_timeline_body_frame.appendChild(this.ob_timeline_body);
            this.ob_timeline_panel.appendChild(this.ob_timeline_body_frame);
        }
        this.ob_timeline_body_frame.style.width = "100%";
        this.ob_timeline_body_frame.style.top = this.ob_timeline_header.style.height;
        this.ob_timeline_body_frame.style.overflowY = "auto";
        this.ob_timeline_panel.style.top = parseInt(this.ob_scene[ob_scene_index].top) + "px";
        this.ob_timeline_panel.style.left = parseInt(this.ob_scene[ob_scene_index].left) + "px";
        this.ob_timeline_panel.style.width = parseInt(this.ob_scene[ob_scene_index].width) + "px";
        this.ob_timeline_panel.style.height = parseInt(this.ob_scene[ob_scene_index].ob_height) +
            parseInt(this.ob_timeline_header.style.height) + "px";

        // Set ob_timeline right panel
        if (this.ob_timeline_right_panel === null || this.ob_timeline_right_panel === undefined) {
            this.ob_timeline_right_panel = document.createElement("div");
            this.ob_timeline_right_panel.id = this.name + '_right_panel';
            this.ob_timeline_right_panel.className = "ob_timeline_right_panel";
            document.body.appendChild(this.ob_timeline_right_panel);
        }

        this.ob_timeline_right_panel.id = this.name + "_right";
        this.ob_timeline_right_panel.style.top = parseInt(this.ob_timeline_panel.style.top) + "px";
        this.ob_timeline_right_panel.style.left = this.ob_scene[ob_scene_index].left + this.ob_scene[ob_scene_index].width + "px";
        this.ob_timeline_right_panel.style.height = parseInt(this.ob_timeline_panel.style.height) + "px";
        this.ob_timeline_right_panel.style.visibility = "hidden";
        this.ob_timeline_panel_resizer.style.top = (this.ob_timeline_panel.offsetHeight - 8) + "px";
        this.ob_timeline_panel_resizer.style.left = (this.ob_timeline_panel.offsetWidth - 8) + "px";

        if (this.ob_help !== undefined)
            this.ob_help.style.left = (this.ob_timeline_header.offsetWidth - 37) + "px";
        if (this.ob_settings !== undefined)
            this.ob_settings.style.left = (this.ob_timeline_header.offsetWidth - 72) + "px";
        if (this.ob_3d !== undefined)
            this.ob_3d.style.left = (this.ob_timeline_header.offsetWidth - 110) + "px";
        if (this.ob_view !== undefined)
            this.ob_view.style.left = (this.ob_timeline_header.offsetWidth - 150) + "px";
        if (this.ob_no_view !== undefined)
            this.ob_no_view.style.left = (this.ob_timeline_header.offsetWidth - 150) + "px";
    };

    OB_TIMELINE.prototype.setGregorianUnitLengths = function (ob_scene_index) {
        const unitLengths = {
            "MILLISECOND": 1,
            "SECOND": 1000,
            "MINUTE": 1000 * 60,
            "HOUR": 1000 * 60 * 60,
            "DAY": 1000 * 60 * 60 * 24,
            "WEEK": 1000 * 60 * 60 * 24 * 7,
            "MONTH": 1000 * 60 * 60 * 24 * 31,
            "YEAR": 1000 * 60 * 60 * 24 * 365,
            "DECADE": 1000 * 60 * 60 * 24 * 365 * 10,
            "CENTURY": 1000 * 60 * 60 * 24 * 365 * 100,
            "MILLENNIUM": 1000 * 60 * 60 * 24 * 365 * 1000,
            "EPOCH": -1,
            "ERA": -2
        };

        const bands = this.ob_scene[ob_scene_index].bands;

        bands.forEach(band => {
            const trimmedUnit = band.intervalUnit.trim();
            band.gregorianUnitLengths = unitLengths[trimmedUnit] || 1000 * 60 * 60;
        });
    };


    OB_TIMELINE.prototype.getUTCTime = function (ob_date) {
        return ob_date + (this.timeZoneOffset * 60000);
    };

    OB_TIMELINE.prototype.getUTCFullYearTime = function (ob_date) {
        return new Date(0).setUTCFullYear(ob_date);
    };

    OB_TIMELINE.prototype.getHour = function (totalGregorianUnitLengths) {
        let hh = new Date(totalGregorianUnitLengths).getHours();
        if (String(hh).length === 1)
            return "0" + hh;
        else
            return hh;
    };

    OB_TIMELINE.prototype.getMinute = function (totalGregorianUnitLengths) {
        let mm = new Date(totalGregorianUnitLengths).getMinutes();
        if (String(mm).length === 1)
            return "0" + mm;
        else
            return mm;
    };

    OB_TIMELINE.prototype.getDay = function (totalGregorianUnitLengths, format) {
        if (format === "ddd") {
            if (new Date(totalGregorianUnitLengths).getDay() === 0)
                return "Sun";
            else if (new Date(totalGregorianUnitLengths).getDay() === 1)
                return "Mon";
            else if (new Date(totalGregorianUnitLengths).getDay() === 2)
                return "Tue";
            else if (new Date(totalGregorianUnitLengths).getDay() === 3)
                return "Wed";
            else if (new Date(totalGregorianUnitLengths).getDay() === 4)
                return "Thu";
            else if (new Date(totalGregorianUnitLengths).getDay() === 5)
                return "Fri";
            else
                return "Sat";
        } else
            return String(new Date(totalGregorianUnitLengths).getDate());
    };
    OB_TIMELINE.prototype.getMonth = function (totalGregorianUnitLengths, format) {
        const monthIndex = new Date(totalGregorianUnitLengths).getMonth();
        if (format === "mmm") {
            const monthNames = [
                "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
            ];
            return monthNames[monthIndex];
        } else {
            return String(monthIndex + 1);
        }
    };

    OB_TIMELINE.prototype.convertDate = function (totalGregorianUnitLengths, dateFormat) {
        let ob_date_separator = " ";
        if (dateFormat.includes("/")) ob_date_separator = "/";
        if (dateFormat.includes("-")) ob_date_separator = "-";

        if (dateFormat === "MM/dd/yyyy" + ob_date_separator + "hh:mm")
            return String(this.getMonth(totalGregorianUnitLengths, "mm") + "/"
                + new Date(totalGregorianUnitLengths).getDate() + "/"
                + new Date(totalGregorianUnitLengths).getFullYear() + ob_date_separator
                + this.getHour(totalGregorianUnitLengths) + ":"
                + this.getMinute(totalGregorianUnitLengths));
        else if (dateFormat === "MM-dd-yyyy hh:mm")
            return String(this.getMonth(totalGregorianUnitLengths, "mm") + "-"
                + new Date(totalGregorianUnitLengths).getDate() + "-"
                + new Date(totalGregorianUnitLengths).getFullYear() + " "
                + this.getHour(totalGregorianUnitLengths) + ":"
                + this.getMinute(totalGregorianUnitLengths));
        else if (dateFormat === "dd/MM/yyyy" + ob_date_separator + "hh:mm")
            return String(new Date(totalGregorianUnitLengths).getDate() + "/"
                + this.getMonth(totalGregorianUnitLengths, "mm") + "/"
                + new Date(totalGregorianUnitLengths).getFullYear() + ob_date_separator
                + this.getHour(totalGregorianUnitLengths) + ":"
                + this.getMinute(totalGregorianUnitLengths));
        else if (dateFormat === "dd/MM/yyyy hh:mm")
            return String(new Date(totalGregorianUnitLengths).getDate() + "/"
                + this.getMonth(totalGregorianUnitLengths, "mm") + "/"
                + new Date(totalGregorianUnitLengths).getFullYear() + " "
                + this.getHour(totalGregorianUnitLengths) + ":"
                + this.getMinute(totalGregorianUnitLengths));
        else if (dateFormat === "MM/dd" + ob_date_separator + "hh:mm")
            return String(this.getMonth(totalGregorianUnitLengths, "mm") + "/"
                + new Date(totalGregorianUnitLengths).getDate() + ob_date_separator
                + this.getHour(totalGregorianUnitLengths) + ":"
                + this.getMinute(totalGregorianUnitLengths));
        else if (dateFormat === "MM/dd")
            return String(this.getMonth(totalGregorianUnitLengths, "mm") + "/"
                + new Date(totalGregorianUnitLengths).getDate());
        else if (dateFormat === "mmm dd")
            return String(this.getMonth(totalGregorianUnitLengths, "mmm") + " "
                + new Date(totalGregorianUnitLengths).getDate());
        else if (dateFormat === "mmm/dd")
            return String(this.getMonth(totalGregorianUnitLengths, "mmm") + "/"
                + new Date(totalGregorianUnitLengths).getDate());
        else if (dateFormat === "dd" + ob_date_separator + "hh:mm")
            return String(
                +new Date(totalGregorianUnitLengths).getDate() + ob_date_separator
                + this.getHour(totalGregorianUnitLengths) + ":"
                + this.getMinute(totalGregorianUnitLengths));
        else if (dateFormat === "ddd dd" + ob_date_separator + "hh:mm")
            return String(this.getDay(totalGregorianUnitLengths, "ddd") + ob_date_separator
                + new Date(totalGregorianUnitLengths).getDate() + " "
                + this.getHour(totalGregorianUnitLengths) + ":"
                + this.getMinute(totalGregorianUnitLengths));
        else if (dateFormat === "mmm/dd" + ob_date_separator + "hh:mm")
            return String(this.getMonth(totalGregorianUnitLengths, "mmm") + "/"
                + new Date(totalGregorianUnitLengths).getDate() + ob_date_separator
                + this.getHour(totalGregorianUnitLengths) + ":"
                + this.getMinute(totalGregorianUnitLengths));
        else if (dateFormat === "dd/MM" + ob_date_separator + "hh:mm")
            return String(new Date(totalGregorianUnitLengths).getDate() + "/"
                + this.getMonth(totalGregorianUnitLengths, "mm") + ob_date_separator
                + this.getHour(totalGregorianUnitLengths) + ":"
                + this.getMinute(totalGregorianUnitLengths));
        else if (dateFormat === "mmm")
            return this.getMonth(totalGregorianUnitLengths, dateFormat);
        else if (dateFormat === "MM")
            return this.getMonth(totalGregorianUnitLengths, dateFormat);
        else if (dateFormat === "yyyy" + ob_date_separator + "MM")
            return String(new Date(totalGregorianUnitLengths).getFullYear() + ob_date_separator
                + new Date(totalGregorianUnitLengths).getMonth());
        if (dateFormat === "yyyy" + ob_date_separator + "mmm" + ob_date_separator + "dd")
            return new Date(totalGregorianUnitLengths).getFullYear() + ob_date_separator
                + this.getMonth(totalGregorianUnitLengths, "mmm") + ob_date_separator +
                this.getDay(totalGregorianUnitLengths, "dd");
        if (dateFormat === "yyyy" + ob_date_separator + "mmm")
            return new Date(totalGregorianUnitLengths).getFullYear() + ob_date_separator
                + this.getMonth(totalGregorianUnitLengths, "mmm");
        if (dateFormat === "yyyy")
            return new Date(totalGregorianUnitLengths).getFullYear();
        else if (dateFormat === "UTC")
            return String(new Date(totalGregorianUnitLengths).toUTCString());
        else if (dateFormat === "ISO")
            return String(new Date(totalGregorianUnitLengths).toISOString());
        else
            return String(new Date(totalGregorianUnitLengths).getHours());
    };

    OB_TIMELINE.prototype.dateToPixelOffSet = function (ob_scene_index, date, gregorianUnitLengths, intervalPixels) {
        if (date === undefined || date === "") {
            return NaN;
        }
        if (this.timeZone === "UTC")
            if (date.toString().includes("UTC"))
                return (this.getUTCTime(Date.parse(date)) -
                    this.ob_scene.sync_time) / (gregorianUnitLengths / intervalPixels);
        return (Date.parse(date) - this.ob_scene.sync_time) / (gregorianUnitLengths / intervalPixels);
    };

    OB_TIMELINE.prototype.pixelOffSetToDateText = function (
        ob_scene_index,
        pixels,
        gregorianUnitLengths,
        intervalPixels,
        intervalUnit,
        dateFormat
    ) {
        const totalGregorianUnitLengths =
            this.ob_scene.sync_time + pixels * (gregorianUnitLengths / intervalPixels);

        if (dateFormat !== "DEFAULT") {
            return this.convertDate(totalGregorianUnitLengths, dateFormat);
        }

        switch (intervalUnit) {
            case "CENTURY":
                return String(new Date(totalGregorianUnitLengths).getFullYear() * 100);
            case "DECADE":
                return String(new Date(totalGregorianUnitLengths).getFullYear() * 10);
            case "YEAR":
                return String(new Date(totalGregorianUnitLengths).getFullYear());
            case "MONTH":
                return this.convertDate(totalGregorianUnitLengths, "MM");
            case "DAY":
                return String(new Date(totalGregorianUnitLengths).getDate());
            case "HOUR":
                return String(new Date(totalGregorianUnitLengths).getHours());
            case "MINUTE":
                return String(new Date(totalGregorianUnitLengths).getMinutes());
            case "SECOND":
                return String(new Date(totalGregorianUnitLengths).getSeconds());
            default:
                return String(new Date(totalGregorianUnitLengths));
        }
    };

    OB_TIMELINE.prototype.pixelOffSetToDate = function (ob_scene_index, pixels, gregorianUnitLengths, intervalPixels) {
        let totalGregorianUnitLengths = this.ob_scene.sync_time +
            (pixels * (gregorianUnitLengths / intervalPixels));
        return new Date(totalGregorianUnitLengths);
    };

    OB_TIMELINE.prototype.get_band = function (ob_scene_index, name) {
        for (let i = 0; i < this.ob_scene[ob_scene_index].bands.length; i++) {
            if (this.ob_scene[ob_scene_index].bands[i].name === name)
                return this.ob_scene[ob_scene_index].bands[i];
        }
    };

    OB_TIMELINE.prototype.center_bands = function (ob_scene_index) {
        let ob_sync = false;
        const scene = this.ob_scene[ob_scene_index];
        const {bands, width, center} = scene;

        for (let i = 0; i < bands.length; i++) {
            const band = bands[i];
            band.viewOffset = -width * (band.multiples - 1) / 2;
            band.width = width * band.multiples;

            switch (center) {
                case 'center':
                    band.x = 0;
                    break;
                case 'left':
                    band.x = -width / 3;
                    break;
                case 'right':
                    band.x = width / 3;
                    break;
                default:
                    band.x = 0;
            }

            if (i === bands.length - 1) {
                ob_sync = true;
            }

            this.move_band(ob_scene_index, band.name, band.x, band.y, band.z, ob_sync);
        }
    };

    OB_TIMELINE.prototype.update_bands_MinDate = function (ob_scene_index, date) {
        this.ob_scene[ob_scene_index].minDateL = 0;
        this.iniMinDateL = 0;
        for (let i = 0; i < this.ob_scene[ob_scene_index].bands.length; i++) {
            let pixelOffSet = this.dateToPixelOffSet(ob_scene_index, date,
                this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths,
                this.ob_scene[ob_scene_index].bands[i].intervalPixels);
            this.ob_scene[ob_scene_index].bands[i].minDate =
                this.pixelOffSetToDate(ob_scene_index, this.ob_scene[ob_scene_index].bands[i].viewOffset +
                    pixelOffSet, this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths,
                    this.ob_scene[ob_scene_index].bands[i].intervalPixels);
            this.ob_scene[ob_scene_index].bands[i].iniMinDate =
                this.pixelOffSetToDate(ob_scene_index, this.ob_scene[ob_scene_index].bands[i].minViewOffset +
                    pixelOffSet, this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths,
                    this.ob_scene[ob_scene_index].bands[i].intervalPixels);
            // Round hour to 0
            this.ob_scene[ob_scene_index].bands[i].minDate =
                new Date(new Date(this.ob_scene[ob_scene_index].bands[0].minDate).setMinutes(0));
            this.ob_scene[ob_scene_index].bands[i].minDate =
                new Date(new Date(this.ob_scene[ob_scene_index].bands[0].minDate).setSeconds(0));
            let minDateL = new Date(this.ob_scene[ob_scene_index].bands[i].minDate).getTime();
            if (minDateL > this.ob_scene[ob_scene_index].minDateL) {
                this.ob_scene[ob_scene_index].minDateL = minDateL;
                this.ob_scene[ob_scene_index].minDate =
                    new Date(this.ob_scene[ob_scene_index].minDateL).toString().substring(0, 24) + " UTC";
            }
            this.ob_scene[ob_scene_index].bands[i].iniMinDate =
                new Date(new Date(this.ob_scene[ob_scene_index].bands[0].iniMinDate).setMinutes(0));
            this.ob_scene[ob_scene_index].bands[i].iniMinDate =
                new Date(new Date(this.ob_scene[ob_scene_index].bands[0].iniMinDate).setSeconds(0));
            let iniMinDateL = new Date(this.ob_scene[ob_scene_index].bands[i].iniMinDate).getTime();
            if (iniMinDateL > this.iniMinDateL) {
                this.iniMinDateL = iniMinDateL;
                this.iniMinDate = new Date(this.iniMinDateL).toString().substring(0, 24) + " UTC";
            }
        }
    };

    OB_TIMELINE.prototype.update_bands_MaxDate = function (ob_scene_index, date) {
        const currentScene = this.ob_scene[ob_scene_index];
        currentScene.maxDateL = 0;
        this.iniMaxDateL = 0;
        for (let i = 0; i < currentScene.bands.length; i++) {
            let pixelOffSet = this.dateToPixelOffSet(ob_scene_index, date,
                currentScene.bands[i].gregorianUnitLengths,
                currentScene.bands[i].intervalPixels);
            currentScene.bands[i].maxDate =
                this.pixelOffSetToDate(ob_scene_index, -currentScene.bands[i].viewOffset +
                    pixelOffSet, currentScene.bands[i].gregorianUnitLengths,
                    currentScene.bands[i].intervalPixels);
            currentScene.bands[i].iniMaxDate =
                this.pixelOffSetToDate(ob_scene_index, -currentScene.bands[i].minViewOffset +
                    pixelOffSet, currentScene.bands[i].gregorianUnitLengths,
                    currentScene.bands[i].intervalPixels);
            currentScene.bands[i].iniMaxDate =
                new Date(new Date(currentScene.bands[0].iniMaxDate).setMinutes(0));
            currentScene.bands[i].iniMaxDate =
                new Date(new Date(currentScene.bands[0].iniMaxDate).setSeconds(0));
            let iniMaxDateL = new Date(currentScene.bands[i].iniMaxDate).getTime();
            if (iniMaxDateL > this.iniMaxDateL) {
                this.iniMaxDateL = iniMaxDateL;
                this.iniMaxDate = new Date(this.iniMaxDateL).toString().substring(0, 24) + " UTC";
            }
        }
    };

    OB_TIMELINE.prototype.set_bands_minDate = function (ob_scene_index) {
        const currentScene = this.ob_scene[ob_scene_index];
        this.ob_scene[ob_scene_index].minDateL = 0;
        for (let i = 0; i < currentScene.bands.length; i++) {
            currentScene.bands[i].minDate = this.pixelOffSetToDate(ob_scene_index,
                currentScene.bands[i].viewOffset,
                currentScene.bands[i].gregorianUnitLengths,
                currentScene.bands[i].intervalPixels);
            // Round hour to 0
            currentScene.bands[i].minDate =
                new Date(new Date(currentScene.bands[0].minDate).setMinutes(0));
            currentScene.bands[i].minDate =
                new Date(new Date(currentScene.bands[0].minDate).setSeconds(0));
            let minDateL = new Date(currentScene.bands[i].minDate).getTime();
            if (minDateL > currentScene.minDateL) {
                currentScene.minDateL = minDateL;
                currentScene.minDate =
                    new Date(currentScene.minDateL).toString().substring(0, 24) + " UTC";
            }
            if (this.get_band_overview_index(ob_scene_index) === i) {
                currentScene.overviewMinDate = currentScene.bands[i].minDate;
                currentScene.overviewMinDateL = minDateL;
            } else {
                currentScene.minDate = currentScene.bands[i].minDate;
                currentScene.minDateL = minDateL;
            }
        }
    };

    OB_TIMELINE.prototype.set_bands_maxDate = function (ob_scene_index) {
        const currentScene = this.ob_scene[ob_scene_index];
        currentScene.maxDateL = 0;
        for (let i = 0; i < currentScene.bands.length; i++) {
            currentScene.bands[i].maxDate = this.pixelOffSetToDate(ob_scene_index,
                -currentScene.bands[i].viewOffset,
                currentScene.bands[i].gregorianUnitLengths,
                currentScene.bands[i].intervalPixels);
            currentScene.bands[i].maxDate =
                new Date(new Date(currentScene.bands[0].maxDate).setMinutes(0));
            currentScene.bands[i].maxDate =
                new Date(new Date(currentScene.bands[0].maxDate).setSeconds(0));
            let maxDateL = new Date(currentScene.bands[i].maxDate).getTime();
            if (maxDateL > currentScene.maxDateL) {
                currentScene.maxDateL = maxDateL;
                currentScene.maxDate =
                    new Date(currentScene.maxDateL).toString().substring(0, 24) + " UTC";
            }
            if (this.get_band_overview_index(ob_scene_index) === i) {
                currentScene.overviewMaxDate = currentScene.bands[i].maxDate;
                currentScene.overviewMaxDateL = maxDateL;
            } else {
                currentScene.maxDate = currentScene.bands[i].maxDate;
                currentScene.maxDateL = maxDateL;
            }
        }
    };

    OB_TIMELINE.prototype.set_bands_viewOffset = function (ob_scene_index) {
        const currentScene = this.ob_scene[ob_scene_index];
        for (let i = 0; i < currentScene.bands.length; i++) {
            currentScene.bands[i].minWidth = currentScene.width;
            currentScene.bands[i].width =
                currentScene.width * currentScene.bands[i].multiples;
            currentScene.bands[i].minViewOffset = -currentScene.bands[i].minWidth;
            currentScene.bands[i].viewOffset = -currentScene.bands[i].width / 2;
            currentScene.bands[i].x = currentScene.bands[i].viewOffset;
        }
    };

    OB_TIMELINE.prototype.update_timeline_model = function (
        ob_scene_index,
        band,
        ob_attribute,
        ob_color,
        ob_alternate_color,
        ob_layouts,
        max_name_length
    ) {
        band.layouts = ob_layouts;
        band.layouts.max_name_length = max_name_length;

        if (this.ob_scene[ob_scene_index].bands.original_length === this.ob_scene[ob_scene_index].bands.length) {
            return;
        }

        band.layout_name = band.layouts[0] || "NONE";
        let set_alternate_color = true;

        const originalBand = this.ob_scene[ob_scene_index].bands[0];
        originalBand.maxY = 0;
        originalBand.minY = 0;
        originalBand.lastGreaterY = -this.ob_scene[ob_scene_index].ob_height;

        for (let i = 1; i < band.layouts.length; i++) {
            this.ob_scene[ob_scene_index].bands[i] = {
                ...band,
                name: band.name + "_" + i,
                layout_name: band.layouts[i],
                color: set_alternate_color ? ob_alternate_color : ob_color,
                backgroundColor: set_alternate_color ? ob_alternate_color : ob_color,
                maxY: 0,
                minY: 0,
                lastGreaterY: -this.ob_scene[ob_scene_index].ob_height,
            };

            set_alternate_color = !set_alternate_color;
        }

        this.ob_scene[ob_scene_index].bands.original_length = this.ob_scene[ob_scene_index].bands.length;
    };

    OB_TIMELINE.prototype.create_new_bands = function (ob_scene_index) {
        const ob_layouts = new Set();
        let max_name_length = 0;
        const {bands, sessions} = this.ob_scene[ob_scene_index];
        const events = sessions?.events || [];

        bands.forEach((band, i) => {
            if (!band.model) {
                Object.assign(band, {
                    layouts: ["NONE"],
                    layout_name: "NONE",
                    model: [{sortBy: "NONE"}]
                });
            }

            const model = band.model[0] || {sortBy: "NONE"};

            if (i === 0) {
                events.forEach((event, k) => {
                    if (event.id && !event.zone) {
                        try {
                            let sortByValue = eval(`sessions.events[k].data.${model.sortBy}`);

                            if (!isNaN(sortByValue)) {
                                sortByValue = `${model.sortBy} ${sortByValue}`;
                            }

                            event.data.sortByValue = sortByValue;

                            if (sortByValue && !ob_layouts.has(sortByValue)) {
                                ob_layouts.add(sortByValue);
                            }

                            const firstLayoutLength = [...ob_layouts][0]?.length || 0;
                            if (firstLayoutLength > max_name_length) {
                                max_name_length = firstLayoutLength + 1;
                            }
                        } catch (error) {
                            //console.error(error);
                        }
                    }
                });
            }

            const alternateColorStr = model.alternateColor?.toString() || "";
            const sortByStr = model.sortBy.toString();

            this.update_timeline_model(
                ob_scene_index,
                band,
                sortByStr,
                band.color,
                alternateColorStr,
                [...ob_layouts],
                max_name_length
            );
        });
    };


    OB_TIMELINE.prototype.set_bands_height = function (ob_scene_index) {
        let new_timeline_height = 0;
        let pos = 0;
        let offSet;
        let offSetOverview;
        let ob_overview = false;

        for (let i = 0; i < this.ob_scene[ob_scene_index].bands.length; i++) {
            const band = this.ob_scene[ob_scene_index].bands[i];

            if (band.name.match(/overview_/)) {
                offSetOverview = parseInt(band.gregorianUnitLengths) / parseInt(band.intervalPixels);
                ob_overview = true;
            } else {
                offSet = parseInt(band.gregorianUnitLengths) / parseInt(band.intervalPixels);
                ob_overview = false;
            }

            if (band.height !== undefined) {
                if (band.name.match(/overview_/)) {
                    try {
                        if (band.height.match(/%/) !== null) {
                            band.height = (this.ob_scene[ob_scene_index].ob_height * parseInt(band.height)) / 100;
                        } else if (band.height.match(/px/) !== null) {
                            band.height = parseInt(band.height);
                        } else {
                            band.height = Math.abs(band.maxY) + Math.abs(band.minY);
                        }
                    } catch (err) {
                        //band.height = Math.abs(band.maxY) + Math.abs(band.minY);
                        //console.error(err);
                    }

                    new_timeline_height += band.height;
                } else {
                    band.height = Math.abs(band.maxY) + Math.abs(band.minY);
                    new_timeline_height += band.height;
                }
            } else {
                band.height = band.y = this.ob_scene[ob_scene_index].ob_height;
                band.y =
                    this.ob_scene[ob_scene_index].ob_height -
                    this.ob_scene[ob_scene_index].ob_height / this.ob_scene[ob_scene_index].bands.length / 2;
                band.pos_x = band.x;
                band.pos_y = band.y;
                band.pos_z = band.z;
            }

            if (this.ob_scene[ob_scene_index].bands.length === 1 && i === this.ob_scene[ob_scene_index].bands.length - 1 && this.ob_scene[ob_scene_index].ob_height > new_timeline_height) {
                if (isNaN(new_timeline_height))
                    new_timeline_height = 0;
                band.height += this.ob_scene[ob_scene_index].ob_height - new_timeline_height;
            }

            if (isNaN(band.height))
                band.height = 0

            if (band.height !== undefined) {
                band.y = this.ob_scene[ob_scene_index].ob_height - pos - band.height / 2;
                band.pos_x = band.x;
                band.pos_y = band.y;
                band.pos_z = band.z;
                pos += band.height;
                band.heightMax = band.height;
                band.maxY = band.heightMax / 2;
                band.minY = -band.maxY;
                band.heightMin = this.ob_scene[ob_scene_index].ob_height - pos;
            }

            if (band.name.match(/overview_/)) {
                try {
                    band.trackIncrement = this.get_overview_track_increment(offSet, offSetOverview, ob_scene_index);
                } catch {
                    band.trackIncrement = 2;
                }
            }
        }

        if (new_timeline_height !== 0) {
            this.ob_scene[ob_scene_index].ob_height = new_timeline_height;
        }
    };

    OB_TIMELINE.prototype.get_band_default_index = function (ob_scene_index) {
        for (let i = 0; i < this.ob_scene[ob_scene_index].bands.length; i++) {
            if (!this.ob_scene[ob_scene_index].bands[i].name.match(/overview_/)) {
                return i;
            }
        }
        return 0;
    };

    OB_TIMELINE.prototype.get_band_overview_index = function (ob_scene_index) {
        for (let i = 0; i < this.ob_scene[ob_scene_index].bands.length; i++) {
            if (this.ob_scene[ob_scene_index].bands[i].name.match(/overview_/)) {
                return i;
            }
        }
        return null;
    };

    OB_TIMELINE.prototype.get_overview_track_increment = function (offSet, offSetOverview, ob_scene_index) {
        let ob_overview_track_increment;
        let ob_band_overview_index = this.get_band_overview_index(ob_scene_index);
        let ob_band_default_index = this.get_band_default_index(ob_scene_index);

        try {
            const defaultBand = this.ob_scene[ob_scene_index].bands[ob_band_default_index];
            const overviewBand = this.ob_scene[ob_scene_index].bands[ob_band_overview_index];

            const pixelRatio = defaultBand.intervalPixels / overviewBand.intervalPixels;
            const heightRatio = defaultBand.height / overviewBand.height;

            ob_overview_track_increment = pixelRatio * heightRatio * (offSet / offSetOverview) * defaultBand.trackIncrement;

            if (isNaN(ob_overview_track_increment)) {
                ob_overview_track_increment = 2;
            }
        } catch (e) {
            ob_overview_track_increment = 2;
        }

        return ob_overview_track_increment;
    };

    OB_TIMELINE.prototype.remove_band_overview = function (ob_scene_index) {
        this.ob_scene[ob_scene_index].bands = this.ob_scene[ob_scene_index].bands.filter(function (band) {
            return !band.name.match(/overview_/);
        });
    };

    OB_TIMELINE.prototype.add_band_overview = function (ob_scene_index) {
        let ob_default_overview_index = this.get_band_default_index(ob_scene_index);
        let ob_default_overview = {};
        if (this.get_band_overview_index(ob_scene_index) == null) {
            ob_default_overview = JSON.stringify({
                name: "ob_overview_band",
                height: "25%",
                color: "#8ac7f6",
                intervalPixels: this.ob_scene[ob_scene_index].bands[ob_default_overview_index].intervalPixels,
                intervalUnit: "DAY",
                dateFormat: "yyyy mmm",
                gregorianUnitLengths: "86400000",
                dateColor: "#040404",
                textColor: "#040404",
                SessionColor: "#a110ff",
                eventColor: "#238448",
                defaultEventSize: 1,
            });
            ob_default_overview = JSON.parse(ob_default_overview);
            this.ob_scene[ob_scene_index].bands.push(ob_default_overview);
        }
    };
    OB_TIMELINE.prototype.set_bands = function (ob_scene_index) {
        // If no overview defined, add a default one
        if (this.ob_visible_view) {
            this.add_band_overview(ob_scene_index);
        } else {
            this.remove_band_overview(ob_scene_index);
        }

        for (let i = 0; i < this.ob_scene[ob_scene_index].bands.length; i++) {
            const band = this.ob_scene[ob_scene_index].bands[i];

            band.textColor = band.textColor || "#000000";
            band.dateColor = band.dateColor || "#000000";
            band.SessionColor = band.SessionColor || "#000000";
            band.eventColor = band.eventColor || "#000000";
            band.texture = band.texture || undefined;
            band.defaultSessionTexture = band.defaultSessionTexture || undefined;
            band.sessionHeight = band.sessionHeight || 10;
            band.defaultEventSize = band.defaultEventSize || 5;

            band.fontSize = band.fontSize || this.fontSize;
            band.fontSizeInt = parseInt(band.fontSize) || this.fontSizeInt;

            if (isNaN(band.fontSizeInt)) {
                band.fontSizeInt = this.fontSize;
            }

            band.fontSize = band.fontSizeInt + "px";

            band.fontFamily = band.fontFamily || this.fontFamily;
            band.fontStyle = band.fontStyle || this.fontStyle;
            band.fontWeight = band.fontWeight || this.fontWeight;

            band.x = band.x !== undefined ? parseInt(band.x) : -10000;
            band.z = band.z !== undefined ? parseInt(band.z) : 0;

            band.width = 100000;

            band.depth = band.depth !== undefined ? parseInt(band.depth) : 0;

            band.color = band.color || "white";

            if (this.backgroundColor === undefined) {
                this.backgroundColor = band.color;
            }

            band.backgroundColor = band.backgroundColor || this.backgroundColor;

            band.intervalPixels = band.intervalPixels || "200";
            band.intervalUnit = band.intervalUnit || "MINUTE";
            band.dateFormat = band.dateFormat || "DEFAULT";

            if (
                band.subIntervalPixels === undefined ||
                band.subIntervalPixels === "NONE"
            ) {
                band.subIntervalPixels = "NONE";
            } else {
                if (
                    band.intervalUnit === "HOUR" &&
                    parseInt(band.intervalPixels) >= 60
                ) {
                    band.subIntervalPixels = parseInt(band.intervalPixels) / 4;
                }
            }

            band.multiples =
                parseInt(band.intervalPixels) / this.ob_scene[ob_scene_index].multiples;
            band.multiples = this.ob_scene[ob_scene_index].multiples;
            band.trackIncrement = this.ob_scene[ob_scene_index].increment;
        }

        this.create_new_bands(ob_scene_index);
        this.set_bands_height(ob_scene_index);
        this.set_bands_viewOffset(ob_scene_index);
        this.set_bands_minDate(ob_scene_index);
        this.set_bands_maxDate(ob_scene_index);
    };

    OB_TIMELINE.prototype.add_zone = function (ob_scene_index, band_number, zone_number, band_name, zone_name, text,
                                               textColor, x, y, z, width, height, depth, color, texture, font_align) {
        x = isNaN(x) ? 0 : x;
        y = isNaN(y) ? 0 : y;
        z = isNaN(z) ? 0 : z;
        width = isNaN(width) ? 0 : width;
        height = isNaN(height) ? 0 : height;
        depth = depth === undefined ? 1 : depth;
        color = this.hex_Luminance(color, -0.15) || color;

        let ob_box = this.track[ob_scene_index](new THREE.BoxGeometry(width, height, depth));
        let ob_material;
        if (texture !== undefined) {
            let loader = this.track[ob_scene_index](new THREE.CubeTextureLoader());
            loader.setCrossOrigin("");
            loader.setPath('three.js/examples/textures/cube/pisa/');
            let textureCube = loader.load([
                'px.png', 'nx.png',
                'py.png', 'ny.png',
                'pz.png', 'nz.png'
            ]);
            let ob_dirLight = this.track[ob_scene_index](new THREE.DirectionalLight(0xffffff));
            ob_dirLight.position.set(10, 10, 10);
            this.ob_scene[ob_scene_index].add(ob_dirLight);
            this.ob_scene[ob_scene_index].add(this.track[ob_scene_index](new THREE.AmbientLight(0x404040)));
            ob_material = this.track[ob_scene_index](new THREE.MeshStandardMaterial({
                envMap: textureCube,
                roughness: 0.5,
                metalness: 1
            }));
            ob_box.computeVertexNormals();
        } else {
            ob_material = this.track[ob_scene_index](new THREE.MeshBasicMaterial({color: color}));
        }

        let ob_zone = this.track[ob_scene_index](new THREE.Mesh(ob_box, ob_material));
        ob_zone.name = "zone_" + zone_name;
        ob_zone.text = text;
        ob_zone.sortBy = "false";
        ob_zone.pos_x = x;
        ob_zone.pos_y = this.get_band(ob_scene_index, band_name).pos_y;
        ob_zone.pos_z = z;
        ob_zone.w = width;
        ob_zone.band_number = band_number;
        ob_zone.zone_number = zone_number;
        ob_zone.position.set(x, y, z);

        this.ob_scene[ob_scene_index].objects.push(ob_zone);

        if (!band_name.includes("overview")) {
            this.add_text_sprite(ob_scene_index, ob_zone, text, 50, 0, 10, undefined,
                24, "Normal", "Normal", textColor, 'Arial', font_align);
        }

        let ob_band = this.ob_scene[ob_scene_index].getObjectByName(band_name);
        if (ob_band !== undefined) {
            ob_band.add(ob_zone);
        }
    };

    OB_TIMELINE.prototype.add_textBox = function (ob_scene_index, band_name, text, textColor, x, y, z, width, height,
                                                  depth, color, texture, font_align) {
        let ob_model_name = this.ob_scene[ob_scene_index].getObjectByName(band_name + "_" + text);
        if (ob_model_name !== undefined) return;
        if (isNaN(x)) x = 0;
        if (isNaN(y)) y = 0;
        if (isNaN(z)) z = 0;
        if (isNaN(width)) width = 0;
        if (isNaN(height)) height = 0;
        if (depth === undefined) depth = 1;
        if (color === undefined) {
            color = this.hex_Luminance(color, -.15);
        }

        let ob_box = this.track[ob_scene_index](new THREE.BoxGeometry(width, height, depth));
        let ob_material;
        if (texture !== undefined) {
            let loader = this.track[ob_scene_index](new THREE.CubeTextureLoader());
            loader.setCrossOrigin("");
            loader.setPath('three.js/examples/textures/cube/pisa/');
            let textureCube = loader.load([
                'px.png', 'nx.png',
                'py.png', 'ny.png',
                'pz.png', 'nz.png'
            ]);
            let ob_dirLight = this.track[ob_scene_index](new THREE.DirectionalLight(0xffffff));
            ob_dirLight.position.set(10, 10, 10);
            this.ob_scene[ob_scene_index].add(ob_dirLight);
            this.ob_scene[ob_scene_index].add(this.track[ob_scene_index](new THREE.AmbientLight(0x404040)));
            ob_material = this.track[ob_scene_index](new THREE.MeshStandardMaterial({
                envMap: textureCube,
                roughness: 0.5,
                metalness: 1
            }));
            ob_box.computeVertexNormals();
        } else {
            ob_material = this.track[ob_scene_index](new THREE.MeshBasicMaterial({color: color}));
        }
        ob_model_name = this.track[ob_scene_index](new THREE.Mesh(ob_box, ob_material));
        ob_model_name.name = band_name + "_" + text;
        ob_model_name.sortBy = "true";
        ob_model_name.pos_x = x;
        ob_model_name.pos_y = this.get_band(ob_scene_index, band_name).pos_y;
        ob_model_name.pos_z = z;
        ob_model_name.position.set(x, y, z);

        this.ob_scene[ob_scene_index].add(ob_model_name);
        this.ob_scene[ob_scene_index].objects.push(ob_model_name);

        this.add_text_sprite(ob_scene_index, ob_model_name, text, 60, 0, 10, undefined,
            24, "Normal", "Normal", textColor, 'Arial', font_align);

    };

    OB_TIMELINE.prototype.hex_Luminance = function (hex, lum = 0) {
        function validateHex(hex) {
            return String(hex).replace(/[^0-9a-f]/gi, '');
        }

        function extendShortHex(hex) {
            if (hex.length < 6) {
                return hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
            }
            return hex;
        }

        function adjustLuminance(colorComponent, lum) {
            const adjusted = Math.round(Math.min(Math.max(0, colorComponent + (colorComponent * lum)), 255));
            return adjusted.toString(16).padStart(2, '0');
        }

        hex = validateHex(hex);
        hex = extendShortHex(hex);

        let rgb = "#";
        for (let i = 0; i < 3; i++) {
            const colorComponent = parseInt(hex.substr(i * 2, 2), 16);
            rgb += adjustLuminance(colorComponent, lum);
        }

        return rgb;
    };


    OB_TIMELINE.prototype.create_zones = function (ob_scene_index) {
        for (let b = 0; b < this.ob_scene[ob_scene_index].bands.length; b++) {
            for (let z = 0; z < this.ob_scene[ob_scene_index].bands[b].zones.length; z++) {
                let x = this.dateToPixelOffSet(ob_scene_index, this.ob_scene[ob_scene_index].bands[b].zones[z].start,
                    this.ob_scene[ob_scene_index].bands[b].gregorianUnitLengths,
                    this.ob_scene[ob_scene_index].bands[b].intervalPixels);
                let y = 0;
                let zz = parseInt(this.ob_scene[ob_scene_index].bands[b].z) + 1;
                let w = x - this.dateToPixelOffSet(ob_scene_index, this.ob_scene[ob_scene_index].bands[b].zones[z].end,
                    this.ob_scene[ob_scene_index].bands[b].gregorianUnitLengths,
                    this.ob_scene[ob_scene_index].bands[b].intervalPixels);
                let h = this.ob_scene[ob_scene_index].bands[b].heightMax;
                let color = this.hex_Luminance(this.ob_scene[ob_scene_index].bands[b].zones[z].render.color);
                this.ob_scene[ob_scene_index].bands[b].zones[z].band_number = b;
                if (color === undefined) color = "#f8feff";
                this.add_zone(ob_scene_index, b, z, this.ob_scene[ob_scene_index].bands[b].name,
                    this.ob_scene[ob_scene_index].bands[b].zones[z].id,
                    this.ob_scene[ob_scene_index].bands[b].zones[z].data.text,
                    this.ob_scene[ob_scene_index].bands[b].textColor,
                    x, y, zz, w, h,
                    parseInt(this.ob_scene[ob_scene_index].bands[b].depth) + 1,
                    this.hex_Luminance(color, -.15),
                    undefined,
                    this.hex_Luminance(color, -.15),
                    this.ob_scene[ob_scene_index].font_align);
            }
        }
    };

    OB_TIMELINE.prototype.create_bands = function (ob_scene_index, ob_set_bands) {
        if (ob_set_bands) {
            this.set_bands(ob_scene_index);
        }

        const currentScene = this.ob_scene[ob_scene_index];
        const bands = currentScene.bands;

        bands.forEach(band => {
            this.add_band(
                ob_scene_index, band.name, band.x, band.y, band.z,
                band.width, band.heightMax, band.depth, band.color, band.texture
            );

            if (band.layout_name !== "NONE") {
                const adjustedX = -(currentScene.width / 2) +
                    (parseInt(band.layouts.max_name_length) *
                        parseInt(band.layouts.max_name_length) / 2);
                const adjustedZ = parseInt(band.z) + 50;
                const adjustedDepth = parseInt(band.depth) + 1;
                const adjustedWidth = parseInt(band.layouts.max_name_length) *
                    parseInt(band.fontSizeInt) * 2.2;
                const luminanceColor = this.hex_Luminance(band.color, -.15);

                this.add_textBox(
                    ob_scene_index, band.name, band.layout_name, band.textColor,
                    adjustedX, band.y, adjustedZ, adjustedWidth,
                    band.heightMax, adjustedDepth, luminanceColor,
                    undefined, luminanceColor, currentScene.font_align
                );
            }
        });
    };

    OB_TIMELINE.prototype.add_band = function (ob_scene_index, band_name, x, y, z, width, height, depth, color,
                                               texture) {
        let ob_band = this.ob_scene[ob_scene_index].getObjectByName(band_name);
        if (ob_band !== undefined) return;
        if (isNaN(x)) x = 0;
        if (isNaN(y)) y = 0;
        if (isNaN(z)) z = 0;
        if (isNaN(width)) width = 0;
        if (isNaN(height)) height = 0;
        if (depth === undefined) depth = 1;
        if (color === undefined) {
            color = this.track[ob_scene_index](new THREE.Color("rgb(114, 171, 173)"));
        } else {
            color = this.track[ob_scene_index](new THREE.Color(color));
        }

        let ob_box = this.track[ob_scene_index](new THREE.BoxGeometry(width, height, depth));
        let ob_material;
        if (texture !== undefined) {
            let loader = this.track[ob_scene_index](new THREE.CubeTextureLoader());
            loader.setCrossOrigin("");
            loader.setPath('three.js/examples/textures/cube/pisa/');
            let textureCube = loader.load([
                'px.png', 'nx.png',
                'py.png', 'ny.png',
                'pz.png', 'nz.png'
            ]);
            let ob_dirLight = this.track[ob_scene_index](new THREE.DirectionalLight(0xffffff));
            ob_dirLight.position.set(10, 10, 10);
            this.ob_scene[ob_scene_index].add(ob_dirLight);
            this.ob_scene[ob_scene_index].add(this.track[ob_scene_index](new THREE.AmbientLight(0x404040)));
            ob_material = this.track[ob_scene_index](new THREE.MeshStandardMaterial({
                envMap: textureCube,
                roughness: 0.5,
                metalness: 1
            }));
            ob_box.computeVertexNormals();
        } else {
            //this.ob_scene[ob_scene_index].group.add(this.track[ob_scene_index](new THREE.AmbientLight(0x404040)));
            this.ob_scene[ob_scene_index].add(this.track[ob_scene_index](new THREE.AmbientLight(0x404040)));
            ob_material = this.track[ob_scene_index](new THREE.MeshBasicMaterial({color: color}));
        }
        ob_band = this.track[ob_scene_index](new THREE.Mesh(ob_box, ob_material));
        ob_band.name = band_name;
        ob_band.pos_x = x;
        ob_band.pos_y = this.get_band(ob_scene_index, band_name).pos_y;
        ob_band.pos_z = z;
        ob_band.position.set(x, y, z);

        //this.ob_scene[ob_scene_index].group.add(ob_band);
        this.ob_scene[ob_scene_index].add(ob_band);
        this.ob_scene[ob_scene_index].objects.push(ob_band);

    };

    OB_TIMELINE.prototype.destroy_scene = function (ob_scene_index) {
        if (this.ob_scene === undefined || this.ob_scene[ob_scene_index] === undefined) return;
        for (let i = 0; i < this.ob_scene[ob_scene_index].children.length; i++) {
            try {
                this.ob_scene[ob_scene_index].remove(this.ob_scene[ob_scene_index].children[i]);
            } catch (e) {
            }
        }
        this.resTracker[ob_scene_index].dispose();

        if (this.ob_timeline_body !== undefined)
            this.ob_timeline_body.innerHTML = "";

        this.ob_scene[ob_scene_index].objects = [];
    };

    OB_TIMELINE.prototype.ob_render = function (ob_scene_index) {
        //console.log("OB_TIMELINE.prototype.ob_render(ob_render_index=" + ob_scene_index + ")");
        this.ob_render_index = ob_scene_index;
        this.ob_scene[ob_scene_index].ob_renderer.render(this.ob_scene[ob_scene_index],
            this.ob_scene[ob_scene_index].ob_camera);
    };

    OB_TIMELINE.prototype.get_backgroundColor = function () {
        if (this.ob_filters !== undefined) {
            for (let i = 0; i < this.ob_filters.length; i++) {
                try {
                    if (this.ob_filters[i].current === "yes")
                        return this.ob_filters[i].backgroundColor;
                } catch (e) {
                    return "";
                }
            }
        }
    };

    OB_TIMELINE.prototype.get_current_filter_value = function () {
        if (this.ob_filters !== undefined) {
            for (let i = 0; i < this.ob_filters.length; i++) {
                try {
                    if (this.ob_filters[i].current === "yes")
                        return this.ob_filters[i].filter_value;
                } catch (e) {
                    return "";
                }
            }
        }
    };

    OB_TIMELINE.prototype.get_current_sortBy = function () {
        if (this.ob_filters !== undefined) {
            for (let i = 0; i < this.ob_filters.length; i++) {
                try {
                    if (this.ob_filters[i].current === "yes")
                        return this.ob_filters[i].sortBy;
                } catch (e) {
                    return "";
                }
            }
        }
    };

    OB_TIMELINE.prototype.set_user_setting_and_filters = function (ob_scene_index, setting_and_filters) {
        if (setting_and_filters.openbexi_timeline !== undefined) {
            this.name = setting_and_filters.openbexi_timeline[0].name;
            //this.title = setting_and_filters.openbexi_timeline[0].title;
            this.user = setting_and_filters.openbexi_timeline[0].user.toLowerCase();
            this.email = setting_and_filters.openbexi_timeline[0].email.toLowerCase();
            this.ob_scene[ob_scene_index].top = setting_and_filters.openbexi_timeline[0].top;
            this.ob_scene[ob_scene_index].left = setting_and_filters.openbexi_timeline[0].left;
            this.ob_scene[ob_scene_index].width = setting_and_filters.openbexi_timeline[0].width;
            this.ob_scene[ob_scene_index].height = setting_and_filters.openbexi_timeline[0].height;
            this.ob_scene[ob_scene_index].ob_camera_type = setting_and_filters.openbexi_timeline[0].camera;
            if (this.ob_scene !== undefined)
                this.ob_scene[ob_scene_index].bands[0].model[0].sortBy = setting_and_filters.openbexi_timeline[0].sortBy;
            if (document.getElementById("ob_sort_by") !== null)
                document.getElementById("ob_sort_by").value = setting_and_filters.openbexi_timeline[0].sortBy;
            this.ob_filters = setting_and_filters.openbexi_timeline[0].filters;
            this.backgroundColor = setting_and_filters.openbexi_timeline[0].backgroundColor;
            if (this.ob_filters !== undefined && this.ob_filters.length !== 0) {
                this.backgroundColor = this.get_backgroundColor(ob_scene_index);
                this.ob_scene[ob_scene_index].ob_filter_value = this.get_current_filter_value(ob_scene_index);
                this.ob_scene[ob_scene_index].ob_filter_value =
                    this.ob_scene[ob_scene_index].ob_filter_value.replaceAll("|", "_PIPE_")
                        .replaceAll("+", "_PLUS_")
                        .replaceAll("%", "_PERC_")
                        .replaceAll("(", "_PARL_")
                        .replaceAll(")", "_PARR_");
                this.ob_scene[ob_scene_index].bands[0].model[0].sortBy = this.get_current_sortBy(ob_scene_index);
            } else
                this.ob_scene[ob_scene_index].ob_filter_value = "";
        }
    };

    OB_TIMELINE.prototype.update_scene = function (
        ob_scene_index,
        header,
        params,
        bands,
        model,
        sessions,
        camera,
        band,
        load_data
    ) {
        let ob_scene_update_required_with_no_reload = false;

        if (band !== null) {
            let x = band.position.x;
            if (band.name.match(/overview_/) && band.position.x_with_no_scale !== undefined) {
                x = band.position.x_with_no_scale;
            }
            if (band.pos_x > -x - this.ob_scene[ob_scene_index].width || x < band.pos_x + this.ob_scene[ob_scene_index].width) {
                clearInterval(this.ob_scene[ob_scene_index].ob_interval_move);
                this.reset_synced_time("new_view", ob_scene_index);
                this.load_data(ob_scene_index);
            } else {
                this.ob_render(ob_scene_index);
            }
        } else {
            if (this.first_sync === undefined) {
                this.first_sync = true;
                this.reset_synced_time("new_sync", ob_scene_index);
                this.runEmptyTimeline(ob_scene_index);
                if (this.data && this.data.match(/^(https|http?):\/\//)) {
                    this.ob_read_filter(ob_scene_index, 0);
                } else if (this.data.includes("readDescriptor")) {
                    if (sessions.events.data !== undefined) {
                        this.ob_open_descriptor(ob_scene_index, sessions.events.data);
                    }
                } else {
                    try {
                        let ob_data = this.data.split("?");
                        let fileExtension = this.data && ob_data[0].match(/\.([^.]+)$/);
                        if (fileExtension !== null) {
                            if (fileExtension[1].toLowerCase() === "json") {
                                this.loadJSON(ob_scene_index);
                            }
                        }
                    } catch (e) {
                    }
                }
                return;
            }

            if (load_data === true) {
                this.load_data(ob_scene_index);
                return;
            }
            ob_scene_update_required_with_no_reload = true;
        }

        if (ob_scene_update_required_with_no_reload) {
            let that_scene = this;
            clearTimeout(this.update_this_scene);
            this.update_this_scene = setTimeout(function () {
                that_scene.update_all_timelines(ob_scene_index, header, params, bands, model, sessions, camera);
            }, 0);
        }
    };

    OB_TIMELINE.prototype.update_all_timelines = function (ob_scene_index, header, params, bands, model, sessions, camera) {
        ob_timelines.forEach(function (ob_timeline) {
                let startDate = new Date();
                if (ob_scene_index === undefined)
                    ob_scene_index = 0;
                if (ob_timeline.name === params[0].name) {
                    ob_timeline.destroy_scene(ob_scene_index);
                    ob_timeline.header = header;
                    ob_timeline.params = params;
                    ob_timeline.ob_scene[ob_scene_index].bands = bands;
                    ob_timeline.ob_scene[ob_scene_index].model = model;
                    ob_timeline.ob_scene[ob_scene_index].sessions = sessions;
                    ob_timeline.ob_set_scene(ob_scene_index);
                    ob_timeline.ob_scene_init(ob_scene_index);
                    ob_timeline.set_bands(ob_scene_index);
                    ob_timeline.set_sessions(ob_scene_index);
                    ob_timeline.ob_set_body_menu(ob_scene_index);
                    ob_timeline.ob_set_renderer(ob_scene_index);
                    ob_timeline.create_bands(ob_scene_index, false);
                    ob_timeline.create_zones(ob_scene_index);
                    ob_timeline.add_line_current_time(ob_scene_index,
                        new Date(ob_timeline.get_current_time()), "rgb(243,23,51)");
                    ob_timeline.center_bands(ob_scene_index);
                    ob_timeline.ob_scene[ob_scene_index].ob_camera_type = camera;
                    ob_timeline.ob_start_clock(ob_scene_index);
                    if (ob_timeline.ob_scene[ob_scene_index].show_calendar)
                        ob_timeline.ob_create_calendar(ob_scene_index,
                            new Date(ob_timeline.ob_scene[ob_scene_index].date_cal));
                    if (ob_timeline.show_filters)
                        ob_timeline.ob_create_filters(ob_scene_index, 0, "select_filter");
                    // Apply filter if any here:
                    let regex = ob_timeline.build_sessions_filter(ob_scene_index, "");
                    ob_timeline.create_sessions(ob_scene_index, false, regex);
                    ob_timeline.create_segments_and_dates(ob_scene_index);
                    //if (ob_timeline.ob_scene[ob_scene_index].ready=== true)
                    ob_timeline.ob_set_camera(ob_scene_index);
                }
                let endDate = new Date();
                ob_timeline.ob_optimize_load_time(ob_scene_index, ob_timeline.ob_scene[ob_scene_index].multiples);
                let ob_time = endDate.getTime() - startDate.getTime();
                try {
                    if (ob_timeline.ob_scene[ob_scene_index].sessions.events.length !== 1)
                        console.log("populated " +
                            ob_timeline.ob_scene[ob_scene_index].sessions.events.length +
                            " session(s) in " + ob_time + " ms and updated scene " + ob_scene_index +
                            " (date min=" + ob_timeline.ob_scene[ob_scene_index].minDate + "- date max=" +
                            ob_timeline.ob_scene[ob_scene_index].maxDate + ")");
                } catch (e) {
                }
            }
        );
        return null;
    };

    OB_TIMELINE.prototype.update_time_marker = function (ob_date) {
        if (ob_date !== undefined)
            this.ob_markerDate = ob_date;
        if (this.ob_marker !== undefined) {
            this.ob_marker.style.visibility = "visible";
            this.ob_marker.style.zIndex = "99999";
            this.ob_marker.style.top = parseInt(this.ob_timeline_header.style.height) - 14 + "px";
            this.ob_marker.style.left = (this.ob_timeline_header.offsetWidth / 2) -
                parseInt(this.ob_marker.style.width) / 2 + "px";
        }
        if (this.ob_time_marker.innerText !== undefined) {
            this.ob_time_marker.style.visibility = "visible";
            this.ob_time_marker.style.zIndex = "99999";
            this.ob_time_marker.style.top = "0px";
            this.ob_time_marker.style.left = (this.ob_timeline_header.offsetWidth / 2) - 200 + "px";
            if (this.timeZone === "UTC") {
                this.ob_time_marker.innerText = this.title + " - " + this.ob_markerDate.toString().substring(0, 25) +
                    " - UTC";
            } else {
                this.ob_time_marker.innerText = this.title + " - " + this.ob_markerDate.toString().substring(0, 25);
            }
            if (this.ob_cal !== undefined) {
                this.ob_cal.goto(this.ob_markerDate);
                this.ob_cal.set(this.ob_markerDate);
            }
        }
    };

    OB_TIMELINE.prototype.sync_bands = function (ob_scene_index, ob_band, x) {
        if (!ob_band) return;

        const currentScene = this.ob_scene[ob_scene_index];
        const bands = currentScene.bands;
        let scale1, scale2, matchingBand;

        // Find the band that matches the given ob_band and update its properties
        for (let i = 0, len = bands.length; i < len; i++) {
            if (bands[i].name === ob_band.name) {
                matchingBand = bands[i];
                break;
            }
        }

        if (matchingBand) {
            this.ob_markerDate = this.pixelOffSetToDate(
                ob_scene_index, -x, matchingBand.gregorianUnitLengths, matchingBand.intervalPixels
            );
            matchingBand.x = x;
            scale1 = matchingBand.gregorianUnitLengths / matchingBand.intervalPixels;
        }

        // Update other bands based on the matching band
        for (let i = 0, len = bands.length; i < len; i++) {
            const band = bands[i];
            if (band.name !== ob_band.name) {
                const markerDate2 = this.pixelOffSetToDate(
                    ob_scene_index, x, band.gregorianUnitLengths, band.intervalPixels
                );
                const incrementPixelOffSet2 = this.dateToPixelOffSet(
                    ob_scene_index, markerDate2, band.gregorianUnitLengths, band.intervalPixels
                );
                scale2 = band.gregorianUnitLengths / band.intervalPixels;

                const ob_band2 = currentScene.getObjectByName(band.name);
                if (ob_band2) {
                    ob_band.position.x_with_no_scale = ob_band2.position.x;
                    ob_band2.position.x = incrementPixelOffSet2 / (scale2 / scale1);
                }
            }
        }

        this.update_time_marker();
    };


    OB_TIMELINE.prototype.move_band = function (ob_scene_index, ob_band_name, x, y, z, ob_sync) {
        if (isNaN(x)) return;

        let ob_band = this.ob_scene[ob_scene_index].getObjectByName(ob_band_name);
        if (ob_band === undefined) return;
        ob_band.position.set(x, y, z);
        if (ob_sync)
            this.sync_bands(ob_scene_index, ob_band, x, y, z);

    };

    OB_TIMELINE.prototype.create_segments_and_dates = function (ob_scene_index) {
        const scene = this.ob_scene[ob_scene_index];
        for (const band of scene.bands) {
            const ob_band = scene.getObjectByName(band.name);
            let incrementPixelOffSet = this.dateToPixelOffSet(ob_scene_index, band.minDate, band.gregorianUnitLengths, band.intervalPixels);
            let maxPixelOffSet = this.dateToPixelOffSet(ob_scene_index, band.maxDate, band.gregorianUnitLengths, band.intervalPixels);

            while (parseInt(incrementPixelOffSet) < parseInt(maxPixelOffSet) + parseInt(band.intervalPixels)) {
                this.createSegment(ob_scene_index, band, incrementPixelOffSet);
                this.createDateText(ob_scene_index, ob_band, band, incrementPixelOffSet);
                if (band.subIntervalPixels !== "NONE") {
                    this.createSubSegments(ob_scene_index, band, incrementPixelOffSet);
                }
                incrementPixelOffSet = parseInt(incrementPixelOffSet) + parseInt(band.intervalPixels);
            }
        }
    };

    OB_TIMELINE.prototype.createSegment = function (ob_scene_index, band, incrementPixelOffSet) {
        const heightMaxHalf = band.heightMax / 2;
        this.add_segment(ob_scene_index, band.name, incrementPixelOffSet, heightMaxHalf, 5, band.heightMax, "black", false);
        this.add_segment(ob_scene_index, band.name, incrementPixelOffSet + 0.15, heightMaxHalf, 5, band.heightMax, band.color, false);
    };

    OB_TIMELINE.prototype.createDateText = function (ob_scene_index, ob_band, band, incrementPixelOffSet) {
        const text = this.pixelOffSetToDateText(ob_scene_index, incrementPixelOffSet, band.gregorianUnitLengths, band.intervalPixels, band.intervalUnit, band.dateFormat);
        const textX = incrementPixelOffSet - (band.fontSizeInt / 2) + 6;
        const textY = this.calculateTextYPosition(band);
        this.add_text_sprite(ob_scene_index, ob_band, text, textX, textY, 5, undefined, band.fontSizeInt, band.fontStyle, band.fontWeight, band.dateColor, band.fontFamily, this.ob_scene[ob_scene_index].font_align);
    };

    OB_TIMELINE.prototype.calculateTextYPosition = function (band) {
        const heightMaxHalf = band.heightMax / 2;
        if (band.intervalUnitPos === "TOP") {
            return heightMaxHalf - band.fontSizeInt;
        }
        return -parseInt(band.heightMax) / 2 + band.fontSizeInt / 2;
    };

    OB_TIMELINE.prototype.createSubSegments = function (ob_scene_index, band, incrementPixelOffSet) {
        let incrementSubPixelOffSet = parseInt(band.subIntervalPixels);
        const heightMaxHalf = band.heightMax / 2;
        while (parseInt(incrementPixelOffSet) + incrementSubPixelOffSet < parseInt(incrementPixelOffSet) + parseInt(band.intervalPixels)) {
            this.add_segment(ob_scene_index, band.name, incrementPixelOffSet + incrementSubPixelOffSet, heightMaxHalf, 5, band.heightMax, "black", true);
            this.add_segment(ob_scene_index, band.name, incrementPixelOffSet + incrementSubPixelOffSet + 0.20, heightMaxHalf, 5, band.heightMax, band.color, true);
            incrementSubPixelOffSet += parseInt(band.subIntervalPixels);
        }
    };

    OB_TIMELINE.prototype.get_first_free_tracks = function (ob_scene_index, ob_busy_tracks, session, i) {
        const band = this.ob_scene[ob_scene_index].bands[i];
        const trackIncrement = band.trackIncrement;
        const activitiesLength = session.activities.length;
        let ob_current_track = band.maxY - band.fontSizeInt - trackIncrement;

        if (ob_busy_tracks.length === 0) {
            return ob_current_track;
        }

        for (let t = 0; t < ob_busy_tracks.length; t++) {
            try {
                let ob_count_track;
                const busyTrack = ob_busy_tracks[t];
                if (ob_current_track > busyTrack) {
                    ob_count_track = Math.abs(ob_current_track - busyTrack) / trackIncrement;
                    if (isNaN(ob_count_track)) {
                        return ob_current_track;
                    }
                    if (t !== 0 && ob_count_track > activitiesLength) {
                        return ob_current_track - (activitiesLength * trackIncrement);
                    }
                    if (ob_count_track > activitiesLength) {
                        return ob_current_track;
                    }
                } else {
                    const nextBusyTrack = ob_busy_tracks[t + 1];
                    ob_count_track = Math.abs(busyTrack - nextBusyTrack) / trackIncrement - activitiesLength;
                    if (isNaN(ob_count_track)) {
                        ob_current_track = ob_busy_tracks[ob_busy_tracks.length - 1] - trackIncrement;
                        return ob_current_track;
                    }
                    if (ob_count_track > activitiesLength) {
                        return busyTrack - (activitiesLength * trackIncrement);
                    }
                }
                ob_current_track -= (activitiesLength * trackIncrement);
            } catch (e) {
                ob_current_track = ob_busy_tracks[ob_busy_tracks.length - 1] - trackIncrement;
                return ob_current_track;
            }
        }
        return ob_busy_tracks[ob_busy_tracks.length - 1] - (activitiesLength * trackIncrement);
    };


    OB_TIMELINE.prototype.get_room_for_session = function (ob_scene_index, sessions, session, i, j) {
        let ob_busy_tracks = [];
        const band = this.ob_scene[ob_scene_index].bands[i];

        band.track = band.maxY - band.fontSizeInt;
        band.track -= band.trackIncrement;

        // Check overlapping with the current session
        for (let l = 0; l < j; l++) {
            let currentSession = sessions[l];
            let isOverlapX =
                (session.original_x >= currentSession.original_x &&
                    session.original_x + session.total_width <= currentSession.original_x + currentSession.total_width) ||
                (session.original_x + session.total_width >= currentSession.original_x &&
                    session.original_x + session.total_width <= currentSession.original_x + currentSession.total_width) ||
                (session.original_x >= currentSession.original_x &&
                    session.original_x <= currentSession.original_x + currentSession.total_width) ||
                (session.original_x <= currentSession.original_x &&
                    session.original_x + session.total_width >= currentSession.original_x + currentSession.total_width);

            if (isOverlapX) {
                for (let a = 0; a < currentSession.activities.length; a++) {
                    ob_busy_tracks.push(currentSession.activities[a].y);
                }
            }
        }

        ob_busy_tracks.sort((a, b) => b - a);

        // Adjust minY to make enough room for the current session
        let ob_first_free_track = this.get_first_free_tracks(ob_scene_index, ob_busy_tracks, session, i);
        if (ob_first_free_track <= band.minY +
            band.trackIncrement) {
            this.ob_scene[ob_scene_index].bands.updated = true;
            band.minY = ob_first_free_track -
                (session.activities.length * band.trackIncrement) -
                band.trackIncrement;
        }
        return ob_first_free_track;
    };

    OB_TIMELINE.prototype.getTextWidth = function (text, font, margin) {
        const cacheKey = `${text}-${font}`;
        this.measureCache = this.measureCache || {};

        // Check if we have this measurement in the cache
        if (this.measureCache[cacheKey]) {
            return this.measureCache[cacheKey] + margin;
        }

        try {
            let canvas = this.getTextWidth.canvas || (this.getTextWidth.canvas = document.createElement("canvas"));
            let context = canvas.getContext("2d");
            context.font = font;
            let metrics = context.measureText(text);
            const width = metrics.actualBoundingBoxRight - metrics.actualBoundingBoxLeft;

            // Cache this measurement for future use
            this.measureCache[cacheKey] = width;

            return width + margin;
        } catch (e) {
            return 0;
        }
    };


    OB_TIMELINE.prototype.getSessionWidth = function (activities) {
        // Early return if the activities array is empty
        if (activities.length === 0) {
            return 0;
        }

        // Initialize min_x and max_x with positive and negative infinity, respectively
        let min_x = Infinity;
        let max_x = -Infinity;

        // Use try-catch for error handling
        try {
            // Use a traditional for loop for better performance
            const len = activities.length;
            for (let i = 0; i < len; i++) {
                const activity = activities[i];
                // Calculate the rightmost x coordinate of the current activity
                const right_x = activity.x + activity.width;

                // Update min_x and max_x
                min_x = Math.min(min_x, activity.x);
                max_x = Math.max(max_x, right_x);
            }
        } catch (e) {
            // Handle exceptions here if needed
            console.error("An error occurred:", e);
            return activities[0].width;
        }

        // Calculate and return the session width
        return max_x - min_x;
    };

    OB_TIMELINE.prototype.getSessionTotalWidth = function (activities) {
        const len = activities.length;
        if (len === 0) {
            return 0;
        }

        let min_x = Infinity;
        let max_x = -Infinity;

        try {
            let activity, right_x;
            for (let i = 0; i < len; ++i) {
                activity = activities[i];
                right_x = activity.x + activity.total_width;

                if (right_x > max_x) max_x = right_x;
                if (activity.x < min_x) min_x = activity.x;
            }
        } catch (e) {
            console.error("An error occurred:", e);
            return activities[0].total_width;
        }

        return max_x - min_x;
    };


    OB_TIMELINE.prototype.getSessionY = function (activities, h) {
        let ob_y = activities[0].y;

        if (activities.length < 2) {
            return ob_y;
        }

        try {
            ob_y = activities[0].y - h / 2 + activities[0].height;
        } catch (e) {
            console.error(e);
            return parseInt(ob_y);
        }

        return parseInt(ob_y);
    };

    OB_TIMELINE.prototype.getSessionX = function (activities) {
        let ob_x = activities[0].x;

        if (activities.length < 2) {
            return ob_x;
        }

        try {
            for (let i = 1; i < activities.length; i++) {
                if (activities[i].x < ob_x) {
                    ob_x = activities[i].x;
                }
            }
        } catch (e) {
            console.error(e);
            return parseInt(ob_x);
        }

        return parseInt(ob_x);
    };

    OB_TIMELINE.prototype.getSessionX_Relative = function (activities, total_w) {
        let ob_x = activities[0].x;

        if (activities.length < 2) {
            return ob_x;
        }

        try {
            for (let i = 1; i < activities.length; i++) {
                if (activities[i].x < ob_x) {
                    ob_x = activities[i].x;
                }
            }
            ob_x += total_w / 2;
        } catch (e) {
            console.error(e);
            return parseInt(ob_x);
        }

        return parseInt(ob_x);
    };


    OB_TIMELINE.prototype.getSession_originalX = function (activities) {
        let ob_x = activities[0].original_x;

        if (activities.length < 2) {
            return ob_x;
        }

        try {
            for (let i = 1; i < activities.length; i++) {
                if (activities[i].original_x > ob_x) {
                    ob_x = activities[i].original_x;
                }
            }
        } catch (e) {
            console.error(e);
            return parseInt(ob_x);
        }

        return parseInt(ob_x);
    };

    OB_TIMELINE.prototype.init_activities = function (ob_scene_index, band_index, session_index) {
        let y = 0;
        let z = 5;
        let h = 0;
        let w = 0;
        let textWidth = 0;
        let pixelOffSetStart = 0;
        let pixelOffSetEnd = 0;
        let original_pixelOffSetStart = 0;
        let original_pixelOffSetEnd = 0;
        let ob_band_index = band_index === 0 ? 1 : 0;
        let ob_coef_overview = 1;

        if (this.ob_scene[ob_scene_index].bands[band_index].name.match(/overview_/)) {
            ob_coef_overview = this.ob_scene[ob_scene_index].bands[ob_band_index].gregorianUnitLengths /
                this.ob_scene[ob_scene_index].bands[band_index].gregorianUnitLengths;
        }

        const activities = this.ob_scene[ob_scene_index].bands[band_index].sessions[session_index].activities;

        for (let a = 0; a < activities.length; a++) {
            const activity = activities[a];
            const {data} = activity;

            if (data !== undefined && data !== null) {
                if (data.title === undefined) {
                    data.title = "";
                }
                pixelOffSetStart = this.dateToPixelOffSet(ob_scene_index, activity.start,
                    this.ob_scene[ob_scene_index].bands[band_index].gregorianUnitLengths,
                    this.ob_scene[ob_scene_index].bands[band_index].intervalPixels);

                pixelOffSetEnd = this.dateToPixelOffSet(ob_scene_index, activity.end,
                    this.ob_scene[ob_scene_index].bands[band_index].gregorianUnitLengths,
                    this.ob_scene[ob_scene_index].bands[band_index].intervalPixels);

                if (activity.original_start !== undefined && activity.original_start !== "") {
                    original_pixelOffSetStart = this.dateToPixelOffSet(ob_scene_index, activity.original_start,
                        this.ob_scene[ob_scene_index].bands[band_index].gregorianUnitLengths,
                        this.ob_scene[ob_scene_index].bands[band_index].intervalPixels);

                    activity.original_pixelOffSetStart = original_pixelOffSetStart;
                    activity.original_x = parseInt(original_pixelOffSetStart);
                } else {
                    activity.original_x = parseInt(pixelOffSetStart);
                }

                if (activity.original_end !== undefined && activity.original_end !== "") {
                    original_pixelOffSetEnd = this.dateToPixelOffSet(ob_scene_index, activity.original_end,
                        this.ob_scene[ob_scene_index].bands[band_index].gregorianUnitLengths,
                        this.ob_scene[ob_scene_index].bands[band_index].intervalPixels);

                    activity.original_pixelOffSetEnd = parseInt(original_pixelOffSetEnd);
                }

                let add_tolerance = 0;

                if (activity.data.tolerance !== undefined &&
                    activity.data.tolerance !== "" &&
                    activity.end !== "" &&
                    activity.data.tolerance >= 0) {
                    add_tolerance = parseInt(activity.data.tolerance);
                }
                let add_image = 0;
                if (activity.render.image !== undefined && activity.render.image !== "") {
                    add_image = 32;
                }

                if (isNaN(parseInt(pixelOffSetEnd))) {
                    h = this.ob_scene[ob_scene_index].bands[band_index].defaultEventSize;
                    w = this.ob_scene[ob_scene_index].bands[band_index].sessionHeight;
                } else {
                    h = this.ob_scene[ob_scene_index].bands[band_index].sessionHeight;
                    w = parseInt(pixelOffSetEnd) - parseInt(pixelOffSetStart);
                }

                if (this.ob_scene[ob_scene_index].bands[band_index].name.match(/overview_/)) {
                    h = this.ob_scene[ob_scene_index].bands[band_index].defaultEventSize /
                        this.ob_scene[ob_scene_index].bands[band_index].trackIncrement;
                    if (isNaN(parseInt(pixelOffSetEnd))) {
                        w = h / 2;
                    }
                }

                activity.x = parseInt(pixelOffSetStart);
                activity.x_relative = parseInt(pixelOffSetStart) + w / 2;
                if (activity.data.tolerance === undefined)
                    activity.original_x = activity.x;
                else
                    activity.original_x = activity.original_x = this.getSession_originalX(activities);
                activity.width = w;
                activity.height = h;
                activity.size = h;
                activity.y = y;
                activity.z = z;
                activity.pixelOffSetStart = parseInt(pixelOffSetStart);
                activity.pixelOffSetEnd = parseInt(pixelOffSetEnd);
                textWidth = this.getTextWidth(data.title,
                    this.ob_scene[ob_scene_index].bands[band_index].fontSize + " " +
                    this.ob_scene[ob_scene_index].bands[band_index].fontFamily, 10);
                activity.textX = (w + textWidth) / 2;
                ;
                activity.total_width = add_image + w + textWidth + add_tolerance;

                if (this.ob_scene[ob_scene_index].bands[band_index].name.match(/overview_/)) {
                    activity.total_width *= ob_coef_overview;
                }
            }
        }
    };

    OB_TIMELINE.prototype.init_sessions = function (ob_scene_index, band_index) {
        let layout;
        let sortByValue;
        let session = {};

        // Assign each event to the right bands and store zones
        if (sortByValue === undefined) {
            let that_eval2 = this;
            sortByValue = eval("that_eval2.ob_scene[ob_scene_index].bands[band_index].model[0].sortBy");
        }
        for (let k = 0; k < this.ob_scene[ob_scene_index].sessions.events.length; k++) {
            if (this.ob_scene[ob_scene_index].sessions.events[k].activities === undefined) {
                if (this.ob_scene[ob_scene_index].sessions.events[k].id === undefined)
                    this.ob_scene[ob_scene_index].sessions.events[k].id = 0;
                let activity = Object.assign({}, this.ob_scene[ob_scene_index].sessions.events[k]);
                this.ob_scene[ob_scene_index].sessions.events[k].activities = [];
                this.ob_scene[ob_scene_index].sessions.events[k].activities[0] = activity;
            }
            session = JSON.parse(JSON.stringify(this.ob_scene[ob_scene_index].sessions.events[k]));
            if (session.zone !== undefined) {
                this.ob_scene[ob_scene_index].bands[band_index].zones.push(session);
            } else {
                if (sortByValue === "NONE" || sortByValue === "") {
                    this.ob_scene[ob_scene_index].bands[band_index].sessions.push(session);
                } else {
                    layout = session.data.sortByValue;
                    if (layout === undefined)
                        layout = eval("session.data." + sortByValue);
                    if (layout !== undefined && this.ob_scene[ob_scene_index].bands[band_index].layout_name === layout) {
                        this.ob_scene[ob_scene_index].bands[band_index].sessions.push(session);
                    }
                }
                this.build_model(ob_scene_index, session.data);
            }
        }
    };

    OB_TIMELINE.prototype.set_sessions = function (ob_scene_index) {
        let y = this.ob_scene[ob_scene_index].ob_height / 2;
        let z = 5;
        this.ob_scene[ob_scene_index].bands.updated = false;

        for (let p = 0; p < 2; p++) {
            if (p === 1 && !this.ob_scene[ob_scene_index].bands.updated) {
                break;
            }

            for (let i = 0; i < this.ob_scene[ob_scene_index].bands.length; i++) {
                const band = this.ob_scene[ob_scene_index].bands[i];
                if (!this.ob_scene[ob_scene_index].sessions || !this.ob_scene[ob_scene_index].sessions.events) {
                    break;
                }

                band.zones = [];
                band.sessions = [];
                band.lastGreaterY = -this.ob_scene[ob_scene_index].ob_height / 2;

                this.init_sessions(ob_scene_index, i);

                for (let j = 0; j < band.sessions.length; j++) {
                    this.init_activities(ob_scene_index, i, j);

                    const session = band.sessions[j];
                    session.width = this.getSessionWidth(session.activities);
                    session.total_width = this.getSessionTotalWidth(session.activities);
                    session.x_relative = this.getSessionX_Relative(session.activities, session.width);
                    session.x = this.getSessionX(session.activities);
                    if (session.data !== undefined)
                        if (session.data.tolerance === undefined)
                            session.original_x = session.x;
                        else
                            session.original_x = this.getSession_originalX(session.activities);
                    session.y = y;
                    session.z = z;
                    session.height = (band.trackIncrement * session.activities.length);

                    y = this.get_room_for_session(ob_scene_index, band.sessions, session, i, j);

                    for (let a = 0; a < session.activities.length; a++) {
                        session.activities[a].y = y;
                        y -= band.trackIncrement;
                    }

                    session.y = this.getSessionY(session.activities, session.height);
                    if (y > band.lastGreaterY) {
                        band.lastGreaterY = y;
                    }
                }

                if (band.lastGreaterY !== -this.ob_scene[ob_scene_index].ob_height / 2) {
                    band.lastGreaterY += band.trackIncrement;
                } else {
                    band.maxY = this.ob_scene[ob_scene_index].height / 2;
                    band.minY = -band.maxY;
                    band.lastGreaterY = this.ob_scene[ob_scene_index].height / 2;
                }
            }

            this.set_bands_height(ob_scene_index);
        }
    };

    OB_TIMELINE.prototype.build_sessions_filter = function (ob_scene_index, filter) {
        if (filter === null || filter === "") return null;

        this.ob_scene[ob_scene_index].ob_filter_value = filter;
        this.regex = "^(?=.*(?:--|--))(?!.*(?:__|__)).*$";
        if (this.ob_scene[ob_scene_index].ob_filter_value.length === 1)
            this.regex = this.regex.replace("--|--",
                this.ob_scene[ob_scene_index].ob_filter_value[0].replace(" ",
                    "|").replace(",", "|").replace(";", "|"));
        if (this.ob_scene[ob_scene_index].ob_filter_value.length === 2) {
            this.regex = this.regex.replace("--|--",
                this.ob_scene[ob_scene_index].ob_filter_value[0].replace(" ",
                    "|").replace(",", "|").replace(";", "|"));
            this.regex = this.regex.replace("__|__",
                this.ob_scene[ob_scene_index].ob_filter_value[1].replace(" ",
                    "|").replace(",", "|").replace(";", "|"));
        }
        return this.regex;
    };

    OB_TIMELINE.prototype.add_tolerance = function (ob_scene_index, ob_object, band_name, session, color) {
        const width = parseInt(session.width);

        // Validate tolerance
        const toleranceValue = session.data.tolerance;
        if (toleranceValue === undefined || toleranceValue === "") {
            return;
        }
        const tolerance = parseInt(toleranceValue);
        if (tolerance < 1) {
            return;
        }

        // Set color
        color = color || session.render.color || "#040404";

        const ob_material = this.track[ob_scene_index](new THREE.MeshBasicMaterial({color: color}));

        const ob_tolerance =
            this.track[ob_scene_index](new THREE.Mesh(this.track[ob_scene_index](new THREE.BoxGeometry(width +
                tolerance, 1, 10)), ob_material));
        ob_tolerance.position.set(session.original_x + (width + tolerance) / 2,
            session.y - session.height / 2, session.z + 1);

        // Function to create circle
        const createCircle = (positionX) => {
            const circle = this.track[ob_scene_index](new THREE.Mesh(
                this.track[ob_scene_index](new THREE.SphereGeometry(2)), ob_material));
            circle.position.set(positionX, 0, session.z);
            ob_tolerance.add(circle);
        };

        // Create circles at the ends of the tolerance band
        createCircle(-(width + tolerance) / 2);
        createCircle((width + tolerance) / 2);

        // Add tolerance to the band if it exists
        const ob_band = this.ob_scene[ob_scene_index].getObjectByName(band_name);
        if (ob_band !== undefined) {
            ob_band.add(ob_tolerance);
        }
    };

    OB_TIMELINE.prototype.create_sessions = function (ob_scene_index, ob_set_sessions, regex) {
        if (ob_scene_index === undefined) ob_scene_index = 0;
        if (ob_set_sessions === true) this.set_sessions(ob_scene_index);

        for (let i = 0; i < this.ob_scene[ob_scene_index].bands.length; i++) {
            const band = this.ob_scene[ob_scene_index].bands[i];

            for (let j = 0; j < band.sessions.length; j++) {
                const session = band.sessions[j];

                for (let a = 0; a < session.activities.length; a++) {
                    const activity = session.activities[a];

                    if (regex !== null && activity.id === undefined && !activity.data.title.match(regex)) {
                        continue;
                    }

                    let eventColor = band.eventColor;
                    let sessionColor = band.SessionColor;
                    let textColor = band.dateColor;
                    let fontSizeInt = band.fontSizeInt;
                    let fontWeight = band.fontWeight;
                    let fontFamily = band.fontFamily;
                    let fontStyle = band.fontStyle;
                    let image = band.image;
                    let texture = band.texture;
                    let backgroundColor = band.backgroundColor;
                    let luminance = band.luminance;
                    let opacity = band.opacity;

                    if (activity.render !== undefined) {
                        const render = activity.render;

                        textColor = render.textColor !== undefined ? render.textColor : textColor;
                        fontSizeInt = render.fontSize !== undefined ? render.fontSize : fontSizeInt;
                        fontWeight = render.fontWeight !== undefined ? render.fontWeight : fontWeight;
                        fontFamily = render.fontFamily !== undefined ? render.fontFamily : fontFamily;
                        fontStyle = render.fontStyle !== undefined ? render.fontStyle : fontStyle;
                        backgroundColor = render.backgroundColor !== undefined ? render.backgroundColor : backgroundColor;
                        luminance = render.luminance !== undefined ? render.luminance : luminance;
                        opacity = render.opacity !== undefined ? render.opacity : opacity;
                        texture = render.texture !== undefined ? render.texture : texture;
                        image = render.image !== undefined ? render.image : image;
                        eventColor = render.color !== undefined ? render.color : eventColor;
                        sessionColor = render.color !== undefined ? render.color : sessionColor;
                    }

                    if (activity.pixelOffSetEnd === undefined || isNaN(parseInt(activity.pixelOffSetEnd))) {
                        // Events
                        if (band.name.match(/overview_/)) {
                            if (this.ob_scene[ob_scene_index].ob_search_value === "" || backgroundColor === "#F8DF09") {
                                this.add_event(ob_scene_index, band.name, activity, eventColor, undefined,
                                    backgroundColor, fontSizeInt, fontStyle, fontWeight, textColor, fontFamily,
                                    false, this.ob_scene[ob_scene_index].font_align);
                            }
                        } else {
                            this.add_event(ob_scene_index, band.name, activity, eventColor, image, backgroundColor,
                                fontSizeInt, fontStyle, fontWeight, textColor, fontFamily, true,
                                this.ob_scene[ob_scene_index].font_align);
                        }
                    } else {
                        // Sessions
                        if (band.name.match(/overview_/)) {
                            if (this.ob_scene[ob_scene_index].ob_search_value === "" || backgroundColor === "#F8DF09") {
                                this.add_session(ob_scene_index, band.name, activity, sessionColor, texture,
                                    undefined, backgroundColor, fontSizeInt, fontStyle, fontWeight, textColor,
                                    fontFamily, this.ob_scene[ob_scene_index].font_align);
                            }
                        } else {
                            this.add_session(ob_scene_index, band.name, activity, sessionColor, texture, image,
                                backgroundColor, fontSizeInt, fontStyle, fontWeight, textColor, fontFamily,
                                this.ob_scene[ob_scene_index].font_align);
                        }
                    }
                }

                // Create box if multiple activities
                if (session.activities.length > 1) {
                    if (band.name.match(/overview_/)) {
                        if (this.ob_scene[ob_scene_index].ob_search_value === "" || session.activities.length > 0) {
                            this.add_sessionsBox(ob_scene_index, band.name, session, undefined, undefined, undefined, undefined);
                        }
                    } else {
                        this.add_sessionsBox(ob_scene_index, band.name, session, undefined, undefined, undefined, undefined);
                    }
                }
            }
        }
    };

    OB_TIMELINE.prototype.add_sessionsBox = function (
        ob_scene_index,
        band_name,
        session,
        color,
        texture,
        luminance = -0.15,
        opacity = 0.35
    ) {
        const scene = this.ob_scene[ob_scene_index];
        const track = this.track[ob_scene_index];
        const boxName = `${band_name}_sessionBox_${session.id}`;

        if (scene.getObjectByName(boxName)) {
            return;
        }

        color = color || session.render?.color;
        if (color) {
            color = this.hex_Luminance(color, luminance);
        }

        const ob_box = track(new THREE.BoxGeometry(session.width, session.height, 1));
        let ob_material;

        if (texture) {
            ob_material = this.createTextureMaterial(track, scene, texture);
        } else {
            ob_material = track(new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity
            }));
        }

        const ob_box_activities = track(new THREE.Mesh(ob_box, ob_material));
        this.setBoxProperties(ob_box_activities, session, band_name, scene);

    };

    OB_TIMELINE.prototype.createTextureMaterial = function (track, scene, texture) {
        const loader = track(new THREE.CubeTextureLoader());
        loader.setCrossOrigin("");
        loader.setPath('three.js/examples/textures/cube/pisa/');
        const textureCube = loader.load([
            'px.png', 'nx.png',
            'py.png', 'ny.png',
            'pz.png', 'nz.png'
        ]);

        const ob_dirLight = track(new THREE.DirectionalLight(0xffffff));
        ob_dirLight.position.set(10, 10, 10);
        scene.add(ob_dirLight);
        scene.add(track(new THREE.AmbientLight(0x404040)));

        return track(new THREE.MeshStandardMaterial({
            envMap: textureCube,
            roughness: 0.5,
            metalness: 1
        }));
    };

    OB_TIMELINE.prototype.setBoxProperties = function (box, session, band_name, scene) {
        box.name = `${band_name}_${session.id}`;
        box.sortBy = "true";
        box.pos_x = session.x_relative;
        box.pos_y = session.y;
        box.pos_z = 1;
        box.position.set(session.x_relative, session.y, 1);

        const ob_band = scene.getObjectByName(band_name);
        if (ob_band) {
            ob_band.add(box);
        }
    };

    OB_TIMELINE.prototype.add_session = function (
        ob_scene_index,
        band_name,
        session,
        color,
        texture,
        image,
        backgroundColor,
        fontSizeInt,
        fontStyle,
        fontWeight,
        textColor,
        fontFamily,
        font_align
    ) {
        let ob_height = session.height;

        if (band_name.match(/_overview/) && this.ob_scene[ob_scene_index].ob_search_value !== "") {
            image = "icon/ob_yellow_square.png";
            ob_height = 4;
        }

        if (image !== undefined) {
            let copy_session = {...session};
            copy_session.x_relative = copy_session.pixelOffSetStart - 8;
            copy_session.z = parseInt(session.z + 41);
            this.add_event(
                ob_scene_index,
                band_name,
                copy_session,
                color,
                image,
                backgroundColor,
                fontSizeInt,
                fontStyle,
                fontWeight,
                textColor,
                fontFamily,
                false,
                font_align
            );
        }

        let ob_material;

        if (texture !== undefined) {
            let loader = this.track[ob_scene_index](new THREE.CubeTextureLoader());
            loader.setCrossOrigin("");
            loader.setPath('three.js/examples/textures/cube/pisa/');
            let textureMetal = loader.load([
                'px.png', 'nx.png',
                'py.png', 'ny.png',
                'pz.png', 'nz.png'
            ]);
            ob_material = this.track[ob_scene_index](new THREE.MeshStandardMaterial({
                color: color,
                envMap: textureMetal,
                roughness: 0.5,
                metalness: 1.0
            }));
        } else {
            ob_material = this.track[ob_scene_index](new THREE.MeshBasicMaterial({color: color}));
        }

        let ob_session = this.track[ob_scene_index](
            new THREE.Mesh(
                this.track[ob_scene_index](new THREE.BoxGeometry(session.width, ob_height, 10)),
                ob_material
            )
        );
        ob_session.position.set(session.x_relative, session.y, session.z);
        ob_session.pos_x = session.x_relative;
        ob_session.pos_y = session.y;
        ob_session.pos_z = session.z;
        ob_session.data = session;

        // Add text and tolerance
        if (!band_name.match(/overview_/)) {
            this.add_text_sprite(
                ob_scene_index,
                ob_session,
                session.data.title,
                session.textX,
                0,
                session.z,
                backgroundColor,
                fontSizeInt,
                fontStyle,
                fontWeight,
                textColor,
                fontFamily,
                font_align
            );
            this.add_tolerance(ob_scene_index, ob_session, band_name, session, undefined);
        }

        let ob_band = this.ob_scene[ob_scene_index].getObjectByName(band_name);
        if (ob_band !== undefined) {
            ob_band.add(ob_session);
        }

        return ob_session;
    };

    OB_TIMELINE.prototype.load_texture = function (image) {
        if (image === undefined || ob_texture === undefined) return undefined;
        return ob_texture.get(image);
    };

    OB_TIMELINE.prototype.add_event = function (
        ob_scene_index,
        band_name,
        session,
        color,
        image,
        backgroundColor,
        fontSizeInt,
        fontStyle,
        fontWeight,
        textColor,
        fontFamily,
        display_text,
        font_align
    ) {

        if (session.data === undefined)
            return null;
        let geometry, material, ob_event, texture;

        if (band_name.match(/_overview/) && this.ob_scene[ob_scene_index].ob_search_value !== "") {
            image = "icon/ob_yellow_square.png";
        }

        texture = this.load_texture(image);
        if (texture === undefined) {
            geometry = this.track[ob_scene_index](new THREE.SphereGeometry(session.size));
            material = this.track[ob_scene_index](new THREE.MeshBasicMaterial({color: color}));
        } else {
            if (band_name.match(/_overview/) && this.ob_scene[ob_scene_index].ob_search_value !== "") {
                geometry = this.track[ob_scene_index](new THREE.PlaneGeometry(8, 8));
            } else {
                geometry = this.track[ob_scene_index](new THREE.PlaneGeometry(16, 16));
            }
            texture.minFilter = THREE.LinearFilter;
            material = this.track[ob_scene_index](
                new THREE.MeshBasicMaterial({
                    map: texture,
                    color: backgroundColor,
                    transparent: true,
                    opacity: 1,
                })
            );
        }

        ob_event = this.track[ob_scene_index](new THREE.Mesh(geometry, material));
        ob_event.position.set(session.x_relative, session.y, session.z);
        ob_event.pos_x = session.x_relative;
        ob_event.pos_y = session.y;
        ob_event.pos_z = session.z;
        ob_event.data = session;
        ob_event.data.tolerance = 0;

        // Add text and tolerance
        if (display_text === true) {
            this.add_text_sprite(
                ob_scene_index,
                ob_event,
                session.data.title,
                session.textX,
                0,
                5,
                backgroundColor,
                fontSizeInt,
                fontStyle,
                fontWeight,
                textColor,
                fontFamily,
                font_align
            );
        }

        this.ob_scene[ob_scene_index].add(ob_event);

        let ob_band = this.ob_scene[ob_scene_index].getObjectByName(band_name);
        if (ob_band !== undefined) {
            ob_band.add(ob_event);
        }

        return ob_event;
    };

    OB_TIMELINE.prototype.add_segment = function (ob_scene_index, band_name, x, y, z, size, color, dashed) {
        try {
            // Validate inputs to prevent unexpected behavior
            if (isNaN(x) || isNaN(y) || isNaN(z) || isNaN(size)) {
                //console.error("Invalid coordinates or size provided.");
                return;
            }

            color = color || new THREE.Color("rgb(114, 171, 173)");

            const points = [
                new THREE.Vector3(x, y, z),
                new THREE.Vector3(x, y - size, z)
            ];

            const geometry = this.track[ob_scene_index](new THREE.BufferGeometry().setFromPoints(points));

            // Explicitly compute the bounding sphere
            geometry.computeBoundingSphere();

            // Check for invalid geometry
            if (geometry.boundingSphere && isNaN(geometry.boundingSphere.radius)) {
                console.error("Invalid geometry created. Bounding sphere radius is NaN.");
                return;
            }

            const material = this.track[ob_scene_index](new THREE.LineDashedMaterial({
                color: color,
                linewidth: 1,
                dashSize: 2,
                gapSize: 4,
            }));

            const segment = this.track[ob_scene_index](new THREE.LineSegments(geometry, material));

            if (dashed) {
                segment.computeLineDistances();
            }

            const ob_band = this.ob_scene[ob_scene_index].getObjectByName(band_name);
            if (ob_band !== undefined) {
                ob_band.add(segment);
            }

        } catch (e) {
            console.error("An error occurred in add_segment:", e);
        }
    };


    OB_TIMELINE.prototype.add_line_current_time = function (ob_scene_index, date, color) {
        color = color || this.track[ob_scene_index](new THREE.Color("rgb(243,23,51)"));

        let ob_x;
        for (let i = 0; i < this.ob_scene[ob_scene_index].bands.length; i++) {
            ob_x = this.dateToPixelOffSet(ob_scene_index, date,
                this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths,
                this.ob_scene[ob_scene_index].bands[i].intervalPixels);
            if (isNaN(ob_x)) return;

            const band = this.ob_scene[ob_scene_index].bands[i];
            const halfHeight = band.height / 2;
            const heightMax = band.heightMax;
            const bandColor = band.color;

            this.add_segment(ob_scene_index, band.name, ob_x, halfHeight, 20, heightMax, color, false);
            this.add_segment(ob_scene_index, band.name, ob_x + 0.45, halfHeight, 20, heightMax, bandColor, false);
            this.add_segment(ob_scene_index, band.name, ob_x + 0.90, halfHeight, 20, heightMax, bandColor, false);
            this.add_segment(ob_scene_index, band.name, ob_x, -halfHeight, 20, heightMax, color, false);
            this.add_segment(ob_scene_index, band.name, ob_x + 0.45, -halfHeight, 20, heightMax, bandColor, false);
            this.add_segment(ob_scene_index, band.name, ob_x + 0.90, -halfHeight, 20, heightMax, bandColor, false);
        }
    };

    OB_TIMELINE.prototype.add_text_sprite = function (ob_scene_index, ob_object, text, x, y, z, backgroundColor,
                                                      fontSize, fontStyle, fontWeight, color, fontFamily, font_align) {
        color = color || this.track[ob_scene_index](new THREE.Color("rgb(114, 171, 173)"));
        let ob_sprite = this.track[ob_scene_index](new SpriteText(text, 10));
        ob_sprite.color = color;
        ob_sprite.fontFamily = fontFamily;
        ob_sprite.textHeight = parseInt(fontSize);
        ob_sprite.fontSize = parseInt(fontSize);
        ob_sprite.fontStyle = fontStyle;
        ob_sprite.padding = 0.1;
        ob_sprite.borderWidth = 0;
        ob_sprite.fontWeight = fontWeight;
        ob_sprite.borderRadius = 0;
        if (backgroundColor !== undefined)
            ob_sprite.backgroundColor = backgroundColor;

        let ob_x = x;
        if (this.ob_scene[ob_scene_index].ob_camera_type !== "Orthographic") {
            ob_x -= 32;
            z = text.toString().length * 3.2;
        }

        ob_sprite.position.set(ob_x, y, z);
        ob_sprite.pos_x = ob_x;
        ob_sprite.pos_y = y;
        ob_sprite.pos_z = z;

        if (ob_object !== undefined) {
            ob_object.add(ob_sprite);
        }
    };

    OB_TIMELINE.prototype.build_model = function (ob_scene_index, sessions) {
        try {
            let ob_obj = Object.entries(sessions);
            if (this.ob_scene[ob_scene_index].model === undefined) {
                this.ob_scene[ob_scene_index].model = new Map(ob_obj);
                this.ob_scene[ob_scene_index].model.delete("title");
                this.ob_scene[ob_scene_index].model.delete("description");
                this.ob_scene[ob_scene_index].model.delete("analyze");
                this.ob_scene[ob_scene_index].model.delete("sortByValue");
            } else {
                for (let i = 0; i < ob_obj.length; i++) {
                    if (ob_obj[i][0] !== "title" && ob_obj[i][0] !== "description" && ob_obj[i][0] !== "analyze" &&
                        ob_obj[i][0] !== "sortByValue") {
                        let v = this.ob_scene[ob_scene_index].model.get(ob_obj[i][0]);
                        if (!v.toString().includes(ob_obj[i][1]))
                            this.ob_scene[ob_scene_index].model.set(ob_obj[i][0], v + "," + ob_obj[i][1]);
                    }
                }
            }
        } catch (err) {
            this.ob_scene[ob_scene_index].model = undefined;
        }
    };

    OB_TIMELINE.prototype.loadJSON = function (ob_scene_index) {
        if (this.data === undefined) return;
        let that = this;
        that.request = new XMLHttpRequest();
        that.request.open('GET', that.data);
        that.request.responseType = 'text'; // now we're getting a string!
        that.request.send();

        that.request.onload = function () {
            let sessions = that.request.response; // get the string from the response
            try {
                that.ob_scene[ob_scene_index].sessions = eval('(' + (sessions) + ')');
                clearTimeout(this.update_this_scene);
                this.update_this_scene = setTimeout(function () {
                    that.update_scene(ob_scene_index, that.header, that.params, that.ob_scene[ob_scene_index].bands,
                        that.ob_scene[ob_scene_index].model, that.ob_scene[ob_scene_index].sessions,
                        that.ob_scene[ob_scene_index].ob_camera_type, null, false);
                }, 10);
            } catch (err) {
                console.log("loadJSON - no file to load");
            }
        };
    };

    OB_TIMELINE.prototype.ob_setListeners = function (ob_scene_index) {
        let that = this;
        let ob_scene = this.ob_scene[ob_scene_index];

        ob_scene.dragControls = this.track[ob_scene_index](
            new DragControls(
                ob_scene.objects,
                ob_scene.ob_camera,
                ob_scene.ob_renderer.domElement
            )
        );

        ob_scene.dragControls.addEventListener('dragstart', onDragStart);
        ob_scene.dragControls.addEventListener('dragend', onDragEnd);
        ob_scene.dragControls.addEventListener('drag', onDrag);

        function onDragStart(e) {
            clearInterval(that.ob_interval_clock);
            clearInterval(ob_scene.ob_interval_move);

            let ob_obj = ob_scene.getObjectById(e.object.id);
            if (ob_obj === undefined) return;

            ob_obj.dragstart_source = ob_obj.position.x || 0;

            if (ob_obj.sortBy !== undefined && ob_obj.sortBy === "true") {
                ob_obj.position.set(ob_obj.pos_x, ob_obj.pos_y, ob_obj.pos_z);
                return;
            } else if (ob_obj.type.match(/Mesh/) && ob_obj.name.match(/zone_/)) {
                let parent = ob_obj.parent;
                parent.dragstart_source = parent.position.x || 0;
                that.move_band(ob_scene_index, parent.name, parent.position.x, parent.pos_y, parent.pos_z, true);
            } else if (ob_obj.type.match(/Mesh/) && ob_obj.name.match(/_band_/)) {
                that.move_band(ob_scene_index, ob_obj.name, ob_obj.position.x, ob_obj.pos_y, ob_obj.pos_z, false);
                that.ob_marker.style.visibility = "visible";
                that.ob_time_marker.style.visibility = "visible";
            } else if (ob_obj.type.match(/Mesh/) && ob_obj.name === "") {
                let parent = ob_obj.parent;
                parent.dragstart_source = parent.position.x || 0;
            } else {
                ob_obj.position.set(ob_obj.pos_x, ob_obj.pos_y, ob_obj.pos_z);
            }

            that.ob_render(ob_scene_index);
        }

        function onDragEnd(e) {
            let ob_obj = ob_scene.getObjectById(e.object.id);
            if (ob_obj === undefined) return;

            if (ob_obj.sortBy !== undefined && ob_obj.sortBy === "true") {
                ob_obj.position.set(ob_obj.pos_x, ob_obj.pos_y, ob_obj.pos_z);
                return;
            } else if (ob_obj.type.match(/Mesh/) && ob_obj.name.match(/zone_/)) {
                that.move_band(ob_scene_index, ob_obj.parent.name, ob_obj.parent.position.x, ob_obj.parent.pos_y, ob_obj.parent.pos_z, true);
            } else if (ob_obj.type.match(/Mesh/) && ob_obj.name.match(/_overview_/)) {
                that.move_band(ob_scene_index, ob_obj.name, ob_obj.position.x, ob_obj.pos_y, ob_obj.pos_z, true);
                that.ob_marker.style.visibility = "visible";
                that.ob_time_marker.style.visibility = "visible";
            } else if (ob_obj.type.match(/Mesh/) && ob_obj.name.match(/_band_/)) {
                that.move_band(ob_scene_index, ob_obj.name, ob_obj.position.x, ob_obj.pos_y, ob_obj.pos_z, true);
                that.ob_marker.style.visibility = "visible";
                that.ob_time_marker.style.visibility = "visible";
            } else if (ob_obj.type.match(/Mesh/) && ob_obj.name === "" && ob_obj.parent.name.match(/_overview_/)) {
                that.move_band(ob_scene_index, ob_obj.parent.name, -ob_obj.position.x, ob_obj.parent.pos_y, ob_obj.parent.pos_z, true);
                that.ob_marker.style.visibility = "visible";
                that.ob_time_marker.style.visibility = "visible";
                return;
            } else if (ob_obj.type.match(/Mesh/) && ob_obj.name === "") {
                that.move_band(ob_scene_index, ob_obj.parent.name, ob_obj.parent.position.x, ob_obj.parent.pos_y, ob_obj.parent.pos_z, true);
                that.ob_open_descriptor(ob_scene_index, ob_obj.data);
            } else {
                ob_obj.position.set(ob_obj.pos_x, ob_obj.pos_y, ob_obj.pos_z);
            }

            that.ob_render(ob_scene_index);

            ob_scene.date = that.ob_markerDate.toString().substring(0, 24) + " UTC";
            ob_scene.date_cal = that.ob_markerDate;
            ob_scene.show_calendar = true;

            if (ob_obj.name.match(/zone_/) || ((ob_obj.type.match(/Mesh/) && ob_obj.name === ""))) {
                ob_obj.parent.ob_source = ob_obj.parent.position.x;
                ob_obj.parent.ob_drag_end_source = ob_obj.parent.position.x;
                ob_obj.parent.ob_speed = (ob_obj.parent.dragstart_source - ob_obj.parent.ob_source) / 60;
            } else {
                ob_obj.ob_source = ob_obj.position.x;
                ob_obj.ob_drag_end_source = ob_obj.position.x;
                ob_obj.ob_speed = (ob_obj.dragstart_source - ob_obj.ob_source) / 60;
            }

            if (that.data && (that.data.match(/^(http?):\/\//) || that.data.match(/^(https?):\/\//))) {
                that.data_head = that.ob_get_url_head(ob_scene);
                clearInterval(ob_scene.ob_interval_move);
                ob_scene.ob_interval_move = setInterval(ob_move, 5);
            } else {
                clearInterval(ob_scene.ob_interval_move);
                ob_scene.ob_interval_move = setInterval(ob_move2, 5);
            }

            function ob_move() {
                if (ob_scene.ob_interval_move === undefined) return;

                if (ob_obj.name.match(/zone_/) || ((ob_obj.type.match(/Mesh/) && ob_obj.name === ""))) {
                    if (ob_obj.dragstart_source >= ob_obj.parent.ob_source - 5 && ob_obj.dragstart_source <= ob_obj.parent.ob_source + 1) {
                        clearInterval(ob_scene.ob_interval_move);
                    } else {
                        if (ob_obj.parent.ob_speed > 0)
                            ob_obj.parent.ob_speed = ob_obj.parent.ob_speed - 0.0025;
                        else
                            ob_obj.parent.ob_speed = ob_obj.parent.ob_speed + 0.0025;
                        if (Math.round(ob_obj.ob_speed) === 0)
                            clearInterval(ob_scene.ob_interval_move);

                        if (ob_obj.dragstart_source <= ob_obj.parent.ob_source)
                            ob_obj.parent.ob_drag_end_source = ob_obj.parent.ob_drag_end_source - ob_obj.parent.ob_speed;
                        else
                            ob_obj.parent.ob_drag_end_source = ob_obj.parent.ob_drag_end_source - ob_obj.parent.ob_speed;

                        that.move_band(
                            ob_scene_index,
                            ob_obj.parent.name,
                            ob_obj.parent.ob_drag_end_source,
                            ob_obj.parent.pos_y,
                            ob_obj.parent.pos_z,
                            true
                        );
                        that.update_scene(
                            ob_scene_index,
                            that.header,
                            that.params,
                            ob_scene.bands,
                            ob_scene.model,
                            ob_scene.sessions,
                            ob_scene.ob_camera_type,
                            ob_obj.parent,
                            true
                        );
                    }
                } else {
                    if (ob_obj.dragstart_source >= ob_obj.ob_source - 5 && ob_obj.dragstart_source <= ob_obj.ob_source + 1) {
                        clearInterval(ob_scene.ob_interval_move);
                    } else {
                        if (ob_obj.ob_speed > 0)
                            ob_obj.ob_speed = ob_obj.ob_speed - 0.0025;
                        else
                            ob_obj.ob_speed = ob_obj.ob_speed + 0.0025;
                        if (Math.round(ob_obj.ob_speed) === 0)
                            clearInterval(ob_scene.ob_interval_move);

                        if (ob_obj.dragstart_source <= ob_obj.ob_source)
                            ob_obj.ob_drag_end_source = ob_obj.ob_drag_end_source - ob_obj.ob_speed;
                        else
                            ob_obj.ob_drag_end_source = ob_obj.ob_drag_end_source - ob_obj.ob_speed;

                        that.move_band(
                            ob_scene_index,
                            ob_obj.name,
                            ob_obj.ob_drag_end_source,
                            ob_obj.pos_y,
                            ob_obj.pos_z,
                            true
                        );
                        that.update_scene(
                            ob_scene_index,
                            that.header,
                            that.params,
                            ob_scene.bands,
                            ob_scene.model,
                            ob_scene.sessions,
                            ob_scene.ob_camera_type,
                            ob_obj,
                            true
                        );
                    }
                }
            }

            function ob_move2() {
                if (ob_scene.ob_interval_move === undefined) return;

                if (ob_obj.dragstart_source >= ob_obj.ob_source - 5 && ob_obj.dragstart_source <= ob_obj.ob_source + 1) {
                    clearInterval(ob_scene.ob_interval_move);
                } else {
                    if (ob_obj.ob_speed > 0)
                        ob_obj.ob_speed = ob_obj.ob_speed - 0.0025;
                    else
                        ob_obj.ob_speed = ob_obj.ob_speed + 0.0025;
                    if (Math.round(ob_obj.ob_speed) === 0)
                        clearInterval(ob_scene.ob_interval_move);

                    if (ob_obj.dragstart_source <= ob_obj.ob_source)
                        ob_obj.ob_drag_end_source = ob_obj.ob_drag_end_source - ob_obj.ob_speed;
                    else
                        ob_obj.ob_drag_end_source = ob_obj.ob_drag_end_source - ob_obj.ob_speed;

                    if (ob_obj.name.match(/zone_/)) {
                        that.move_band(ob_scene_index, ob_obj.parent.name, ob_obj.parent.position.x, ob_obj.parent.pos_y, ob_obj.parent.pos_z, true);
                    } else {
                        that.move_band(ob_scene_index, ob_obj.name, ob_obj.ob_drag_end_source, ob_obj.pos_y, ob_obj.pos_z, true);
                        that.update_scene(
                            ob_scene_index,
                            that.header,
                            that.params,
                            ob_scene.bands,
                            ob_scene.model,
                            ob_scene.sessions,
                            ob_scene.ob_camera_type,
                            ob_obj,
                            null,
                            false
                        );
                    }
                }
            }

            if (ob_obj.name.match(/zone_/) || ob_obj.type.match(/Mesh/) && ob_obj.name === "") {
                clearInterval(ob_scene.ob_interval_move);
                ob_scene.ob_interval_move = setInterval(ob_move, 5);
            } else {
                clearInterval(ob_scene.ob_interval_move);
                ob_scene.ob_interval_move = setInterval(ob_move2, 5);
            }
        }

        function onDrag(e) {
            let ob_obj = ob_scene.getObjectById(e.object.id);
            if (ob_obj === undefined) return;
            if (ob_obj.sortBy !== undefined && ob_obj.sortBy === "true") {
                ob_obj.position.set(ob_obj.pos_x, ob_obj.pos_y, ob_obj.pos_z);
                return;
            } else if (ob_obj.type.match(/Mesh/) && ob_obj.name.match(/zone_/)) {
                moveZone(ob_obj);
            } else if (ob_obj.type.match(/Mesh/) && ob_obj.name.match(/_band_/)) {
                moveBand(ob_obj);
            } else if (ob_obj.type.match(/Mesh/) && ob_obj.name === "") {
                moveSession(ob_obj);
            } else {
                ob_obj.position.set(ob_obj.pos_x, ob_obj.pos_y, ob_obj.pos_z);
            }
            that.ob_render(ob_scene_index);
        }


        function moveZone(ob_obj) {
            let ob_step = ob_obj.dragstart_source - ob_obj.position.x;
            ob_obj.dragstart_source = ob_obj.position.x;
            ob_obj.position.set(ob_obj.pos_x, 0, ob_obj.pos_z);
            ob_obj.parent.position.x = ob_obj.parent.position.x - ob_step;
            that.move_band(
                ob_scene_index,
                ob_obj.parent.name,
                ob_obj.parent.position.x,
                ob_obj.parent.pos_y,
                ob_obj.parent.pos_z,
                true
            );
            that.ob_marker.style.visibility = "visible";
            that.ob_time_marker.style.visibility = "visible";
        }

        function moveBand(ob_obj) {
            that.move_band(
                ob_scene_index,
                ob_obj.name,
                ob_obj.position.x,
                ob_obj.pos_y,
                ob_obj.pos_z,
                true
            );
            that.ob_marker.style.visibility = "visible";
            that.ob_time_marker.style.visibility = "visible";
        }

        function moveSession(ob_obj) {
            let ob_step = ob_obj.dragstart_source - ob_obj.position.x;
            ob_obj.dragstart_source = ob_obj.position.x;
            ob_obj.position.set(ob_obj.pos_x, ob_obj.pos_y, ob_obj.pos_z);
            ob_obj.parent.position.x = ob_obj.parent.position.x - ob_step;
            that.move_band(
                ob_scene_index,
                ob_obj.parent.name,
                ob_obj.parent.position.x,
                ob_obj.parent.pos_y,
                ob_obj.parent.pos_z,
                true
            );
        }
    };

    OB_TIMELINE.prototype.ob_set_scene = function () {
        if (this.ob_scene === undefined) {
            this.ob_scene = new Array(ob_MAX_SCENES);
            this.ob_scene.sync_time = 0;
            this.resTracker = new Array(ob_MAX_SCENES);
            this.track = new Array(ob_MAX_SCENES);
            this.original_bands = new Array(ob_MAX_SCENES);
        }

        let ob_sort_by = "NONE";
        for (let s = 0; s < this.ob_scene.length; s++) {
            if (this.ob_scene[s] === undefined) {
                // Tracking all objects which will be created in order to do full cleanup when needed.
                this.resTracker[s] = new ResourceTracker();
                this.track[s] = this.resTracker[s].track.bind(this.resTracker[s]);
                this.ob_scene[s] = this.track[s](new THREE.Scene());
                this.ob_scene[s].background = new THREE.Color(0x000000);
                this.ob_scene[s].objects = [];
                this.ob_scene[s].ready = true;
                //this.ob_scene[s].group = new THREE.Group();
            }

            // Save original bands setting
            if (this.original_bands[s] === undefined) {
                this.original_bands[s] = Object.assign([], this.bands);
                ob_sort_by = this.bands[0].model[0].sortBy;
            }
            if (this.ob_scene[s].bands !== undefined)
                ob_sort_by = this.ob_scene[s].bands[0].model[0].sortBy;
            this.ob_scene[s].bands = Object.assign([], this.original_bands[s]);
            this.ob_scene[s].bands[0].model[0].sortBy = ob_sort_by;

            //this.bands[0].model[0].sortBy = ob_sort_by;
            this.ob_scene[s].model = undefined;
        }
    };

    OB_TIMELINE.prototype.ob_set_renderer = function (ob_scene_index) {
        if (this.ob_scene[ob_scene_index].ob_renderer === undefined) {
            this.ob_scene[ob_scene_index].ob_renderer = this.track[ob_scene_index](new THREE.WebGLRenderer({antialias: true}));
            this.ob_scene[ob_scene_index].ob_renderer.setClearColor(0xffffff, 1);
            this.ob_scene[ob_scene_index].ob_renderer.setPixelRatio(window.devicePixelRatio * 2);
            this.ob_scene[ob_scene_index].ob_renderer.shadowMap.enabled = true;
        }

        const rendererElement = this.ob_scene[ob_scene_index].ob_renderer.domElement;
        rendererElement.style.width = this.ob_scene[ob_scene_index].width + "px";
        rendererElement.style.height = this.ob_scene[ob_scene_index].ob_height + "px";
        this.ob_timeline_body.appendChild(rendererElement);

        this.ob_scene[ob_scene_index].ob_renderer.setSize(this.ob_scene[ob_scene_index].width, this.ob_scene[ob_scene_index].ob_height);
    };

    OB_TIMELINE.prototype.ob_set_camera = function (ob_scene_index) {
        const scene = this.ob_scene[ob_scene_index];

        if (scene.ob_camera_type === undefined) {
            scene.ob_camera_type = "Orthographic";
        }

        if (scene.ob_camera_type === "Orthographic") {
            const ob_pos_orthographic_camera_x = 0;
            const ob_pos_orthographic_camera_y = 0;
            const ob_pos_orthographic_camera_z = scene.ob_height;

            scene.ob_camera = this.track[ob_scene_index](
                new THREE.OrthographicCamera(
                    -scene.width / 2,
                    scene.width / 2,
                    scene.ob_height,
                    0,
                    -scene.width,
                    scene.ob_far
                )
            );
            scene.ob_camera.position.set(
                ob_pos_orthographic_camera_x,
                ob_pos_orthographic_camera_y,
                ob_pos_orthographic_camera_z
            );
            scene.add(scene.ob_camera);
        } else {
            scene.ob_camera = this.track[ob_scene_index](
                new THREE.PerspectiveCamera(
                    scene.ob_fov,
                    scene.width / scene.ob_height,
                    scene.ob_near,
                    scene.ob_far
                )
            );
            scene.ob_camera.position.set(
                scene.ob_pos_camera_x,
                scene.ob_pos_camera_y,
                scene.ob_pos_camera_z
            );
            scene.add(scene.ob_camera);
            scene.ob_camera.lookAt(
                scene.ob_lookAt_x,
                scene.ob_lookAt_y,
                scene.ob_lookAt_z
            );
            scene.add(this.track[ob_scene_index](new THREE.AmbientLight(0xf0f0f0)));

            const light = this.track[ob_scene_index](new THREE.SpotLight(0xffffff, 1.5));
            light.position.set(0, 1500, 200);
            light.castShadow = true;
            light.shadow.bias = -0.000222;
            light.shadow.mapSize.width = 1024;
            light.shadow.mapSize.height = 1024;
            scene.add(light);
        }

        // Set all listeners
        this.ob_setListeners(ob_scene_index);

        // requestAnimationFrame(this.animate);
        this.ob_render(ob_scene_index);

        // console.log("ob_set_camera() - camera:" + scene.ob_camera_type);
    };

    OB_TIMELINE.prototype.runEmptyTimeline = function (ob_scene_index) {
        let sessions = "{'dateTimeFormat': 'iso8601','scene': '0','events' : [{}]}";
        this.ob_scene[ob_scene_index].sessions = eval('(' + (sessions) + ')');
        let that_scene = this;
        clearTimeout(this.update_this_scene);
        this.update_this_scene = setTimeout(function () {
            that_scene.update_all_timelines(ob_scene_index, that_scene.header, that_scene.params, that_scene.ob_scene[ob_scene_index].bands,
                that_scene.ob_scene[ob_scene_index].model, that_scene.ob_scene[ob_scene_index].sessions,
                that_scene.ob_scene[ob_scene_index].ob_camera_type);
        }, 0);
        this.update_this_scene = setTimeout(function () {
            that_scene.update_all_timelines(ob_scene_index, that_scene.header, that_scene.params, that_scene.ob_scene[ob_scene_index].bands,
                that_scene.ob_scene[ob_scene_index].model, that_scene.ob_scene[ob_scene_index].sessions,
                that_scene.ob_scene[ob_scene_index].ob_camera_type);
        }, 0);
    };

    OB_TIMELINE.prototype.ob_getDataType = function (ob_scene_index, json) {
        if (json.openbexi_timeline?.[0]?.filters) {
            return "filters";
        }
        if (json.event_descriptor) {
            return "event_descriptor";
        }
        return "events";
    };

    OB_TIMELINE.prototype.ob_optimize_load_time = function (ob_scene_index, multiples) {
        if (multiples === undefined)
            this.ob_scene[ob_scene_index].multiples = 45;
        else
            this.ob_scene[ob_scene_index].multiples = multiples;
        return this.ob_scene[ob_scene_index].multiples === 480;
    };

    OB_TIMELINE.prototype.load_data = function (ob_scene_index) {
        const ob_scene = this.ob_scene[ob_scene_index];

        if (this.ob_scene !== undefined && ob_scene.ob_interval_move !== undefined) {
            clearInterval(ob_scene.ob_interval_move);
        }

        if (!this.data) {
            this.update_scene(ob_scene_index, this.header, this.params, ob_scene.bands,
                ob_scene.model, ob_scene.sessions,
                ob_scene.ob_camera_type, null, false);
            return;
        }

        if (this.data.includes("startDate=test")) {
            this.method = "POST";
        } else if (this.data.includes("readDescriptor") || this.data.includes("updateFilter") ||
            this.data.includes("addFilter") || this.data.includes("saveFilter") ||
            this.data.includes("deleteFilter") || this.data.includes("readFilters")) {
            this.method = "POST";
            this.ob_optimize_load_time(ob_scene_index, 480);
        } else if (this.data.includes("updateEvent") || this.data.includes("addEvent") ||
            this.data.includes("deleteEvent")) {
            this.method = "POST";
            this.ob_optimize_load_time(ob_scene_index, 480);
        } else if (!this.data.includes(".json") && !this.data.includes("UTC")) {
            this.data = this.ob_get_url_head(ob_scene_index) +
                "?startDate=" + ob_scene.minDate +
                "&endDate=" + ob_scene.maxDate +
                "&scene=" + ob_scene_index +
                "&filterName=" + ob_scene.ob_filter_name +
                "&filter=" + ob_scene.ob_filter_value +
                "&search=" + ob_scene.ob_search_value +
                "&timelineName=" + this.name +
                "&userName=" + this.ob_user_name;
            this.method = "GET";
        } else {
            this.data = this.ob_get_url_head(ob_scene_index) +
                "?startDate=" + ob_scene.minDate +
                "&endDate=" + ob_scene.maxDate +
                "&scene=" + ob_scene_index +
                "&filterName=" + ob_scene.ob_filter_name +
                "&filter=" + ob_scene.ob_filter_value +
                "&search=" + ob_scene.ob_search_value +
                "&timelineName=" + this.name +
                "&userName=" + this.ob_user_name;
            this.method = "GET";
        }

        console.log(this.data.toString());

        let ob_url_secure = this.data && this.data.match(/^(https|http?):\/\//);
        if (ob_url_secure !== null && ob_url_secure.length === 2) {
            if (!!window.EventSource && this.data.includes("sse")) {
                let that = this;
                this.ob_not_connected(ob_scene_index);

                if (this.eventSource !== undefined) {
                    this.eventSource.close();
                }

                let eventSource = new EventSource(this.data, {
                    // If clients have set Access-Control-Allow-Credentials to true, the openbexi.timeline.server
                    // will not permit the use of credentials and access to resource by the client will be blocked
                    // by CORS policy withCredentials: true
                });

                this.eventSource = eventSource;

                eventSource.onmessage = function (e) {
                    that.ob_connected(ob_scene_index);
                    let json = JSON.parse(e.data);
                    let dataType = that.ob_getDataType(ob_scene_index, json);

                    if (dataType === "filters") {
                        try {
                            that.set_user_setting_and_filters(ob_scene_index, json);
                            that.data = that.ob_get_url_head(ob_scene_index) +
                                "?startDate=" + that.ob_scene[ob_scene_index].minDate +
                                "&endDate=" + that.ob_scene[ob_scene_index].maxDate +
                                "&scene=" + ob_scene_index +
                                "&filterName=" + that.ob_scene[ob_scene_index].ob_filter_name +
                                "&filter=" + that.ob_scene[ob_scene_index].ob_filter_value +
                                "&search=" + that.ob_scene[ob_scene_index].ob_search_value +
                                "&timelineName=" + that.name +
                                "&userName=" + that.ob_user_name;
                            that.update_scene(ob_scene_index, that.header, that.params,
                                that.ob_scene[ob_scene_index].bands, that.ob_scene[ob_scene_index].model,
                                that.ob_scene[ob_scene_index].sessions, that.ob_scene[ob_scene_index].ob_camera_type,
                                null, true);
                        } catch (err) {
                            console.log('POST - cannot save setting_and_filters ...');
                        }
                    } else if (dataType === "event_descriptor") {
                        try {
                            let data = json;
                            if (data !== undefined && data.event_descriptor[0] !== undefined) {
                                that.ob_open_descriptor(ob_scene_index, data.event_descriptor[0]);
                            }
                        } catch (err) {
                            console.log('POST - cannot read event_descriptor ...');
                        }
                    } else {
                        that.ob_scene[ob_scene_index].sessions = json;
                        if (that.ob_scene[ob_scene_index].sessions.scene !== undefined) {
                            ob_scene_index = that.ob_scene[ob_scene_index].sessions.scene;
                        }
                        if (that.ob_scene[ob_scene_index].sessions.events.length > 0)
                            that.update_scene(ob_scene_index, that.header, that.params,
                                that.ob_scene[ob_scene_index].bands, that.ob_scene[ob_scene_index].model,
                                that.ob_scene[ob_scene_index].sessions, that.ob_scene[ob_scene_index].ob_camera_type,
                                null, false);
                    }
                };

                eventSource.onopen = function () {
                    that.ob_connected(ob_scene_index);
                };

                eventSource.onerror = function () {
                    that.ob_not_connected(ob_scene_index);
                    if (!that.data.includes("updateFilter") && !that.data.includes("addFilter")
                        && !that.data.includes("saveFilter") && !that.data.includes("deleteFilter")
                        && !that.data.includes("readFilters") && !that.data.includes("event_descriptor")
                        && !that.data.includes("readDescriptor")) {
                        console.log('SSE - onerror');
                        that.data = that.ob_get_url_head(ob_scene_index) +
                            "?startDate=" + that.ob_scene[ob_scene_index].minDate +
                            "&endDate=" + that.ob_scene[ob_scene_index].maxDate +
                            "&scene=" + ob_scene_index +
                            "&filterName=" + that.ob_scene[ob_scene_index].ob_filter_name +
                            "&filter=" + that.ob_scene[ob_scene_index].ob_filter_value +
                            "&search=" + that.ob_scene[ob_scene_index].ob_search_value +
                            "&timelineName=" + that.name +
                            "&userName=" + that.ob_user_name;
                        that.load_data(ob_scene_index);
                    } else {
                        that.data = that.ob_get_url_head(ob_scene_index) +
                            "?startDate=" + that.ob_scene[ob_scene_index].minDate +
                            "&endDate=" + that.ob_scene[ob_scene_index].maxDate +
                            "&scene=" + ob_scene_index +
                            "&filterName=" + that.ob_scene[ob_scene_index].ob_filter_name +
                            "&filter=" + that.ob_scene[ob_scene_index].ob_filter_value +
                            "&search=" + that.ob_scene[ob_scene_index].ob_search_value +
                            "&timelineName=" + that.name +
                            "&userName=" + that.ob_user_name;
                        that.ob_connected(ob_scene_index);
                        return;
                    }
                    console.log('SSE - reconnecting ...');
                }
            } else {
                let that = this;
                this.ob_not_connected(ob_scene_index);
                fetch(this.data, {
                    method: this.method,
                    dataType: 'json',
                    mode: 'no-cors',
                    headers: {
                        "Accept": "application/json",
                        'Content-Type': 'application/json',
                    }
                }).then(response => {
                    if (response.ok) {
                        console.log("Response OK!");
                        this.ob_connected(ob_scene_index);
                        return response.json();
                    } else {
                        console.log("Response not OK!");
                    }
                }).then((json) => {
                    let dataType = that.ob_getDataType(ob_scene_index, json);

                    if (dataType === "filters") {
                        try {
                            that.set_user_setting_and_filters(ob_scene_index, json);
                            that.data = that.ob_get_url_head(ob_scene_index) +
                                "?startDate=" + that.ob_scene[ob_scene_index].minDate +
                                "&endDate=" + that.ob_scene[ob_scene_index].maxDate +
                                "&scene=" + ob_scene_index +
                                "&filterName=" + that.ob_scene[ob_scene_index].ob_filter_name +
                                "&filter=" + that.ob_scene[ob_scene_index].ob_filter_value +
                                "&search=" + that.ob_scene[ob_scene_index].ob_search_value +
                                "&timelineName=" + that.name +
                                "&userName=" + that.ob_user_name;
                            that.method = "GET";
                            that.update_scene(ob_scene_index, that.header, that.params,
                                that.ob_scene[ob_scene_index].bands, that.ob_scene[ob_scene_index].model,
                                that.ob_scene[ob_scene_index].sessions, that.ob_scene[ob_scene_index].ob_camera_type,
                                null, true);
                        } catch (err) {
                            console.log('POST - cannot save setting_and_filters ...');
                        }
                    } else if (dataType === "event_descriptor") {
                        try {
                            if (json !== undefined && json.event_descriptor[0] !== undefined) {
                                that.ob_open_descriptor(ob_scene_index, json.event_descriptor[0]);
                            }
                            that.data = that.ob_get_url_head(ob_scene_index) +
                                "?startDate=" + that.ob_scene[ob_scene_index].minDate +
                                "&endDate=" + that.ob_scene[ob_scene_index].maxDate +
                                "&scene=" + ob_scene_index +
                                "&filterName=" + that.ob_scene[ob_scene_index].ob_filter_name +
                                "&filter=" + that.ob_scene[ob_scene_index].ob_filter_value +
                                "&search=" + that.ob_scene[ob_scene_index].ob_search_value +
                                "&timelineName=" + that.name +
                                "&userName=" + that.ob_user_name;
                        } catch (err) {
                            console.log('POST - cannot read event_descriptor ...');
                        }
                    } else {
                        that.ob_scene[ob_scene_index].sessions = json;
                        if (that.ob_scene[ob_scene_index].sessions.scene !== undefined) {
                            ob_scene_index = that.ob_scene[ob_scene_index].sessions.scene;
                        }
                        if (that.ob_scene[ob_scene_index].sessions.events.length > 0)
                            that.update_scene(ob_scene_index, that.header, that.params,
                                that.ob_scene[ob_scene_index].bands, that.ob_scene[ob_scene_index].model,
                                that.ob_scene[ob_scene_index].sessions, that.ob_scene[ob_scene_index].ob_camera_type,
                                null, false);
                    }
                }).catch(err => {
                    console.log('Error message:', err.statusText);
                    this.ob_not_connected(ob_scene_index);
                });
            }
        }
    };

    window.onscroll = function () {
        ob_timelines.forEach(function (ob_timeline) {
            //ob_timeline.ob_timeline_header.style.top = "0px";
        });
    };

    window.addEventListener('resize', function () {
        ob_timelines.forEach(function (ob_timeline) {
            ob_timeline.ob_scene_init(ob_timeline.ob_render_index);
        });
    }, false);

    OB_TIMELINE.prototype.getLocalStorage = function () {
        this.ob_user_name = "guest";
        this.ob_email_name = "";

        try {
            if (localStorage.user !== undefined) {
                this.ob_user = JSON.parse(localStorage.user.toLowerCase());
                this.ob_email = JSON.parse(localStorage.email.toLowerCase());
                this.ob_user_name = this.ob_user.name;
                this.ob_email_name = this.ob_email.name;
            } else {
                localStorage.user = JSON.stringify({name: "guest"});
                localStorage.email = JSON.stringify({name: ""});
            }
        } catch (e) {
        }

        if (this.ob_user_name === "guest") {
            localStorage.user = JSON.stringify({name: "guest"});
            localStorage.email = JSON.stringify({name: ""});
        }
    };

    OB_TIMELINE.prototype.loadModel = function (model) {
        let this_new_timeline = this;
        fetch(model)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(async data => {
                // Validate data before applying
                if (!data.params || !data.bands) {
                    throw new Error('Invalid data structure');
                }

                this_new_timeline.params = data.params;
                this_new_timeline.bands = data.bands;

                // Modularized URL update function
                this.params[0].title = "Timeline report real-time";
                this.params[0].data = await this_new_timeline.updateURL();
                if (this.params[0].data.includes("sse"))
                    this.params[0].title = "Timeline report";

                // Rest of the initialization
                this_new_timeline.initializeTimeline();
            })
            .catch(error => {
                console.error('Error loading the JSON file:', error);
                // Implement user-friendly error handling
            });
    };

    OB_TIMELINE.prototype.updateURL = async function () {
        const currentPort = parseInt(window.location.port, 10);
        let url = `https://${window.location.hostname}:${currentPort}/openbexi_timeline/sessions?startDate=current_time&endDate=`;
        try {
            const response = await fetch(url); // Use 'url' here instead of 'this.params[0].data'
            if (!response.ok) {
                url = `https://${window.location.hostname}:${currentPort}/openbexi_timeline_sse/sessions?startDate=current_time&endDate=`;
            }
        } catch (error) {
            console.error('An error occurred while fetching the URL:' + url, error);
            console.error('Swap to the URL:' + url);
        }
        return url;
    };

    OB_TIMELINE.prototype.initializeTimeline = function () {
        // Initialization logic here
        this.ob_init();
        this.ob_scene_index = 0;
        this.first_sync = undefined;
        this.update_scene(this.ob_scene_index, null, this.params,
            this.bands, this.model, this.sessions, null, null,
            false);
        ob_timelines.push(this);
        // Any other setup needed
    };
}

// Export the OB_TIMELINE constructor function
export {OB_TIMELINE};



