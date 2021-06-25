/* This notice must be untouched at all times.

Copyright (c) 2021 arcazj All rights reserved.
    OpenBEXI Timeline 0.9.8 beta

The latest version is available at http://www.openbexi.comhttps://github.com/arcazj/openbexi_timeline.

    This program is free software; you can redistribute it and/or
modify it under the terms of the GNU General Public License
as published by the Free Software Foundation; either version 1 and 2
of the License, or (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
as long with this program; if not, write to the Free Software
Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
*/
/*
tests Ajax no_secure
http://localhost:8080/openbexi_timeline.html
data: "http://localhost:8080/openbexi_timeline/sessions?startDate=curent_time&endDate="
data: "http://localhost:8080/openbexi_timeline/sessions?startDate=test&endDate=test"

tests Ajax secure
https://localhost:8445/openbexi_timeline.html
data: "https://localhost:8445/openbexi_timeline/sessions?startDate=test&endDate=test"

tests SSE
Important server setting: ctx = tomcat.addContext("/", new File(".").getAbsolutePath());
https://localhost:63342/openbexi_GNS_timeline/tests/openbexi_timeline_test_SSE_example.html
https://localhost:8443/tests/openbexi_timeline_test_SSE_example.html
data: "https://localhost:8443/openbexi_timeline_sse/sessions?startDate=test&endDate=test"

tests WS
Important server setting: ctx =tomcat.addWebapp("/", ".");
http://localhost:63342/openbexi_GNS_timeline/tests/openbexi_timeline_test_WS_example.html
data: "wss://localhost:8444/openbexi_timeline_ws/sessions?startDate=test&endDate=test"
*/

ob_debug_room = false;
ob_debug_ADD_WEBGL_OBJECT = false;
ob_debug_ADD_SESSION_WEBGL_OBJECT = false;
ob_debug_ADD_EVENT_WEBGL_OBJECT = false;
ob_debug_MOVE_WEBGL_OBJECT = false;
ob_debug_REMOVE_WEBGL_OBJECT = false;
const ob_MAX_SCENES = 3;
const ob_timelines = [];

function get_ob_timeline(ob_timeline_name) {
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

    untrack(resource) {
        this.resources.delete(resource);
    }


    dispose() {
        for (const resource of this.resources) {
            if (resource instanceof THREE.Object3D) {
                if (resource.parent) {
                    resource.parent.remove(resource);
                }
            }
            /*if (resource.dispose) {
                try {
                        resource.dispose();
                } catch (err) {
                }
            }*/
        }
        this.resources.clear();
    }
}

function OB_TIMELINE() {
    OB_TIMELINE.prototype.getTimeZone = function () {
        this.timeZoneOffset = new Date().getTimezoneOffset();
        this.timeZone = "";
        if (this.params[0].date.includes("UTC"))
            this.timeZone = "UTC";
        if (this.params[0].timeZone === "UTC")
            this.timeZone = this.params[0].timeZone;
    };

    OB_TIMELINE.prototype.get_synced_time = function () {
        let sync_time;
        try {
            if (this.params[0].date !== undefined) {
                if (this.params[0].date === "current_time" || this.params[0].date === "Date.now()") {
                    if (this.timeZone === "UTC")
                        sync_time = this.getUTCTime(Date.now());
                    else
                        sync_time = Date.now();
                } else if (this.params[0].date.length === 4) {
                    sync_time = this.getUTCFullYearTime(parseInt(this.params[0].date));
                } else {
                    sync_time = this.getUTCTime(Date.parse(this.params[0].date));
                }
            } else {
                console.log("get_synced_time(): timeline date not defined - set to default : current date");
                if (this.timeZone === "UTC")
                    sync_time = this.getUTCTime(Date.now());
                else
                    sync_time = Date.now();
            }
        } catch (err) {
            console.log("get_synced_time(): Wrong timeline date - set to default : current date");
            if (this.timeZone === "UTC")
                sync_time = this.getUTCTime(Date.now());
            else
                sync_time = Date.now();
        }
        return sync_time;
    };
    OB_TIMELINE.prototype.get_current_time = function () {
        if (this.timeZone === "UTC")
            return this.getUTCTime(Date.now())
        else
            return Date.now();
    };

    OB_TIMELINE.prototype.reset_synced_time = function (ob_case, ob_scene_index) {
        clearInterval(this.ob_interval_clock);
        try {
            if (ob_case === "new_view") {
                this.ob_scene.sync_time = Date.parse(this.ob_markerDate.toString());
                this.ob_scene[ob_scene_index].date = new Date(this.ob_scene.sync_time);
                this.ob_scene[ob_scene_index].offset = this.ob_scene[ob_scene_index].ob_width;
                this.set_bands(ob_scene_index);
                this.update_bands_MinDate(ob_scene_index, this.ob_scene[ob_scene_index].date);
                this.update_bands_MaxDate(ob_scene_index, this.ob_scene[ob_scene_index].date);
            } else if (ob_case === "new_sync") {
                this.ob_set_scene(ob_scene_index);
                this.ob_init(ob_scene_index);
                this.setGregorianUnitLengths(ob_scene_index);
                this.ob_scene.sync_time = this.get_synced_time();
                this.ob_scene[ob_scene_index].date = new Date(this.ob_scene.sync_time);
                this.set_bands(ob_scene_index);
                this.update_bands_MinDate(ob_scene_index, this.ob_scene[ob_scene_index].date);
                this.update_bands_MaxDate(ob_scene_index, this.ob_scene[ob_scene_index].date);
                this.minDate = this.iniMinDate;
                this.maxDate = this.iniMaxDate;
            } else if (ob_case === "re_sync") {
                this.ob_set_scene(ob_scene_index);
                this.ob_init(ob_scene_index);
                this.setGregorianUnitLengths(ob_scene_index);
                this.ob_scene.sync_time = this.get_synced_time();
                this.ob_scene[ob_scene_index].date = new Date(this.ob_scene.sync_time);
                this.set_bands(ob_scene_index);
                this.update_bands_MinDate(ob_scene_index, this.ob_scene[ob_scene_index].date);
                this.update_bands_MaxDate(ob_scene_index, this.ob_scene[ob_scene_index].date);
            } else if (ob_case === "new_search") {
                this.ob_scene.sync_time = Date.parse(this.ob_markerDate.toString());
            } else if (ob_case === "new_calendar_date") {
                //this.first_sync = true;
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

    OB_TIMELINE.prototype.ob_init = function (ob_scene_index) {
        // Set all timeline parameters:
        this.name = this.params[0].name;
        this.title = "";
        this.multiples = 30;

        if (this.params[0].title !== undefined)
            this.title = this.params[0].title;
        if (this.ob_filter_value === undefined)
            this.ob_filter_value = "";
        if (this.ob_search_value === undefined)
            this.ob_search_value = "";
        this.regex = "^(?=.*(?:--|--))(?!.*(?:--|--)).*$";

        this.ob_camera_type = this.params[0].camera;
        this.ob_pos_camera_y = this.ob_scene[ob_scene_index].ob_height / 2;
        if (this.ob_scene[ob_scene_index].ob_height > 2000) {
            this.ob_pos_camera_x = -1500;
        } else if (this.ob_scene[ob_scene_index].ob_height > 1000) {
            this.ob_pos_camera_x = -1000;
        } else {
            this.ob_pos_camera_x = -100;
        }
        this.ob_pos_camera_z = this.ob_scene[ob_scene_index].ob_height / 2;

        this.ob_far = 50000;
        this.ob_near = 1;
        this.ob_fov = 70;
        this.ob_lookAt_x = 0;
        this.ob_lookAt_y = this.ob_scene[ob_scene_index].ob_height / 2;
        this.ob_lookAt_z = 0;

        this.descriptor = this.params[0].descriptor;
        this.data = this.params[0].data;
        this.center = "center";
        this.font_align = "right";

        // -- set time zone --
        this.getTimeZone();

        // -- set timeline top --
        try {
            if (this.params[0].top !== undefined) {
                this.top = parseInt(this.params[0].top);
            } else {
                console.log("ob_init(): timeline top not defined - set to default : 0");
                this.top = 0;
            }
        } catch (err) {
            console.log("ob_init(): Wrong timeline top - set to default : 0");
            this.top = 0;
        }

        // -- set timeline height --
        try {

            if (this.params[0].height !== undefined) {
                this.ob_scene[ob_scene_index].ob_height = parseInt(this.params[0].height);
            } else {
                console.log("ob_init(): timeline height not defined - set to default : 800");
                this.ob_scene[ob_scene_index].ob_height = 800;
            }
        } catch (err) {
            console.log("ob_init(): Wrong timeline height - set to default : 800");
            this.ob_scene[ob_scene_index].ob_height = 800;
        }

        // -- set timeline width --
        try {
            if (this.params[0].width !== undefined) {
                this.ob_scene[ob_scene_index].ob_width = parseInt(this.params[0].width);
            } else {
                console.log("ob_init(): timeline width not defined - set to default : 800");
                this.ob_scene[ob_scene_index].ob_width = 800;
            }
        } catch (err) {
            console.log("ob_init(): Wrong timeline width - set to default : 800");
            this.ob_scene[ob_scene_index].ob_width = 800;
        }
        // -- set timeline left --
        try {
            if (this.params[0].left !== undefined) {
                this.left = parseInt(this.params[0].left);
            } else {
                console.log("ob_init(): timeline left not defined - set to default : 0");
                this.left = 0;
            }
        } catch (err) {
            console.log("ob_init(): Wrong timeline width - set to default : 0");
            this.left = 0;
        }
    };

    OB_TIMELINE.prototype.ob_apply_data_model = function (ob_scene_index) {
        try {
            this.ob_scene[ob_scene_index].model = eval(document.getElementById(this.name + "_model").innerHTML);
        } catch (err) {
        }
        this.update_scenes(ob_scene_index, this.header, this.params, this.ob_scene[ob_scene_index].bands,
            this.ob_scene[ob_scene_index].model, this.ob_scene[ob_scene_index].sessions,
            this.ob_camera_type, null, false);
    };
    OB_TIMELINE.prototype.ob_apply_bands_info = function (ob_scene_index) {
        try {
            this.ob_scene[ob_scene_index].bands = eval(document.getElementById(this.name + "_bands").innerHTML);
        } catch (err) {
        }
        this.update_scenes(ob_scene_index, this.header, this.params, this.ob_scene[ob_scene_index].bands,
            this.ob_scene[ob_scene_index].model, this.ob_scene[ob_scene_index].sessions,
            this.ob_camera_type, null, false);
    };
    OB_TIMELINE.prototype.ob_apply_timeline_info = function (ob_scene_index) {
        this.params[0].top = parseInt(document.getElementById(this.name + "_top").value);
        this.params[0].left = parseInt(document.getElementById(this.name + "_left").value);
        this.params[0].height = parseInt(document.getElementById(this.name + "_height").value);
        this.params[0].width = parseInt(document.getElementById(this.name + "_width").value);
        this.update_scenes(ob_scene_index, this.header, this.params, this.ob_scene[ob_scene_index].bands,
            this.ob_scene[ob_scene_index].model, this.ob_scene[ob_scene_index].sessions,
            this.ob_camera_type, null, false);
    };
    OB_TIMELINE.prototype.ob_apply_timeline_sorting = function (ob_scene_index) {
        try {
            this.ob_scene[ob_scene_index].bands[0].model[0].sortBy = document.getElementById("ob_sort_by").value;
            this.update_scenes(ob_scene_index, this.header, this.params, this.ob_scene[ob_scene_index].bands,
                this.ob_scene[ob_scene_index].model, this.ob_scene[ob_scene_index].sessions,
                this.ob_camera_type, null, false);
        } catch (err) {
        }
    };
    OB_TIMELINE.prototype.ob_apply_timeline_filter = function (ob_scene_index) {
        let ob_checked;
        this.ob_filter_value = "";
        try {
            for (let [key, value] of this.ob_scene[ob_scene_index].model.entries()) {
                let value_items = value.split(",");
                if (value_items.length > 1) {
                    for (let i = 0; i < value_items.length; i++) {
                        try {
                            ob_checked = document.getElementById(this.name + "_" + key + "_" + value_items[i]).checked;
                        } catch (err) {
                        }
                        if (ob_checked !== undefined && ob_checked === true) {
                            this.ob_filter_value += key + ":" + value_items[i] + " ";
                        }
                    }
                }
            }
            this.update_scenes(ob_scene_index, this.header, this.params, this.ob_scene[ob_scene_index].bands,
                this.ob_scene[ob_scene_index].model, this.ob_scene[ob_scene_index].sessions,
                this.ob_camera_type, null, true);
        } catch (err) {
        }
    };
    OB_TIMELINE.prototype.ob_apply_orthographic_camera = function (ob_scene_index) {
        this.ob_camera_type = "Orthographic";
        this.update_scenes(ob_scene_index, this.header, this.params, this.ob_scene[ob_scene_index].bands,
            this.ob_scene[ob_scene_index].model, this.ob_scene[ob_scene_index].sessions,
            this.ob_camera_type, null, false);
    };
    OB_TIMELINE.prototype.ob_apply_perspective_camera = function (ob_scene_index) {
        this.ob_camera_type = "Perspective";
        this.update_scenes(ob_scene_index, this.header, this.params, this.ob_scene[ob_scene_index].bands,
            this.ob_scene[ob_scene_index].model, this.ob_scene[ob_scene_index].sessions,
            this.ob_camera_type, null, false);
    };
    OB_TIMELINE.prototype.ob_cancel_setting = function (ob_scene_index) {
        this.ob_remove_setting();
        this.update_scenes(ob_scene_index, this.header, this.params, this.ob_scene[ob_scene_index].bands,
            this.ob_scene[ob_scene_index].model, this.ob_scene[ob_scene_index].sessions,
            this.ob_camera_type, null, false);
    };

    OB_TIMELINE.prototype.ob_create_sorting = function (ob_scene_index) {
        let ob_sorting_by = "NONE";
        let ob_filtering = "";
        this.ob_remove_descriptor();
        this.ob_remove_calendar();
        this.ob_remove_help();
        this.ob_remove_setting();
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
                div.style.height = parseInt(this.ob_scene[ob_scene_index].ob_height) + parseInt(this.ob_timeline_header.style.height) + "px";
            else
                div.style.height = window.innerHeight + "px";
            div.style.width = "100%";

            let OB_MAX_ATT_VALUE = 15;
            let ob_build_all_sorting_options = "<option value='" + "NONE" + "'>" + "NONE" + "</option>\n";
            let ob_build_all_filtering_options = "<div>";
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

                            ob_build_all_filtering_options +=
                                "<table><tr align=left ><td style='background:#CDCCCC;font-weight:bold;'>" + key +
                                "</td><td></td><td></td><td></td></tr> \n";
                            let ob_tr = true;
                            for (let i = 0; i < value_items.length; i++) {
                                if (i === 0 || (i % 4) === 0) {
                                    ob_build_all_filtering_options += "<tr>";
                                    ob_tr = false;
                                }
                                // Add filtering lists for items not longer than 12 characters
                                if (value_items[i] !== "" && value_items[i].length <= OB_MAX_ATT_VALUE &&
                                    !value_items[i].includes("-->")) {
                                    ob_build_all_filtering_options += "<td><label>" + value_items[i] +
                                        "<input type='checkbox' id= " + this.name + "_" + key + "_" + value_items[i] +
                                        "></label></td>";
                                }
                                if (ob_tr === true && i !== 0 && (i % 4) !== 0) {
                                    ob_build_all_filtering_options += "</tr>";
                                    ob_tr = true;
                                }
                            }
                            if (ob_tr === true)
                                ob_build_all_filtering_options += "</table>";
                            else
                                ob_build_all_filtering_options += "</tr></table>";
                        }
                    }
                }
            } catch (err) {
            }
            ob_build_all_filtering_options += "</div>";

            div.innerHTML = "" +
                "<div class='ob_descriptor_head' >Sorting & Filtering<\div>\n" +
                "<div class='ob_form1'>\n" +
                "<form>\n" +
                "<fieldset>\n" +
                "<legend><span class='number'>1 - </span>Timeline Sorting By " + ob_sorting_by + "</legend>\n" +
                "<input class='ob_sort_by' type='label' disabled value='Sort by :'>\n" +
                "<select id='ob_sort_by' name='ob_sorting_by'>\n" +
                ob_build_all_sorting_options +
                "</select>      \n" +
                "</fieldset>\n" +
                "<fieldset>" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_apply_timeline_sorting(" + ob_scene_index + ");\" value='Apply' />\n" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_cancel_setting(" + ob_scene_index + ");\" value='Cancel' />\n" +
                "</fieldset>\n" +
                "<legend><span class='number'>2 - </span>Timeline Filtering " + ob_filtering + "</legend>\n" +
                "<fieldset>\n" +
                ob_build_all_filtering_options +
                "</fieldset>\n" +
                "<fieldset>" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_apply_timeline_filter(" + ob_scene_index + ");\" value='Apply Filtering' />\n" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_cancel_setting(" + ob_scene_index + ");\" value='Cancel' />\n" +
                "</fieldset>\n" +
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
        try {
            if (document.getElementById(this.name + "_setting") !== null) {
                this.ob_remove_setting();
                return;
            }
            this.ob_timeline_right_panel.style.visibility = "visible";
            let div = document.createElement("div");
            div.className = "ob_head_panel";
            div.id = this.name + '_setting';
            let ob_model_line_count = 20;
            try {
                ob_model_line_count = JSON.stringify(this.ob_scene[ob_scene_index].model, null,
                    2).split('\n').length;
            } catch (err) {
            }

            div.innerHTML = "" +
                "<div style='padding:8px;text-align:center;'>Setting<\div>\n" +
                "<div class='ob_form1'>\n" +
                "<form>\n" +
                "<fieldset>\n" +
                "<legend><span class='number'>1 - </span>Timeline Info</legend>\n" +
                "<input type='label' disabled value='Top :'>\n" +
                "<input type='number' id=" + this.name + "_top value='" + this.top + "'>\n" +
                "<input type='label' disabled value='Left :'>\n" +
                "<input type='number' id=" + this.name + "_left value='" + this.left + "'>\n" +
                "<input type='label' disabled value='Width :'>\n" +
                "<input type='number' id=" + this.name + "_width value='" + this.ob_scene[ob_scene_index].ob_width + "'>\n" +
                "<input type='label' disabled value='Height :'>\n" +
                "<input type='number' id=" + this.name + "_height value='" + this.ob_scene[ob_scene_index].ob_height + "'>\n" +
                "</fieldset>\n" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_apply_timeline_info(" + ob_scene_index + ");\" value='Apply Timeline Info' />\n" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_cancel_setting(" + ob_scene_index + ");\" value='Cancel' />\n" +
                "<fieldset>\n" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_apply_bands_info(" + ob_scene_index + ");\" value='Apply Bands Info' />\n" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_cancel_setting(" + ob_scene_index + ");\" value='Cancel' />\n" +
                "<fieldset>\n" +
                "<legend><span class='number'>2 - </span> Data Model</legend>\n" +
                "<textarea id=" + this.name + "_data rows='" + ob_model_line_count + "' >" + JSON.stringify(this.ob_scene[ob_scene_index].model, null, 2) + "</textarea>\n" +
                "</fieldset>\n" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_apply_data_model(" + ob_scene_index + ");\" value='Apply Model Info' />\n" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_cancel_setting(" + ob_scene_index + ");\" value='Cancel' />\n" +
                "<fieldset>\n" +
                "<legend><span class='number'>3 - </span>Timeline Camera Info</legend>\n" +
                "</fieldset>\n" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_apply_orthographic_camera(" + ob_scene_index + ");\" value='Orthographic' />\n" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_apply_perspective_camera(" + ob_scene_index + ");\" value='Perspective' />\n" +
                "</form>\n" +
                "<div class='ob_gui_iframe_container' id='" + this.name + "_gui_iframe_container' style='position:absolute;'> </div>\n" +
                "</div>";

            this.ob_timeline_right_panel.style.top = this.ob_timeline_panel.offsetTop + "px";
            this.ob_timeline_right_panel.style.left = this.ob_timeline_panel.offsetLeft + parseInt(this.ob_timeline_panel.style.width) + "px";
            this.ob_timeline_right_panel.appendChild(div);

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

    OB_TIMELINE.prototype.ob_connected = function () {
        if (this.ob_start === undefined) return;
        this.ob_start.style.visibility = "visible";
        this.ob_stop.style.visibility = "hidden";
    };

    OB_TIMELINE.prototype.ob_not_connected = function () {
        if (this.ob_start === undefined) return;
        this.ob_start.style.visibility = "hidden";
        this.ob_stop.style.visibility = "visible";
    };

    OB_TIMELINE.prototype.ob_create_help = function () {
        this.ob_remove_descriptor();
        this.ob_remove_calendar();
        this.ob_remove_setting();
        this.ob_remove_sorting();
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
                "<form>\n" +
                "<fieldset>\n" +
                "<legend> version 0.9.8 beta</legend>\n" +
                "<a  href='https://github.com/arcazj/openbexi'>'https://github.com/arcazj/openbexi'</a >\n" +
                "</form>\n" +
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

    OB_TIMELINE.prototype.ob_start_clock = function () {
        /*if ((this.params[0].date !== "current_time" && this.params[0].date !== "Date.now()")) {
            clearInterval(this.ob_interval_clock);
            return;
        }*/
        let that_clock = this;
        this.ob_sec_incr = 0;
        try {
            clearInterval(this.ob_interval_clock);
            this.ob_interval_clock = setInterval(function () {
                that_clock.get_current_time();
                //that_clock.center_bands(that_clock.ob_render_index);
                that_clock.ob_sec_incr++;
                if (that_clock.ob_sec_incr === 10) {
                    that_clock.ob_sec_incr = 0;
                }
                /*console.log("ob_start_clock - ob_sec_incr++=" + that_clock.ob_sec_incr +
                    " - ob_interval_clock=" reset_synced_time+ that_clock.ob_interval_clock +
                    " - currentTime=" + new Date(that_clock.get_current_time()).toString().substring(0, 24) +
                    " - ob_render_index/ob_scene_index=" + that_clock.ob_render_index + "/" + that_clock.ob_scene_index);*/
            }, 1000);
        } catch (e) {
        }
    };

    OB_TIMELINE.prototype.ob_create_calendar = function (date) {
        if (date === undefined || date === "current_time") date = "now";
        this.ob_remove_descriptor();
        this.ob_remove_help();
        this.ob_remove_setting();
        this.ob_remove_sorting();
        try {
            if (document.getElementById(this.name + "_cal") !== null) {
                this.ob_remove_calendar();
                //return;
            }
            let div = document.createElement("div");
            div.className = "ob_head_panel";
            div.id = this.name + '_help';
            div.innerHTML = "<div style='padding:8px;text-align: center;'>Calendar<\div>";
            this.ob_timeline_right_panel.appendChild(div);

            this.ob_timeline_right_panel.style.visibility = "visible";
            this.div_cal = document.createElement("div");
            this.div_cal.id = this.name + "_cal";
            this.div_cal.className = "auto-jsCalendar";
            this.ob_cal = jsCalendar.new(this.div_cal, date, {
                navigator: true,
                navigatorPosition: "both",
                zeroFill: false,
                monthFormat: "month YYYY",
                dayFormat: "DDD",
                firstDayOfTheWeek: "2",
                language: "en"
            });

            let that3 = this;
            this.ob_cal.onDateClick(function (event, date) {
                if (that3.ob_scene[that3.ob_render_index].ob_interval_move !== undefined)
                    clearInterval(that3.ob_scene[that3.ob_render_index].ob_interval_move);
                that3.ob_scene[that3.ob_render_index].date_cal = date.toString();
                that3.ob_scene[that3.ob_render_index].show_calendar = true;
                that3.reset_synced_time("new_calendar_date", that3.ob_render_index);
                that3.ob_remove_calendar();
                if (that3.data && that3.data.match(/^(http?):\/\//) ||
                    that3.data.match(/^(wss?|ws):\/\/[^\s$.?#].[^\s]*$/) ||
                    that3.data && that3.data.match(/^(https?):\/\//)) {
                    that3.data_head = that3.data.split("?");
                    that3.update_scenes(that3.ob_render_index, that3.header, that3.params, that3.ob_scene[that3.ob_render_index].bands,
                        that3.ob_scene[that3.ob_render_index].model, that3.ob_scene[that3.ob_render_index].sessions,
                        that3.ob_camera_type, null, true);
                } else
                    that3.update_scenes(that3.ob_render_index, that3.header, that3.params, that3.ob_scene[that3.ob_render_index].bands,
                        that3.ob_scene[that3.ob_render_index].model, that3.ob_scene[that3.ob_render_index].sessions,
                        that3.ob_camera_type, null, false);
            })
            this.ob_cal.onMonthChange(function (event, date) {
                if (that3.ob_scene[that3.ob_render_index].ob_interval_move !== undefined)
                    clearInterval(that3.ob_scene[that3.ob_render_index].ob_interval_move);
                that3.ob_scene[that3.ob_render_index].date_cal = date.toString();
                that3.ob_scene[that3.ob_render_index].show_calendar = true;
                that3.reset_synced_time("new_calendar_date", that3.ob_render_index);
                if (that3.data && that3.data.match(/^(http?):\/\//) ||
                    that3.data.match(/^(wss?|ws):\/\/[^\s$.?#].[^\s]*$/) ||
                    that3.data && that3.data.match(/^(https?):\/\//)) {
                    that3.data_head = that3.data.split("?");
                    that3.update_scenes(that3.ob_render_index, that3.header, that3.params, that3.ob_scene[that3.ob_render_index].bands,
                        that3.ob_scene[that3.ob_render_index].model, that3.ob_scene[that3.ob_render_index].sessions,
                        that3.ob_camera_type, null, true);
                } else
                    that3.update_scenes(that3.ob_render_index, that3.header, that3.params, that3.ob_scene[that3.ob_render_index].bands,
                        that3.ob_scene[that3.ob_render_index].model, that3.ob_scene[that3.ob_render_index].sessions,
                        that3.ob_camera_type, null, false);
            })


            this.ob_timeline_right_panel.style.top = this.ob_timeline_panel.offsetTop + "px";
            this.ob_timeline_right_panel.style.left = this.ob_timeline_panel.offsetLeft +
                parseInt(this.ob_timeline_panel.style.width) + "px";
            this.ob_timeline_right_panel.appendChild(this.div_cal);
        } catch (err) {
        }
    };

    OB_TIMELINE.prototype.ob_remove_calendar = function () {
        try {
            this.ob_timeline_right_panel.style.visibility = "hidden";
            this.ob_timeline_right_panel.removeChild(document.getElementById(this.name + "_cal"));
        } catch (err) {
        }
    };

    OB_TIMELINE.prototype.ob_open_descriptor = function (ob_scene_index, data) {
        this.ob_remove_help();
        this.ob_remove_calendar();
        this.ob_remove_setting();
        this.ob_remove_sorting();
        try {
            this.ob_timeline_right_panel.removeChild(document.getElementById(this.name + "_descriptor"));
        } catch (err) {
        }
        if (data !== undefined) {
            this.ob_createDescriptor(ob_scene_index, data);
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
            if (window.innerHeight > parseInt(this.ob_scene[ob_scene_index].ob_height) + parseInt(this.ob_timeline_header.style.height))
                div.style.height = parseInt(this.ob_scene[ob_scene_index].ob_height) + parseInt(this.ob_timeline_header.style.height) + "px";
            else
                div.style.height = window.innerHeight + "px";
            if (this.descriptor === undefined) {
                if (descriptor.id === undefined) descriptor.id = "";
                if (descriptor.end === undefined) descriptor.end = "";
                let ob_descriptor_body = "";
                for (let [key, value] of Object.entries(descriptor.data)) {
                    if (key !== "sortByValue" && key !== "description" && key !== "analyze" && key !== "title"
                        && value !== "NA" && value !== "?" && value !== undefined)
                        ob_descriptor_body += "<tr><td class=ob_descriptor_td>" + key + ":</td><td>" + value +
                            "</td></tr>";
                }
                div.innerHTML = "<div class=ob_descriptor_head >" + "data" + "<\div><br><br>" +
                    "<table class=ob_descriptor_table id=" + this.name + "_table_start_end" + ">" +
                    "<tr class=ob_descriptor_tr><td class=ob_descriptor_td>id : </td><td class=ob_descriptor_td2>" +
                    descriptor.id + "</td></tr>" +
                    "<tr class=ob_descriptor_tr><td class=ob_descriptor_td>start : </td><td class=ob_descriptor_td2>" +
                    descriptor.start + "</td></tr>" +
                    "<tr class=ob_descriptor_tr><td class=ob_descriptor_td>end : </td><td class=ob_descriptor_td2>" +
                    descriptor.end + "</td></tr>" +
                    "<tr class=ob_descriptor_tr><td></td></tr>" +
                    "<tr class=ob_descriptor_tr><td class=ob_descriptor_td>title:</td><td class=ob_descriptor_td2>" +
                    descriptor.data.title + "</td></tr>" +
                    ob_descriptor_body +
                    "<tr><td></td></tr>" +
                    "<tr class=ob_descriptor_tr><td class=ob_descriptor_td>description:</td><td class=ob_descriptor_td2>" +
                    descriptor.data.description + "</td></tr>" +
                    "</table>";
                this.ob_timeline_right_panel.appendChild(div);
            } else {
                // Build, eval and display he descriptor
                this.descriptor = "this." + this.descriptor.replace(".js",
                    "(descriptor)").replace("this.", "");
                this.ob_timeline_right_panel.appendChild(eval(this.descriptor));
            }
        }
    };

    OB_TIMELINE.prototype.ob_createTimelineHeader = function () {
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
                if (that2.ob_scene[that2.ob_render_index].ob_interval_move !== undefined)
                    clearInterval(that2.ob_scene[that2.ob_render_index].ob_interval_move);
                that2.moving = false;
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
                if (that2.ob_scene[that2.ob_render_index].ob_interval_move !== undefined)
                    clearInterval(that2.ob_scene[that2.ob_render_index].ob_interval_move);
                that2.moving = false;
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
                if (that2.ob_scene[that2.ob_render_index].show_calendar === undefined)
                    that2.ob_scene[that2.ob_render_index].show_calendar = true;
                if (that2.ob_scene[that2.ob_render_index].show_calendar === true) {
                    that2.ob_create_calendar(that2.ob_markerDate);
                    that2.ob_scene[that2.ob_render_index].show_calendar = false;
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
                if (that2.ob_scene[that2.ob_render_index].ob_interval_move !== undefined)
                    clearInterval(that2.ob_scene[that2.ob_render_index].ob_interval_move);
                that2.moving = false;
                that2.reset_synced_time("re_sync", that2.ob_render_index);
                if (that2.data && that2.data.match(/^(http?):\/\//) ||
                    that2.data.match(/^(wss?|ws):\/\/[^\s$.?#].[^\s]*$/) ||
                    that2.data && that2.data.match(/^(https?):\/\//)) {
                    that2.data_head = that2.data.split("?");
                    that2.update_scenes(that2.ob_render_index, that2.header, that2.params, that2.ob_scene[that2.ob_render_index].bands,
                        that2.ob_scene[that2.ob_render_index].model, that2.ob_scene[that2.ob_render_index].sessions,
                        that2.ob_camera_type, null, true);
                } else
                    that2.update_scenes(that2.ob_render_index, that2.header, that2.params, that2.ob_scene[that2.ob_render_index].bands,
                        that2.ob_scene[that2.ob_render_index].model, that2.ob_scene[that2.ob_render_index].sessions,
                        that2.ob_camera_type, null, false);
            };
            this.ob_sync.onmousemove = function () {
                that2.moving = false;
                that2.ob_sync.style.cursor = "pointer";
            };

            this.ob_filter = document.createElement("IMG");
            this.ob_filter.className = "ob_filter";
            this.ob_filter.alt = "Filtering&Sorting menu";
            this.ob_filter.style.left = "131px";
            this.ob_filter.style.height = 32 + "px";
            this.ob_filter.style.width = 32 + "px";
            this.ob_filter.onclick = function () {
                that2.moving = false;
                that2.ob_settings.style.zIndex = "9999";
                if (that2.ob_scene[that2.ob_render_index].ob_interval_move !== undefined)
                    clearInterval(that2.ob_scene[that2.ob_render_index].ob_interval_move);
                that2.ob_create_sorting(that2.ob_render_index);
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
                that2.reset_synced_time("new_search", that2.ob_render_index);
                clearInterval(that2.ob_scene[that2.ob_render_index].ob_interval_move);
                that2.ob_search_value = that2.ob_search_input.value;
                that2.update_scenes(that2.ob_render_index, that2.header, that2.params,
                    that2.ob_scene[that2.ob_render_index].bands, that2.ob_scene[that2.ob_render_index].model,
                    that2.ob_scene[that2.ob_render_index].sessions, that2.ob_camera_type, null, true);
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
                clearInterval(that2.ob_scene[that2.ob_render_index].ob_interval_move);
                if (that2.ob_camera_type === "Perspective") {
                    get_ob_timeline(that2.name).ob_apply_orthographic_camera(that2.ob_render_index);
                    that2.ob_camera_type = "Orthographic";
                    that2.ob_3d.className = "ob_3d";
                } else {
                    get_ob_timeline(that2.name).ob_apply_perspective_camera(that2.ob_render_index);
                    that2.ob_camera_type = "Perspective";
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
                clearInterval(that2.ob_scene[that2.ob_render_index].ob_interval_move);
                that2.ob_create_setting(that2.ob_render_index);
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
                clearInterval(that2.ob_scene[that2.ob_render_index].ob_interval_move);
                that2.moving = false;
                that2.ob_create_help();
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
                    that2.reset_synced_time("new_search", that2.ob_render_index);
                    clearInterval(that2.ob_scene[that2.ob_render_index].ob_interval_move);
                    that2.ob_search_value = that2.ob_search_input.value;
                    that2.update_scenes(that2.ob_render_index, that2.header, that2.params,
                        that2.ob_scene[that2.ob_render_index].bands, that2.ob_scene[that2.ob_render_index].model,
                        that2.ob_scene[that2.ob_render_index].sessions, that2.ob_camera_type, null, true);
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
            this.ob_timeline_header.appendChild(this.ob_3d);
            this.ob_timeline_header.appendChild(this.ob_settings);
            this.ob_timeline_header.appendChild(this.ob_help);
            this.ob_timeline_header.appendChild(this.ob_search_input);
            this.ob_timeline_header.appendChild(this.ob_search_label);
            this.ob_connected();
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
        //this.ob_canvas = document.getElementById("ob_timeline_canvas");

        //Set timeline
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
                that2.params[0].width = parseInt(that2.ob_timeline_panel.style.width);
                that2.params[0].height = parseInt(that2.ob_timeline_panel.style.height);
                that2.update_scenes(that2.ob_render_index, that2.header, that2.params,
                    that2.ob_scene[that2.ob_render_index].bands, that2.ob_scene[that2.ob_render_index].model,
                    that2.ob_scene[that2.ob_render_index].sessions, that2.ob_camera_type, null, false);
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
                that2.params[0].width = parseInt(that2.ob_timeline_panel.style.width);
                that2.params[0].height = parseInt(that2.ob_timeline_panel.style.height);
                that2.update_scenes(that2.ob_render_index, that2.header, that2.params,
                    that2.ob_scene[that2.ob_render_index].bands, that2.ob_scene[that2.ob_render_index].model,
                    that2.ob_scene[that2.ob_render_index].sessions, that2.ob_camera_type, null, false);
            };
            // Set Header description if any otherwise keep default
            this.ob_createTimelineHeader();
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
        this.ob_timeline_panel.style.top = parseInt(this.top) + "px";
        this.ob_timeline_panel.style.left = parseInt(this.left) + "px";
        this.ob_timeline_panel.style.width = parseInt(this.ob_scene[ob_scene_index].ob_width) + "px";
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
        this.ob_timeline_right_panel.style.left = this.left + this.ob_scene[ob_scene_index].ob_width + "px";
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
    };
    OB_TIMELINE.prototype.setGregorianUnitLengths = function (ob_scene_index) {
        for (let i = 0; i < this.ob_scene[ob_scene_index].bands.length; i++) {
            if (this.ob_scene[ob_scene_index].bands[i].intervalUnit === "MILLISECOND    ")
                this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths = 1;
            else if (this.ob_scene[ob_scene_index].bands[i].intervalUnit === "SECOND")
                this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths = 1000;
            else if (this.ob_scene[ob_scene_index].bands[i].intervalUnit === "MINUTE")
                this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths = 1000 * 60;
            else if (this.ob_scene[ob_scene_index].bands[i].intervalUnit === "HOUR")
                this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths = 1000 * 60 * 60;
            else if (this.ob_scene[ob_scene_index].bands[i].intervalUnit === "DAY")
                this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths = 1000 * 60 * 60 * 24;
            else if (this.ob_scene[ob_scene_index].bands[i].intervalUnit === "WEEK")
                this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths = 1000 * 60 * 60 * 24 * 7;
            else if (this.ob_scene[ob_scene_index].bands[i].intervalUnit === "MONTH")
                this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths = 1000 * 60 * 60 * 24 * 31;
            else if (this.ob_scene[ob_scene_index].bands[i].intervalUnit === "YEAR")
                this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths = 1000 * 60 * 60 * 24 * 365;
            else if (this.ob_scene[ob_scene_index].bands[i].intervalUnit === "DECADE")
                this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths = 1000 * 60 * 60 * 24 * 365 * 10;
            else if (this.ob_scene[ob_scene_index].bands[i].intervalUnit === "CENTURY")
                this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths = 1000 * 60 * 60 * 24 * 365 * 100;
            else if (this.ob_scene[ob_scene_index].bands[i].intervalUnit === "MILLENNIUM     ")
                this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths = 1000 * 60 * 60 * 24 * 365 * 1000;
            else if (this.ob_scene[ob_scene_index].bands[i].intervalUnit === "EPOCH")
                this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths = -1;
            else if (this.ob_scene[ob_scene_index].bands[i].intervalUnit === "ERA")
                this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths = -2;
            else
                this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths = 1000 * 60 * 60;
        }
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
    }
    OB_TIMELINE.prototype.getMinute = function (totalGregorianUnitLengths) {
        let mm = new Date(totalGregorianUnitLengths).getMinutes();
        if (String(mm).length === 1)
            return "0" + mm;
        else
            return mm;
    }
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
        if (format === "mmm") {
            if (new Date(totalGregorianUnitLengths).getMonth() === 0)
                return "Jan";
            else if (new Date(totalGregorianUnitLengths).getMonth() === 1)
                return "Feb";
            else if (new Date(totalGregorianUnitLengths).getMonth() === 2)
                return "Mar";
            else if (new Date(totalGregorianUnitLengths).getMonth() === 3)
                return "Apr";
            else if (new Date(totalGregorianUnitLengths).getMonth() === 4)
                return "May";
            else if (new Date(totalGregorianUnitLengths).getMonth() === 5)
                return "Jun";
            else if (new Date(totalGregorianUnitLengths).getMonth() === 6)
                return "Jul";
            else if (new Date(totalGregorianUnitLengths).getMonth() === 7)
                return "Aug";
            else if (new Date(totalGregorianUnitLengths).getMonth() === 8)
                return "Sep";
            else if (new Date(totalGregorianUnitLengths).getMonth() === 9)
                return "Oct";
            else if (new Date(totalGregorianUnitLengths).getMonth() === 10)
                return "Nov";
            else
                return "Dec";
        } else {
            return String(new Date(totalGregorianUnitLengths).getMonth() + 1);
        }
    }
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
    OB_TIMELINE.prototype.getPixelOffSetIncrement = function (ob_scene_index, gregorianUnitLengths, intervalPixels) {
        return this.dateToPixelOffSet(ob_scene_index, new Date(gregorianUnitLengths), gregorianUnitLengths,
            intervalPixels) - this.dateToPixelOffSet(ob_scene_index, new Date(0), gregorianUnitLengths,
            intervalPixels);
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
    OB_TIMELINE.prototype.pixelOffSetToDateText = function (ob_scene_index, pixels, gregorianUnitLengths,
                                                            intervalPixels, intervalUnit, dateFormat) {
        let totalGregorianUnitLengths = this.ob_scene.sync_time +
            (pixels * (gregorianUnitLengths / intervalPixels));
        if (dateFormat !== "DEFAULT")
            return this.convertDate(totalGregorianUnitLengths, dateFormat);
        if (intervalUnit === "CENTURY")
            return String(new Date(totalGregorianUnitLengths).getFullYear() * 100);
        else if (intervalUnit === "DECADE")
            return String(new Date(totalGregorianUnitLengths).getFullYear() * 10);
        else if (intervalUnit === "YEAR")
            return String(new Date(totalGregorianUnitLengths).getFullYear());
        else if (intervalUnit === "MONTH")
            return this.convertDate(totalGregorianUnitLengths, "MM");
        else if (intervalUnit === "DAY")
            return String(new Date(totalGregorianUnitLengths).getDate());
        else if (intervalUnit === "HOUR")
            return String(new Date(totalGregorianUnitLengths).getHours());
        else if (intervalUnit === "MINUTE")
            return String(new Date(totalGregorianUnitLengths).getMinutes());
        else if (intervalUnit === "SECOND")
            return String(new Date(totalGregorianUnitLengths).getSeconds());
        else
            return String(new Date(totalGregorianUnitLengths));
    };
    OB_TIMELINE.prototype.pixelOffSetToDate = function (ob_scene_index, pixels, gregorianUnitLengths, intervalPixels) {
        let totalGregorianUnitLengths = this.ob_scene.sync_time +
            (pixels * (gregorianUnitLengths / intervalPixels));
        return new Date(totalGregorianUnitLengths)
    };

// Bands creation and manipulation
    OB_TIMELINE.prototype.get_band = function (ob_scene_index, name) {
        for (let i = 0; i < this.ob_scene[ob_scene_index].bands.length; i++) {
            if (this.ob_scene[ob_scene_index].bands[i].name === name)
                return this.ob_scene[ob_scene_index].bands[i];
        }
    };
    OB_TIMELINE.prototype.center_bands = function (ob_scene_index) {
        let ob_sync = false;
        for (let i = 0; i < this.ob_scene[ob_scene_index].bands.length; i++) {
            this.ob_scene[ob_scene_index].bands[i].viewOffset =
                -this.ob_scene[ob_scene_index].ob_width * (this.ob_scene[ob_scene_index].bands[i].multiples - 1) / 2;
            if (this.center === undefined)
                this.ob_scene[ob_scene_index].bands[i].x = 0;
            else {
                if (this.center === "left")
                    this.ob_scene[ob_scene_index].bands[i].x = -this.ob_scene[ob_scene_index].ob_width / 3;
                else if (this.center === "right")
                    this.ob_scene[ob_scene_index].bands[i].x = this.ob_scene[ob_scene_index].ob_width / 3;
                else
                    this.ob_scene[ob_scene_index].bands[i].x = 0;
            }
            this.ob_scene[ob_scene_index].bands[i].width =
                this.ob_scene[ob_scene_index].ob_width * this.ob_scene[ob_scene_index].bands[i].multiples;
            if (i === this.ob_scene[ob_scene_index].bands.length - 1)
                ob_sync = true;
            this.move_band(ob_scene_index, this.ob_scene[ob_scene_index].bands[i].name,
                this.ob_scene[ob_scene_index].bands[i].x, this.ob_scene[ob_scene_index].bands[i].y,
                this.ob_scene[ob_scene_index].bands[i].z, ob_sync);
        }
    };
    OB_TIMELINE.prototype.get_MinDate = function (ob_scene_index, date) {
        let pixelOffSet = this.dateToPixelOffSet(ob_scene_index, date,
            this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths,
            this.ob_scene[ob_scene_index].bands[i].intervalPixels);
        this.pixelOffSetToDate(ob_scene_index, this.ob_scene[ob_scene_index].bands[i].viewOffset +
            pixelOffSet, this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths,
            this.ob_scene[ob_scene_index].bands[i].intervalPixels);
    }
    OB_TIMELINE.prototype.update_bands_MinDate = function (ob_scene_index, date) {
        this.minDateL = 0;
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
            if (minDateL > this.minDateL) {
                this.minDateL = minDateL;
                this.minDate = new Date(this.minDateL).toString().substring(0, 24) + " UTC";
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
        //console.log(this.minDate);
    };
    OB_TIMELINE.prototype.update_bands_MaxDate = function (ob_scene_index, date) {
        this.maxDateL = 0;
        this.iniMaxDateL = 0;
        for (let i = 0; i < this.ob_scene[ob_scene_index].bands.length; i++) {
            let pixelOffSet = this.dateToPixelOffSet(ob_scene_index, date,
                this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths,
                this.ob_scene[ob_scene_index].bands[i].intervalPixels);
            this.ob_scene[ob_scene_index].bands[i].maxDate =
                this.pixelOffSetToDate(ob_scene_index, -this.ob_scene[ob_scene_index].bands[i].viewOffset +
                    pixelOffSet, this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths,
                    this.ob_scene[ob_scene_index].bands[i].intervalPixels);
            this.ob_scene[ob_scene_index].bands[i].iniMaxDate =
                this.pixelOffSetToDate(ob_scene_index, -this.ob_scene[ob_scene_index].bands[i].minViewOffset +
                    pixelOffSet, this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths,
                    this.ob_scene[ob_scene_index].bands[i].intervalPixels);
            this.ob_scene[ob_scene_index].bands[i].iniMaxDate =
                new Date(new Date(this.ob_scene[ob_scene_index].bands[0].iniMaxDate).setMinutes(0));
            this.ob_scene[ob_scene_index].bands[i].iniMaxDate =
                new Date(new Date(this.ob_scene[ob_scene_index].bands[0].iniMaxDate).setSeconds(0));
            let iniMaxDateL = new Date(this.ob_scene[ob_scene_index].bands[i].iniMaxDate).getTime();
            if (iniMaxDateL > this.iniMaxDateL) {
                this.iniMaxDateL = iniMaxDateL;
                this.iniMaxDate = new Date(this.iniMaxDateL).toString().substring(0, 24) + " UTC";
            }
        }
        //console.log(this.maxDate);
    };

    OB_TIMELINE.prototype.set_bands_minDate = function (ob_scene_index) {
        this.minDateL = 0;
        for (let i = 0; i < this.ob_scene[ob_scene_index].bands.length; i++) {
            this.ob_scene[ob_scene_index].bands[i].minDate = this.pixelOffSetToDate(ob_scene_index,
                this.ob_scene[ob_scene_index].bands[i].viewOffset,
                this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths,
                this.ob_scene[ob_scene_index].bands[i].intervalPixels);
            // Round hour to 0
            this.ob_scene[ob_scene_index].bands[i].minDate = new Date(new Date(this.ob_scene[ob_scene_index].bands[0].minDate).setMinutes(0));
            this.ob_scene[ob_scene_index].bands[i].minDate = new Date(new Date(this.ob_scene[ob_scene_index].bands[0].minDate).setSeconds(0));
            let minDateL = new Date(this.ob_scene[ob_scene_index].bands[i].minDate).getTime();
            if (minDateL > this.minDateL) {
                this.minDateL = minDateL;
                this.minDate = new Date(this.minDateL).toString().substring(0, 24) + " UTC";
            }
        }
    };
    OB_TIMELINE.prototype.set_bands_maxDate = function (ob_scene_index) {
        this.maxDateL = 0;
        for (let i = 0; i < this.ob_scene[ob_scene_index].bands.length; i++) {
            this.ob_scene[ob_scene_index].bands[i].maxDate = this.pixelOffSetToDate(ob_scene_index,
                -this.ob_scene[ob_scene_index].bands[i].viewOffset,
                this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths,
                this.ob_scene[ob_scene_index].bands[i].intervalPixels);
            this.ob_scene[ob_scene_index].bands[i].maxDate =
                new Date(new Date(this.ob_scene[ob_scene_index].bands[0].maxDate).setMinutes(0));
            this.ob_scene[ob_scene_index].bands[i].maxDate =
                new Date(new Date(this.ob_scene[ob_scene_index].bands[0].maxDate).setSeconds(0));
            let maxDateL = new Date(this.ob_scene[ob_scene_index].bands[i].maxDate).getTime();
            if (maxDateL > this.maxDateL) {
                this.maxDateL = maxDateL;
                this.maxDate = new Date(this.maxDateL).toString().substring(0, 24) + " UTC";
            }
        }
    };
    OB_TIMELINE.prototype.set_bands_viewOffset = function (ob_scene_index) {
        for (let i = 0; i < this.ob_scene[ob_scene_index].bands.length; i++) {
            this.ob_scene[ob_scene_index].bands[i].minWidth = this.ob_scene[ob_scene_index].ob_width;
            this.ob_scene[ob_scene_index].bands[i].width =
                this.ob_scene[ob_scene_index].ob_width * this.ob_scene[ob_scene_index].bands[i].multiples;
            this.ob_scene[ob_scene_index].bands[i].minViewOffset = -this.ob_scene[ob_scene_index].bands[i].minWidth;
            this.ob_scene[ob_scene_index].bands[i].viewOffset = -this.ob_scene[ob_scene_index].bands[i].width / 2;
            this.ob_scene[ob_scene_index].bands[i].x = this.ob_scene[ob_scene_index].bands[i].viewOffset;
        }
    };
    OB_TIMELINE.prototype.update_timeline_model = function (ob_scene_index, band, ob_attribute, ob_color,
                                                            ob_alternate_color, ob_layouts, max_name_length) {
        band.layouts = ob_layouts;
        band.layouts.max_name_length = max_name_length;
        if (this.ob_scene[ob_scene_index].bands.original_length === this.ob_scene[ob_scene_index].bands.length) return;
        band.layout_name = band.layouts[0];
        if (band.layout_name === undefined) band.layout_name = "NONE";
        let set_alternate_color = true;

        this.ob_scene[ob_scene_index].bands[0].maxY = 0;
        this.ob_scene[ob_scene_index].bands[0].minY = 0;
        this.ob_scene[ob_scene_index].bands[0].lastGreaterY = -this.ob_scene[ob_scene_index].ob_height;
        for (let i = 1; i < band.layouts.length; i++) {
            //this.ob_scene[ob_scene_index].bands.unshift(Object.assign({}, band));
            this.ob_scene[ob_scene_index].bands[i] = Object.assign({}, band);
            this.ob_scene[ob_scene_index].bands[i].name = band.name + "_" + i;
            this.ob_scene[ob_scene_index].bands[i].layout_name = band.layouts[i];
            if (set_alternate_color === true) {
                this.ob_scene[ob_scene_index].bands[i].color = ob_alternate_color;
                this.ob_scene[ob_scene_index].bands[i].backgroundColor = ob_alternate_color;
                set_alternate_color = false;
            } else {
                this.ob_scene[ob_scene_index].bands[i].color = ob_color;
                set_alternate_color = true;
            }
            this.ob_scene[ob_scene_index].bands[i].maxY = 0;
            this.ob_scene[ob_scene_index].bands[i].minY = 0;
            this.ob_scene[ob_scene_index].bands[i].lastGreaterY = -this.ob_scene[ob_scene_index].ob_height;
        }
        this.ob_scene[ob_scene_index].bands.original_length = this.ob_scene[ob_scene_index].bands.length;
    }

    OB_TIMELINE.prototype.create_new_bands = function (ob_scene_index) {
        let ob_layouts = [];
        let max_name_length = 0;
        let sortByValue;

        for (let i = 0; i < this.ob_scene[ob_scene_index].bands.length; i++) {
            if (this.ob_scene[ob_scene_index].bands[i].model === undefined) {
                this.ob_scene[ob_scene_index].bands[i].layouts = ["NONE"];
                this.ob_scene[ob_scene_index].bands[i].layout_name = "NONE";
                this.ob_scene[ob_scene_index].bands[i].model = [{sortBy: "NONE"}];
            } else {
                for (let j = 0; j < 1; j++) {
                    if (this.ob_scene[ob_scene_index].bands[i].model[j].sortBy === undefined)
                        this.ob_scene[ob_scene_index].bands[i].model[j].sortBy = "NONE";
                    if (i === 0) {
                        if (this.ob_scene[ob_scene_index].sessions === undefined) return;
                        for (let k = 0; k < this.ob_scene[ob_scene_index].sessions.events.length; k++) {
                            // Remove all events events not visible in the bands
                            //pixelOffSetStart = this.dateToPixelOffSet(ob_scene_index, this.ob_scene[ob_scene_index].sessions.events[i].start, band.gregorianUnitLengths, band.intervalPixels);
                            //if (pixelOffSetStart > -this.ob_scene[ob_scene_index].ob_width && this.ob_scene[ob_scene_index].ob_width > pixelOffSetStart) {
                            try {
                                if (this.ob_scene[ob_scene_index].sessions.events[k].id !== undefined && this.ob_scene[ob_scene_index].sessions.events[k].zone === undefined) {
                                    sortByValue = eval("this.ob_scene[ob_scene_index].sessions.events[k]" + ".data." +
                                        this.ob_scene[ob_scene_index].bands[i].model[j].sortBy.toString());
                                    this.ob_scene[ob_scene_index].sessions.events[k].data.sortByValue = sortByValue;
                                    if (ob_layouts.indexOf(sortByValue) === -1) {
                                        ob_layouts.push(sortByValue);
                                        if ((ob_layouts[0]) !== undefined) {
                                            if ((ob_layouts[0]).length > max_name_length)
                                                max_name_length = (ob_layouts[0]).length;
                                        }
                                    }
                                }
                            } catch {
                            }
                        }
                    }

                    if (this.ob_scene[ob_scene_index].bands[i].model[j].alternateColor !== undefined)
                        this.update_timeline_model(ob_scene_index, this.ob_scene[ob_scene_index].bands[i],
                            this.ob_scene[ob_scene_index].bands[i].model[j].sortBy.toString(),
                            this.ob_scene[ob_scene_index].bands[i].color,
                            this.ob_scene[ob_scene_index].bands[i].model[j].alternateColor.toString(),
                            ob_layouts, max_name_length);
                    else
                        this.update_timeline_model(ob_scene_index, this.ob_scene[ob_scene_index].bands[i],
                            this.ob_scene[ob_scene_index].bands[i].model[j].sortBy.toString(),
                            this.ob_scene[ob_scene_index].bands[i].color, undefined,
                            ob_layouts, max_name_length);
                }
            }
        }
    };
    OB_TIMELINE.prototype.set_bands_height = function (ob_scene_index) {
        // Height may have changed depending on how many sessions or events populated in the bands
        // So here we need to check the Timeline height changed
        let new_timeline_height = 0;
        for (let i = 0; i < this.ob_scene[ob_scene_index].bands.length; i++) {
            if (this.ob_scene[ob_scene_index].bands[i].height !== undefined) {
                if (this.ob_scene[ob_scene_index].bands[i].minY !== undefined) {
                    this.ob_scene[ob_scene_index].bands[i].height =
                        Math.abs(this.ob_scene[ob_scene_index].bands[i].maxY) +
                        Math.abs(this.ob_scene[ob_scene_index].bands[i].minY);
                    new_timeline_height += this.ob_scene[ob_scene_index].bands[i].height;
                } else {
                    try {
                        if (this.ob_scene[ob_scene_index].bands[i].height.match(/%/) !== null)
                            this.ob_scene[ob_scene_index].bands[i].height = (this.ob_scene[ob_scene_index].ob_height *
                                parseInt(this.ob_scene[ob_scene_index].bands[i].height)) / 100;
                        if (this.ob_scene[ob_scene_index].bands[i].height.match(/px/) !== null)
                            this.ob_scene[ob_scene_index].bands[i].height =
                                parseInt(this.ob_scene[ob_scene_index].bands[i].height);
                    } catch (err) {
                    }
                }
            } else {
                this.ob_scene[ob_scene_index].bands[i].y = this.ob_scene[ob_scene_index].ob_height -
                    ((this.ob_scene[ob_scene_index].ob_height / this.ob_scene[ob_scene_index].bands.length) / 2);
                this.ob_scene[ob_scene_index].bands[i].pos_x = this.ob_scene[ob_scene_index].bands[i].x;
                this.ob_scene[ob_scene_index].bands[i].pos_y = this.ob_scene[ob_scene_index].bands[i].y;
                this.ob_scene[ob_scene_index].bands[i].pos_z = this.ob_scene[ob_scene_index].bands[i].z;
            }
            if (this.ob_scene[ob_scene_index].bands.length === 1 &&
                i === this.ob_scene[ob_scene_index].bands.length - 1 &&
                this.ob_scene[ob_scene_index].ob_height > new_timeline_height)
                this.ob_scene[ob_scene_index].bands[i].height +=
                    this.ob_scene[ob_scene_index].ob_height - new_timeline_height;
        }
        if (new_timeline_height !== 0) {
            this.ob_scene[ob_scene_index].ob_height = new_timeline_height;
        }
        let pos = 0;
        let offSet, offSetOverview;
        for (let i = 0; i < this.ob_scene[ob_scene_index].bands.length; i++) {
            if (this.ob_scene[ob_scene_index].bands[i].height !== undefined) {
                this.ob_scene[ob_scene_index].bands[i].y =
                    this.ob_scene[ob_scene_index].ob_height - pos - (this.ob_scene[ob_scene_index].bands[i].height / 2);
                this.ob_scene[ob_scene_index].bands[i].pos_x = this.ob_scene[ob_scene_index].bands[i].x;
                this.ob_scene[ob_scene_index].bands[i].pos_y = this.ob_scene[ob_scene_index].bands[i].y;
                this.ob_scene[ob_scene_index].bands[i].pos_z = this.ob_scene[ob_scene_index].bands[i].z;
                pos = pos + this.ob_scene[ob_scene_index].bands[i].height;
                this.ob_scene[ob_scene_index].bands[i].heightMax = this.ob_scene[ob_scene_index].bands[i].height;
                this.ob_scene[ob_scene_index].bands[i].maxY = this.ob_scene[ob_scene_index].bands[i].heightMax / 2;
                this.ob_scene[ob_scene_index].bands[i].minY = -this.ob_scene[ob_scene_index].bands[i].maxY;
                this.ob_scene[ob_scene_index].bands[i].heightMin = this.ob_scene[ob_scene_index].ob_height - pos;
                if (this.ob_scene[ob_scene_index].bands[i].name.match(/overview_/)) {
                    offSetOverview = parseInt(this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths) /
                        parseInt(this.ob_scene[ob_scene_index].bands[i].intervalPixels);
                } else {
                    offSet = parseInt(this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths) /
                        parseInt(this.ob_scene[ob_scene_index].bands[i].intervalPixels);
                }
            }
        }
        /*console.log("this.params[" + 0 + "].height =" + this.params[0].height +
            " | this.ob_scene[ob_scene_index].bands[" + 0 + "].trackIncrement=" +
            this.ob_scene[ob_scene_index].bands[0].trackIncrement +
            " | this.ob_scene[ob_scene_index].ob_height=" + this.ob_scene[ob_scene_index].ob_height);*/
        for (let i = 0; i < this.ob_scene[ob_scene_index].bands.length; i++) {
            if (this.ob_scene[ob_scene_index].bands[i].name.match(/overview_/)) {
                /*try {
                    this.ob_scene[ob_scene_index].bands[i].trackIncrement =
                        (offSet / offSetOverview) * this.ob_scene[ob_scene_index].bands[i].trackIncrement;
                    if (this.ob_scene[ob_scene_index].bands[i].trackIncrement === undefined)
                        this.ob_scene[ob_scene_index].bands[i].trackIncrement = 1;
                } catch {
                    this.ob_scene[ob_scene_index].bands[i].trackIncrement = 1;
                }*/
                this.ob_scene[ob_scene_index].bands[i].trackIncrement = 1;
            }
            /*console.log("this.ob_scene[ob_scene_index].bands[" + i + "].name=" + this.ob_scene[ob_scene_index].bands[i].name +
                " | this.ob_scene[ob_scene_index].bands[" + i + "].height=" + this.ob_scene[ob_scene_index].bands[i].height +
                " | this.ob_scene[ob_scene_index].bands[" + i + "].heightMin=" + this.ob_scene[ob_scene_index].bands[i].heightMin +
                " | this.ob_scene[ob_scene_index].bands[" + i + "].heightMax=" + this.ob_scene[ob_scene_index].bands[i].heightMax +
                " | this.ob_scene[ob_scene_index].bands[" + i + "].maxY=" + this.ob_scene[ob_scene_index].bands[i].maxY +
                " | this.ob_scene[ob_scene_index].bands[" + i + "].pos_x=" + this.ob_scene[ob_scene_index].bands[i].pos_x +
                " | this.ob_scene[ob_scene_index].bands[" + i + "].x=" + this.ob_scene[ob_scene_index].bands[i].x +
                " | this.ob_scene[ob_scene_index].bands[" + i + "].minY=" + this.ob_scene[ob_scene_index].bands[i].minY +
                " | this.ob_scene[ob_scene_index].bands[" + i + "].pos_y=" + this.ob_scene[ob_scene_index].bands[i].pos_y +
                " | this.ob_scene[ob_scene_index].bands[" + i + "].y=" + this.ob_scene[ob_scene_index].bands[i].y +
                " | this.ob_scene[ob_scene_index].bands[" + i + "].lastGreaterY=" + this.ob_scene[ob_scene_index].bands[i].lastGreaterY);*/
        }
    };
    OB_TIMELINE.prototype.set_bands = function (ob_scene_index) {
        for (let i = 0; i < this.ob_scene[ob_scene_index].bands.length; i++) {
            if (this.ob_scene[ob_scene_index].bands[i].textColor === undefined)
                this.ob_scene[ob_scene_index].bands[i].textColor = "#000000";
            if (this.ob_scene[ob_scene_index].bands[i].dateColor === undefined)
                this.ob_scene[ob_scene_index].bands[i].dateColor = "#000000";
            if (this.ob_scene[ob_scene_index].bands[i].SessionColor === undefined)
                this.ob_scene[ob_scene_index].bands[i].SessionColor = "#000000";
            if (this.ob_scene[ob_scene_index].bands[i].eventColor === undefined)
                this.ob_scene[ob_scene_index].bands[i].eventColor = "#000000";
            if (this.ob_scene[ob_scene_index].bands[i].texture === undefined)
                this.ob_scene[ob_scene_index].bands[i].texture = undefined;
            if (this.ob_scene[ob_scene_index].bands[i].defaultSessionTexture === undefined)
                this.ob_scene[ob_scene_index].bands[i].defaultSessionTexture = undefined;
            if (this.ob_scene[ob_scene_index].bands[i].sessionHeight === undefined)
                this.ob_scene[ob_scene_index].bands[i].sessionHeight = 10;
            if (this.ob_scene[ob_scene_index].bands[i].defaultEventSize === undefined)
                this.ob_scene[ob_scene_index].bands[i].defaultEventSize = 5;

            if (this.params[0].fontSize === undefined) {
                this.fontSize = "12px";
                this.fontSizeInt = "12";
            } else {
                this.fontSize = this.params[0].fontSize;
                try {
                    this.fontSizeInt = this.fontSize.replace("px", "");
                } catch (e) {
                    this.fontSizeInt = this.fontSize
                }
                this.fontSize = this.fontSizeInt + "px";
            }
            if (this.ob_scene[ob_scene_index].bands[i].fontSize === undefined) {
                this.ob_scene[ob_scene_index].bands[i].fontSize = this.fontSize;
                this.ob_scene[ob_scene_index].bands[i].fontSizeInt = this.fontSizeInt;
            } else {
                try {
                    this.ob_scene[ob_scene_index].bands[i].fontSizeInt =
                        this.ob_scene[ob_scene_index].bands[i].fontSize.replace("px", "");
                } catch (e) {
                    this.ob_scene[ob_scene_index].bands[i].fontSizeInt =
                        this.ob_scene[ob_scene_index].bands[i].fontSize
                }
                this.ob_scene[ob_scene_index].bands[i].fontSize =
                    this.ob_scene[ob_scene_index].bands[i].fontSizeInt + "px";
            }

            if (this.params[0].fontFamily === undefined) {
                this.fontFamily = 'Arial';
            } else {
                this.fontFamily = this.params[0].fontFamily;
            }
            if (this.ob_scene[ob_scene_index].bands[i].fontFamily === undefined) {
                this.ob_scene[ob_scene_index].bands[i].fontFamily = this.fontFamily;
            }

            if (this.params[0].fontStyle === undefined) {
                this.fontStyle = 'Normal';
            } else {
                this.fontStyle = this.params[0].fontStyle;
            }
            if (this.ob_scene[ob_scene_index].bands[i].fontStyle === undefined) {
                this.ob_scene[ob_scene_index].bands[i].fontStyle = this.fontStyle;
            }

            if (this.params[0].fontWeight === undefined) {
                this.fontWeight = 'Normal';
            } else {
                this.fontWeight = this.params[0].fontWeight;
            }
            if (this.ob_scene[ob_scene_index].bands[i].fontWeight === undefined) {
                this.ob_scene[ob_scene_index].bands[i].fontWeight = this.fontWeight;
            }

            if (this.ob_scene[ob_scene_index].bands[i].x === undefined)
                this.ob_scene[ob_scene_index].bands[i].x = -10000;
            else
                this.ob_scene[ob_scene_index].bands[i].x = parseInt(this.ob_scene[ob_scene_index].bands[i].x);

            if (this.ob_scene[ob_scene_index].bands[i].z === undefined)
                this.ob_scene[ob_scene_index].bands[i].z = 0;
            else
                this.ob_scene[ob_scene_index].bands[i].z = parseInt(this.ob_scene[ob_scene_index].bands[i].z);

            this.ob_scene[ob_scene_index].bands[i].width = 100000;

            if (this.ob_scene[ob_scene_index].bands[i].depth === undefined)
                this.ob_scene[ob_scene_index].bands[i].depth = 0;
            else
                this.ob_scene[ob_scene_index].bands[i].depth = parseInt(this.ob_scene[ob_scene_index].bands[i].depth);

            if (this.ob_scene[ob_scene_index].bands[i].color === undefined)
                this.ob_scene[ob_scene_index].bands[i].color = 'white';

            if (this.params[0].backgroundColor === undefined) {
                this.backgroundColor = this.ob_scene[ob_scene_index].bands[i].color;
            } else {
                this.backgroundColor = this.params[0].backgroundColor;
            }
            if (this.ob_scene[ob_scene_index].bands[i].backgroundColor === undefined) {
                this.ob_scene[ob_scene_index].bands[i].backgroundColor = this.backgroundColor;
            }

            if (this.ob_scene[ob_scene_index].bands[i].intervalPixels === undefined)
                this.ob_scene[ob_scene_index].bands[i].intervalPixels = "200";

            if (this.ob_scene[ob_scene_index].bands[i].intervalUnit === undefined)
                this.ob_scene[ob_scene_index].bands[i].intervalUnit = "MINUTE";

            if (this.ob_scene[ob_scene_index].bands[i].dateFormat === undefined)
                this.ob_scene[ob_scene_index].bands[i].dateFormat = "DEFAULT"

            if (this.ob_scene[ob_scene_index].bands[i].subIntervalPixels ===
                undefined || this.ob_scene[ob_scene_index].bands[i].subIntervalPixels === "NONE")
                this.ob_scene[ob_scene_index].bands[i].subIntervalPixels = "NONE";
            else {
                if (this.ob_scene[ob_scene_index].bands[i].intervalUnit ===
                    "HOUR" && parseInt(this.ob_scene[ob_scene_index].bands[i].intervalPixels) >= 60)
                    this.ob_scene[ob_scene_index].bands[i].subIntervalPixels =
                        parseInt(this.ob_scene[ob_scene_index].bands[i].intervalPixels) / 4;
            }
            this.ob_scene[ob_scene_index].bands[i].multiples =
                parseInt(this.ob_scene[ob_scene_index].bands[i].intervalPixels) / this.multiples;
            this.ob_scene[ob_scene_index].bands[i].trackIncrement = 20;
        }
        this.create_new_bands(ob_scene_index);
        this.set_bands_height(ob_scene_index);
        this.set_bands_viewOffset(ob_scene_index);
        this.set_bands_minDate(ob_scene_index);
        this.set_bands_maxDate(ob_scene_index);
    };
    OB_TIMELINE.prototype.add_zone = function (ob_scene_index, band_number, zone_number, band_name, zone_name, text, textColor, x, y, z, width, height,
                                               depth, color, texture) {
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

        //this.ob_scene[ob_scene_index].add(ob_zone);
        this.ob_scene[ob_scene_index].objects.push(ob_zone);

        if (!band_name.includes("overview"))
            this.add_text_sprite(ob_scene_index, ob_zone, text, 50, 0, 10, 24, "Normal",
                "Normal", textColor, 'Arial', undefined);

        let ob_band = this.ob_scene[ob_scene_index].getObjectByName(band_name);
        if (ob_band !== undefined) {
            ob_band.add(ob_zone);
        }

        if (ob_debug_ADD_WEBGL_OBJECT) console.log("OB_TIMELINE.add_zone(" + band_name + "," +
            text + "," + textColor + "," + x + "," + y + "," + z + "," + width + "," + height + "," + depth + "," +
            color + "," + texture + ")");
    };

    OB_TIMELINE.prototype.add_textBox = function (ob_scene_index, band_name, text, textColor, x, y, z, width, height,
                                                  depth, color, texture) {
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

        this.add_text_sprite(ob_scene_index, ob_model_name, text, 50, 0, 10, 24, "Normal",
            "Normal", textColor, 'Arial', undefined);

        if (ob_debug_ADD_WEBGL_OBJECT) console.log("OB_TIMELINE.add_textBox(" + band_name + "," +
            text + "," + textColor + "," + x + "," + y + "," + z + "," + width + "," + height + "," + depth + "," +
            color + "," + texture + ")");
    };

    OB_TIMELINE.prototype.hex_Luminance = function (hex, lum) {
        // validate hex string
        hex = String(hex).replace(/[^0-9a-f]/gi, '');
        if (hex.length < 6) {
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }
        lum = lum || 0;

        // convert to decimal and change luminosity
        let rgb = "#", c, i;
        for (i = 0; i < 3; i++) {
            c = parseInt(hex.substr(i * 2, 2), 16);
            c = Math.round(Math.min(Math.max(0, c + (c * lum)), 255)).toString(16);
            rgb += ("00" + c).substr(c.length);
        }

        return rgb;
    }

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
                    this.hex_Luminance(color, -.15));
            }
        }
    };

    OB_TIMELINE.prototype.create_bands = function (ob_scene_index, ob_set_bands) {
        if (ob_set_bands === true) this.set_bands(ob_scene_index);
        for (let i = 0; i < this.ob_scene[ob_scene_index].bands.length; i++) {
            this.add_band(ob_scene_index, this.ob_scene[ob_scene_index].bands[i].name,
                this.ob_scene[ob_scene_index].bands[i].x,
                this.ob_scene[ob_scene_index].bands[i].y,
                this.ob_scene[ob_scene_index].bands[i].z,
                this.ob_scene[ob_scene_index].bands[i].width,
                this.ob_scene[ob_scene_index].bands[i].heightMax,
                this.ob_scene[ob_scene_index].bands[i].depth,
                this.ob_scene[ob_scene_index].bands[i].color,
                this.ob_scene[ob_scene_index].bands[i].texture);
            if (this.ob_scene[ob_scene_index].bands[i].layout_name !== "NONE") {
                this.add_textBox(ob_scene_index, this.ob_scene[ob_scene_index].bands[i].name,
                    this.ob_scene[ob_scene_index].bands[i].layout_name,
                    this.ob_scene[ob_scene_index].bands[i].textColor,
                    -(this.ob_scene[ob_scene_index].ob_width / 2) +
                    (parseInt(this.ob_scene[ob_scene_index].bands[i].layouts.max_name_length) *
                        parseInt(this.ob_scene[ob_scene_index].bands[i].layouts.max_name_length) / 2),
                    this.ob_scene[ob_scene_index].bands[i].y,
                    parseInt(this.ob_scene[ob_scene_index].bands[i].z) + 50,
                    parseInt(this.ob_scene[ob_scene_index].bands[i].layouts.max_name_length) *
                    parseInt(this.ob_scene[ob_scene_index].bands[i].fontSizeInt) * 2,
                    this.ob_scene[ob_scene_index].bands[i].heightMax,
                    parseInt(this.ob_scene[ob_scene_index].bands[i].depth) + 1,
                    this.hex_Luminance(this.ob_scene[ob_scene_index].bands[i].color, -.15),
                    undefined,
                    this.hex_Luminance(this.ob_scene[ob_scene_index].bands[i].color, -.15));
            }
        }
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
            this.ob_scene[ob_scene_index].add(this.track[ob_scene_index](new THREE.AmbientLight(0x404040)));
            ob_material = this.track[ob_scene_index](new THREE.MeshBasicMaterial({color: color}));
        }
        ob_band = this.track[ob_scene_index](new THREE.Mesh(ob_box, ob_material));
        ob_band.name = band_name;
        ob_band.pos_x = x;
        ob_band.pos_y = this.get_band(ob_scene_index, band_name).pos_y;
        ob_band.pos_z = z;
        ob_band.position.set(x, y, z);

        this.ob_scene[ob_scene_index].add(ob_band);
        this.ob_scene[ob_scene_index].objects.push(ob_band);
        if (ob_debug_ADD_WEBGL_OBJECT) console.log("OB_TIMELINE.add_band(" + band_name + "," + x + "," + y + "," + z +
            "," + width + "," + height + "," + depth + "," + color + "," + texture + ")");
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

    OB_TIMELINE.prototype.destroy_all_scenes = function (ob_scene_index) {
        if (this.ob_scene !== undefined)
            for (let i = 0; i < this.ob_scene.length; i++)
                this.destroy_scene(i);
        this.ob_scene = undefined;
    }

    OB_TIMELINE.prototype.ob_render = function (ob_scene_index) {
        //console.log("OB_TIMELINE.prototype.ob_render(ob_render_index=" + ob_scene_index + ")");
        this.ob_scene[ob_scene_index].ob_renderer.render(this.ob_scene[ob_scene_index],
            this.ob_scene[ob_scene_index].ob_camera);
    }

    OB_TIMELINE.prototype.update_scenes = function (ob_scene_index, header, params, bands, model, sessions, camera,
                                                    band, load_data) {
        // If user is moving a band
        if (band !== null) {
            if ((band.pos_x > -band.position.x - this.ob_scene[ob_scene_index].ob_width ||
                band.position.x < band.pos_x + this.ob_scene[ob_scene_index].ob_width)) {
                clearInterval(this.ob_scene[ob_scene_index].ob_interval_move);
                this.reset_synced_time("new_view", ob_scene_index);
                this.load_data(ob_scene_index);
            } else {
                this.ob_render(ob_scene_index);
            }
        } else {   // If user is not moving a band
            if (this.first_sync === true) {
                this.ob_render_index = ob_scene_index;
                this.first_sync = false;
                this.second_sync = true;
                this.reset_synced_time("new_sync", ob_scene_index);
                this.load_data(ob_scene_index);
                return;
            }

            /*if (this.ob_render_index === 2) {
                this.ob_render_index = 0;
            } else {
                this.ob_render_index++;
            }*/
            this.ob_scene_index = this.ob_render_index;

            if (load_data === true) {
                this.load_data(ob_scene_index);
                //console.log("-->Not going to update_scene and load_data - minDate=" + this.minDate + " maxDate=" + this.maxDate);
                return;
            }

            //console.log("---->Go to update_scene[" + ob_scene_index + "] - minDate=" + this.minDate + " maxDate=" + this.maxDate);
            let that_scene = this;
            clearTimeout(this.update_this_scene);
            this.update_this_scene = setTimeout(function () {
                that_scene.update_scene(ob_scene_index, header, params, bands, model, sessions, camera);
            }, 0);

            if (this.second_sync === true) {
                this.ob_render_index = ob_scene_index;
                this.second_sync = false;
                this.reset_synced_time("re_sync", ob_scene_index);
                this.load_data(ob_scene_index);
            }
        }
    }

    OB_TIMELINE.prototype.update_scene = function (ob_scene_index, header, params, bands, model, sessions, camera) {
        ob_timelines.forEach(function (ob_timeline) {
                let startDate = new Date();
                if (ob_timeline.name === params[0].name) {
                    let current_camera = ob_timeline.ob_camera_type;
                    ob_timeline.destroy_scene(ob_timeline.ob_scene_index);
                    ob_timeline.ob_scene_index = ob_scene_index;
                    ob_timeline.ob_camera_type = camera;
                    ob_timeline.header = header;
                    ob_timeline.params = params;
                    ob_timeline.ob_scene[ob_timeline.ob_scene_index].bands = bands;
                    ob_timeline.ob_scene[ob_timeline.ob_scene_index].model = model;
                    ob_timeline.ob_scene[ob_timeline.ob_scene_index].sessions = sessions;

                    ob_timeline.ob_set_scene(ob_timeline.ob_scene_index);
                    ob_timeline.ob_init(ob_timeline.ob_scene_index);
                    ob_timeline.set_bands(ob_timeline.ob_scene_index);
                    ob_timeline.set_sessions(ob_timeline.ob_scene_index);
                    ob_timeline.ob_set_body_menu(ob_timeline.ob_scene_index);
                    ob_timeline.ob_set_renderer(ob_timeline.ob_scene_index);
                    ob_timeline.create_bands(ob_timeline.ob_scene_index, false);
                    ob_timeline.create_zones(ob_timeline.ob_scene_index);
                    ob_timeline.add_line_current_time(ob_timeline.ob_scene_index,
                        new Date(ob_timeline.get_current_time()), "rgb(243,23,51)");
                    ob_timeline.center_bands(ob_timeline.ob_scene_index);
                    ob_timeline.ob_camera_type = current_camera;
                    ob_timeline.ob_start_clock();
                    if (ob_timeline.ob_scene[ob_timeline.ob_scene_index].show_calendar)
                        ob_timeline.ob_create_calendar(new Date(ob_timeline.ob_scene[ob_timeline.ob_scene_index].date_cal));
                    // Apply filter if any here:
                    let regex = ob_timeline.build_sessions_filter("");
                    ob_timeline.create_sessions(ob_timeline.ob_scene_index, false, regex);
                    ob_timeline.create_segments_and_dates(ob_timeline.ob_scene_index);
                    ob_timeline.ob_set_camera(ob_timeline.ob_scene_index);
                }
                let endDate = new Date();
                let ob_time = endDate.getTime() - startDate.getTime();
                console.log("populated " + ob_timeline.ob_scene[ob_timeline.ob_scene_index].sessions.events.length +
                    " session(s) in " + ob_time + " ms and updated scene " + ob_timeline.ob_scene_index +
                    " (date min=" + ob_timeline.minDate + "- date max=" + ob_timeline.maxDate + ")");
            }
        );
        return null;
    };

    OB_TIMELINE.prototype.sync_bands = function (ob_scene_index, ob_band, x) {
        if (ob_band === undefined) return;
        let ob_band2;
        let scale1;
        let scale2;
        let ob_incrementPixelOffSet2;
        for (let i = 0; i < this.ob_scene[ob_scene_index].bands.length; i++) {
            if (ob_band.name === this.ob_scene[ob_scene_index].bands[i].name) {
                this.ob_markerDate = this.pixelOffSetToDate(ob_scene_index, -x,
                    this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths,
                    this.ob_scene[ob_scene_index].bands[i].intervalPixels);
                this.ob_scene[ob_scene_index].bands[i].x = x;
                scale1 = this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths /
                    this.ob_scene[ob_scene_index].bands[i].intervalPixels;
                break;
            }
        }
        for (let i = 0; i < this.ob_scene[ob_scene_index].bands.length; i++) {
            if (ob_band.name !== this.ob_scene[ob_scene_index].bands[i].name) {
                this.ob_markerDate2 =
                    this.pixelOffSetToDate(ob_scene_index, x,
                        this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths,
                        this.ob_scene[ob_scene_index].bands[i].intervalPixels);
                ob_incrementPixelOffSet2 = this.dateToPixelOffSet(ob_scene_index, this.ob_markerDate2,
                    this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths,
                    this.ob_scene[ob_scene_index].bands[i].intervalPixels);
                scale2 = this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths /
                    this.ob_scene[ob_scene_index].bands[i].intervalPixels;
                //Start syncing
                ob_band2 = this.ob_scene[ob_scene_index].getObjectByName(this.ob_scene[ob_scene_index].bands[i].name);
                if (ob_band2 !== undefined)
                    ob_band2.position.x = ob_incrementPixelOffSet2 / (scale2 / scale1);
            }
        }
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
    OB_TIMELINE.prototype.move_zone = function (ob_scene_index, ob_parent_name, ob_zone_name, x, pos_x, y, z, ob_sync) {
        if (isNaN(x)) return;
        let ob_band = this.ob_scene[ob_scene_index].getObjectByName(ob_parent_name);
        let ob_zone = this.ob_scene[ob_scene_index].getObjectByName(ob_zone_name);
        if (ob_band === undefined) return;
        if (ob_zone === undefined) return;
        //x = x - ob_band.position.x;
        let ob_zone_start_x = this.dateToPixelOffSet(ob_scene_index,
            this.ob_scene[ob_scene_index].bands[ob_zone.band_number].zones[ob_zone.zone_number].start,
            this.ob_scene[ob_scene_index].bands[ob_zone.band_number].gregorianUnitLengths,
            this.ob_scene[ob_scene_index].bands[ob_zone.band_number].intervalPixels);
        let ob_current_time_x = this.dateToPixelOffSet(ob_scene_index,
            new Date(this.get_current_time()),
            this.ob_scene[ob_scene_index].bands[ob_zone.band_number].gregorianUnitLengths,
            this.ob_scene[ob_scene_index].bands[ob_zone.band_number].intervalPixels);
        let ob_marker_x = this.dateToPixelOffSet(ob_scene_index,
            this.ob_markerDate,
            this.ob_scene[ob_scene_index].bands[ob_zone.band_number].gregorianUnitLengths,
            this.ob_scene[ob_scene_index].bands[ob_zone.band_number].intervalPixels);
        let ob_band_x = x - ob_zone_start_x;
        this.move_band(ob_scene_index, ob_parent_name, ob_band_x, ob_band.pos_y, ob_band.pos_z, ob_sync);
        ob_zone.position.set(pos_x, 0, z);

        if (ob_debug_MOVE_WEBGL_OBJECT) console.log("OB_TIMELINE.move_zone(" + ob_parent_name + "," + ob_zone_name +
            "," + x + "," + y + "," + z + ")");
        //console.log("OB_TIMELINE.move_zone(" + ob_parent_name + "," + ob_zone_name + "," + x + "," + y + "," + z +
            //" band_x=" + ob_band_x + " ob_zone_start_x=" + ob_zone_start_x + ")");
    };
    OB_TIMELINE.prototype.move_band = function (ob_scene_index, ob_band_name, x, y, z, ob_sync) {
        if (isNaN(x)) return;
        if (ob_band_name.includes("zone"))
            console.log("OB_TIMELINE.moveBand(" + ob_band_name + "," + x + "," + y + "," + z + ")");
        let ob_band = this.ob_scene[ob_scene_index].getObjectByName(ob_band_name);
        if (ob_band === undefined) return;
        ob_band.position.set(x, y, z);
        if (ob_sync)
            this.sync_bands(ob_scene_index, ob_band, x, y, z);

        if (ob_debug_MOVE_WEBGL_OBJECT) console.log("OB_TIMELINE.moveBand(" + ob_band_name + "," + x + "," + y + "," + z + ")");
        //console.log("OB_TIMELINE.moveBand(" + ob_band_name + "," + x + "," + y + "," + z + ")");
    };

    OB_TIMELINE.prototype.create_segments_and_dates = function (ob_scene_index) {
        //console.log("create_segments_and_dates start at:" + Date() + " - " + new Date().getMilliseconds());
        let text, textX, textY, maxPixelOffSet, incrementPixelOffSet, incrementSubPixelOffSet;
        for (let i = 0; i < this.ob_scene[ob_scene_index].bands.length; i++) {
            let ob_band = this.ob_scene[ob_scene_index].getObjectByName(this.ob_scene[ob_scene_index].bands[i].name);

            incrementPixelOffSet = this.dateToPixelOffSet(ob_scene_index, this.ob_scene[ob_scene_index].bands[i].minDate,
                this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths,
                this.ob_scene[ob_scene_index].bands[i].intervalPixels);
            maxPixelOffSet = this.dateToPixelOffSet(ob_scene_index, this.ob_scene[ob_scene_index].bands[i].maxDate,
                this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths,
                this.ob_scene[ob_scene_index].bands[i].intervalPixels);

            while (parseInt(incrementPixelOffSet) < parseInt(maxPixelOffSet) +
            parseInt(this.ob_scene[ob_scene_index].bands[i].intervalPixels)) {

                //Create segments
                this.add_segment(ob_scene_index, this.ob_scene[ob_scene_index].bands[i].name,
                    incrementPixelOffSet, this.ob_scene[ob_scene_index].bands[i].heightMax -
                    (this.ob_scene[ob_scene_index].bands[i].heightMax / 2), 5,
                    this.ob_scene[ob_scene_index].bands[i].heightMax, "black", false);
                // Trick: Add an extra segment to make a thinnest segment
                this.add_segment(ob_scene_index, this.ob_scene[ob_scene_index].bands[i].name,
                    incrementPixelOffSet + 0.15, this.ob_scene[ob_scene_index].bands[i].heightMax -
                    (this.ob_scene[ob_scene_index].bands[i].heightMax / 2), 5,
                    this.ob_scene[ob_scene_index].bands[i].heightMax,
                    this.ob_scene[ob_scene_index].bands[i].color, false);

                //Create date texts
                text = this.pixelOffSetToDateText(ob_scene_index, incrementPixelOffSet,
                    this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths,
                    this.ob_scene[ob_scene_index].bands[i].intervalPixels,
                    this.ob_scene[ob_scene_index].bands[i].intervalUnit,
                    this.ob_scene[ob_scene_index].bands[i].dateFormat);
                textX = incrementPixelOffSet - (this.ob_scene[ob_scene_index].bands[i].fontSizeInt / 2) + 6;
                if (this.ob_scene[ob_scene_index].bands[i].intervalUnitPos === "TOP")
                    textY = (this.ob_scene[ob_scene_index].bands[i].heightMax -
                        (this.ob_scene[ob_scene_index].bands[i].heightMax / 2)) -
                        this.ob_scene[ob_scene_index].bands[i].fontSizeInt;
                else if (this.ob_scene[ob_scene_index].bands[i].intervalUnitPos === "BOTTOM")
                    textY = (-parseInt(this.ob_scene[ob_scene_index].bands[i].heightMax) / 2) +
                        this.ob_scene[ob_scene_index].bands[i].fontSizeInt / 2;
                else
                    textY = (-parseInt(this.ob_scene[ob_scene_index].bands[i].heightMax) / 2) +
                        this.ob_scene[ob_scene_index].bands[i].fontSizeInt / 2;

                //this.add_text_CSS2D(ob_band, text, textX, textY, 5,this.ob_scene[ob_scene_index].bands[i].fontSizeInt, this.ob_scene[ob_scene_index].bands[i].dateColor);
                this.add_text_sprite(ob_scene_index, ob_band, text, textX, textY, 5,
                    this.ob_scene[ob_scene_index].bands[i].fontSizeInt,
                    this.ob_scene[ob_scene_index].bands[i].fontStyle,
                    this.ob_scene[ob_scene_index].bands[i].fontWeight, this.ob_scene[ob_scene_index].bands[i].dateColor,
                    this.ob_scene[ob_scene_index].bands[i].fontFamily, undefined);

                //Create sub-segments if required
                if (this.ob_scene[ob_scene_index].bands[i].subIntervalPixels !== "NONE") {
                    incrementSubPixelOffSet = parseInt(this.ob_scene[ob_scene_index].bands[i].subIntervalPixels);
                    while (parseInt(incrementPixelOffSet) + parseInt(incrementSubPixelOffSet) < parseInt(incrementPixelOffSet) + parseInt(this.ob_scene[ob_scene_index].bands[i].intervalPixels)) {
                        this.add_segment(ob_scene_index, this.ob_scene[ob_scene_index].bands[i].name, incrementPixelOffSet + incrementSubPixelOffSet,
                            this.ob_scene[ob_scene_index].bands[i].heightMax -
                            (this.ob_scene[ob_scene_index].bands[i].heightMax / 2), 5
                            , this.ob_scene[ob_scene_index].bands[i].heightMax, "black", true);
                        // Trick: Add an extra segment to make a thinnest segment
                        this.add_segment(ob_scene_index, this.ob_scene[ob_scene_index].bands[i].name,
                            incrementPixelOffSet + incrementSubPixelOffSet + 0.20,
                            this.ob_scene[ob_scene_index].bands[i].heightMax -
                            (this.ob_scene[ob_scene_index].bands[i].heightMax / 2), 5,
                            this.ob_scene[ob_scene_index].bands[i].heightMax,
                            this.ob_scene[ob_scene_index].bands[i].color, true);
                        incrementSubPixelOffSet += parseInt(this.ob_scene[ob_scene_index].bands[i].subIntervalPixels);
                    }
                }
                incrementPixelOffSet = parseInt(incrementPixelOffSet) + parseInt(this.ob_scene[ob_scene_index].bands[i].intervalPixels);
            }
        }
        //console.log("create_segments_and_dates done at:" + Date() + " - " + new Date().getMilliseconds());
    };

    OB_TIMELINE.prototype.get_room_for_session = function (ob_scene_index, sessions, session, i) {
        let ob_enough_room = true;
        this.ob_scene[ob_scene_index].bands[i].track = this.ob_scene[ob_scene_index].bands[i].maxY -
            this.ob_scene[ob_scene_index].bands[i].fontSizeInt;

        // if not enough room to plot the session increase bandWith regarding this.ob_scene[ob_scene_index].bands[i].trackIncrement
        while (ob_enough_room) {
            this.ob_scene[ob_scene_index].bands[i].track = this.ob_scene[ob_scene_index].bands[i].track -
                this.ob_scene[ob_scene_index].bands[i].trackIncrement;
            for (let l = 0; l < sessions.length; l++) {
                if (sessions[l].y === undefined) {
                    return this.ob_scene[ob_scene_index].bands[i].track;
                }
                // If no room, so check for the next track.
                if (sessions[l].y === this.ob_scene[ob_scene_index].bands[i].track) {
                    if (parseInt(session.x) >= parseInt(sessions[l].x) &&
                        parseInt(session.x) <= parseInt(sessions[l].x + sessions[l].total_width)) {
                        //  session i        ___
                        //  session l      _________
                        if (ob_debug_room) console.log("case1: this.ob_scene[ob_scene_index].bands[i].name=" +
                            this.ob_scene[ob_scene_index].bands[i].name +
                            " - session.data.title=" + session.data.title +
                            " - session.x=" + session.x +
                            " - session.total_width=" + session.total_width + " -->(" + parseInt(session.x + session.total_width) + ")" +
                            " - sessions[l].data.title=" + sessions[l].data.title +
                            " - sessions[l].x=" + sessions[l].x +
                            " - sessions[l].total_width=" + sessions[l].total_width + " -->(" + parseInt(sessions.x + sessions.total_width) + ")");

                        break;
                    } else if (parseInt(session.x) <= parseInt(sessions[l].x) &&
                        parseInt(session.x + session.total_width) >= parseInt(sessions[l].x)) {
                        //  session i      _________
                        //  session l              ________
                        if (ob_debug_room) console.log("case2: this.ob_scene[ob_scene_index].bands[i].name=" + this.ob_scene[ob_scene_index].bands[i].name +
                            " - session.data.title=" + session.data.title +
                            " - session.x=" + session.x +
                            " - session.total_width=" + session.total_width + " -->(" + parseInt(session.x + session.total_width) + ")" +
                            " - sessions[l].data.title=" + sessions[l].data.title +
                            " - sessions[l].x=" + sessions[l].x +
                            " - sessions[l].total_width=" + sessions[l].total_width + " -->(" + parseInt(sessions[l].x + sessions[l].total_width) + ")");

                        break;
                    } else {
                        if (ob_debug_room) console.log("case normal: this.ob_scene[ob_scene_index].bands[i].name=" + this.ob_scene[ob_scene_index].bands[i].name +
                            " - session.data.title=" + session.data.title +
                            " - session.x=" + session.x +
                            " - session.total_width=" + session.total_width + " -->(" + parseInt(session.x + session.total_width) + ")" +
                            " - sessions[l].data.title=" + sessions[l].data.title +
                            " - sessions[l].x=" + sessions[l].x +
                            " - sessions[l].total_width=" + sessions[l].total_width + " -->(" + parseInt(sessions[l].x + sessions[l].total_width) + ")");
                    }
                }
                // Reset increment if there is enough room to plot the session otherwise increase bandwidth.
                if (this.ob_scene[ob_scene_index].bands[i].track <= this.ob_scene[ob_scene_index].bands[i].minY + this.ob_scene[ob_scene_index].bands[i].trackIncrement) {
                    this.ob_scene[ob_scene_index].bands.updated = true;
                    this.ob_scene[ob_scene_index].bands[i].minY = this.ob_scene[ob_scene_index].bands[i].track - (2 * this.ob_scene[ob_scene_index].bands[i].trackIncrement);
                    return this.ob_scene[ob_scene_index].bands[i].track;
                }
            }
        }
        //console.log("this.ob_scene[ob_scene_index].bands[i].heightMax=" + this.ob_scene[ob_scene_index].bands[i].heightMax + " " + this.ob_scene[ob_scene_index].bands[i].name + " title=" + String(session.data.title) + " x=" + session.x + " w=" + session.w + " y=" + y);
        return this.ob_scene[ob_scene_index].bands[i].track;
    };

    function getTextWidth(text, font) {
        // re-use canvas object for better performance
        try {
            let canvas = getTextWidth.canvas || (getTextWidth.canvas = document.createElement("canvas"));
            let context = canvas.getContext("2d");
            context.font = font;
            let metrics = context.measureText(text);
            return metrics.width;
        } catch (e) {
            return 0;
        }
    }

    OB_TIMELINE.prototype.set_sessions = function (ob_scene_index) {
        let layout;
        let y = 0, z = 5, h = 0, w = 0;
        let textX = 0;
        let pixelOffSetStart = 0;
        let pixelOffSetEnd = 0;
        this.ob_scene[ob_scene_index].bands.updated = false;

        // two passes are necessary if bands height change because we need to calculate again all sessions coordinates
        let sortByValue;
        for (let p = 0; p < 2; p++) {
            if (p === 1 && this.ob_scene[ob_scene_index].bands.updated === false)
                break;

            // for each bands
            for (let i = 0; i < this.ob_scene[ob_scene_index].bands.length; i++) {
                this.ob_scene[ob_scene_index].bands[i].zones = [];
                this.ob_scene[ob_scene_index].bands[i].sessions = [];
                this.ob_scene[ob_scene_index].bands[i].lastGreaterY = -this.ob_scene[ob_scene_index].ob_height / 2;
                if (this.ob_scene[ob_scene_index].sessions === undefined) break;

                // Assign each event to the right bands and store zones
                if (sortByValue === undefined)
                    sortByValue = eval("this.ob_scene[ob_scene_index].bands[i].model[0].sortBy");
                for (let k = 0; k < this.ob_scene[ob_scene_index].sessions.events.length; k++) {
                    // Remove all events events not visible in the bands
                    //pixelOffSetStart = this.dateToPixelOffSet(ob_scene_index, this.ob_scene[ob_scene_index].sessions.events[k].start, this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths, this.ob_scene[ob_scene_index].bands[i].intervalPixels);
                    //if (pixelOffSetStart > -this.ob_scene[ob_scene_index].ob_width && this.ob_scene[ob_scene_index].ob_width > pixelOffSetStart) {
                    if (this.ob_scene[ob_scene_index].sessions.events[k].zone !== undefined) {
                        this.ob_scene[ob_scene_index].bands[i].zones.push(Object.assign({},
                            this.ob_scene[ob_scene_index].sessions.events[k]));
                    } else if (this.ob_scene[ob_scene_index].sessions.events[k].id !== undefined) {
                        if (sortByValue === "NONE") {
                            this.ob_scene[ob_scene_index].bands[i].sessions.push(Object.assign({},
                                this.ob_scene[ob_scene_index].sessions.events[k]));
                        } else {
                            layout = this.ob_scene[ob_scene_index].sessions.events[k].data.sortByValue;
                            if (layout === undefined)
                                layout = eval("this.ob_scene[ob_scene_index].sessions.events[k].data." + sortByValue);
                            if (layout !== undefined && this.ob_scene[ob_scene_index].bands[i].layout_name === layout) {
                                this.ob_scene[ob_scene_index].sessions.events[k].y = undefined;
                                this.ob_scene[ob_scene_index].bands[i].sessions.push(Object.assign({},
                                    this.ob_scene[ob_scene_index].sessions.events[k]));
                            }
                        }
                        this.build_model(ob_scene_index, this.ob_scene[ob_scene_index].sessions.events[k].data);
                        //}
                    }
                }

                for (let j = 0; j < this.ob_scene[ob_scene_index].bands[i].sessions.length; j++) {
                    if (this.ob_scene[ob_scene_index].sessions.events[j].id !== undefined) {
                        let session = this.ob_scene[ob_scene_index].bands[i].sessions[j];
                        if (session.data !== null && session.data.title === undefined) session.data.title = "";

                        pixelOffSetStart = this.dateToPixelOffSet(ob_scene_index, session.start,
                            this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths,
                            this.ob_scene[ob_scene_index].bands[i].intervalPixels);
                        pixelOffSetEnd = this.dateToPixelOffSet(ob_scene_index, session.end,
                            this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths,
                            this.ob_scene[ob_scene_index].bands[i].intervalPixels);

                        if (this.ob_scene[ob_scene_index].bands[i].name.match(/overview_/)) {
                            if (isNaN(parseInt(pixelOffSetEnd))) {
                                h = this.ob_scene[ob_scene_index].bands[i].trackIncrement;
                                w = this.ob_scene[ob_scene_index].bands[i].trackIncrement;
                            } else {
                                h = this.ob_scene[ob_scene_index].bands[i].trackIncrement;
                                w = parseInt(pixelOffSetEnd) - parseInt(pixelOffSetStart);
                            }
                        } else {
                            if (isNaN(parseInt(pixelOffSetEnd))) {
                                h = this.ob_scene[ob_scene_index].bands[i].defaultEventSize;
                                w = this.ob_scene[ob_scene_index].bands[i].defaultEventSize;
                                textX = getTextWidth(session.data.title,
                                    this.ob_scene[ob_scene_index].bands[i].fontSize + " " +
                                    this.ob_scene[ob_scene_index].bands[i].fontFamily);
                                textX = this.ob_scene[ob_scene_index].bands[i].defaultEventSize * 2 + textX / 2;

                            } else {
                                h = this.ob_scene[ob_scene_index].bands[i].sessionHeight;
                                w = parseInt(pixelOffSetEnd) - parseInt(pixelOffSetStart);
                                textX = getTextWidth(session.data.title,
                                    this.ob_scene[ob_scene_index].bands[i].fontSize + " " +
                                    this.ob_scene[ob_scene_index].bands[i].fontFamily);
                                textX = (w / 2) + this.ob_scene[ob_scene_index].bands[i].defaultEventSize + textX / 2;
                            }
                        }

                        // Do not write texts for any overview bands.
                        this.ob_scene[ob_scene_index].bands[i].sessions[j].x = parseInt(pixelOffSetStart);
                        this.ob_scene[ob_scene_index].bands[i].sessions[j].x_relative = parseInt(pixelOffSetStart) + w / 2;
                        this.ob_scene[ob_scene_index].bands[i].sessions[j].width = w;
                        this.ob_scene[ob_scene_index].bands[i].sessions[j].height = h;
                        this.ob_scene[ob_scene_index].bands[i].sessions[j].size = h;
                        this.ob_scene[ob_scene_index].bands[i].sessions[j].z = z;
                        this.ob_scene[ob_scene_index].bands[i].sessions[j].textX = textX;
                        this.ob_scene[ob_scene_index].bands[i].sessions[j].pixelOffSetStart = pixelOffSetStart;
                        this.ob_scene[ob_scene_index].bands[i].sessions[j].pixelOffSetEnd = pixelOffSetEnd;
                        this.ob_scene[ob_scene_index].bands[i].sessions[j].total_width =
                            w + (session.data.title.length * this.ob_scene[ob_scene_index].bands[i].fontSizeInt);

                        y = this.get_room_for_session(ob_scene_index, this.ob_scene[ob_scene_index].bands[i].sessions,
                            this.ob_scene[ob_scene_index].bands[i].sessions[j], i);
                    }
                    this.ob_scene[ob_scene_index].bands[i].sessions[j].y = y;
                    if (y > this.ob_scene[ob_scene_index].bands[i].lastGreaterY)
                        this.ob_scene[ob_scene_index].bands[i].lastGreaterY = y;
                }
                if (this.ob_scene[ob_scene_index].bands[i].lastGreaterY !== -this.ob_scene[ob_scene_index].ob_height / 2) {
                    this.ob_scene[ob_scene_index].bands[i].lastGreaterY =
                        this.ob_scene[ob_scene_index].bands[i].lastGreaterY +
                        this.ob_scene[ob_scene_index].bands[i].trackIncrement;
                } else {
                    this.ob_scene[ob_scene_index].bands[i].maxY = this.params[0].height / 2;
                    this.ob_scene[ob_scene_index].bands[i].minY = -this.ob_scene[ob_scene_index].bands[i].maxY;
                    this.ob_scene[ob_scene_index].bands[i].lastGreaterY = this.params[0].height / 2;
                }
            }
            this.set_bands_height(ob_scene_index);
        }
    };
    OB_TIMELINE.prototype.build_sessions_filter = function (filter) {
        if (filter === null || filter === "") return null;

        this.ob_filter_value = filter;
        this.regex = "^(?=.*(?:--|--))(?!.*(?:__|__)).*$";
        if (this.ob_filter_value.length === 1)
            this.regex = this.regex.replace("--|--", this.ob_filter_value[0].replace(" ",
                "|").replace(",", "|").replace(";", "|"));
        if (this.ob_filter_value.length === 2) {
            this.regex = this.regex.replace("--|--", this.ob_filter_value[0].replace(" ",
                "|").replace(",", "|").replace(";", "|"));
            this.regex = this.regex.replace("__|__", this.ob_filter_value[1].replace(" ",
                "|").replace(",", "|").replace(";", "|"));
        }
        return this.regex;
    }

    OB_TIMELINE.prototype.create_sessions = function (ob_scene_index, ob_set_sessions, regex) {
        if (ob_set_sessions === true) this.set_sessions(ob_scene_index);

        for (let i = 0; i < this.ob_scene[ob_scene_index].bands.length; i++) {
            let ob_obj;
            for (let j = 0; j < this.ob_scene[ob_scene_index].bands[i].sessions.length; j++) {
                try {
                    if (regex === null || this.ob_scene[ob_scene_index].bands[i].sessions[j].id !== undefined ||
                        this.ob_scene[ob_scene_index].bands[i].sessions[j].data.title.match(regex)) {
                        if ((this.ob_scene[ob_scene_index].bands[i].sessions[j].pixelOffSetEnd === undefined ||
                            isNaN(parseInt(this.ob_scene[ob_scene_index].bands[i].sessions[j].pixelOffSetEnd))) &&
                            !this.ob_scene[ob_scene_index].bands[i].name.match(/overview_/)) {
                            if (this.ob_scene[ob_scene_index].bands[i].sessions[j].render !== undefined)
                                ob_obj = this.add_event(ob_scene_index, this.ob_scene[ob_scene_index].bands[i].name,
                                    this.ob_scene[ob_scene_index].bands[i].backgroundColor,
                                    this.ob_scene[ob_scene_index].bands[i].sessions[j].render.color,
                                    this.ob_scene[ob_scene_index].bands[i].sessions[j],
                                    this.ob_scene[ob_scene_index].bands[i].sessions[j].render.image);
                            else
                                ob_obj = this.add_event(ob_scene_index, this.ob_scene[ob_scene_index].bands[i].name,
                                    this.ob_scene[ob_scene_index].bands[i].backgroundColor,
                                    this.ob_scene[ob_scene_index].bands[i].eventColor,
                                    this.ob_scene[ob_scene_index].bands[i].sessions[j]);
                        } else {
                            if (this.ob_scene[ob_scene_index].bands[i].sessions[j].render !== undefined &&
                                !this.ob_scene[ob_scene_index].bands[i].name.match(/overview_/)) {
                                ob_obj = this.add_session(ob_scene_index, this.ob_scene[ob_scene_index].bands[i].name,
                                    this.ob_scene[ob_scene_index].bands[i].backgroundColor,
                                    this.ob_scene[ob_scene_index].bands[i].sessions[j].render.color,
                                    this.ob_scene[ob_scene_index].bands[i].defaultSessionTexture,
                                    this.ob_scene[ob_scene_index].bands[i].sessions[j],
                                    this.ob_scene[ob_scene_index].bands[i].sessions[j].render.image);
                            } else
                                ob_obj = this.add_session(ob_scene_index, this.ob_scene[ob_scene_index].bands[i].name,
                                    this.ob_scene[ob_scene_index].bands[i].backgroundColor,
                                    this.ob_scene[ob_scene_index].bands[i].SessionColor,
                                    this.ob_scene[ob_scene_index].bands[i].defaultSessionTexture,
                                    this.ob_scene[ob_scene_index].bands[i].sessions[j]);
                        }
                        if (!this.ob_scene[ob_scene_index].bands[i].name.match(/overview_/)) {
                            let textColor = this.ob_scene[ob_scene_index].bands[i].dateColor;
                            let fontSizeInt = this.ob_scene[ob_scene_index].bands[i].fontSizeInt;
                            let fontWeight = this.ob_scene[ob_scene_index].bands[i].fontWeight;
                            let fontFamily = this.ob_scene[ob_scene_index].bands[i].fontFamily;
                            let fontStyle = this.ob_scene[ob_scene_index].bands[i].fontStyle;
                            let backgroundColor = this.ob_scene[ob_scene_index].bands[i].backgroundColor;
                            if (this.ob_scene[ob_scene_index].bands[i].sessions[j].render !== undefined) {
                                if (this.ob_scene[ob_scene_index].bands[i].sessions[j].render.textColor !== undefined)
                                    textColor = this.ob_scene[ob_scene_index].bands[i].sessions[j].render.textColor;
                                if (this.ob_scene[ob_scene_index].bands[i].sessions[j].render.fontSize !== undefined)
                                    fontSizeInt = this.ob_scene[ob_scene_index].bands[i].sessions[j].render.fontSize;
                                if (this.ob_scene[ob_scene_index].bands[i].sessions[j].render.fontWeight !== undefined)
                                    fontWeight = this.ob_scene[ob_scene_index].bands[i].sessions[j].render.fontWeight;
                                if (this.ob_scene[ob_scene_index].bands[i].sessions[j].render.fontFamily !== undefined)
                                    fontFamily = this.ob_scene[ob_scene_index].bands[i].sessions[j].render.fontFamily;
                                if (this.ob_scene[ob_scene_index].bands[i].sessions[j].render.fontStyle !== undefined)
                                    fontStyle = this.ob_scene[ob_scene_index].bands[i].sessions[j].render.fontStyle;
                                if (this.ob_scene[ob_scene_index].bands[i].sessions[j].render.backgroundColor !== undefined)
                                    backgroundColor = this.ob_scene[ob_scene_index].bands[i].sessions[j].render.backgroundColor;
                            }

                            this.add_text_sprite(ob_scene_index, ob_obj,
                                this.ob_scene[ob_scene_index].bands[i].sessions[j].data.title,
                                this.ob_scene[ob_scene_index].bands[i].sessions[j].textX, 0, 5, fontSizeInt,
                                fontStyle, fontWeight, textColor, fontFamily, backgroundColor);
                        }
                    }
                } catch (e) {
                    console.log(this.ob_scene[ob_scene_index].bands[i].name + " title=" +
                        String(this.ob_scene[ob_scene_index].bands[i].sessions[j].data.title) +
                        " - this.ob_scene[ob_scene_index].bands[i].heightMax=" +
                        this.ob_scene[ob_scene_index].bands[i].heightMax + "  i=" + i + " - j=" + j);
                }
            }
        }
    }

    OB_TIMELINE.prototype.move_session = function (session, x, y, z) {
        if (session !== undefined) {
            try {
                session.position.set(x, y, z);
            } catch (err) {
                if (x === undefined)
                    x = session.position.x;
                if (y === undefined)
                    y = session.position.y;
                if (z === undefined)
                    z = session.position.z;
                session.position.set(x, y, z);
            }
        }
    };

// WebGl OpenBexi library
    OB_TIMELINE.prototype.add_session = function (ob_scene_index, band_name, background, color, texture, session, image) {
        if (image !== undefined) {
            let copy = Object.assign({}, session);
            copy.x_relative = copy.pixelOffSetStart - 8;
            copy.z = parseInt(session.z + 41);
            this.add_event(ob_scene_index, band_name, background, color, copy, image);
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
        } else
            ob_material = this.track[ob_scene_index](new THREE.MeshBasicMaterial({color: color}));

        let ob_session = this.track[ob_scene_index](new THREE.Mesh(this.track[ob_scene_index](new THREE.BoxGeometry(session.width, session.height, 10)), ob_material));
        ob_session.position.set(session.x_relative, session.y, session.z);
        ob_session.pos_x = session.x_relative;
        ob_session.pos_y = session.y;
        ob_session.pos_z = session.z;
        ob_session.data = session;
        //this.ob_scene[ob_scene_index].add(ob_session);
        let ob_band = this.ob_scene[ob_scene_index].getObjectByName(band_name);
        if (ob_band !== undefined) {
            ob_band.add(ob_session);
        }
        if (ob_debug_ADD_SESSION_WEBGL_OBJECT) console.log("OB_TIMELINE.Session(" + band_name + "," + session.x + "," +
            session.y + "," + session.z + "," + session.width + "," + session.height + "," + session.color + ")");
        return ob_session;
    };
    OB_TIMELINE.prototype.removeSession = function (ob_scene_index, band_name, session_id) {
        let ob_band = this.ob_scene[ob_scene_index].getObjectByName(band_name);
        if (ob_band !== undefined) {
            ob_band.remove(session_id);
        }
        if (ob_debug_REMOVE_WEBGL_OBJECT) console.log("removeEvent(" + band_name + "+event_id=" + session_id + ")");
    };

    OB_TIMELINE.prototype.load_texture = function (image) {
        if (image === undefined || ob_texture === undefined) return undefined;
        return ob_texture.get(image);
    }

    OB_TIMELINE.prototype.add_event = function (ob_scene_index, band_name, background, color, session, image) {
        let geometry, material, ob_event;
        let texture = this.load_texture(image);
        if (texture === undefined) {
            geometry = this.track[ob_scene_index](new THREE.SphereGeometry(session.size));
            material = this.track[ob_scene_index](new THREE.MeshBasicMaterial({color: color}));
        } else {
            geometry = this.track[ob_scene_index](new THREE.PlaneGeometry(16, 16));
            texture.minFilter = THREE.LinearFilter;
            material = this.track[ob_scene_index](new THREE.MeshBasicMaterial({
                map: texture,
                color: background,
                transparent: true,
                opacity: 1
            }));
        }
        ob_event = this.track[ob_scene_index](new THREE.Mesh(geometry, material));
        ob_event.position.set(session.x_relative, session.y, session.z);
        ob_event.pos_x = session.x_relative;
        ob_event.pos_y = session.y;
        ob_event.pos_z = session.z;
        ob_event.data = session;

        this.ob_scene[ob_scene_index].add(ob_event);

        let ob_band = this.ob_scene[ob_scene_index].getObjectByName(band_name);
        if (ob_band !== undefined) {
            ob_band.add(ob_event);
        }
        if (ob_debug_ADD_EVENT_WEBGL_OBJECT) console.log("OB_TIMELINE.ob_addEvent(" + band_name + "," + x + "," + y + "," + z + "," + size + "," + color + ")");
        return ob_event;
    };
    OB_TIMELINE.prototype.removeEvent = function (ob_scene_index, band_name, event_id) {
        let ob_band = this.ob_scene[ob_scene_index].getObjectByName(band_name);
        if (ob_band !== undefined) {
            ob_band.remove(event_id);
        }
        if (ob_debug_REMOVE_WEBGL_OBJECT) console.log("OB_TIMELINE.removeEvent(" + band_name + "+event_id=" + event_id + ")");
    };
    OB_TIMELINE.prototype.add_segment = function (ob_scene_index, band_name, x, y, z, size, color, dashed) {
        if (color === undefined) {
            color = this.track[ob_scene_index](new THREE.Color("rgb(114, 171, 173)"));
        }
        let points = [];
        points.push(new THREE.Vector3(x, y, z));
        points.push(new THREE.Vector3(x, y - size, z));
        let geometry = this.track[ob_scene_index](new THREE.BufferGeometry().setFromPoints(points));
        let material = this.track[ob_scene_index](new THREE.LineDashedMaterial({
            color: color,
            linewidth: 1,
            dashSize: 2,
            gapSize: 4,
        }));
        let segment = this.track[ob_scene_index](new THREE.LineSegments(geometry, material));
        if (dashed) segment.computeLineDistances();
        let ob_band = this.ob_scene[ob_scene_index].getObjectByName(band_name);
        if (ob_band !== undefined) {
            ob_band.add(segment);
        }
        if (ob_debug_ADD_WEBGL_OBJECT) console.log("OB_TIMELINE.add_segment(" + band_name + "," + x + "," + y + "," + z + "," + size + "," + color + ")");
    };

    OB_TIMELINE.prototype.remove_segments = function (ob_scene_index, band_name) {
        let ob_band = this.ob_scene[ob_scene_index].getObjectByName(band_name);
        if (ob_band !== undefined) {
            ob_band.children = [];
        }
        if (ob_debug_REMOVE_WEBGL_OBJECT) console.log("OB_TIMELINE.remove_segments(" + band_name + ")");
    };

    OB_TIMELINE.prototype.add_line_current_time = function (ob_scene_index, date, color) {
        if (color === undefined) {
            color = this.track[ob_scene_index](new THREE.Color("rgb(243,23,51)"));
        }

        let ob_x;
        for (let i = 0; i < this.ob_scene[ob_scene_index].bands.length; i++) {
            ob_x = this.dateToPixelOffSet(ob_scene_index, date,
                this.ob_scene[ob_scene_index].bands[i].gregorianUnitLengths,
                this.ob_scene[ob_scene_index].bands[i].intervalPixels);
            if (ob_x.isNaN) return;
            this.add_segment(ob_scene_index, this.ob_scene[ob_scene_index].bands[i].name, ob_x,
                this.ob_scene[ob_scene_index].bands[i].height / 2, 20,
                this.ob_scene[ob_scene_index].bands[i].heightMax, color, false);
            this.add_segment(ob_scene_index, this.ob_scene[ob_scene_index].bands[i].name, ob_x + 0.45,
                this.ob_scene[ob_scene_index].bands[i].height / 2, 20,
                this.ob_scene[ob_scene_index].bands[i].heightMax, this.ob_scene[ob_scene_index].bands[i].color, false);
            this.add_segment(ob_scene_index, this.ob_scene[ob_scene_index].bands[i].name, ob_x,
                -this.ob_scene[ob_scene_index].bands[i].height / 2, 20,
                this.ob_scene[ob_scene_index].bands[i].heightMax, color, false);
            this.add_segment(ob_scene_index, this.ob_scene[ob_scene_index].bands[i].name, ob_x + 0.45,
                -this.ob_scene[ob_scene_index].bands[i].height / 2, 20,
                this.ob_scene[ob_scene_index].bands[i].heightMax,
                this.ob_scene[ob_scene_index].bands[i].color, false);
        }
    };

    OB_TIMELINE.prototype.add_text_sprite = function (ob_scene_index, ob_object, text, x, y, z, fontSize, fontStyle,
                                                      fontWeight, color, fontFamily, backgroundColor) {
        if (color === undefined) {
            color = this.track[ob_scene_index](new THREE.Color("rgb(114, 171, 173)"));
        }
        let ob_sprite = this.track[ob_scene_index](new THREE.TextSprite({
            alignment: this.font_align,
            backgroundColor: backgroundColor,
            color: color,
            fontFamily: fontFamily,
            fontSize: parseInt(fontSize),
            fontStyle: fontStyle,
            fontVariant: 'normal',
            padding: 0.15,
            fontWeight: fontWeight,
            text: [
                text,
            ].join('\n'),
        }));
        if (this.ob_camera_type === "Orthographic") {
            ob_sprite.position.set(x, y, z);
            ob_sprite.pos_x = x;
            ob_sprite.pos_y = y;
            ob_sprite.pos_z = z;
        } else {
            ob_sprite.position.set(x - 32, y, text.toString().length * 3.2);
            ob_sprite.pos_x = x - 32;
            ob_sprite.pos_y = y;
            ob_sprite.pos_z = text.toString().length * 3.2;
        }

        if (ob_object !== undefined) {
            ob_object.add(ob_sprite);
        }
        if (ob_debug_ADD_WEBGL_OBJECT) console.log("OB_TIMELINE.TextSprite(" + ob_object + "," + text + "," + x + "," + y + "," + z + "," + size + "," + color + ")");
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
    }
    OB_TIMELINE.prototype.loadJSON = function () {
        if (this.data === undefined) return;
        let that = this;
        that.request = new XMLHttpRequest();
        that.request.open('GET', that.data);
        that.request.responseType = 'text'; // now we're getting a string!
        that.request.send();

        that.request.onload = function () {
            let sessions = that.request.response; // get the string from the response
            try {
                that.ob_scene[that.ob_render_index].sessions = eval('(' + (sessions) + ')');
                that.update_scenes(that.ob_render_index, that.header, that.params, that.ob_scene[that.ob_render_index].bands,
                    that.ob_scene[that.ob_render_index].model, that.ob_scene[that.ob_render_index].sessions,
                    that.ob_camera_type, null, false);
            } catch (err) {
                console.log("loadJSON - no file to load");
            }
        };
    };

    function getFileExtension(fileName) {
        let matches = fileName && fileName.match(/\.([^.]+)$/);
        if (matches) {
            return matches[1].toLowerCase();
        }
        return '';
    }

    OB_TIMELINE.prototype.ob_setListeners = function (ob_scene_index) {
        let that = this;

        this.ob_scene[ob_scene_index].dragControls =
            this.track[ob_scene_index](new THREE.DragControls(this.ob_scene[ob_scene_index].objects,
                this.ob_scene[ob_scene_index].ob_camera, this.ob_scene[ob_scene_index].ob_renderer.domElement));
        this.ob_scene[ob_scene_index].dragControls.addEventListener('dragstart', function (e) {
            clearInterval(that.ob_interval_clock);
            clearInterval(that.ob_scene[that.ob_render_index].ob_interval_move);

            //if (that.ob_controls !== undefined) that.ob_controls.enabled = false;
            let ob_obj = that.ob_scene[that.ob_render_index].getObjectById(e.object.id);
            if (ob_obj === undefined) return;
            if (ob_obj.position !== undefined)
                ob_obj.dragstart_source = ob_obj.position.x;
            else
                ob_obj.dragstart_source = 0;
            if (ob_obj.sortBy !== undefined && ob_obj.sortBy === "true") {
                ob_obj.position.set(ob_obj.pos_x, ob_obj.pos_y, ob_obj.pos_z);
                return;
            } else if (ob_obj.type.match(/Mesh/) && ob_obj.name.match(/zone_/)) {
                that.move_zone(that.ob_render_index, ob_obj.parent.name, ob_obj.name, ob_obj.position.x, ob_obj.pos_x, ob_obj.pos_y, ob_obj.pos_z, true);
            } else if (ob_obj.type.match(/Mesh/) && ob_obj.name.match(/_band_/)) {
                that.move_band(that.ob_render_index, ob_obj.name, ob_obj.position.x, ob_obj.pos_y, ob_obj.pos_z, false);
                that.ob_marker.style.visibility = "visible";
                that.ob_time_marker.style.visibility = "visible";
            } else if (ob_obj.type.match(/Mesh/) && ob_obj.name === "") {
                that.move_session(ob_obj, ob_obj.pos_x, ob_obj.pos_y, ob_obj.pos_z);
            } else {
                ob_obj.position.set(ob_obj.pos_x, ob_obj.pos_y, ob_obj.pos_z);
            }
            that.ob_render(that.ob_render_index);

            if (ob_debug_MOVE_WEBGL_OBJECT) console.log("dragstart :" + that.name + " - " + ob_obj.type + " - " + ob_obj.name);
            //console.log("dragControls.addEventListener('dragstart'," + e.object.name + " ob_obj.dragstart_source=" + ob_obj.dragstart_source + ")");
        });
        this.ob_scene[ob_scene_index].dragControls.addEventListener('dragend', function (e) {
            //if (that.ob_controls !== undefined) that.ob_controls.enabled = true;
            let ob_obj = that.ob_scene[that.ob_render_index].getObjectById(e.object.id);
            if (ob_obj === undefined) return;
            if (ob_obj.sortBy !== undefined && ob_obj.sortBy === "true") {
                ob_obj.position.set(ob_obj.pos_x, ob_obj.pos_y, ob_obj.pos_z);
                return;
            } else if (ob_obj.type.match(/Mesh/) && ob_obj.name.match(/zone_/)) {
                that.move_band(that.ob_render_index, ob_obj.parent.name, ob_obj.parent.position.x, ob_obj.parent.pos_y, ob_obj.parent.pos_z, true);
                //
                //
                // that.move_zone(that.ob_render_index, ob_obj.parent.name, ob_obj.name, ob_obj.parent.position.x, ob_obj.pos_x, ob_obj.pos_y, ob_obj.pos_z, false);
                //console.log("-------zone-------dragControls.addEventListener('dragend'," + ob_obj.name + " ---" + ob_obj.position.x + " ::: " + ob_obj.parent.name + " ---" + ob_obj.parent.position.x + ")");
            } else if (ob_obj.type.match(/Mesh/) && ob_obj.name.match(/_band_/)) {
                that.move_band(that.ob_render_index, ob_obj.name, ob_obj.position.x, ob_obj.pos_y, ob_obj.pos_z, true);
                that.ob_marker.style.visibility = "visible";
                that.ob_time_marker.style.visibility = "visible";
            } else if (ob_obj.type.match(/Mesh/) && ob_obj.name === "") {
                that.move_session(ob_obj, ob_obj.position.x, ob_obj.pos_y, ob_obj.pos_z);
                that.ob_open_descriptor(that.ob_render_index, ob_obj.data);
                return;
            } else {
                ob_obj.position.set(ob_obj.pos_x, ob_obj.pos_y, ob_obj.pos_z);
            }
            that.ob_render(that.ob_render_index);
            if (ob_debug_MOVE_WEBGL_OBJECT) console.log("dragend :" + that.name + " - " + ob_obj.type + " - " + ob_obj.name);

            // Update scene according the new bands position
            that.ob_scene[that.ob_render_index].date = that.ob_markerDate.toString().substring(0, 24) + " UTC";
            that.ob_scene[that.ob_render_index].date_cal = that.ob_markerDate;
            that.ob_scene[that.ob_render_index].show_calendar = true;
            let ob_source = ob_obj.position.x;
            let ob_drag_end_source = ob_obj.position.x;
            let ob_speed = (ob_obj.dragstart_source - ob_source) / 60;

            if (that.data && that.data.match(/^(http?):\/\//) ||
                that.data.match(/^(wss?|ws):\/\/[^\s$.?#].[^\s]*$/) ||
                that.data && that.data.match(/^(https?):\/\//)) {
                that.data_head = that.data.split("?");

                clearInterval(that.ob_scene[that.ob_render_index].ob_interval_move);
                that.ob_scene[that.ob_render_index].ob_interval_move = setInterval(ob_move, 5);

                function ob_move() {
                    //console.log("ob_move - ob_render_index=" + that.ob_render_index + " - ob_interval_move=" + that.ob_scene[that.ob_render_index].ob_interval_move);
                    if (that.ob_scene[that.ob_render_index].ob_interval_move === undefined) return;
                    if (ob_obj.dragstart_source >= ob_source - 5 && ob_obj.dragstart_source <= ob_source + 1) {
                        clearInterval(that.ob_scene[that.ob_render_index].ob_interval_move);
                    } else {
                        if (ob_speed > 0)
                            ob_speed = ob_speed - 0.0025;
                        else
                            ob_speed = ob_speed + 0.0025;
                        if (Math.round(ob_speed) === 0)
                            clearInterval(that.ob_scene[that.ob_render_index].ob_interval_move);

                        if (ob_obj.dragstart_source <= ob_source)
                            ob_drag_end_source = ob_drag_end_source - ob_speed;
                        else
                            ob_drag_end_source = ob_drag_end_source - ob_speed;

                        if (ob_obj.name.match(/zone_/)) {
                            that.move_zone(that.ob_render_index, ob_obj.parent.name, ob_obj.name, ob_drag_end_source, ob_obj.pos_x, ob_obj.pos_y, ob_obj.pos_z, true);
                        } else {
                            that.move_band(that.ob_render_index, ob_obj.name, ob_drag_end_source, ob_obj.pos_y,
                                ob_obj.pos_z, true);
                            that.update_scenes(that.ob_render_index, that.header, that.params,
                                that.ob_scene[that.ob_render_index].bands, that.ob_scene[that.ob_render_index].model,
                                that.ob_scene[that.ob_render_index].sessions, that.ob_camera_type, ob_obj, true);
                        }
                    }
                }
            } else {
                clearInterval(that.ob_scene[that.ob_render_index].ob_interval_move);
                that.ob_scene[that.ob_render_index].ob_interval_move = setInterval(ob_move2, 5);

                function ob_move2() {
                    if (that.ob_scene[that.ob_render_index].ob_interval_move === undefined) return;
                    if (ob_obj.dragstart_source >= ob_source - 5 && ob_obj.dragstart_source <= ob_source + 1) {
                        clearInterval(that.ob_scene[that.ob_render_index].ob_interval_move);
                    } else {
                        if (ob_speed > 0)
                            ob_speed = ob_speed - 0.0025;
                        else
                            ob_speed = ob_speed + 0.0025;
                        if (Math.round(ob_speed) === 0)
                            clearInterval(that.ob_scene[that.ob_render_index].ob_interval_move);

                        if (ob_obj.dragstart_source <= ob_source)
                            ob_drag_end_source = ob_drag_end_source - ob_speed;
                        else
                            ob_drag_end_source = ob_drag_end_source - ob_speed;

                        if (ob_obj.name.match(/zone_/)) {
                            that.move_zone(that.ob_render_index, ob_obj.parent.name, ob_obj.name, ob_drag_end_source, ob_obj.pos_x, ob_obj.pos_y, ob_obj.pos_z, true);
                        } else {
                            that.move_band(that.ob_render_index, ob_obj.name, ob_drag_end_source, ob_obj.pos_y,
                                ob_obj.pos_z, true);
                            that.update_scenes(that.ob_render_index, that.header, that.params,
                                that.ob_scene[that.ob_render_index].bands, that.ob_scene[that.ob_render_index].model,
                                that.ob_scene[that.ob_render_index].sessions, that.ob_camera_type, ob_obj, null, false);
                        }
                    }
                }
            }
            //console.log("dragControls.addEventListener('dragend'," + e.object.name + ")");
        });

        this.ob_scene[ob_scene_index].dragControls.addEventListener('drag', function (e) {
            let ob_obj = that.ob_scene[that.ob_render_index].getObjectById(e.object.id);
            if (ob_obj === undefined) return;
            if (ob_obj.sortBy !== undefined && ob_obj.sortBy === "true") {
                ob_obj.position.set(ob_obj.pos_x, ob_obj.pos_y, ob_obj.pos_z);
                return;
            } else if (ob_obj.type.match(/Mesh/) && ob_obj.name.match(/zone_/)) {
                that.move_zone(that.ob_render_index, ob_obj.parent.name, ob_obj.name, ob_obj.position.x, ob_obj.pos_x, ob_obj.pos_y, ob_obj.pos_z, true);
                that.ob_marker.style.visibility = "visible";
                that.ob_time_marker.style.visibility = "visible";
                //console.log("-------zone-------dragControls.addEventListener('drag'," + ob_obj.name + " : " + e.object.position.x + " : " + ob_obj.parent.name + ": " + ob_obj.parent.position.x + ")");
            } else if (ob_obj.type.match(/Mesh/) && ob_obj.name.match(/_band_/)) {
                that.move_band(that.ob_render_index, ob_obj.name, ob_obj.position.x, ob_obj.pos_y, ob_obj.pos_z, true);
                that.ob_marker.style.visibility = "visible";
                that.ob_time_marker.style.visibility = "visible";
                //console.log("-----band-------dragControls.addEventListener('drag'," + e.object.name + " :  " + ob_obj.position.x + ")");
            } else if (ob_obj.type.match(/Mesh/) && ob_obj.name === "") {
                that.move_session(ob_obj, ob_obj.position.x, ob_obj.pos_y, ob_obj.pos_z)
            } else {
                ob_obj.position.set(ob_obj.pos_x, ob_obj.pos_y, ob_obj.pos_z);
            }
            that.ob_render(that.ob_render_index);
            if (ob_debug_MOVE_WEBGL_OBJECT) console.log("drag :" + that.name + " - " + ob_obj.type +
                " - " + ob_obj.name);
        });
    };

    OB_TIMELINE.prototype.ob_set_scene = function (ob_scene_index) {
        if (this.ob_scene === undefined) {
            this.ob_scene = new Array(ob_MAX_SCENES);
            this.resTracker = new Array(ob_MAX_SCENES);
            this.track = new Array(ob_MAX_SCENES);
            this.original_bands = new Array(ob_MAX_SCENES);
        }

        let ob_sort_by = "NONE";
        for (let s = 0; s < this.ob_scene.length; s++) {
            if (this.ob_scene[s] === undefined) {
                // Tracking all objects which will be create in order to do full cleanup when needed.
                this.resTracker[s] = new ResourceTracker();
                this.track[s] = this.resTracker[s].track.bind(this.resTracker[s]);
                this.ob_scene[s] = this.track[s](new THREE.Scene());
                this.ob_scene[s].background = new THREE.Color(0x000000);
                this.ob_scene[s].objects = [];
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
    }

    OB_TIMELINE.prototype.ob_set_renderer = function (ob_scene_index) {
        if (this.ob_scene[ob_scene_index].ob_renderer === undefined) {
            this.ob_scene[ob_scene_index].ob_renderer = this.track[ob_scene_index](new THREE.WebGLRenderer({antialias: true}));
            this.ob_scene[ob_scene_index].ob_renderer.setClearColor(0xffffff, 1);
            this.ob_scene[ob_scene_index].ob_renderer.setPixelRatio(window.devicePixelRatio * 2);
            this.ob_scene[ob_scene_index].ob_renderer.shadowMap.enabled = true;
        }
        this.ob_timeline_body.appendChild(this.ob_scene[ob_scene_index].ob_renderer.domElement);
        this.ob_scene[ob_scene_index].ob_renderer.domElement.clientWidth = this.ob_scene[ob_scene_index].ob_width + "px";
        this.ob_scene[ob_scene_index].ob_renderer.domElement.clientHeight = this.ob_scene[ob_scene_index].ob_height + "px";
        this.ob_scene[ob_scene_index].ob_renderer.setSize(this.ob_scene[ob_scene_index].ob_width, this.ob_scene[ob_scene_index].ob_height);
    };

    OB_TIMELINE.prototype.ob_set_camera = function (ob_scene_index) {
        if (this.ob_camera_type === undefined) this.ob_camera_type = "Orthographic";
        if (this.ob_camera_type === "Orthographic") {
            this.ob_pos_orthographic_camera_x = 0;
            this.ob_pos_orthographic_camera_y = 0;
            this.ob_pos_orthographic_camera_z = this.ob_scene[ob_scene_index].ob_height;
            this.ob_scene[ob_scene_index].ob_camera =
                this.track[ob_scene_index](new THREE.OrthographicCamera(-this.ob_scene[ob_scene_index].ob_width / 2,
                    this.ob_scene[ob_scene_index].ob_width / 2, this.ob_scene[ob_scene_index].ob_height, 0,
                    -this.ob_scene[ob_scene_index].ob_width, this.ob_far));
            this.ob_scene[ob_scene_index].ob_camera.position.set(this.ob_pos_orthographic_camera_x, this.ob_pos_orthographic_camera_y,
                this.ob_pos_orthographic_camera_z);
            this.ob_scene[ob_scene_index].add(this.ob_scene[ob_scene_index].ob_camera);
            //this.ob_scene[ob_scene_index].ob_camera.lookAt(this.ob_lookAt_x, this.ob_lookAt_y, this.ob_lookAt_z);
        } else {
            this.ob_scene[ob_scene_index].ob_camera =
                this.track[ob_scene_index](new THREE.PerspectiveCamera(this.ob_fov,
                    this.ob_scene[ob_scene_index].ob_width / this.ob_scene[ob_scene_index].ob_height,
                    this.ob_near, this.ob_far));
            this.ob_scene[ob_scene_index].ob_camera.position.set(this.ob_pos_camera_x, this.ob_pos_camera_y, this.ob_pos_camera_z);
            this.ob_scene[ob_scene_index].add(this.ob_scene[ob_scene_index].ob_camera);
            this.ob_scene[ob_scene_index].ob_camera.lookAt(this.ob_lookAt_x, this.ob_lookAt_y, this.ob_lookAt_z);
            this.ob_scene[ob_scene_index].add(this.track[ob_scene_index](new THREE.AmbientLight(0xf0f0f0)));
            let light = this.track[ob_scene_index](new THREE.SpotLight(0xffffff, 1.5));
            light.position.set(0, 1500, 200);
            light.castShadow = true;
            //light.shadow = this.track[ob_scene_index](new THREE.LightShadow(new THREE.PerspectiveCamera(this.ob_fov, 1, 200, 2000)));
            light.shadow.bias = -0.000222;
            light.shadow.mapSize.width = 1024;
            light.shadow.mapSize.height = 1024;
            this.ob_scene[ob_scene_index].add(light);
        }
        // Set all listeners
        this.ob_setListeners(ob_scene_index);
        //requestAnimationFrame(this.animate);
        this.ob_render(ob_scene_index);
        //console.log("ob_set_camera() - camera:" + this.ob_camera_type);
    };

    OB_TIMELINE.prototype.animate = function () {
        ob_timelines.forEach(function (ob_timeline) {
            ob_timeline.ob_render(ob_timeline.ob_render_index);
        });
    };

    OB_TIMELINE.prototype.runUnitTestsMinutes = function (ob_scene_index) {
        let sessions = "{'dateTimeFormat': 'iso8601','events' : [";
        let ob_start, ob_end, ob_type, ob_title, ob_status;
        for (let i = 0; i < 200; i++) {
            ob_start = new Date(Date.now());
            ob_end = new Date(Date.now() + 10000);
            ob_type = "type1";
            ob_title = "session_" + i;
            ob_status = "SCHEDULED";
            if (i === 0) {
                ob_start = new Date(Date.now() + 320000);
                ob_end = new Date(Date.now() + 420000);
                ob_type = "type2";
                ob_title = "session_plus" + i;
            } else if (i === 2 || i === 78) {
                ob_start = new Date(Date.now() + 520000);
                ob_end = new Date(Date.now() + 705000);
                ob_type = "type1";
                ob_title = "session_plus" + i;
            } else if (i === 1 || i === 3) {
                ob_start = new Date(Date.now());
                ob_end = "";
                ob_title = "event___" + i;
            } else if (i === 4) {
                ob_type = "type3";
                ob_start = new Date(Date.now());
                ob_end = new Date(Date.now() + 100000);
                ob_title = "session_current_time_" + i;
            } else if (i === 8) {
                ob_type = "type3";
                ob_start = new Date(Date.now());
                ob_end = new Date(Date.now() + 1000000);
                ob_title = "session_current_time_" + i;
            } else if (i === 6 || i === 19) {
                ob_type = "type2";
                ob_start = new Date(Date.now() - 15000);
                ob_end = new Date(Date.now() - 10000);
            } else if (i === 7 || i === 27) {
                ob_type = "type2";
                ob_start = new Date(Date.now() - 155000);
                ob_end = new Date(Date.now() - 35000);
                ob_title = "s" + i;
            } else if (i === 10) {
                ob_start = new Date(Date.now());
                ob_end = new Date(Date.now() + (10 * 310000));
            } else if (i === 8 || i === 9) {
                ob_start = new Date(Date.now() - 590000);
                ob_end = new Date(Date.now() - 300000);
                ob_type = "type2";
                ob_title = "s" + i;
            } else if (i === 14) {
                ob_start = new Date(Date.now() - 590000);
                ob_end = new Date(Date.now() - 300000);
                ob_type = "type3";
                ob_title = "session" + i;
            } else if (i === 15) {
                ob_start = new Date(Date.now() - 590000);
                ob_end = new Date(Date.now() - 3000000);
                ob_type = "type2";
                ob_title = "1234567890123456789012345678901234567890_" + i;
            } else if (i === 20 || i === 21 || i === 22) {
                ob_start = new Date(Date.now() - 410000);
                ob_end = new Date(Date.now() - 400000);
                ob_title = "session_plusplus" + i;
            } else if (i === 27 || i === 31 || i === 32) {
                ob_start = new Date(Date.now() - 520000);
                ob_end = new Date(Date.now() - 515000);
                ob_type = "type2";
            } else if (i === 18) {
                ob_start = new Date(Date.now() + i * 5000);
                ob_end = "";
                ob_title = "event_" + i;
            } else if (i === 17 || i === 26 || i === 112 || i === 132 || i === 355) {
                ob_start = new Date(Date.now());
                ob_end = new Date(Date.now() + (10 * 310000));
                ob_type = "type3";
                ob_status = "ABORTED";
            } else if (i === 33 || i === 71 || i === 100 || i === 102 || i === 355) {
                ob_start = new Date(Date.now() + 310000);
                ob_end = new Date(Date.now() + (2 * 310000));
                ob_type = "type1";
                ob_title = "Session______________________________________" + i;
            } else if (i === 69) {
                ob_start = new Date(Date.now() + (30000));
                ob_end = new Date(Date.now() + (110000));
                ob_title = "Session++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++" + i;
            } else if (i === 44 || i === 57 || i === 61 || i === 89 || i === 190 || i === 342 || i === 482) {
                ob_start = new Date(Date.now() + i * 5000);
                ob_end = "";
                ob_type = "type2";
                ob_title = "event_plusplusplusplusplusplus" + i;
            } else if (i > 100 && i < 110) {
                ob_type = "type3" + i;
            } else if (i > 200 && i < 210) {
                ob_type = "type2" + i;
            } else if (i > 300 && i < 310) {
                ob_type = "type1" + i;
            } else if (i % 2 === 0 && i < 400) {
                ob_start = new Date(Date.now() + i * 5000);
                ob_end = new Date(Date.now() + i * 5100);
                ob_title = "session__" + i;
                ob_status = "FINISHED";
            } else if (i > 400) {
                if (i % 2 === 0) {
                    ob_start = new Date(Date.now() - i * 3000);
                    ob_end = new Date(Date.now() - i * 2800);
                    ob_title = "sessionPast" + i;
                } else {
                    ob_start = new Date(Date.now() - i * 2950);
                    ob_end = "";
                    ob_title = "eventPast" + i;
                }
            } else {
                ob_start = new Date(Date.now() + i * 5000);
                ob_end = "";
                ob_title = "event_" + i;
                ob_status = "RUNNING";
            }

            sessions += "{";
            sessions += "'id': '" + i + "',";
            sessions += "'start': '" + ob_start + "',";
            sessions += "'end': '" + ob_end + "',";
            sessions += "'data': {";
            sessions += "'title': '" + ob_title + "',";
            sessions += "'type': '" + ob_type + "',";
            sessions += "'status': '" + ob_status + "',";
            sessions += "'duration': 'true',";
            sessions += "'priority': '10',";
            sessions += "'tolerance': '5',";
            sessions += "'description': 'UnitTestsMinutes',";
            sessions += "}},";
        }
        sessions += "]}";
        this.ob_scene[ob_scene_index].sessions = eval('(' + (sessions) + ')');

        this.update_scenes(ob_scene_index, this.header, this.params, this.ob_scene[ob_scene_index].bands,
            this.ob_scene[ob_scene_index].model, this.ob_scene[ob_scene_index].sessions,
            this.ob_camera_type, null, false);
    };
    OB_TIMELINE.prototype.runUnitTestsHours = function (ob_scene_index) {
        console.log("start runUnitTestsHours at:" + Date() + " - " + new Date().getMilliseconds());
        let sessions = "{'dateTimeFormat': 'iso8601','events' : [";
        let ob_start, ob_end, ob_type, ob_title, ob_status;
        for (let i = 0; i < 50; i++) {
            ob_start = new Date(Date.now());
            ob_end = new Date(Date.now() + 10000);
            ob_type = "type1";
            ob_title = "session_SESSION" + i;
            ob_status = "SCHEDULED";
            if (i === 0 || i === 11) {
                ob_start = new Date(Date.now());
                ob_end = new Date(Date.now() + 1015000);
                ob_type = "type2";
                ob_title = "session SESSION T0";
            } else if (i === 4 || i === 8 || i === 12 || i === 14 || i === 41 || i === 71 || i === 79) {
                ob_start = new Date(Date.now() + i * 600000);
                ob_end = new Date(Date.now() + i * 700000);
                ob_type = "type4";
                ob_title = "session_SESSION_long_long_LONG_long_long_long_long long_long_LONG_long_long_long_long" + i;
                ob_status = "FINISHED";
            } else if (i === 3 || i === 9 || i === 18 || i === 59 || i === 53 || i === 43 || i === 29 || i === 33 ||
                i === 89 || i === 83 || i === 61 || i === 47) {
                ob_start = new Date(Date.now() + i * 300000);
                ob_end = new Date(Date.now() + i * 650000);
                ob_type = "type3";
                ob_title = "session" + i;
            } else if (i % 17 === 0) {
                ob_start = new Date(Date.now() + i * 50000);
                ob_end = "";
                ob_type = "type4";
                ob_title = "s" + i;
            } else if (i % 16 === 0) {
                ob_start = new Date(Date.now() + i * 50000);
                ob_end = "";
                ob_type = "type1";
                ob_title = "s" + i;
            } else if (i % 11 === 0) {
                ob_start = new Date(Date.now() + i * 50000);
                ob_end = "";
                ob_type = "type2";
                ob_title = "s" + i;
            } else if (i % 10 === 0) {
                ob_start = new Date(Date.now() + i * 50000);
                ob_end = "";
                ob_type = "type3";
                ob_title = "s" + i;
                ob_status = "RUNNING";
            } else if (i % 7 === 0) {
                ob_start = new Date(Date.now() + i * 50000);
                ob_end = "";
                ob_type = "type1";
                ob_title = "s" + i;
            } else if (i % 5 === 0) {
                ob_start = new Date(Date.now() + i * 50000);
                ob_end = "";
                ob_type = "type2";
                ob_title = "s" + i;
                ob_status = "ABORTED";
            } else if (i % 3 === 0) {
                ob_start = new Date(Date.now() + i * 50000);
                ob_end = new Date(Date.now() + i * 65000);
                ob_type = "type1";
                ob_title = "session_long_long_LONG_long_long_long_long_LONG_long_long_long_long" + i;
            } else if (i % 9 === 0) {
                ob_start = new Date(Date.now() + i * 300000);
                ob_end = new Date(Date.now() + i * 650000);
                ob_type = "type1";
                ob_title = "session" + i;
            } else if (i % 6 === 0) {
                ob_start = new Date(Date.now() + i * 300000);
                ob_end = new Date(Date.now() + i * 650000);
                ob_type = "type2";
                ob_title = "session" + i;
            } else if (i % 11 === 0) {
                ob_start = new Date(Date.now() + i * 300000);
                ob_end = new Date(Date.now() + i * 650000);
                ob_type = "type3";
                ob_title = "session" + i;
            } else if (i % 4 === 0) {
                ob_start = new Date(Date.now() + i * 300000);
                ob_end = new Date(Date.now() + i * 650000);
                ob_type = "type4";
                ob_title = "session" + i;
            } else if (i % 3 === 0) {
                ob_start = new Date(Date.now() + i * 300000);
                ob_end = new Date(Date.now() + i * 650000);
                ob_type = "type2";
                ob_title = "session" + i;
                ob_status = "FAILED";
            } else if (i % 2 === 0) {
                ob_start = new Date(Date.now() + i * 300000);
                ob_end = new Date(Date.now() + i * 650000);
                ob_type = "type2";
                ob_title = "session" + i;
            } else {
                ob_start = new Date(Date.now() + i * 650000);
                ob_end = "";
                ob_title = "event_" + i;
                ob_type = "type1";
            }

            sessions += "{";
            sessions += "'id': '" + i + "',";
            sessions += "'start': '" + ob_start + "',";
            sessions += "'end': '" + ob_end + "',";
            sessions += "'data': {";
            sessions += "'title': '" + ob_title + "',";
            sessions += "'type': '" + ob_type + "',";
            sessions += "'status': '" + ob_status + "',";
            sessions += "'duration': 'true',";
            sessions += "'priority': '10',";
            sessions += "'tolerance': '5',";
            sessions += "'description': 'UnitTestsHours',";
            sessions += "}},";
        }
        sessions += "]}";
        this.ob_scene[ob_scene_index].sessions = eval('(' + (sessions) + ')');

        this.update_scenes(ob_scene_index, this.header, this.params, this.ob_scene[ob_scene_index].bands,
            this.ob_scene[ob_scene_index].model, this.ob_scene[ob_scene_index].sessions,
            this.ob_camera_type, null, false);
        console.log("Stop runUnitTestsHours at:" + Date() + " - " + new Date().getMilliseconds());
    };
    OB_TIMELINE.prototype.load_data = function (ob_scene_index) {
        if (this.ob_scene[ob_scene_index].ob_interval_move !== undefined)
            clearInterval(this.ob_scene[ob_scene_index].ob_interval_move);

        if (this.data === undefined) {
            this.update_scenes(ob_scene_index, this.header, this.params, this.ob_scene[ob_scene_index].bands,
                this.ob_scene[ob_scene_index].model, this.ob_scene[ob_scene_index].sessions,
                this.ob_camera_type, null, false);
            return;
        }
        if (this.data === "unit_tests_minutes") {
            this.ob_not_connected();
            this.runUnitTestsMinutes(ob_scene_index);
            return;
        }
        if (this.data === "unit_tests_hours") {
            this.ob_not_connected();
            this.runUnitTestsHours(ob_scene_index);
            return;
        }

        if (!this.data.includes(".json") && !this.data.includes("=test") && !this.data.includes("UTC")) {
            this.ob_not_connected();
            this.data_head = this.data.split("?");
            this.data = this.data_head[0] + "?startDate=" + this.minDate + "&endDate=" + this.maxDate +
                "&filter=" + this.ob_filter_value + "&search=" + this.ob_search_value;
        }
        let ob_ws = this.data && this.data.match(/^(wss?|ws):\/\/[^\s$.?#].[^\s]*$/);
        if (ob_ws !== null && ob_ws.length === 2) {
            let that = this;
            let ws = new WebSocket(ob_ws[0]);
            console.log(ob_ws[0]);
            ws.onopen = function () {
                console.log("WS - onopen!");
                ws.send("Open WebSocket");
            };
            ws.onmessage = function (e) {
                that.ob_connected();
                that.ob_scene[that.ob_scene_index].sessions = eval('(' + (e.data) + ')');
                that.update_scenes(that.ob_scene_index, that.header, that.params, that.ob_scene[that.ob_scene_index].bands,
                    that.ob_scene[that.ob_scene_index].model, that.ob_scene[that.ob_scene_index].sessions,
                    that.ob_camera_type, null, false);
            };
            ws.onerror = function () {
                that.ob_not_connected();
            }
            ws.onclose = function () {
                // connection closed, discard old websocket and create a new one in 5s
                console.log("WS - onclose!");
                that.ob_not_connected();
                that.ws = null;
                setTimeout(that.load_data(that.ob_scene_index), 10000);
            }
            return;
        }

        //let ob_url = this.data && this.data.match(/^(http?|chrome):\/\/[^\s$.?#].[^\s]*$/);
        let ob_url = this.data && this.data.match(/^(http?):\/\//);
        if (ob_url !== null && ob_url.length === 2) {
            let that = this;
            fetch(this.data, {
                method: 'GET',
                dataType: 'json',
                headers: {
                    "Accept": "application/json",
                    'Content-Type': 'application/json',
                }
            })
                .then(response => {
                    if (response.ok) {
                        that.ob_connected();
                        console.log("Response OK!");
                        return response.json();
                    } else {
                        console.log("Response not OK!");
                    }
                })
                .then((json) => {
                    that.ob_scene[that.ob_scene_index].sessions = json;
                    that.update_scenes(that.ob_render_index, that.header, that.params,
                        that.ob_scene[that.ob_scene_index].bands, that.ob_scene[that.ob_scene_index].model,
                        that.ob_scene[that.ob_scene_index].sessions, that.ob_camera_type, null, false);
                }).catch(err => {
                console.log('Error message:', err.statusText)
                this.ob_not_connected();
            });
            return;
        }
        //let ob_url_secure = this.data && this.data.match(/^(https?|chrome):\/\/[^\s$.?#].[^\s]*$/);
        let ob_url_secure = this.data && this.data.match(/^(https?):\/\//);
        if (ob_url_secure !== null && ob_url_secure.length === 2) {
            if (!!window.EventSource && this.data.includes("sse")) {
                let that = this;

                //Close the previous eventSource request to notify the server to do  all cleanup on the server side;
                if (this.eventSource !== undefined)
                    this.eventSource.close();
                let eventSource = new EventSource(this.data, {
                    // If clients have set Access-Control-Allow-Credentials to true, the openbexi.timeline.server
                    // will not permit the use of credentials and access to resource by the client will be blocked
                    // by CORS policy withCredentials: true
                });
                this.eventSource = eventSource;
                eventSource.onmessage = function (e) {
                    //console.log('onmessage: Receiving sessions:' + e.openbexi.timeline.data);
                    that.ob_connected();
                    that.ob_scene[that.ob_scene_index].sessions = eval('(' + (e.data) + ')');
                    that.update_scenes(that.ob_scene_index, that.header, that.params,
                        that.ob_scene[that.ob_scene_index].bands, that.ob_scene[that.ob_scene_index].model,
                        that.ob_scene[that.ob_scene_index].sessions, that.ob_camera_type, null, false);
                    //eventSource.close();
                };
                eventSource.onopen = function () {
                    that.ob_connected();
                };
                eventSource.onerror = function () {
                    // Very important: Do not close the session otherwise this client would not reconnect
                    //eventSource.close();
                    that.ob_not_connected();
                    console.log('SSE - onerror');
                    that.load_data(ob_scene_index);
                    console.log('SSE - reconnecting ...');
                }

            } else {
                let that = this;
                fetch(this.data, {
                    method: 'GET',
                    dataType: 'json',
                    headers: {
                        "Accept": "application/json",
                        'Content-Type': 'application/json',
                    }
                })
                    .then(response => {
                        if (response.ok) {
                            console.log("Response OK!");
                            this.ob_connected();
                            return response.json();
                        } else {
                            console.log("Response not OK!");
                        }
                    })
                    .then((json) => {
                        that.ob_scene[that.ob_scene_index].sessions = json;
                        that.update_scenes(that.ob_scene_index, that.header, that.params,
                            that.ob_scene[that.ob_scene_index].bands, that.ob_scene[that.ob_scene_index].model,
                            that.ob_scene[that.ob_scene_index].sessions, that.ob_camera_type, null, false);
                    }).catch(err => {
                    console.log('Error message:', err.statusText)
                    this.ob_not_connected();
                });
                return;
            }
            return;
        }

        let fileExtension = this.data && this.data.match(/\.([^.]+)$/);
        if (fileExtension !== null) {
            if (fileExtension[1].toLowerCase() === "json") {
                this.loadJSON();
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
            ob_timeline.ob_init(ob_timeline.ob_render_index);
        });
    }, false);
}

function ob_load_timeline(ob_timeline_instance) {
    ob_timelines.push(ob_timeline_instance);
    ob_timeline_instance.first_sync = true;
    ob_timeline_instance.ob_scene_index = 0;
    ob_timeline_instance.update_scenes(ob_timeline_instance.ob_scene_index, null, ob_timeline_instance.params,
        ob_timeline_instance.bands, ob_timeline_instance.model, ob_timeline_instance.sessions, null, null,
        true);
}