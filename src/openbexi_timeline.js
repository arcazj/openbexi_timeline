/* This notice must be untouched at all times.

Copyright (c) 2020 arcazj All rights reserved.
    OPENBEXI Timeline 0.9.1 beta

The latest version is available at http://www.openbexi.comhttps://github.com/arcazj/openbexi_timeline.

    This program is free software; you can redistribute it and/or
modify it under the terms of the GNU General Public License
as published by the Free Software Foundation; either version 2 and 3
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
            if (resource.dispose) {
                try {
                    resource.dispose();
                } catch (err) {
                }
            }
        }
        this.resources.clear();
    }
}

/*function WebSocketClient() {
    this.number = 0;	// Message number
    this.autoReconnectInterval = 5 * 1000;	// ms
}*/

function OB_TIMELINE() {

    OB_TIMELINE.prototype.ob_init = function () {

        // Tacking all objects which will be create in order to do full cleanup when needed.
        this.resTracker = new ResourceTracker();
        this.track = this.resTracker.track.bind(this.resTracker);

        // Set all timeline parameters:
        this.name = this.params[0].name;
        this.title = "";
        if (this.params[0].title !== undefined)
            this.title = this.params[0].title;
        if (this.ob_filter === undefined)
            this.ob_filter = "*";
        this.regex = "^(?=.*(?:--|--))(?!.*(?:--|--)).*$";

        this.camera = this.params[0].camera;
        this.ob_pos_camera_y = this.height / 2;
        if (this.height > 2000) {
            this.ob_pos_camera_x = -1500;
            this.ob_pos_camera_z = this.height / 2;
        } else if (this.height > 1000) {
            this.ob_pos_camera_x = -1000;
            this.ob_pos_camera_z = this.height / 2;
        } else {
            this.ob_pos_camera_x = -100;
            this.ob_pos_camera_z = this.height / 2;
        }
        this.ob_far = 100000;
        this.ob_near = 1;
        this.ob_fov = 70;
        this.ob_lookAt_x = 0;
        this.ob_lookAt_y = this.height / 2;
        this.ob_lookAt_z = 0;

        this.descriptor = this.params[0].descriptor;
        this.data = this.params[0].data;
        this.center = "center";
        this.font_align = "right";

        // -- set timeline date --
        try {
            this.timeZoneOffset = new Date().getTimezoneOffset();
            this.timeZone = "";
            if (this.params[0].date.includes("UTC"))
                this.timeZone = "UTC";
            if (this.params[0].timeZone === "UTC")
                this.timeZone = this.params[0].timeZone;

            this.startDateTime = Date.now();
            if (this.params[0].date !== undefined) {
                if (this.params[0].date === "current_time" || this.params[0].date === "Date.now()") {
                    if (this.timeZone === "UTC")
                        this.startDateTime = this.getUTCTime(Date.now())
                } else if (this.params[0].date.length === 4) {
                    this.startDateTime = this.getUTCFullYearTime(parseInt(this.params[0].date));
                } else {
                    this.startDateTime = this.getUTCTime(Date.parse(this.params[0].date));
                }
            } else {
                console.log("ob_init(): timeline date not defined - set to default :current date");
                if (this.timeZone === "UTC")
                    this.startDateTime = this.getUTCTime(Date.now())
            }
        } catch (err) {
            console.log("ob_init(): Wrong timeline date - set to default : current date");
            if (this.timeZone === "UTC")
                this.startDateTime = this.getUTCTime(Date.now())
        }

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
                this.height = parseInt(this.params[0].height);
            } else {
                console.log("ob_init(): timeline height not defined - set to default : 800");
                this.height = 800;
            }
        } catch (err) {
            console.log("ob_init(): Wrong timeline height - set to default : 800");
            this.height = 800;
        }
        // Height may have changed depending on how many sessions or events populated in the bands
        // So here we need to check the Timeline height changed
        let new_timeline_height = 0;
        for (let i = 0; i < this.bands.length; i++) {
            if (this.bands[i].height !== undefined) {
                if (this.bands[i].height === "auto") this.bands[i].height = "0";
                if (this.bands[i].minY !== undefined) {
                    new_timeline_height += Math.abs(this.bands[i].maxY) + Math.abs(this.bands[i].minY);
                }
            }
        }
        if (new_timeline_height !== 0)
            this.height = new_timeline_height;

        // -- set timeline width --
        try {
            if (this.params[0].width !== undefined) {
                this.width = parseInt(this.params[0].width);
            } else {
                console.log("ob_init(): timeline width not defined - set to default : 800");
                this.width = 800;
            }
        } catch (err) {
            console.log("ob_init(): Wrong timeline width - set to default : 800");
            this.width = 800;
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

        this.setGregorianUnitLengths();

        this.objects = [];

        // Save original bands setting
        if (this.original_bands === undefined)
            this.original_bands = Object.assign({}, this.bands);
        else {
            let ob_sortBy = this.bands[0].model[0].sortBy;
            this.bands = Object.assign([], this.original_bands);
            this.bands[0].model[0].sortBy = ob_sortBy;
            this.model = undefined;
        }
        this.set_bands();

        //console.log("ob_init(): top:" + this.top + " left:" + this.left + " width:" + this.width + " height:" + this.height);
        //if (this.ob_timeline_panel !== undefined)
        //console.log("ob_init(): panel.top:" + this.ob_timeline_panel.style.top + " panel.left:" + this.ob_timeline_panel.style.left + " panel.width:" + this.ob_timeline_panel.style.width + " panel.height:" + this.ob_timeline_panel.style.height);
    };

    OB_TIMELINE.prototype.ob_apply_data_model = function () {
        try {
            this.model = eval(document.getElementById(this.name + "_model").innerHTML);
        } catch (err) {
        }
        this.update_scene(this.header, this.params, this.bands, this.model, this.sessions, this.camera);
    };
    OB_TIMELINE.prototype.ob_apply_bands_info = function () {
        try {
            this.bands = eval(document.getElementById(this.name + "_bands").innerHTML);
        } catch (err) {
        }
        this.update_scene(this.header, this.params, this.bands, this.model, this.sessions, this.camera);
    };
    OB_TIMELINE.prototype.ob_apply_timeline_info = function () {
        this.params[0].top = parseInt(document.getElementById(this.name + "_top").value);
        this.params[0].left = parseInt(document.getElementById(this.name + "_left").value);
        this.params[0].height = parseInt(document.getElementById(this.name + "_height").value);
        this.params[0].width = parseInt(document.getElementById(this.name + "_width").value);
        this.update_scene(this.header, this.params, this.bands, this.model, this.sessions, this.camera);
    };
    OB_TIMELINE.prototype.ob_apply_timeline_sorting = function () {
        try {
            let ob_sort_by = document.getElementById("ob_sort_by").value;
            this.bands[0].model[0].sortBy = document.getElementById("ob_sort_by").value;
            this.update_scene(this.header, this.params, this.bands, this.model, this.sessions, this.camera);
        } catch (err) {
        }
    };
    OB_TIMELINE.prototype.ob_apply_timeline_filter = function () {
        let ob_checked;
        try {
            for (let [key, value] of this.model.entries()) {
                let value_items = value.split(",");
                if (value_items.length > 1) {
                    for (let i = 0; i < value_items.length; i++) {
                        try {
                            ob_checked = document.getElementById(this.name + "_" + key + "_" + value_items[i]).checked;
                        } catch (err) {
                        }
                        if (ob_checked !== undefined && ob_checked === true) {
                            this.ob_filter += key + ":" + value_items[i] + " ";
                            this.ob_search_input.value = this.ob_filter;
                        }
                    }
                }
            }
            this.loadData();
            //this.update_scene(this.header, this.params, this.bands, this.model, this.sessions, this.camera);
        } catch (err) {
        }
    };
    OB_TIMELINE.prototype.ob_apply_orthographic_camera = function () {
        this.camera = "Orthographic";
        this.update_scene(this.header, this.params, this.bands, this.model, this.sessions, this.camera);
    };
    OB_TIMELINE.prototype.ob_apply_perspective_camera = function () {
        this.camera = "Perspective";
        this.update_scene(this.header, this.params, this.bands, this.model, this.sessions, this.camera);
    };
    OB_TIMELINE.prototype.ob_cancel_setting = function () {
        this.ob_remove_setting();
        this.update_scene(this.header, this.params, this.bands, this.model, this.sessions, this.camera);
    };

    OB_TIMELINE.prototype.ob_create_gui = function (place) {
        let that3 = this;
        let params = {
            Perspective: false,
            fov: this.ob_fov,
            far: this.ob_far,
            near: this.ob_near,
            x: this.ob_pos_camera_x,
            y: this.ob_pos_camera_y,
            z: this.ob_pos_camera_z,
            lookAt_x: this.ob_lookAt_x,
            lookAt_y: this.ob_lookAt_y,
            lookAt_z: this.ob_lookAt_z,
        };

        if (this.gui === undefined) {
            if (place === true)
                this.gui = new dat.GUI();
            else {
                this.gui = new dat.GUI({autoPlace: false});
                this.gui.domElement.id = this.name + '_gui';
            }

            this.gui.add(params, 'Perspective').onChange(function (value) {
                if (value === false) {
                    that3.camera = "Orthographic";
                    that3.ob_apply_orthographic_camera();
                } else {
                    that3.camera = "Perspective";
                    that3.ob_apply_perspective_camera();
                }
            });
            this.gui.add(params, 'fov', -300, 300).onChange(function (value) {
                that3.ob_fov = value;
                that3.ob_set_camera();
            });
            this.gui.add(params, 'far', 0, 10000).onChange(function (value) {
                that3.ob_far = value;
                that3.ob_set_camera();
            });
            this.gui.add(params, 'near', 0, 5).onChange(function (value) {
                that3.ob_near = value;
                that3.ob_set_camera();
            });
            this.gui.add(params, 'x', -300, 300).onChange(function (value) {
                that3.ob_pos_camera_x = value;
                that3.ob_set_camera();
            });
            this.gui.add(params, 'y', -300, 300).onChange(function (value) {
                that3.ob_pos_camera_y = value;
                that3.ob_set_camera();
            });
            this.gui.add(params, 'z', -2000, 2000).onChange(function (value) {
                that3.ob_pos_camera_z = value;
                that3.ob_set_camera();
            });
            this.gui.add(params, 'lookAt_x', -300, 300).onChange(function (value) {
                that3.ob_lookAt_x = value;
                that3.ob_set_camera();
            });
            this.gui.add(params, 'lookAt_y', -300, 300).onChange(function (value) {
                that3.ob_lookAt_y = value;
                that3.ob_set_camera();
            });
            this.gui.add(params, 'lookAt_z', -300, 300).onChange(function (value) {
                that3.ob_lookAt_z = value;
                that3.ob_set_camera();
            });

            this.ob_gui_div = document.createElement("div");
            this.ob_gui_div.id = this.name + "_gui";
            this.ob_gui_div.class = "ob_gui_div";
            this.ob_gui_div.style.position = "absolute";
            this.ob_gui_div.style.top = "0px";
            this.ob_gui_div.style.left = "80px";
            this.ob_gui_div.style.zIndex = "20";
            this.ob_gui_div.appendChild(this.gui.domElement);
            //this.gui.close();
            //this.gui.__proto__.constructor.toggleHide();
            return this.ob_gui_div;
        }
    };
    OB_TIMELINE.prototype.ob_create_sorting = function () {
        let ob_sorting_by = "NONE";
        let ob_filtering = "";
        this.ob_remove_descriptor();
        this.ob_remove_calendar();
        this.ob_remove_help();
        this.ob_remove_setting();
        try {
            ob_sorting_by = this.bands[0].model[0].sortBy;
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
            div.className = "ob_head_panel";
            div.id = this.name + '_setting';

            /*let ob_band_line_count = 20;
            try {
                ob_band_line_count = JSON.stringify(this.bands, null, 2).split('\n').length;
            } catch (err) {
            }

            let ob_model_line_count = 20;
            try {
                ob_model_line_count = JSON.stringify(this.model, null, 2).split('\n').length;
            } catch (err) {
            }*/

            let ob_build_all_sorting_options = "<option value='" + "NONE" + "'>" + "NONE" + "</option>\n";
            let ob_build_all_filtering_options = "<div>";
            try {
                for (let [key, value] of this.model.entries()) {

                    ob_build_all_sorting_options += "  <option value='" + key + "'>" + key + " </option>\n";

                    let value_items = value.split(",");
                    if (value_items.length > 1) {
                        ob_build_all_filtering_options += "<table><tr align=left ><td style='background:#CDCCCC;font-weight:bold;'>" + key + "</td><td></td><td></td><td></td></tr> \n";
                        let ob_tr;
                        for (let i = 0; i < value_items.length; i++) {
                            if (i === 0 || (i % 4) === 0) {
                                ob_build_all_filtering_options += "<tr>";
                                ob_tr = false;
                            }
                            ob_build_all_filtering_options += "<td><label>" + value_items[i] +
                                "<input type='checkbox' id= " + this.name + "_" + key + "_" + value_items[i] +
                                //" onchange=\"get_ob_timeline(\'" + this.name + "\').ob_apply_timeline_filter();\"" +
                                "></label></td>";
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
            } catch (err) {
            }
            ob_build_all_filtering_options += "</div>";

            div.innerHTML = "" +
                "<div style='padding:8px;text-align:center;'>Sorting & Filtering<\div>\n" +
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
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_apply_timeline_sorting();\" value='Apply' />\n" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_cancel_setting();\" value='Cancel' />\n" +
                "</fieldset>\n" +
                "<legend><span class='number'>2 - </span>Timeline Filtering " + ob_filtering + "</legend>\n" +
                "<fieldset>\n" +
                ob_build_all_filtering_options +
                "</fieldset>\n" +
                "<fieldset>" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_apply_timeline_filter();\" value='Apply Filtering' />\n" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_cancel_setting();\" value='Cancel' />\n" +
                "</fieldset>\n" +
                "</form>\n" +
                "<div class='ob_gui_iframe_container' id='" + this.name + "_gui_iframe_container' style='position:absolute;'> </div>\n" +
                "</div>";

            this.ob_timeline_right_panel.style.top = this.ob_timeline_panel.offsetTop + "px";
            this.ob_timeline_right_panel.style.left = this.ob_timeline_panel.offsetLeft + parseInt(this.ob_timeline_panel.style.width) + "px";
            this.ob_timeline_right_panel.appendChild(div);
            try {
                document.getElementById("ob_sort_by").value = this.bands[0].model[0].sortBy;
            } catch (err) {
            }

            if (this.camera === "Perspective") {
                let ob_gui = this.ob_create_gui(false);
                document.getElementById(this.name + "_gui_iframe_container").appendChild(ob_gui);
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
    OB_TIMELINE.prototype.ob_create_setting = function () {
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

            let ob_band_line_count = 20;
            try {
                ob_band_line_count = JSON.stringify(this.bands, null, 2).split('\n').length;
            } catch (err) {
            }

            let ob_model_line_count = 20;
            try {
                ob_model_line_count = JSON.stringify(this.model, null, 2).split('\n').length;
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
                "<input type='number' id=" + this.name + "_width value='" + this.width + "'>\n" +
                "<input type='label' disabled value='Height :'>\n" +
                "<input type='number' id=" + this.name + "_height value='" + this.height + "'>\n" +
                "</fieldset>\n" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_apply_timeline_info();\" value='Apply Timeline Info' />\n" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_cancel_setting();\" value='Cancel' />\n" +
                "<fieldset>\n" +
                //"<legend><span class='number'>3 - </span>Timeline Bands Info</legend>\n" +
                //"<textarea id=" + this.name + "_bands rows='" + ob_band_line_count + "' >" + JSON.stringify(this.bands, null, 2) + "</textarea>\n" +
                //"</fieldset>\n" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_apply_bands_info();\" value='Apply Bands Info' />\n" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_cancel_setting();\" value='Cancel' />\n" +
                "<fieldset>\n" +
                "<legend><span class='number'>2 - </span> Data Model</legend>\n" +
                //"<label for='test'>test:</label>\n" +
                "<textarea id=" + this.name + "_data rows='" + ob_model_line_count + "' >" + JSON.stringify(this.model, null, 2) + "</textarea>\n" +
                "</fieldset>\n" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_apply_data_model();\" value='Apply Model Info' />\n" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_cancel_setting();\" value='Cancel' />\n" +
                "<fieldset>\n" +
                "<legend><span class='number'>3 - </span>Timeline Camera Info</legend>\n" +
                "</fieldset>\n" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_apply_orthographic_camera();\" value='Orthographic' />\n" +
                "<input type='button' onclick=\"get_ob_timeline(\'" + this.name + "\').ob_apply_perspective_camera();\" value='Perspective' />\n" +
                "</form>\n" +
                "<div class='ob_gui_iframe_container' id='" + this.name + "_gui_iframe_container' style='position:absolute;'> </div>\n" +
                "</div>";

            this.ob_timeline_right_panel.style.top = this.ob_timeline_panel.offsetTop + "px";
            this.ob_timeline_right_panel.style.left = this.ob_timeline_panel.offsetLeft + parseInt(this.ob_timeline_panel.style.width) + "px";
            this.ob_timeline_right_panel.appendChild(div);

            if (this.camera === "Perspective") {
                let ob_gui = this.ob_create_gui(false);
                document.getElementById(this.name + "_gui_iframe_container").appendChild(ob_gui);
            }
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
            div.innerHTML = "<div style='padding:8px;text-align: center;'>OpenBexi timeline<\div>\n" +
                "<div class=\"ob_form1\">\n" +
                "<form>\n" +
                "<fieldset>\n" +
                "<legend> version 0.9.1 beta</legend>\n" +
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
        if ((this.params[0].date !== "current_time" && this.params[0].date !== "Date.now()")) {
            clearInterval(this.ob_refresh_interval_clock);
            return;
        }
        let that2 = this;
        this.ob_sec_incr = 0;
        try {
            clearInterval(this.ob_refresh_interval_clock);
            this.ob_refresh_interval_clock = setInterval(function () {
                if (that2.timeZone === "UTC")
                    that2.startDateTime = that2.getUTCTime(Date.now())
                else
                    that2.startDateTime = Date.now();
                that2.center_bands();
                that2.ob_sec_incr++;
                if (that2.ob_sec_incr === 10) {
                    //that2.update_scene(that2.header, that2.params, that2.bands, that2.model, that2.sessions, that2.camera);
                    that2.center_bands();
                    that2.ob_sec_incr = 0;
                }
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
                if (that3.idInterval !== undefined)
                    clearInterval(that3.idInterval);
                that3.params[0].date = date.toString().substring(0, 24) + " UTC";
                that3.params[0].date_cal = date.toString();
                that3.params[0].show_calendar = true;
                that3.ob_remove_calendar();
                if (that3.data && that3.data.match(/^(http?):\/\//) ||
                    that3.data.match(/^(wss?|ws):\/\/[^\s$.?#].[^\s]*$/) ||
                    that3.data && that3.data.match(/^(https?):\/\//)) {
                    that3.data_head = that3.data.split("?");
                    that3.update_bands_MinDate(that3.params[0].date);
                    that3.update_bands_MaxDate(that3.params[0].date);
                    that3.loadData();
                } else
                    that3.update_scene(that3.header, that3.params, that3.bands, that3.model, that3.sessions, that3.camera);
            })
            this.ob_cal.onMonthChange(function (event, date) {
                if (that3.idInterval !== undefined)
                    clearInterval(that3.idInterval);
                that3.params[0].date = date.toString();
                that3.params[0].date_cal = date.toString();
                that3.params[0].show_calendar = true;
                if (that3.data && that3.data.match(/^(http?):\/\//) ||
                    that3.data.match(/^(wss?|ws):\/\/[^\s$.?#].[^\s]*$/) ||
                    that3.data && that3.data.match(/^(https?):\/\//)) {
                    that3.data_head = that3.data.split("?");
                    that3.update_bands_MinDate(that3.params[0].date);
                    that3.update_bands_MaxDate(that3.params[0].date);
                    that3.loadData();
                } else
                    that3.update_scene(that3.header, that3.params, that3.bands, that3.model, that3.sessions, that3.camera);
            })


            this.ob_timeline_right_panel.style.top = this.ob_timeline_panel.offsetTop + "px";
            this.ob_timeline_right_panel.style.left = this.ob_timeline_panel.offsetLeft + parseInt(this.ob_timeline_panel.style.width) + "px";
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

    OB_TIMELINE.prototype.ob_open_descriptor = function (data) {
        this.ob_remove_help();
        this.ob_remove_calendar();
        this.ob_remove_setting();
        this.ob_remove_sorting();
        try {
            this.ob_timeline_right_panel.removeChild(document.getElementById(this.name + "_descriptor"));
        } catch (err) {
        }
        if (data !== undefined) {
            this.ob_createDescriptor(data);
        }
    };

    OB_TIMELINE.prototype.ob_remove_descriptor = function (data) {
        try {
            this.ob_timeline_right_panel.style.visibility = "hidden";
            this.ob_timeline_right_panel.removeChild(document.getElementById(this.name + "_descriptor"));
        } catch (err) {
        }
    };

    OB_TIMELINE.prototype.ob_createDescriptor = function (descriptor) {
        // Use default descriptor if a specific descriptor has not been defined somewhere for event or sessopns
        if (document.getElementById(this.name + "_descriptor") === null) {
            this.ob_timeline_right_panel.style.visibility = "visible";
            if (this.descriptor === undefined) {
                let div = document.createElement("div");
                div.id = this.name + "_descriptor";
                div.className = "ob_descriptor";
                if (descriptor.id === undefined) descriptor.id = "";
                if (descriptor.end === undefined) descriptor.end = "";
                let ob_descriptor_body = "";
                for (let [key, value] of Object.entries(descriptor.data)) {
                    if (key !== "sortByValue" && key !== "description" && key !== "title" && value !== "NA" && value !== "?" && value !== undefined)
                        ob_descriptor_body += "<tr><td class=ob_descriptor_td>" + key + ":</td><td>" + value + "</td></tr>";
                }
                div.innerHTML = "<div class=ob_descriptor_head >" + "data" + "<\div><br><br>" +
                    "<table class=ob_descriptor_table id=" + this.name + "_table_start_end" + ">" +
                    "<tr><td class=ob_descriptor_td>id : </td><td>" + descriptor.id + "</td></tr>" +
                    "<tr><td class=ob_descriptor_td>start : </td><td>" + descriptor.start + "</td></tr>" +
                    "<tr><td class=ob_descriptor_td>end : </td><td>" + descriptor.end + "</td></tr>" +
                    "<tr><td></td></tr>" +
                    "<tr><td class=ob_descriptor_td>title:</td><td>" + descriptor.data.title + "</td></tr>" +
                    ob_descriptor_body +
                    "<tr><td></td></tr>" +
                    "<tr><td class=ob_descriptor_td>description:</td><td><textarea class= 'ob_descriptor_area' disabled>" +
                    descriptor.data.description + "</textarea></td></tr>" +
                    "</table>";
                this.ob_timeline_right_panel.appendChild(div);
            } else {
                // Build, eval and display he descriptor
                this.descriptor = "this." + this.descriptor.replace(".js", "(descriptor)").replace("this.", "");
                let div = eval(this.descriptor);
                this.ob_timeline_right_panel.appendChild(div);
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
                e = event || window.event;
                // get the mouse cursor position at startup:
                that2.pos3 = e.clientX;
                that2.pos4 = e.clientY;
            };
            this.ob_timeline_header.onmousemove = function (event) {
                that2.ob_timeline_header.style.cursor = "move";
                if (that2.moving !== true) return;
                that2.ob_remove_help();
                that2.ob_remove_calendar();
                that2.ob_remove_descriptor();
                that2.ob_remove_setting();
                e = event || window.event;
                that2.pos1 = that2.pos3 - e.clientX;
                that2.pos2 = that2.pos4 - e.clientY;
                that2.pos3 = e.clientX;
                that2.pos4 = e.clientY;
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
            this.ob_start.style.left = "5px";
            this.ob_start.style.height = 32 + "px";
            this.ob_start.style.width = 32 + "px";
            this.ob_start.onclick = function () {
                if (that2.idInterval !== undefined)
                    clearInterval(that2.idInterval);
                that2.moving = false;
            };
            this.ob_start.onmousemove = function () {
                that2.moving = false;
                that2.ob_start.style.cursor = "pointer";
            };

            this.ob_stop = document.createElement("IMG");
            this.ob_stop.className = "ob_stop";
            this.ob_stop.style.left = "5px";
            this.ob_stop.style.height = 32 + "px";
            this.ob_stop.style.width = 32 + "px";
            this.ob_stop.onclick = function () {
                if (that2.idInterval !== undefined)
                    clearInterval(that2.idInterval);
                that2.moving = false;
            };
            this.ob_stop.onmousemove = function () {
                that2.moving = false;
                that2.ob_stop.style.cursor = "pointer";
            };

            this.ob_calendar = document.createElement("IMG");
            this.ob_calendar.className = "ob_calendar";
            this.ob_calendar.style.left = "47px";
            this.ob_calendar.style.height = 32 + "px";
            this.ob_calendar.style.width = 32 + "px";
            this.ob_calendar.onclick = function () {
                that2.moving = false;
                if (that2.params[0].show_calendar === undefined)
                    that2.params[0].show_calendar = true;
                if (that2.params[0].show_calendar === true) {
                    that2.ob_create_calendar(that2.ob_markerDate);
                    that2.params[0].show_calendar === false;
                }
            };
            this.ob_calendar.onmousemove = function (event) {
                that2.moving = false;
                that2.ob_calendar.style.cursor = "pointer";
            };

            this.ob_sync = document.createElement("IMG");
            this.ob_sync.className = "ob_sync";
            this.ob_sync.style.left = "89px";
            this.ob_sync.style.height = 32 + "px";
            this.ob_sync.style.width = 32 + "px";
            this.ob_sync.onclick = function () {
                if (that2.idInterval !== undefined)
                    clearInterval(that2.idInterval);
                that2.moving = false;
                that2.update_scene(that2.header, that2.params, that2.bands, that2.model, that2.sessions, that2.camera);
            };
            this.ob_sync.onmousemove = function () {
                that2.moving = false;
                that2.ob_sync.style.cursor = "pointer";
            };

            this.ob_search = document.createElement("IMG");
            this.ob_search.className = "ob_search";
            this.ob_search.style.left = "131px";
            this.ob_search.style.height = 32 + "px";
            this.ob_search.style.width = 32 + "px";
            this.ob_search.onclick = function () {
                that2.moving = false;
                that2.ob_settings.style.zIndex = "9999";
                if (that2.idInterval !== undefined)
                    clearInterval(that2.idInterval);
                that2.ob_create_sorting();
            };
            this.ob_search.onmousemove = function () {
                that2.moving = false;
                that2.ob_search.style.cursor = "pointer";
            };

            this.ob_marker = document.createElement("IMG");
            this.ob_marker.className = "ob_marker";
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
            this.ob_3d.style.zIndex = "10";
            this.ob_3d.style.height = 32 + "px";
            this.ob_3d.style.width = 32 + "px";
            this.ob_3d.onmouseenter = function (e) {
            };
            this.ob_3d.onclick = function (e) {
                that2.moving = false;
                that2.ob_3d.style.zIndex = "9999";
                if (that2.idInterval !== undefined)
                    clearInterval(that2.idInterval);
                if (that2.camera === "Perspective") {
                    get_ob_timeline(that2.name).ob_apply_orthographic_camera();
                    that2.camera = "Orthographic";
                    that2.ob_3d.className = "ob_3d";
                } else {
                    get_ob_timeline(that2.name).ob_apply_perspective_camera();
                    that2.camera = "Perspective";
                    that2.ob_3d.className = "ob_2d";
                    //that2.move_band(that2.bands[0].name, that2.bands[0].x, that2.bands[0].y, that2.bands[0].z, true);
                    //that2.ob_renderer.render(that2.ob_scene, that2.ob_camera);
                }
            };
            this.ob_3d.onmousemove = function () {
                that2.moving = false;
                that2.ob_3d.style.cursor = "pointer";
            };

            this.ob_settings = document.createElement("IMG");
            this.ob_settings.className = "ob_settings";
            this.ob_settings.style.zIndex = "10";
            this.ob_settings.style.height = 32 + "px";
            this.ob_settings.style.width = 32 + "px";
            this.ob_settings.onmouseenter = function (e) {
            };
            this.ob_settings.onclick = function (e) {
                that2.moving = false;
                that2.ob_settings.style.zIndex = "9999";
                if (that2.idInterval !== undefined)
                    clearInterval(that2.idInterval);
                that2.ob_create_setting();
            };
            this.ob_settings.onmousemove = function () {
                that2.moving = false;
                that2.ob_settings.style.cursor = "pointer";
            };

            this.ob_help = document.createElement("IMG");
            this.ob_help.className = "ob_help";
            this.ob_help.style.height = 32 + "px";
            this.ob_help.style.width = 32 + "px";
            this.ob_help.onclick = function () {
                if (that2.idInterval !== undefined)
                    clearInterval(that2.idInterval);
                that2.moving = false;
                that2.ob_create_help()
            };
            this.ob_help.onmousemove = function () {
                that2.moving = false;
                that2.ob_help.style.cursor = "pointer";
            };

            this.ob_search_input = document.createElement("INPUT");
            this.ob_search_input.className = "ob_search_input";
            this.ob_search_input.style.left = "172px";
            this.ob_search_input.onmousemove = function (event) {
                that2.moving = false;
                that2.ob_search_input.style.cursor = "default";
            };
            this.ob_search_input.onkeydown = function (event) {
                if (event.keyCode === 13) {
                    that2.moving = false;
                    that2.params[0].show_calendar = true;
                    if (that2.params[0].date === "current_time")
                        that2.params[0].date_cal = new Date();
                    else
                        that2.params[0].date_cal = new Date(that2.params[0].date);
                    that2.ob_remove_calendar();
                    that2.update_scene(that2.header, that2.params, that2.bands, that2.model, that2.sessions, that2.camera);
                }
            };
            this.ob_timeline_header.appendChild(this.ob_start);
            this.ob_timeline_header.appendChild(this.ob_stop);
            this.ob_timeline_header.appendChild(this.ob_calendar);
            this.ob_timeline_header.appendChild(this.ob_sync);
            this.ob_timeline_header.appendChild(this.ob_search);
            this.ob_timeline_header.appendChild(this.ob_marker);
            this.ob_timeline_header.appendChild(this.ob_time_marker);
            this.ob_timeline_header.appendChild(this.ob_3d);
            this.ob_timeline_header.appendChild(this.ob_settings);
            this.ob_timeline_header.appendChild(this.ob_help);
            this.ob_timeline_header.appendChild(this.ob_search_input);
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

    OB_TIMELINE.prototype.ob_set_body_menu = function () {
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
                e = event || window.event;
                // get the mouse cursor position at startup:
                that2.pos3 = e.clientX;
                that2.pos4 = e.clientY;
                that2.ob_timeline_panel_resizer.style.cursor = "nw-resize";
                that2.ob_timeline_panel_resizer.style.visibility = "visible";
                that2.ob_remove_help();
                that2.ob_remove_calendar();
                that2.ob_remove_descriptor();
                that2.ob_remove_setting();
            };
            this.ob_timeline_panel_resizer.onmousemove = function (event) {
                if (that2.moving !== true) return;
                e = event || window.event;
                that2.pos1 = that2.pos3 - e.clientX;
                that2.pos2 = that2.pos4 - e.clientY;
                that2.pos3 = e.clientX;
                that2.pos4 = e.clientY;

                that2.ob_timeline_panel.style.height = (that2.ob_timeline_panel_resizer.offsetTop - that2.pos2) + "px";
                that2.ob_timeline_panel.style.width = (that2.ob_timeline_panel_resizer.offsetLeft - that2.pos1) + "px";
                that2.ob_timeline_panel_resizer.style.top = (that2.ob_timeline_panel_resizer.offsetTop - that2.pos2) + "px";
                that2.ob_timeline_panel_resizer.style.left = (that2.ob_timeline_panel_resizer.offsetLeft - that2.pos1) + "px";
            };
            this.ob_timeline_panel_resizer.onmouseup = function (event) {
                that2.moving = false;
                that2.ob_timeline_panel_resizer.style.width = "20px";
                that2.ob_timeline_panel_resizer.style.height = "20px";
                that2.ob_timeline_panel.style.height = (that2.ob_timeline_panel_resizer.offsetTop - that2.pos2) + "px";
                that2.ob_timeline_panel.style.width = (that2.ob_timeline_panel_resizer.offsetLeft - that2.pos1) + "px";
                that2.ob_timeline_panel_resizer.style.top = (that2.ob_timeline_panel_resizer.offsetTop - that2.pos2) + "px";
                that2.ob_timeline_panel_resizer.style.left = (that2.ob_timeline_panel_resizer.offsetLeft - that2.pos1) + "px";

                that2.params[0].width = parseInt(that2.ob_timeline_panel.style.width);
                that2.params[0].height = parseInt(that2.ob_timeline_panel.style.height);
                //that2.reset_bands();
                that2.update_scene(that2.header, that2.params, that2.bands, that2.model, that2.sessions, that2.camera);
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
                that2.update_scene(that2.header, that2.params, that2.bands, that2.model, that2.sessions, that2.camera);
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
        //this.ob_timeline_body_frame.style.height = this.height + "px";

        this.ob_timeline_body_frame.style.overflowY = "auto";
        //this.ob_timeline_body.style.height = this.height-300 + "px";

        this.ob_timeline_panel.style.top = parseInt(this.top) + "px";
        this.ob_timeline_panel.style.left = parseInt(this.left) + "px";
        this.ob_timeline_panel.style.width = parseInt(this.width) + "px";
        this.ob_timeline_panel.style.height = parseInt(this.height) + parseInt(this.ob_timeline_header.style.height) + "px";
        this.offsetWidth = this.width;

        // Set ob_timeline right panel
        if (this.ob_timeline_right_panel === null || this.ob_timeline_right_panel === undefined) {
            this.ob_timeline_right_panel = document.createElement("div");
            this.ob_timeline_right_panel.id = this.name + '_right_panel';
            this.ob_timeline_right_panel.className = "ob_timeline_right_panel";
            document.body.appendChild(this.ob_timeline_right_panel);
        }

        this.ob_timeline_right_panel.id = this.name + "_right";
        this.ob_timeline_right_panel.style.top = parseInt(this.ob_timeline_panel.style.top) + "px";
        this.ob_timeline_right_panel.style.left = this.left + this.width + "px";
        this.ob_timeline_right_panel.style.height = parseInt(this.ob_timeline_panel.style.height) + "px";
        this.ob_timeline_right_panel.style.visibility = "hidden";
        this.ob_timeline_panel_resizer.style.top = (this.ob_timeline_panel.offsetHeight - 8) + "px";
        this.ob_timeline_panel_resizer.style.left = (this.ob_timeline_panel.offsetWidth - 8) + "px";

        this.offsetWidth = this.ob_timeline_body.offsetWidth;
        this.offsetHeight = this.ob_timeline_body.offsetHeight;

        if (this.ob_help !== undefined)
            this.ob_help.style.left = (this.ob_timeline_header.offsetWidth - 37) + "px";
        if (this.ob_settings !== undefined)
            this.ob_settings.style.left = (this.ob_timeline_header.offsetWidth - 72) + "px";
        if (this.ob_3d !== undefined)
            this.ob_3d.style.left = (this.ob_timeline_header.offsetWidth - 110) + "px";

        //if (this.ob_timeline_panel !== undefined)
        //console.log("ob_init(): panel.top:" + this.ob_timeline_panel.style.top + " panel.left:" + this.ob_timeline_panel.style.left + " panel.width:" + this.ob_timeline_panel.style.width + " panel.height:" + this.ob_timeline_panel.style.height);

    };
    OB_TIMELINE.prototype.setGregorianUnitLengths = function () {
        for (let i = 0; i < this.bands.length; i++) {
            if (this.bands[i].intervalUnit === "MILLISECOND    ")
                this.bands[i].gregorianUnitLengths = 1;
            else if (this.bands[i].intervalUnit === "SECOND")
                this.bands[i].gregorianUnitLengths = 1000;
            else if (this.bands[i].intervalUnit === "MINUTE")
                this.bands[i].gregorianUnitLengths = 1000 * 60;
            else if (this.bands[i].intervalUnit === "HOUR")
                this.bands[i].gregorianUnitLengths = 1000 * 60 * 60;
            else if (this.bands[i].intervalUnit === "DAY")
                this.bands[i].gregorianUnitLengths = 1000 * 60 * 60 * 24;
            else if (this.bands[i].intervalUnit === "WEEK")
                this.bands[i].gregorianUnitLengths = 1000 * 60 * 60 * 24 * 7;
            else if (this.bands[i].intervalUnit === "MONTH")
                this.bands[i].gregorianUnitLengths = 1000 * 60 * 60 * 24 * 31;
            else if (this.bands[i].intervalUnit === "YEAR")
                this.bands[i].gregorianUnitLengths = 1000 * 60 * 60 * 24 * 365;
            else if (this.bands[i].intervalUnit === "DECADE")
                this.bands[i].gregorianUnitLengths = 1000 * 60 * 60 * 24 * 365 * 10;
            else if (this.bands[i].intervalUnit === "CENTURY")
                this.bands[i].gregorianUnitLengths = 1000 * 60 * 60 * 24 * 365 * 100;
            else if (this.bands[i].intervalUnit === "MILLENNIUM     ")
                this.bands[i].gregorianUnitLengths = 1000 * 60 * 60 * 24 * 365 * 1000;
            else if (this.bands[i].intervalUnit === "EPOCH")
                this.bands[i].gregorianUnitLengths = -1;
            else if (this.bands[i].intervalUnit === "ERA")
                this.bands[i].gregorianUnitLengths = -2;
            else
                this.bands[i].gregorianUnitLengths = 1000 * 60 * 60;
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
    OB_TIMELINE.prototype.getPixelOffSetIncrement = function (gregorianUnitLengths, intervalPixels) {
        return this.dateToPixelOffSet(new Date(gregorianUnitLengths), gregorianUnitLengths, intervalPixels) - this.dateToPixelOffSet(new Date(0), gregorianUnitLengths, intervalPixels);
    };
    OB_TIMELINE.prototype.dateToPixelOffSet = function (date, gregorianUnitLengths, intervalPixels) {
        if (date === undefined || date === "") {
            return NaN;
        }
        if (this.timeZone === "UTC")
            if (date.toString().includes("UTC"))
                return (this.getUTCTime(Date.parse(date)) - this.startDateTime) / (gregorianUnitLengths / intervalPixels);
        return (Date.parse(date) - this.startDateTime) / (gregorianUnitLengths / intervalPixels);
    };
    OB_TIMELINE.prototype.pixelOffSetToDateText = function (pixels, gregorianUnitLengths, intervalPixels, intervalUnit, dateFormat) {
        let totalGregorianUnitLengths = this.startDateTime + (pixels * (gregorianUnitLengths / intervalPixels));
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
    OB_TIMELINE.prototype.pixelOffSetToDate = function (pixels, gregorianUnitLengths, intervalPixels) {
        let totalGregorianUnitLengths = this.startDateTime + (pixels * (gregorianUnitLengths / intervalPixels));
        return new Date(totalGregorianUnitLengths)
    };

// Bands creation and manipulation
    OB_TIMELINE.prototype.get_band = function (name) {
        for (let i = 0; i < this.bands.length; i++) {
            if (this.bands[i].name === name)
                return this.bands[i];
        }
    };
    OB_TIMELINE.prototype.center_bands = function () {
        let ob_sync = false;
        for (let i = 0; i < this.bands.length; i++) {
            this.bands[i].viewOffset = -this.width * (this.bands[i].multiples - 1) / 2;
            if (this.center === undefined)
                this.bands[i].x = 0;
            else {
                if (this.center === "left")
                    this.bands[i].x = -this.width / 3;
                else if (this.center === "right")
                    this.bands[i].x = this.width / 3;
                else
                    this.bands[i].x = 0;
            }
            this.bands[i].width = this.width * this.bands[i].multiples;
            if (i === this.bands.length - 1)
                ob_sync = true;
            this.move_band(this.bands[i].name, this.bands[i].x, this.bands[i].y, this.bands[i].z, ob_sync);
        }
    };
    OB_TIMELINE.prototype.update_bands_MinDate = function (date) {
        this.minDateL = 0;
        for (let i = 0; i < this.bands.length; i++) {
            let pixelOffSet = this.dateToPixelOffSet(date, this.bands[i].gregorianUnitLengths, this.bands[i].intervalPixels);
            this.bands[i].minDate = this.pixelOffSetToDate(this.bands[i].viewOffset + pixelOffSet, this.bands[i].gregorianUnitLengths, this.bands[i].intervalPixels);
            // Round hour to 0
            this.bands[i].minDate = new Date(new Date(this.bands[0].minDate).setMinutes(0));
            this.bands[i].minDate = new Date(new Date(this.bands[0].minDate).setSeconds(0));
            let minDateL = new Date(this.bands[i].minDate).getTime();
            if (minDateL > this.minDateL) {
                this.minDateL = minDateL;
                this.minDate = new Date(this.minDateL).toString().substring(0, 24) + " UTC";
            }
        }
        //console.log(this.minDate);
    };
    OB_TIMELINE.prototype.update_bands_MaxDate = function (date) {
        this.maxDateL = 0;
        for (let i = 0; i < this.bands.length; i++) {
            let pixelOffSet = this.dateToPixelOffSet(date, this.bands[i].gregorianUnitLengths, this.bands[i].intervalPixels);
            this.bands[i].maxDate = this.pixelOffSetToDate(-this.bands[i].viewOffset + pixelOffSet, this.bands[i].gregorianUnitLengths, this.bands[i].intervalPixels);
            this.bands[i].maxDate = new Date(new Date(this.bands[0].maxDate).setMinutes(0));
            this.bands[i].maxDate = new Date(new Date(this.bands[0].maxDate).setSeconds(0));
            let maxDateL = new Date(this.bands[i].maxDate).getTime();
            if (maxDateL > this.maxDateL) {
                this.maxDateL = maxDateL;
                this.maxDate = new Date(this.maxDateL).toString().substring(0, 24) + " UTC";
            }
        }
        //console.log(this.maxDate);
    };

    OB_TIMELINE.prototype.set_bands_minDate = function () {
        this.minDateL = 0;
        for (let i = 0; i < this.bands.length; i++) {
            this.bands[i].minDate = this.pixelOffSetToDate(this.bands[i].viewOffset, this.bands[i].gregorianUnitLengths, this.bands[i].intervalPixels);
            // Round hour to 0
            this.bands[i].minDate = new Date(new Date(this.bands[0].minDate).setMinutes(0));
            this.bands[i].minDate = new Date(new Date(this.bands[0].minDate).setSeconds(0));
            let minDateL = new Date(this.bands[i].minDate).getTime();
            if (minDateL > this.minDateL) {
                this.minDateL = minDateL;
                this.minDate = new Date(this.minDateL).toString().substring(0, 24) + " UTC";
            }
        }
        //console.log(this.minDate);
    };
    OB_TIMELINE.prototype.set_bands_maxDate = function () {
        this.maxDateL = 0;
        for (let i = 0; i < this.bands.length; i++) {
            this.bands[i].maxDate = this.pixelOffSetToDate(-this.bands[i].viewOffset, this.bands[i].gregorianUnitLengths, this.bands[i].intervalPixels);
            this.bands[i].maxDate = new Date(new Date(this.bands[0].maxDate).setMinutes(0));
            this.bands[i].maxDate = new Date(new Date(this.bands[0].maxDate).setSeconds(0));
            let maxDateL = new Date(this.bands[i].maxDate).getTime();
            if (maxDateL > this.maxDateL) {
                this.maxDateL = maxDateL;
                this.maxDate = new Date(this.maxDateL).toString().substring(0, 24) + " UTC";
            }
        }
        //console.log(this.maxDate);
    };
    OB_TIMELINE.prototype.set_bands_viewOffset = function () {
        for (let i = 0; i < this.bands.length; i++) {
            this.bands[i].width = this.width * this.bands[i].multiples;
            this.bands[i].viewOffset = -this.bands[i].width / 2;
            this.bands[i].x = this.bands[i].viewOffset;
        }
    };
    OB_TIMELINE.prototype.update_timeline_model = function (band, ob_attribute, ob_color, ob_alternate_color, ob_layouts, max_name_length) {

        band.layouts = ob_layouts;
        band.layouts.max_name_length = max_name_length;
        if (this.bands.original_length === this.bands.length) return;
        band.layout_name = band.layouts[0];
        if (band.layout_name === undefined) band.layout_name = "NONE";
        let set_alternate_color = true;
        for (let i = 1; i < band.layouts.length; i++) {
            this.bands.unshift(Object.assign({}, band));
            this.bands[i].name = band.name + "_" + i;
            this.bands[i].layout_name = band.layouts[i];
            if (set_alternate_color === true) {
                this.bands[i].color = ob_alternate_color;
                set_alternate_color = false;
            } else {
                this.bands[i].color = ob_color;
                set_alternate_color = true;
            }
        }
        this.bands.original_length = this.bands.length;
    }

    OB_TIMELINE.prototype.create_new_bands = function () {

        let ob_layouts = [];
        let max_name_length = 0;
        let pixelOffSetStart;
        let sortByValue;

        for (let i = 0; i < this.bands.length; i++) {
            if (this.bands[i].model === undefined) {
                this.bands[i].layouts = ["NONE"];
                this.bands[i].layout_name = "NONE";
                this.bands[i].model = [{sortBy: "NONE"}];
            } else {
                for (let j = 0; j < 1; j++) {
                    if (this.bands[i].model[j].sortBy === undefined) this.bands[i].model[j].sortBy = "NONE";
                    if (i === 0) {
                        if (this.sessions === undefined) return;
                        for (let k = 0; k < this.sessions.events.length; k++) {
                            // Remove all events events not visible in the bands
                            //pixelOffSetStart = this.dateToPixelOffSet(this.sessions.events[i].start, band.gregorianUnitLengths, band.intervalPixels);
                            //if (pixelOffSetStart > -this.width && this.width > pixelOffSetStart) {
                            sortByValue = eval("this.sessions.events[k]" + ".data." + this.bands[i].model[j].sortBy.toString());
                            this.sessions.events[k].data.sortByValue = sortByValue;
                            if (ob_layouts.indexOf(sortByValue) === -1) {
                                ob_layouts.push(sortByValue);
                                if ((ob_layouts[0]) !== undefined) {
                                    if ((ob_layouts[0]).length > max_name_length)
                                        max_name_length = (ob_layouts[0]).length;
                                }
                            }
                            //}
                        }
                    }

                    if (this.bands[i].model[j].alternateColor !== undefined)
                        this.update_timeline_model(this.bands[i], this.bands[i].model[j].sortBy.toString(), this.bands[i].color, this.bands[i].model[j].alternateColor.toString(), ob_layouts, max_name_length);
                    else
                        this.update_timeline_model(this.bands[i], this.bands[i].model[j].sortBy.toString(), this.bands[i].color, undefined, ob_layouts, max_name_length);
                }
            }
        }
    };
    OB_TIMELINE.prototype.set_bands_height = function () {
        let offSet, offSetOverview;
        let pos = 0;

        // Height may have changed depending on how many sessions or events populated in the bands
        // So here we need to check the Timeline height changed
        let new_timeline_height = 0;
        for (let i = 0; i < this.bands.length; i++) {
            if (this.bands[i].height !== undefined) {
                if (this.bands[i].minY !== undefined) {
                    this.bands[i].height = Math.abs(this.bands[i].maxY) + Math.abs(this.bands[i].minY);
                    new_timeline_height += this.bands[i].height;
                }
            }
        }
        if (new_timeline_height !== 0) {
            this.height = new_timeline_height;
            if (this.params[0].height !== new_timeline_height) {
                new_timeline_height = this.params[0].height;
            }
            this.params[0].height = new_timeline_height;
        }

        let ob_band_height_default = this.height / this.bands.length;
        let ob_band_height = 0;
        for (let i = 0; i < this.bands.length; i++) {
            if (this.bands[i].height === undefined) {
                this.bands[i].y = this.height - pos - (ob_band_height_default / 2);
                this.bands[i].pos_x = this.bands[i].x;
                this.bands[i].pos_y = this.bands[i].y;
                this.bands[i].pos_z = this.bands[i].z;
                pos = pos + ob_band_height_default;
                ob_band_height = ob_band_height_default;
            } else {
                try {
                    if (this.bands[i].height.match(/%/) !== null)
                        ob_band_height = (this.height * parseInt(this.bands[i].height)) / 100;
                    else if (this.bands[i].height.match(/px/) !== null)
                        ob_band_height = parseInt(this.bands[i].height);
                    else
                        ob_band_height = parseInt(this.bands[i].height);
                } catch (err) {
                    ob_band_height = parseInt(this.bands[i].height);
                }
                this.bands[i].y = this.height - pos - (ob_band_height / 2);
                this.bands[i].pos_x = this.bands[i].x;
                this.bands[i].pos_y = this.bands[i].y;
                this.bands[i].pos_z = this.bands[i].z;
                pos = pos + ob_band_height;
                this.bands[i].heightMax = ob_band_height;
                this.bands[i].maxY = this.bands[i].heightMax / 2;
                this.bands[i].minY = -this.bands[i].maxY;
                this.bands[i].heightMin = this.height - pos;
                if (this.bands[i].name.match(/overview_/)) {
                    offSetOverview = parseInt(this.bands[i].gregorianUnitLengths) / parseInt(this.bands[i].intervalPixels);
                } else {
                    offSet = parseInt(this.bands[i].gregorianUnitLengths) / parseInt(this.bands[i].intervalPixels);
                }
            }
        }

        for (let i = 0; i < this.bands.length; i++) {
            if (this.bands[i].name.match(/overview_/)) {
                try {
                    this.bands[i].trackIncrement = (offSet / offSetOverview) * this.bands[i].trackIncrement;
                    if (this.bands[i].trackIncrement === undefined)
                        this.bands[i].trackIncrement = 1;
                } catch {
                    this.bands[i].trackIncrement = 1;
                }
            }
            /*console.log("this.bands[i].name=" + this.bands[i].name +
                " - this.bands[i].trackIncrement=" + this.bands[i].trackIncrement +
                " - this.bands[i].height=" + this.bands[i].height +
                " - this.bands[i].heightMax=" + this.bands[i].heightMax +
                " - this.bands[i].heightMin=" + this.bands[i].heightMin +
                " - this.bands[i].maxY=" + this.bands[i].maxY +
                " - this.bands[i].minY=" + this.bands[i].minY +
                " - this.bands[i].pos_x=" + this.bands[i].pos_x +
                " - this.bands[i].pos_y=" + this.bands[i].pos_y +
                " - this.bands[i].pos_z=" + this.bands[i].pos_z)*/
        }
    };
    OB_TIMELINE.prototype.set_bands = function () {
        for (let i = 0; i < this.bands.length; i++) {
            if (this.bands[i].textColor === undefined)
                this.bands[i].textColor = "#000000";
            if (this.bands[i].dateColor === undefined)
                this.bands[i].dateColor = "#000000";
            if (this.bands[i].SessionColor === undefined)
                this.bands[i].SessionColor = "#000000";
            if (this.bands[i].eventColor === undefined)
                this.bands[i].eventColor = "#000000";
            if (this.bands[i].texture === undefined)
                this.bands[i].texture = undefined;
            if (this.bands[i].defaultSessionTexture === undefined)
                this.bands[i].defaultSessionTexture = undefined;
            if (this.bands[i].sessionHeight === undefined)
                this.bands[i].sessionHeight = 10;
            if (this.bands[i].defaultEventSize === undefined)
                this.bands[i].defaultEventSize = 5;

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
            if (this.bands[i].fontSize === undefined) {
                this.bands[i].fontSize = this.fontSize;
                this.bands[i].fontSizeInt = this.fontSizeInt;
            } else {
                try {
                    this.bands[i].fontSizeInt = this.bands[i].fontSize.replace("px", "");
                } catch (e) {
                    this.bands[i].fontSizeInt = this.bands[i].fontSize
                }
                this.bands[i].fontSize = this.bands[i].fontSizeInt + "px";
            }

            if (this.params[0].fontFamily === undefined) {
                this.fontFamily = 'Arial';
            } else {
                this.fontFamily = this.params[0].fontFamily;
            }
            if (this.bands[i].fontFamily === undefined) {
                this.bands[i].fontFamily = this.fontFamily;
            }

            if (this.params[0].fontStyle === undefined) {
                this.fontStyle = 'Normal';
            } else {
                this.fontStyle = this.params[0].fontStyle;
            }
            if (this.bands[i].fontStyle === undefined) {
                this.bands[i].fontStyle = this.fontStyle;
            }

            if (this.params[0].fontWeight === undefined) {
                this.fontWeight = 'Normal';
            } else {
                this.fontWeight = this.params[0].fontWeight;
            }
            if (this.bands[i].fontWeight === undefined) {
                this.bands[i].fontWeight = this.fontWeight;
            }

            if (this.bands[i].x === undefined)
                this.bands[i].x = -10000;
            else
                this.bands[i].x = parseInt(this.bands[i].x);

            if (this.bands[i].z === undefined)
                this.bands[i].z = 0;
            else
                this.bands[i].z = parseInt(this.bands[i].z);

            this.bands[i].width = 100000;

            if (this.bands[i].depth === undefined)
                this.bands[i].depth = 0;
            else
                this.bands[i].depth = parseInt(this.bands[i].depth);

            if (this.bands[i].color === undefined)
                this.bands[i].color = 'white';

            if (this.bands[i].intervalPixels === undefined)
                this.bands[i].intervalPixels = "200";

            if (this.bands[i].intervalUnit === undefined)
                this.bands[i].intervalUnit = "MINUTE";

            if (this.bands[i].dateFormat === undefined)
                this.bands[i].dateFormat = "DEFAULT"

            if (this.bands[i].subIntervalPixels === undefined || this.bands[i].subIntervalPixels === "NONE")
                this.bands[i].subIntervalPixels = "NONE";
            else {
                if (this.bands[i].intervalUnit === "HOUR" && parseInt(this.bands[i].intervalPixels) >= 60)
                    this.bands[i].subIntervalPixels = parseInt(this.bands[i].intervalPixels) / 4;
            }
            this.bands[i].multiples = parseInt(this.bands[i].intervalPixels) / 30;
            this.bands[i].trackIncrement = 20;
            //this.bands[i].track = (-parseInt(this.bands[i].heightMax) / 2) + this.bands[i].trackIncrement;
        }
        this.create_new_bands();
        this.set_bands_height();
        this.set_bands_viewOffset();
        this.set_bands_minDate();
        this.set_bands_maxDate();
        //console.log("window width:" + this.width + " --- band width:" + this.bands[0].width + " --- " + this.bands[0].minDate + " --- " + this.bands[0].maxDate + " --- viewOffset:" + this.bands[0].viewOffset)
    };

    OB_TIMELINE.prototype.add_textBox = function (band_name, text, x, y, z, width, height, depth, color, texture) {
        let ob_model_name = this.ob_scene.getObjectByName(band_name + "_" + text);
        if (ob_model_name !== undefined) return;
        if (isNaN(x)) x = 0;
        if (isNaN(y)) y = 0;
        if (isNaN(z)) z = 0;
        if (isNaN(width)) width = 0;
        if (isNaN(height)) height = 0;
        if (depth === undefined) depth = 1;
        if (color === undefined) {
            color = this.track(new THREE.Color("rgb(114, 171, 173)"));
        } else {
            color = this.track(new THREE.Color(color));
        }

        let ob_box = this.track(new THREE.BoxGeometry(width, height, depth));
        let ob_material;
        if (texture !== undefined) {
            let loader = this.track(new THREE.CubeTextureLoader());
            loader.setCrossOrigin("");
            loader.setPath('three.js/examples/textures/cube/pisa/');
            let textureCube = loader.load([
                'px.png', 'nx.png',
                'py.png', 'ny.png',
                'pz.png', 'nz.png'
            ]);
            let ob_dirLight = this.track(new THREE.DirectionalLight(0xffffff));
            ob_dirLight.position.set(10, 10, 10);
            this.ob_scene.add(ob_dirLight);
            this.ob_scene.add(this.track(new THREE.AmbientLight(0x404040)));
            ob_material = this.track(new THREE.MeshStandardMaterial({
                envMap: textureCube,
                roughness: 0.5,
                metalness: 1
            }));
            ob_box.computeVertexNormals();
        } else {
            //this.ob_scene.add(this.track(new THREE.AmbientLight(0x404040)));
            ob_material = this.track(new THREE.MeshBasicMaterial({color: color, wireframeLinewidth: 1}));
        }
        ob_model_name = this.track(new THREE.Mesh(ob_box, ob_material));
        ob_model_name.name = band_name + "_" + text;
        ob_model_name.sortBy = "true";
        ob_model_name.pos_x = x;
        ob_model_name.pos_y = this.get_band(band_name).pos_y;
        ob_model_name.pos_z = z;
        ob_model_name.position.set(x, y, z);

        this.ob_scene.add(ob_model_name);
        this.objects.push(ob_model_name);

        this.add_text_sprite(ob_model_name, text, 50, 0, 10, 24, "Normal",
            "Normal", color, 'Arial');
        //this.add_text3D(ob_model_name, text, 50, 0, 10, 24, color);

        if (ob_debug_ADD_WEBGL_OBJECT) console.log("OB_TIMELINE.add_textBox(" + band_name + "," +
            text + "," + x + "," + y + "," + z + "," + width + "," + height + "," + depth + "," +
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

    OB_TIMELINE.prototype.create_bands = function (ob_set_bands) {
        if (ob_set_bands === true) this.set_bands();
        for (let i = 0; i < this.bands.length; i++) {
            this.add_band(this.bands[i].name,
                this.bands[i].x,
                this.bands[i].y,
                this.bands[i].z,
                this.bands[i].width,
                this.bands[i].heightMax,
                this.bands[i].depth,
                this.bands[i].color,
                this.bands[i].texture);
            if (this.bands[i].layout_name !== "NONE") {
                this.add_textBox(this.bands[i].name, this.bands[i].layout_name,
                    -(this.width / 2) + (parseInt(this.bands[i].layouts.max_name_length) * 4),
                    this.bands[i].y,
                    parseInt(this.bands[i].z) + 40,
                    parseInt(this.bands[i].layouts.max_name_length) * parseInt(this.bands[i].fontSizeInt) * 3,
                    this.bands[i].heightMax,
                    parseInt(this.bands[i].depth) + 1,
                    this.hex_Luminance(this.bands[i].color, -.15),
                    undefined);
            }
        }
    };

    OB_TIMELINE.prototype.add_band = function (band_name, x, y, z, width, height, depth, color, texture) {
        let ob_band = this.ob_scene.getObjectByName(band_name);
        if (ob_band !== undefined) return;
        if (isNaN(x)) x = 0;
        if (isNaN(y)) y = 0;
        if (isNaN(z)) z = 0;
        if (isNaN(width)) width = 0;
        if (isNaN(height)) height = 0;
        if (depth === undefined) depth = 1;
        if (color === undefined) {
            color = this.track(new THREE.Color("rgb(114, 171, 173)"));
        } else {
            color = this.track(new THREE.Color(color));
        }

        let ob_box = this.track(new THREE.BoxGeometry(width, height, depth));
        let ob_material;
        if (texture !== undefined) {
            let loader = this.track(new THREE.CubeTextureLoader());
            loader.setCrossOrigin("");
            loader.setPath('three.js/examples/textures/cube/pisa/');
            let textureCube = loader.load([
                'px.png', 'nx.png',
                'py.png', 'ny.png',
                'pz.png', 'nz.png'
            ]);
            let ob_dirLight = this.track(new THREE.DirectionalLight(0xffffff));
            ob_dirLight.position.set(10, 10, 10);
            this.ob_scene.add(ob_dirLight);
            this.ob_scene.add(this.track(new THREE.AmbientLight(0x404040)));
            ob_material = this.track(new THREE.MeshStandardMaterial({
                envMap: textureCube,
                roughness: 0.5,
                metalness: 1
            }));
            ob_box.computeVertexNormals();
        } else {
            this.ob_scene.add(this.track(new THREE.AmbientLight(0x404040)));
            ob_material = this.track(new THREE.MeshBasicMaterial({color: color, wireframeLinewidth: 1}));
        }
        ob_band = this.track(new THREE.Mesh(ob_box, ob_material));
        ob_band.name = band_name;
        ob_band.pos_x = x;
        ob_band.pos_y = this.get_band(band_name).pos_y;
        ob_band.pos_z = z;
        ob_band.position.set(x, y, z);

        this.ob_scene.add(ob_band);
        this.objects.push(ob_band);
        if (ob_debug_ADD_WEBGL_OBJECT) console.log("OB_TIMELINE.add_band(" + band_name + "," + x + "," + y + "," + z + "," + width + "," + height + "," + depth + "," + color + "," + texture + ")");
    };

    OB_TIMELINE.prototype.destroy_scene = function () {
        if (this.ob_scene === undefined) return;
        for (let i = 0; i < this.ob_scene.children.length; i++) {
            this.ob_scene.remove(this.ob_scene.children[i]);
        }
        this.resTracker.dispose();
        this.ob_scene = undefined;
        this.ob_timeline_body.innerHTML = "";
        //this.ob_renderer = undefined;
    };

    OB_TIMELINE.prototype.update_scene = function (header, params, bands, model, sessions, camera) {
        ob_timelines.forEach(function (ob_timeline) {
                if (ob_timeline.name === params[0].name) {
                    let current_camera = ob_timeline.camera;
                    ob_timeline.destroy_scene();

                    ob_timeline.camera = camera;
                    ob_timeline.header = header;
                    ob_timeline.params = params;
                    ob_timeline.bands = bands;
                    ob_timeline.model = model;
                    ob_timeline.sessions = sessions;

                    ob_timeline.ob_init();
                    ob_timeline.set_sessions();
                    ob_timeline.ob_set_body_menu();
                    ob_timeline.ob_set_scene();
                    ob_timeline.create_bands(false);
                    clearTimeout(ob_timeline.timeout_create_segments);
                    clearTimeout(ob_timeline.timeout_create_sessions);
                    ob_timeline.timeout_create_sessions = setTimeout(function () {
                        ob_timeline.create_sessions();
                        ob_timeline.ob_renderer.render(ob_timeline.ob_scene, ob_timeline.ob_camera);
                    }, 0);
                    ob_timeline.timeout_create_segments = setTimeout(function () {
                        ob_timeline.create_segments_and_dates();
                        ob_timeline.ob_renderer.render(ob_timeline.ob_scene, ob_timeline.ob_camera);
                    }, 0);
                    ob_timeline.add_line_current_time();
                    ob_timeline.center_bands();
                    ob_timeline.camera = current_camera;
                    ob_timeline.ob_start_clock();
                    if (params[0].show_calendar)
                        ob_timeline.ob_create_calendar(new Date(params[0].date_cal));
                    ob_timeline.ob_set_camera();
                    return null;
                }
            }
        );
        return null;
    };

    OB_TIMELINE.prototype.sync_bands = function (ob_band, x) {
        if (ob_band === undefined) return;
        let ob_band2;
        let scale1;
        let scale2;
        let ob_incrementPixelOffSet2;
        for (let i = 0; i < this.bands.length; i++) {
            if (ob_band.name === this.bands[i].name) {
                this.ob_markerDate = this.pixelOffSetToDate(-x, this.bands[i].gregorianUnitLengths, this.bands[i].intervalPixels);
                scale1 = this.bands[i].gregorianUnitLengths / this.bands[i].intervalPixels;
                break;
            }
        }
        for (let i = 0; i < this.bands.length; i++) {
            if (ob_band.name !== this.bands[i].name) {
                this.ob_markerDate2 = this.pixelOffSetToDate(x, this.bands[i].gregorianUnitLengths, this.bands[i].intervalPixels);
                ob_incrementPixelOffSet2 = this.dateToPixelOffSet(this.ob_markerDate2, this.bands[i].gregorianUnitLengths, this.bands[i].intervalPixels);
                scale2 = this.bands[i].gregorianUnitLengths / this.bands[i].intervalPixels;
                //Start syncing
                ob_band2 = this.ob_scene.getObjectByName(this.bands[i].name);
                ob_band2.position.x = ob_incrementPixelOffSet2 / (scale2 / scale1);
                //if (this.ob_camera!==undefined)this.ob_renderer.render(this.ob_scene, this.ob_camera);
            }
        }
        if (this.ob_marker !== undefined) {
            this.ob_marker.style.visibility = "visible";
            this.ob_marker.style.zIndex = "99999";
            this.ob_marker.style.top = parseInt(this.ob_timeline_header.style.height) - 14 + "px";
            this.ob_marker.style.left = (parseInt(this.ob_timeline_header.offsetWidth) / 2) - parseInt(this.ob_marker.style.width) / 2 + "px";
        }
        if (this.ob_time_marker.innerText !== undefined) {
            this.ob_time_marker.style.visibility = "visible";
            this.ob_time_marker.style.zIndex = "99999";
            this.ob_time_marker.style.top = "0px";
            this.ob_time_marker.style.left = (parseInt(this.ob_timeline_header.offsetWidth) / 2) - 200 + "px";
            if (this.timeZone === "UTC") {
                this.ob_time_marker.innerText = this.title + " - " + this.ob_markerDate.toString().substring(0, 25) + " - UTC";
            } else {
                this.ob_time_marker.innerText = this.title + " - " + this.ob_markerDate.toString().substring(0, 25);
            }
            if (this.ob_cal !== undefined) {
                this.ob_cal.goto(this.ob_markerDate);
                this.ob_cal.set(this.ob_markerDate);
            }
        }
    };

    OB_TIMELINE.prototype.move_band = function (band_name, x, y, z, ob_sync) {
        if (isNaN(x)) return;
        let ob_band = this.ob_scene.getObjectByName(band_name);
        if (ob_band === undefined) return;
        ob_band.position.set(x, y, z);
        if (ob_sync)
            this.sync_bands(ob_band, x, y, z);

        if (ob_debug_MOVE_WEBGL_OBJECT) console.log("OB_TIMELINE.moveBand(" + band_name + "," + x + "," + y + "," + z + ")");
    };

    OB_TIMELINE.prototype.create_segments_and_dates = function () {
        //console.log("create_segments_and_dates start at:" + Date() + " - " + new Date().getMilliseconds());
        let text, textX, textY, maxPixelOffSet, incrementPixelOffSet, incrementSubPixelOffSet;
        for (let i = 0; i < this.bands.length; i++) {
            let ob_band = this.ob_scene.getObjectByName(this.bands[i].name);

            incrementPixelOffSet = this.dateToPixelOffSet(this.bands[i].minDate, this.bands[i].gregorianUnitLengths, this.bands[i].intervalPixels);
            maxPixelOffSet = this.dateToPixelOffSet(this.bands[i].maxDate, this.bands[i].gregorianUnitLengths, this.bands[i].intervalPixels);

            while (parseInt(incrementPixelOffSet) < parseInt(maxPixelOffSet) + parseInt(this.bands[i].intervalPixels)) {

                //Create segments
                this.add_segment(this.bands[i].name, incrementPixelOffSet, this.bands[i].heightMax - (this.bands[i].heightMax / 2), 5, this.bands[i].heightMax, "black", false);
                // Trick: Add an extra segment to make a thinnest segment
                this.add_segment(this.bands[i].name, incrementPixelOffSet + 0.15, this.bands[i].heightMax - (this.bands[i].heightMax / 2), 5, this.bands[i].heightMax, this.bands[i].color, false);

                //Create date texts
                text = this.pixelOffSetToDateText(incrementPixelOffSet, this.bands[i].gregorianUnitLengths, this.bands[i].intervalPixels, this.bands[i].intervalUnit, this.bands[i].dateFormat);
                textX = incrementPixelOffSet - (this.bands[i].fontSizeInt / 2) + 6;
                if (this.bands[i].intervalUnitPos === "TOP")
                    textY = (this.bands[i].heightMax - (this.bands[i].heightMax / 2)) - this.bands[i].fontSizeInt;
                else if (this.bands[i].intervalUnitPos === "BOTTOM")
                    textY = (-parseInt(this.bands[i].heightMax) / 2) + this.bands[i].fontSizeInt;
                else
                    textY = (-parseInt(this.bands[i].heightMax) / 2) + this.bands[i].fontSizeInt;

                //this.add_text_CSS2D(ob_band, text, textX, textY, 5, this.bands[i].fontSizeInt, this.bands[i].dateColor);
                this.add_text_sprite(ob_band, text, textX, textY, 5, this.bands[i].fontSizeInt,
                    this.bands[i].fontStyle, this.bands[i].fontWeight, this.bands[i].dateColor, this.bands[i].fontFamily);

                //Create sub-segments if required
                if (this.bands[i].subIntervalPixels !== "NONE") {
                    incrementSubPixelOffSet = parseInt(this.bands[i].subIntervalPixels);
                    while (parseInt(incrementPixelOffSet) + parseInt(incrementSubPixelOffSet) < parseInt(incrementPixelOffSet) + parseInt(this.bands[i].intervalPixels)) {
                        this.add_segment(this.bands[i].name, incrementPixelOffSet + incrementSubPixelOffSet, this.bands[i].heightMax - (this.bands[i].heightMax / 2), 5, this.bands[i].heightMax, "black", true);
                        // Trick: Add an extra segment to make a thinnest segment
                        this.add_segment(this.bands[i].name, incrementPixelOffSet + incrementSubPixelOffSet + 0.20, this.bands[i].heightMax - (this.bands[i].heightMax / 2), 5, this.bands[i].heightMax, this.bands[i].color, true);
                        incrementSubPixelOffSet += parseInt(this.bands[i].subIntervalPixels);
                    }
                }
                incrementPixelOffSet = parseInt(incrementPixelOffSet) + parseInt(this.bands[i].intervalPixels);
            }
        }
        //console.log("create_segments_and_dates done at:" + Date() + " - " + new Date().getMilliseconds());
    };

    OB_TIMELINE.prototype.get_room_for_session = function (sessions, session, i) {
        let ob_enough_room = true;
        this.bands[i].track = this.bands[i].maxY - this.bands[i].fontSizeInt;

        // if not enough room to plot the session increase bandwith regarding this.bands[i].trackIncrement
        while (ob_enough_room) {
            this.bands[i].track = this.bands[i].track - this.bands[i].trackIncrement;
            for (let l = 0; l < sessions.length; l++) {
                if (sessions[l].y === undefined) {
                    return this.bands[i].track;
                }
                // If no room, so check for the next track.
                if (sessions[l].y === this.bands[i].track) {
                    if (parseInt(session.x) >= parseInt(sessions[l].x) &&
                        parseInt(session.x) <= parseInt(sessions[l].x + sessions[l].total_width)) {
                        //  session i        ___
                        //  session l      _________
                        if (ob_debug_room) console.log("case1: this.bands[i].name=" + this.bands[i].name +
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
                        if (ob_debug_room) console.log("case2: this.bands[i].name=" + this.bands[i].name +
                            " - session.data.title=" + session.data.title +
                            " - session.x=" + session.x +
                            " - session.total_width=" + session.total_width + " -->(" + parseInt(session.x + session.total_width) + ")" +
                            " - sessions[l].data.title=" + sessions[l].data.title +
                            " - sessions[l].x=" + sessions[l].x +
                            " - sessions[l].total_width=" + sessions[l].total_width + " -->(" + parseInt(sessions[l].x + sessions[l].total_width) + ")");

                        break;
                    } else {
                        if (ob_debug_room) console.log("case normal: this.bands[i].name=" + this.bands[i].name +
                            " - session.data.title=" + session.data.title +
                            " - session.x=" + session.x +
                            " - session.total_width=" + session.total_width + " -->(" + parseInt(session.x + session.total_width) + ")" +
                            " - sessions[l].data.title=" + sessions[l].data.title +
                            " - sessions[l].x=" + sessions[l].x +
                            " - sessions[l].total_width=" + sessions[l].total_width + " -->(" + parseInt(sessions[l].x + sessions[l].total_width) + ")");
                    }
                }
                // Reset increment if there is enough room to plot the session otherwise increase bandwidth.
                if (this.bands[i].track <= this.bands[i].minY + this.bands[i].trackIncrement) {
                    this.bands.updated = true;
                    this.bands[i].minY = this.bands[i].track - (2 * this.bands[i].trackIncrement);
                    return this.bands[i].track;
                }
            }
        }
        //console.log("this.bands[i].heightMax=" + this.bands[i].heightMax + " " + this.bands[i].name + " title=" + String(session.data.title) + " x=" + session.x + " w=" + session.w + " y=" + y);
        return this.bands[i].track;
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

    OB_TIMELINE.prototype.set_sessions = function () {
        let layout;
        let y = 0, z = 5, h = 0, w = 0;
        let textX = 0;
        let pixelOffSetStart = 0;
        let pixelOffSetEnd = 0;
        this.bands.updated = false;

        // two passes are necessary if bands height change because we need to calculate again all sessions coordinates
        let sortByValue;
        for (let p = 0; p < 2; p++) {
            if (p === 1 && this.bands.updated === false)
                break;

            // for each bands
            for (let i = 0; i < this.bands.length; i++) {
                this.bands[i].sessions = [];
                if (this.sessions === undefined) break;

                // Assign each event to the right bands
                if (sortByValue === undefined)
                    sortByValue = eval("this.bands[i].model[0].sortBy");
                for (let k = 0; k < this.sessions.events.length; k++) {
                    // Remove all events events not visible in the bands
                    //pixelOffSetStart = this.dateToPixelOffSet(this.sessions.events[k].start, this.bands[i].gregorianUnitLengths, this.bands[i].intervalPixels);
                    //if (pixelOffSetStart > -this.width && this.width > pixelOffSetStart) {
                    if (sortByValue === "NONE") {
                        this.bands[i].sessions.push(Object.assign({}, this.sessions.events[k]));
                    } else {
                        layout = this.sessions.events[k].data.sortByValue;
                        if (layout === undefined)
                            layout = eval("this.sessions.events[k].data." + sortByValue);
                        if (layout !== undefined && this.bands[i].layout_name === layout) {
                            this.sessions.events[k].y = undefined;
                            this.bands[i].sessions.push(Object.assign({}, this.sessions.events[k]));
                        }
                    }
                    this.build_model(this.sessions.events[k].data);
                    //}
                }

                for (let j = 0; j < this.bands[i].sessions.length; j++) {
                    let session = this.bands[i].sessions[j];
                    if (session.data != null && session.data.title === undefined) session.data.title = "";

                    pixelOffSetStart = this.dateToPixelOffSet(session.start, this.bands[i].gregorianUnitLengths, this.bands[i].intervalPixels);
                    pixelOffSetEnd = this.dateToPixelOffSet(session.end, this.bands[i].gregorianUnitLengths, this.bands[i].intervalPixels);

                    if (this.bands[i].name.match(/overview_/)) {
                        if (isNaN(parseInt(pixelOffSetEnd))) {
                            h = this.bands[i].trackIncrement;
                            w = this.bands[i].trackIncrement;
                        } else {
                            h = this.bands[i].trackIncrement;
                            w = parseInt(pixelOffSetEnd) - parseInt(pixelOffSetStart);
                        }
                    } else {
                        if (isNaN(parseInt(pixelOffSetEnd))) {
                            h = this.bands[i].defaultEventSize;
                            w = this.bands[i].defaultEventSize;
                            textX = getTextWidth(session.data.title, this.bands[i].fontSize + " " + this.bands[i].fontFamily);
                            textX = this.bands[i].defaultEventSize * 2 + textX / 2;

                        } else {
                            h = this.bands[i].sessionHeight;
                            w = parseInt(pixelOffSetEnd) - parseInt(pixelOffSetStart);
                            textX = getTextWidth(session.data.title, this.bands[i].fontSize + " " + this.bands[i].fontFamily);
                            textX = (w / 2) + this.bands[i].defaultEventSize + textX / 2;
                        }
                    }

                    // Do not write texts for any overview bands.
                    this.bands[i].sessions[j].x = parseInt(pixelOffSetStart);
                    this.bands[i].sessions[j].x_relative = parseInt(pixelOffSetStart) + w / 2;
                    this.bands[i].sessions[j].width = w;
                    this.bands[i].sessions[j].height = h;
                    this.bands[i].sessions[j].size = h;
                    this.bands[i].sessions[j].z = z;
                    this.bands[i].sessions[j].textX = textX;
                    this.bands[i].sessions[j].pixelOffSetEnd = pixelOffSetEnd;
                    this.bands[i].sessions[j].total_width = w + (session.data.title.length * this.bands[i].fontSizeInt);

                    y = this.get_room_for_session(this.bands[i].sessions, this.bands[i].sessions[j], i);

                    this.bands[i].sessions[j].y = y;
                }
            }
            this.set_bands_height();
        }
    };
    OB_TIMELINE.prototype.build_sessions_filter = function () {
        this.ob_filter = this.ob_search_input.value.split("|");
        this.regex = "^(?=.*(?:--|--))(?!.*(?:__|__)).*$";
        if (this.ob_filter.length === 1)
            this.regex = this.regex.replace("--|--", this.ob_filter[0].replace(" ", "|").replace(",", "|").replace(";", "|"));
        if (this.ob_filter.length === 2) {
            this.regex = this.regex.replace("--|--", this.ob_filter[0].replace(" ", "|").replace(",", "|").replace(";", "|"));
            this.regex = this.regex.replace("__|__", this.ob_filter[1].replace(" ", "|").replace(",", "|").replace(";", "|"));
        }
    }

    OB_TIMELINE.prototype.create_sessions = function (ob_set_sessions) {
        if (ob_set_sessions === true) this.set_sessions();

        // Apply filter if any here:
        this.build_sessions_filter();

        for (let i = 0; i < this.bands.length; i++) {
            let ob_obj;
            for (let j = 0; j < this.bands[i].sessions.length; j++) {
                try {
                    if (this.bands[i].sessions[j].data.title.match(this.regex)) {
                        if (this.bands[i].sessions[j].pixelOffSetEnd === undefined ||
                            isNaN(parseInt(this.bands[i].sessions[j].pixelOffSetEnd))) {
                            if (this.bands[i].sessions[j].render !== undefined)
                                ob_obj = this.add_event(this.bands[i].name, this.bands[i].sessions[j].render.color,
                                    this.bands[i].sessions[j], this.bands[i].sessions[j].render.image);
                            else
                                ob_obj = this.add_event(this.bands[i].name, this.bands[i].eventColor,
                                    this.bands[i].sessions[j]);
                        } else {
                            if (this.bands[i].sessions[j].render !== undefined)
                                ob_obj = this.add_session(this.bands[i].name, this.bands[i].sessions[j].render.color,
                                    this.bands[i].defaultSessionTexture,
                                    this.bands[i].sessions[j]);
                            else
                                ob_obj = this.add_session(this.bands[i].name, this.bands[i].SessionColor,
                                    this.bands[i].defaultSessionTexture,
                                    this.bands[i].sessions[j]);
                        }
                        if (!this.bands[i].name.match(/overview_/)) {
                            //this.add_text_CSS2D(ob_obj, this.bands[i].sessions[j].data.title,
                            //this.bands[i].sessions[j].textX, 0, 5, this.bands[i].fontSizeInt, this.bands[i].textColor);
                            let textColor = this.bands[i].dateColor;
                            let fontSizeInt = this.bands[i].fontSizeInt;
                            let fontWeight = this.bands[i].fontWeight;
                            let fontFamily = this.bands[i].fontFamily;
                            let fontStyle = this.bands[i].fontStyle;
                            if (this.bands[i].sessions[j].render !== undefined) {
                                if (this.bands[i].sessions[j].render.textColor !== undefined)
                                    textColor = this.bands[i].sessions[j].render.textColor;
                                if (this.bands[i].sessions[j].render.fontSize !== undefined)
                                    fontSizeInt = this.bands[i].sessions[j].render.fontSize;
                                if (this.bands[i].sessions[j].render.fontWeight !== undefined)
                                    fontWeight = this.bands[i].sessions[j].render.fontWeight;
                                if (this.bands[i].sessions[j].render.fontFamily !== undefined)
                                    fontFamily = this.bands[i].sessions[j].render.fontFamily;
                                if (this.bands[i].sessions[j].render.fontStyle !== undefined)
                                    fontStyle = this.bands[i].sessions[j].render.fontStyle;
                            }

                            this.add_text_sprite(ob_obj, this.bands[i].sessions[j].data.title,
                                this.bands[i].sessions[j].textX, 0, 5, fontSizeInt,
                                fontStyle, fontWeight,
                                textColor, fontFamily);
                        }
                    }
                } catch (e) {
                }
                //console.log(this.bands[i].name + " title=" + String(session.data.title) + " - this.bands[i].heightMax=" + this.bands[i].heightMax + "  i=" + i + " - j=" + j + " x=" + parseInt(x) + " y=" + y + " w=" + parseInt(this.sessions.events[j].total_width) + "  --> " + this.bands[i].track);
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
    OB_TIMELINE.prototype.add_new_band = function (type) {

    };
// WebGl OpenBexi library
    OB_TIMELINE.prototype.add_session = function (band_name, color, texture, session) {
        let ob_material;
        if (texture !== undefined) {
            let loader = this.track(new THREE.CubeTextureLoader());
            loader.setCrossOrigin("");
            loader.setPath('three.js/examples/textures/cube/pisa/');
            let textureMetal = loader.load([
                'px.png', 'nx.png',
                'py.png', 'ny.png',
                'pz.png', 'nz.png'
            ]);
            ob_material = this.track(new THREE.MeshStandardMaterial({
                color: color,
                envMap: textureMetal,
                roughness: 0.5,
                metalness: 1
            }));
        } else
            ob_material = this.track(new THREE.MeshBasicMaterial({color: color}));

        let ob_session = this.track(new THREE.Mesh(this.track(new THREE.BoxGeometry(session.width, session.height, 10)), ob_material));
        ob_session.position.set(session.x_relative, session.y, session.z);
        ob_session.pos_x = session.x_relative;
        ob_session.pos_y = session.y;
        ob_session.pos_z = session.z;
        ob_session.data = session;
        this.ob_scene.add(ob_session);
        let ob_band = this.ob_scene.getObjectByName(band_name);
        if (ob_band !== undefined) {
            ob_band.add(ob_session);
        }
        if (ob_debug_ADD_SESSION_WEBGL_OBJECT) console.log("OB_TIMELINE.Session(" + band_name + "," + session.x + "," +
            session.y + "," + session.z + "," + session.width + "," + session.height + "," + session.color + ")");
        return ob_session;
    };
    OB_TIMELINE.prototype.removeSession = function (band_name, session_id) {
        let ob_band = this.ob_scene.getObjectByName(band_name);
        if (ob_band !== undefined) {
            ob_band.remove(session_id);
        }
        if (ob_debug_REMOVE_WEBGL_OBJECT) console.log("removeEvent(" + band_name + "+event_id=" + session_id + ")");
    };

    OB_TIMELINE.prototype.load_texture = function (image) {
        if (image === undefined || ob_texture === undefined) return undefined;
        return ob_texture.get(image);
    }

    OB_TIMELINE.prototype.add_event = function (band_name, color, session, image) {
        let geometry, material, ob_event;
        let texture = this.load_texture(image);
        if (texture === undefined) {
            geometry = this.track(new THREE.SphereGeometry(session.size));
            material = this.track(new THREE.MeshBasicMaterial({color: color}));
        } else {
            geometry = this.track(new THREE.PlaneGeometry(16, 16));
            texture.minFilter = THREE.LinearFilter;
            material = this.track(new THREE.MeshBasicMaterial({
                map: texture,
                color: '#a1d9ff',
                transparent: true,
                opacity: 1
            }));
        }
        ob_event = this.track(new THREE.Mesh(geometry, material));
        ob_event.position.set(session.x_relative, session.y, session.z);
        ob_event.pos_x = session.x_relative;
        ob_event.pos_y = session.y;
        ob_event.pos_z = session.z;
        ob_event.data = session;

        this.ob_scene.add(ob_event);

        let ob_band = this.ob_scene.getObjectByName(band_name);
        if (ob_band !== undefined) {
            ob_band.add(ob_event);
        }
        if (ob_debug_ADD_EVENT_WEBGL_OBJECT) console.log("OB_TIMELINE.ob_addEvent(" + band_name + "," + x + "," + y + "," + z + "," + size + "," + color + ")");
        return ob_event;
    };
    OB_TIMELINE.prototype.removeEvent = function (band_name, event_id) {
        let ob_band = this.ob_scene.getObjectByName(band_name);
        if (ob_band !== undefined) {
            ob_band.remove(event_id);
        }
        if (ob_debug_REMOVE_WEBGL_OBJECT) console.log("OB_TIMELINE.removeEvent(" + band_name + "+event_id=" + event_id + ")");
    };

    OB_TIMELINE.prototype.add_hot_zone = function (band_name, hotZone_name, x, y, z, width, height, depth, color) {
        let hotZone = this.ob_scene.getObjectByName(hotZone_name);
        if (hotZone !== undefined) return;
        if (ob_debug_ADD_WEBGL_OBJECT) console.log("add_hot_zone(" + hotZone_name + "," + band_name + "," + x + "," + y + "," + z + "," + width + "," + height + "," + depth + "," + color + ")");
        if (isNaN(x)) x = 0;
        if (isNaN(y)) y = 0;
        if (isNaN(z)) z = 0;
        if (isNaN(width)) width = 0;
        if (isNaN(height)) height = 0;
        if (depth === undefined) depth = 2;
        let rbg_color;
        if (color === undefined) {
            rbg_color = this.track(new THREE.Color("rgb(114, 171, 173)"));
        } else {
            rbg_color = this.track(new THREE.Color(color));
        }

        let material = this.track(this.track(new THREE.MeshBasicMaterial({color: rbg_color})));
        hotZone = this.track(new THREE.Mesh(this.track(new THREE.CubeGeometry(width, height, depth)), material));
        hotZone.name = hotZone_name;
        hotZone.position.set(x, y, z);
        this.ob_scene.add(hotZone);

        let ob_band = this.ob_scene.getObjectByName(band_name);
        if (ob_band !== undefined) {
            ob_band.add(hotZone);
        }
        if (ob_debug_ADD_WEBGL_OBJECT) console.log("OB_TIMELINE.add_hot_zone(" + hotZone_name + "," + band_name + "," + x + "," + y + "," + z + "," + width + "," + height + "," + depth + "," + color + ")");
    };
    OB_TIMELINE.prototype.move_hot_zone = function (band_name, hotZone_name, x, y, z, width, height, depth, color) {
        if (isNaN(x)) return;
        let hotZone = this.ob_scene.getObjectByName(hotZone_name);
        if (hotZone === undefined) {
            OB_TIMELINE.addHotZone(band_name, hotZone_name, x, y, z, width, height, depth, color);
            return;
        }
        hotZone.position.set(x, y, z);
        if (ob_debug_MOVE_WEBGL_OBJECT) console.log("OB_TIMELINE.move_hot_zone(" + hotZone_name + "," + band_name + "," + x + "," + y + "," + z + "," + width + "," + height + " color=" + color + ")");
    };
    OB_TIMELINE.prototype.add_segment = function (band_name, x, y, z, size, color, dashed) {
        if (color === undefined) {
            color = this.track(new THREE.Color("rgb(114, 171, 173)"));
        }
        let geometry = this.track(new THREE.Geometry());
        geometry.vertices.push(this.track(new THREE.Vector3(x, y, z)));
        geometry.vertices.push(this.track(new THREE.Vector3(x, y - size, z)));
        let material = this.track(new THREE.LineDashedMaterial({
            color: color,
            linewidth: 1,
            dashSize: 2,
            gapSize: 4,
        }));
        let segment = this.track(new THREE.LineSegments(geometry, material));
        if (dashed) segment.computeLineDistances();
        let ob_band = this.ob_scene.getObjectByName(band_name);
        if (ob_band !== undefined) {
            ob_band.add(segment);
        }
        if (ob_debug_ADD_WEBGL_OBJECT) console.log("OB_TIMELINE.add_segment(" + band_name + "," + x + "," + y + "," + z + "," + size + "," + color + ")");
    };

    OB_TIMELINE.prototype.remove_segments = function (band_name) {
        let ob_band = this.ob_scene.getObjectByName(band_name);
        if (ob_band !== undefined) {
            ob_band.children = [];
        }
        if (ob_debug_REMOVE_WEBGL_OBJECT) console.log("OB_TIMELINE.remove_segments(" + band_name + ")");
    };

    OB_TIMELINE.prototype.add_line_current_time = function (color) {
        if (color === undefined) {
            color = this.track(new THREE.Color("rgb(243,23,51)"));
        }

        let ob_x;
        for (let i = 0; i < this.bands.length; i++) {
            ob_x = this.dateToPixelOffSet(new Date(Date.now()), this.bands[i].gregorianUnitLengths, this.bands[i].intervalPixels);
            if (ob_x.isNaN) return;
            this.add_segment(this.bands[i].name, ob_x, this.bands[i].height / 2, 20, this.bands[i].heightMax, color, false);
            this.add_segment(this.bands[i].name, ob_x + 0.45, this.bands[i].height / 2, 20, this.bands[i].heightMax, this.bands[i].color, false);
            this.add_segment(this.bands[i].name, ob_x, -this.bands[i].height / 2, 20, this.bands[i].heightMax, color, false);
            this.add_segment(this.bands[i].name, ob_x + 0.45, -this.bands[i].height / 2, 20, this.bands[i].heightMax, this.bands[i].color, false);
        }
    };
    OB_TIMELINE.prototype.add_text_CSS2D = function (ob_object, text, x, y, z, size, color) {
        if (color === undefined) {
            color = this.track(new THREE.Color("rgb(114, 171, 173)"));
        }

        let textDiv = document.createElement('div');
        textDiv.className = 'ob_label';
        textDiv.style.align = this.font_align;
        textDiv.style.fillStyle = this.color;
        textDiv.style.fontFamily = 'Arial';
        textDiv.style.fontSize = this.fontSize;
        textDiv.style.strokeStyle = '#000';
        textDiv.style.strokeWidth = '0';
        textDiv.style.fontStyle = 'Normal';
        textDiv.style.fontVariant = 'Normal';
        textDiv.style.fontWeight = 'Normal';
        textDiv.textContent = text;

        let textLabel = this.track(new THREE.CSS2DObject(textDiv));
        textLabel.position.set(x, y, 30);
        textLabel.pos_x = x;
        textLabel.pos_y = y;
        textLabel.pos_z = 30;

        if (ob_object !== undefined) {
            ob_object.add(textLabel);
        }
        if (ob_debug_ADD_WEBGL_OBJECT) console.log("OB_TIMELINE.TextSprite(" + ob_object + "," + text + "," + x + "," + y + "," + z + "," + size + "," + color + ")");
    };

    OB_TIMELINE.prototype.add_text_sprite = function (ob_object, text, x, y, z, fontSize, fontStyle, fontWeight
        , color, fontFamily) {
        if (color === undefined) {
            color = this.track(new THREE.Color("rgb(114, 171, 173)"));
        }

        let ob_sprite = this.track(new THREE.TextSprite({
            align: this.font_align,
            fillStyle: color,
            fontFamily: fontFamily,
            fontSize: fontSize,
            strokeStyle: '#e00',
            strokeWidth: 0,
            fontStyle: fontStyle,
            fontVariant: 'normal',
            fontWeight: fontWeight,
            text: text,
        }));
        ob_sprite.position.set(x, y, 30);
        ob_sprite.pos_x = x;
        ob_sprite.pos_y = y;
        ob_sprite.pos_z = 30;

        if (ob_object !== undefined) {
            ob_object.add(ob_sprite);
        }
        if (ob_debug_ADD_WEBGL_OBJECT) console.log("OB_TIMELINE.TextSprite(" + ob_object + "," + text + "," + x + "," + y + "," + z + "," + size + "," + color + ")");
    };
    OB_TIMELINE.prototype.add_text3D = function (band_name, text, x, y, z, size, color) {
        if (color === undefined) {
            color = this.track(new THREE.Color("rgb(114, 171, 173)"));
        }
        let textMaterial = this.track(new THREE.MeshBasicMaterial({color: color}));
        let textGeometry = this.track(new THREE.TextGeometry(text, {
            font: ob_font,
            size: size,
            height: 5,
            curveSegments: 0,
            bevelEnabled: false,
            bevelThickness: 0,
            bevelSize: 0,
            bevelSegments: 0
        }));

        let textMesh = this.track(new THREE.Mesh(textGeometry, textMaterial));
        textMesh.position.set(x, y, z);
        textMesh.name = band_name + "_" + textMesh.id;
        //textMesh.name = band_name + "_" + text + "_" + textMesh.id;

        this.ob_scene.add(textMesh);
        let ob_band = this.ob_scene.getObjectByName(band_name);
        if (ob_band !== undefined) {
            ob_band.add(textMesh);
        }
        if (ob_debug_ADD_WEBGL_OBJECT) console.log("OB_TIMELINE.addText3D(" + band_name + "," + text + "," + x + "," + y + "," + z + "," + size + "," + color + ")");
    };
    OB_TIMELINE.prototype.remove_text3D = function (band_name) {
        let ob_band = this.ob_scene.getObjectByName(band_name);
        if (ob_band !== undefined) {
            ob_band.children = [];
        }
        if (ob_debug_REMOVE_WEBGL_OBJECT) console.log("removeText3D(" + band_name + ")");
    };

    OB_TIMELINE.prototype.build_model = function (sessions) {
        try {
            let obj = Object.entries(sessions);
            if (this.model === undefined) {
                this.model = new Map(obj);
                this.model.delete("title");
                this.model.delete("description");
                this.model.delete("sortByValue");
            } else {
                for (let i = 0; i < obj.length; i++) {
                    if (obj[i][0] !== "title" && obj[i][0] !== "description" && obj[i][0] !== "sortByValue") {
                        let v = this.model.get(obj[i][0]);
                        if (!v.toString().includes(obj[i][1]))
                            this.model.set(obj[i][0], v + "," + obj[i][1]);
                    }
                }
            }

        } catch (err) {
            this.model = undefined;
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
                that.sessions = eval('(' + (sessions) + ')');
                that.update_scene(that.header, that.params, that.bands, that.model, that.sessions, that.camera);
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

// THREE.JS FONTS
    function ob_load_font(font_type) {
        let font = null;
        let loader = new THREE.FontLoader();
        if (font_type === "helvetiker_bold")
            loader.load('three.js/examples/fonts/helvetiker_bold.typeface.json', function (font) {
            });
        else if (font_type === "helvetiker_regular")
            loader.load('three.js/examples/fonts/helvetiker_regular.typeface.json', function (font) {
            });
        else if (font_type === "droid_sans_bold")
            loader.load('three.js/examples/fonts/droid_sans_bold.typeface.json', function (font) {
            });
        else if (font_type === "droid_sans_bold")
            loader.load('three.js/examples/fonts/droid_sans_bold.typeface.json', function (font) {
            });
        else {
            // Default font
            loader.load('three.js/examples/fonts/helvetiker_bold.typeface.json', function (font) {
            });
        }
        return font;
        //loader.load('three.js/examples/fonts/droid/droid_sans_bold.typeface.json', function (font)
        //loader.load('three.js/examples/fonts/droid/droid_sans_mono_regular.typeface.json', function (font)
        //loader.load('three.js/examples/fonts/gentilis_bold.typeface.json', function (font)
        //loader.load('three.js/examples/fonts/optimer_regular.typeface.json', function (font)
        //loader.load('three.js/examples/fonts/optimer_bold.typeface.json', function (font)
        //loader.load('three.js/examples/fonts/droid/droid_sans_regular.typeface.json', function (font)
        // loader.load('three.js/examples/fonts/droid/droid_serif_bold.typeface.json', function (font)
        //loader.load('three.js/examples/fonts/droid/droid_serif_regular.typeface.json', function (font)
    }

//let ob_font = ob_load_font();

    OB_TIMELINE.prototype.ob_setListeners = function () {
        let that = this;

        this.dragControls = this.track(new THREE.DragControls(this.objects, this.ob_camera, this.ob_renderer.domElement));
        this.dragControls.addEventListener('dragstart', function (e) {
            clearInterval(that.ob_refresh_interval_clock);
            if (that.idInterval !== undefined)
                clearInterval(that.idInterval);

            //if (that.ob_controls !== undefined) that.ob_controls.enabled = false;
            let ob_obj = that.ob_scene.getObjectById(e.object.id);
            if (ob_obj === undefined) return;
            if (ob_obj.position !== undefined)
                ob_obj.dragstart_source = ob_obj.position.x;
            else
                ob_obj.dragstart_source = 0;
            if (ob_obj.sortBy !== undefined && ob_obj.sortBy === "true") {
                ob_obj.position.set(ob_obj.pos_x, ob_obj.pos_y, ob_obj.pos_z);
                return;
            } else if (ob_obj.type.match(/Mesh/) && ob_obj.name.match(/_band_/)) {
                that.move_band(ob_obj.name, ob_obj.position.x, ob_obj.pos_y, ob_obj.pos_z, false);
                that.ob_marker.style.visibility = "visible";
                that.ob_time_marker.style.visibility = "visible";
            } else if (ob_obj.type.match(/Mesh/) && ob_obj.name === "") {
                that.move_session(ob_obj, ob_obj.pos_x, ob_obj.pos_y, ob_obj.pos_z);
            } else {
                ob_obj.position.set(ob_obj.pos_x, ob_obj.pos_y, ob_obj.pos_z);
            }
            that.ob_renderer.render(that.ob_scene, that.ob_camera);
            //console.log("that.ob_renderer.render(that.ob_scene, that.ob_camera)");

            if (ob_debug_MOVE_WEBGL_OBJECT) console.log("dragstart :" + that.name + " - " + ob_obj.type + " - " + ob_obj.name);
            //console.log("dragControls.addEventListener('dragstart'," + e.object.name + ")");
        });
        this.dragControls.addEventListener('dragend', function (e) {
            //if (that.ob_controls !== undefined) that.ob_controls.enabled = true;
            let ob_obj = that.ob_scene.getObjectById(e.object.id);
            if (ob_obj === undefined) return;
            if (ob_obj.sortBy !== undefined && ob_obj.sortBy === "true") {
                ob_obj.position.set(ob_obj.pos_x, ob_obj.pos_y, ob_obj.pos_z);
                return;
            } else if (ob_obj.type.match(/Mesh/) && ob_obj.name.match(/_band_/)) {
                that.move_band(ob_obj.name, ob_obj.position.x, ob_obj.pos_y, ob_obj.pos_z, true);
                that.ob_marker.style.visibility = "visible";
                that.ob_time_marker.style.visibility = "visible";
            } else if (ob_obj.type.match(/Mesh/) && ob_obj.name === "") {
                that.move_session(ob_obj, ob_obj.position.x, ob_obj.pos_y, ob_obj.pos_z);
                that.ob_open_descriptor(ob_obj.data);
                return;
            } else {
                ob_obj.position.set(ob_obj.pos_x, ob_obj.pos_y, ob_obj.pos_z);
            }
            that.ob_renderer.render(that.ob_scene, that.ob_camera);
            //that.dragControls = that.track(new THREE.DragControls(that.objects, that.ob_camera, that.ob_renderer.domElement));
            if (ob_debug_MOVE_WEBGL_OBJECT) console.log("dragend :" + that.name + " - " + ob_obj.type + " - " + ob_obj.name);

            // Update scene according the new bands position
            that.params[0].date = that.ob_markerDate.toString().substring(0, 24) + " UTC";
            that.params[0].date_cal = that.ob_markerDate;
            that.params[0].show_calendar = true;
            that.update_bands_MinDate(that.params[0].date);
            that.update_bands_MaxDate(that.params[0].date);

            if (that.data && that.data.match(/^(http?):\/\//) ||
                that.data.match(/^(wss?|ws):\/\/[^\s$.?#].[^\s]*$/) ||
                that.data && that.data.match(/^(https?):\/\//)) {
                that.data_head = that.data.split("?");

                let ob_source = ob_obj.position.x;
                let ob_drag_end_source = ob_obj.position.x;
                let ob_speed = (ob_obj.dragstart_source - ob_source) / 60;
                that.idInterval = setInterval(ob_move, 5);

                function ob_move() {
                    if (ob_obj.dragstart_source >= ob_source - 5 && ob_obj.dragstart_source <= ob_source + 1) {
                        if (that.idInterval !== undefined)
                            clearInterval(that.idInterval);
                    } else {
                        if (ob_speed > 0)
                            ob_speed = ob_speed - 0.0025;
                        else
                            ob_speed = ob_speed + 0.0025;
                        if (Math.round(ob_speed) === 0)
                            clearInterval(that.idInterval);

                        if (ob_obj.dragstart_source <= ob_source)
                            ob_drag_end_source = ob_drag_end_source - ob_speed;
                        else
                            ob_drag_end_source = ob_drag_end_source - ob_speed;

                        that.move_band(ob_obj.name, ob_drag_end_source, ob_obj.pos_y, ob_obj.pos_z, true);
                        that.ob_renderer.render(that.ob_scene, that.ob_camera);
                        if (ob_obj.pos_x > -ob_obj.position.x - that.width || ob_obj.position.x < ob_obj.pos_x + that.width) {
                            if (that.idInterval !== undefined)
                                clearInterval(that.idInterval);
                            that.loadData();
                        }
                        /*console.log("|...........................................V.......................................|");
                        console.log(
                            new Date(that.minDateL).toISOString() + "............................................................." +
                            new Date(that.maxDateL).toISOString() + "\n" +
                            "............................................." + new Date(that.startDateTime).toISOString() + "\n" +
                            "ob_obj.pos_x=" + ob_obj.pos_x + " ob_obj.position.x=" + ob_obj.position.x)*/
                    }
                }
            } else {

                let ob_source = ob_obj.position.x;
                let ob_drag_end_source = ob_obj.position.x;
                let ob_speed = (ob_obj.dragstart_source - ob_source) / 60;
                that.idInterval = setInterval(ob_move, 5);

                function ob_move() {
                    if (ob_obj.dragstart_source >= ob_source - 5 && ob_obj.dragstart_source <= ob_source + 1) {
                        if (that.idInterval !== undefined)
                            clearInterval(that.idInterval);
                    } else {
                        if (ob_speed > 0)
                            ob_speed = ob_speed - 0.0025;
                        else
                            ob_speed = ob_speed + 0.0025;
                        if (Math.round(ob_speed) === 0)
                            clearInterval(that.idInterval);

                        if (ob_obj.dragstart_source <= ob_source)
                            ob_drag_end_source = ob_drag_end_source - ob_speed;
                        else
                            ob_drag_end_source = ob_drag_end_source - ob_speed;

                        that.move_band(ob_obj.name, ob_drag_end_source, ob_obj.pos_y, ob_obj.pos_z, true);
                        that.ob_renderer.render(that.ob_scene, that.ob_camera);
                        if (ob_obj.pos_x > -ob_obj.position.x - that.width || ob_obj.position.x < ob_obj.pos_x + that.width) {
                            if (that.idInterval !== undefined)
                                clearInterval(that.idInterval);
                            that.update_scene(that.header, that.params, that.bands, that.model, that.sessions, that.camera);
                        }

                        /*console.log("|...........................................V.......................................|");
                        console.log(
                            new Date(that.minDateL).toISOString() + "............................................................." +
                            new Date(that.maxDateL).toISOString() + "\n" +
                            "............................................." + new Date(that.startDateTime).toISOString() + "\n" +
                            "ob_obj.pos_x=" + ob_obj.pos_x + " ob_obj.position.x=" + ob_obj.position.x);*/
                    }
                }
            }

            //console.log("dragControls.addEventListener('dragend'," + e.object.name + ")");
        });

        this.dragControls.addEventListener('drag', function (e) {
            //console.log("dragControls.addEventListener('drag'): moving " + e.object.type);
            //if (that.ob_controls !== undefined) that.ob_controls.enabled = false;
            let ob_obj = that.ob_scene.getObjectById(e.object.id);
            if (ob_obj === undefined) return;
            if (ob_obj.sortBy !== undefined && ob_obj.sortBy === "true") {
                ob_obj.position.set(ob_obj.pos_x, ob_obj.pos_y, ob_obj.pos_z);
                return;
            } else if (ob_obj.type.match(/Mesh/) && ob_obj.name.match(/_band_/)) {
                that.move_band(ob_obj.name, ob_obj.position.x, ob_obj.pos_y, ob_obj.pos_z, true);
                that.ob_marker.style.visibility = "visible";
                that.ob_time_marker.style.visibility = "visible";
            } else if (ob_obj.type.match(/Mesh/) && ob_obj.name === "") {
                that.move_session(ob_obj, ob_obj.position.x, ob_obj.pos_y, ob_obj.pos_z)
            } else {
                ob_obj.position.set(ob_obj.pos_x, ob_obj.pos_y, ob_obj.pos_z);
            }
            that.ob_renderer.render(that.ob_scene, that.ob_camera);
            if (ob_debug_MOVE_WEBGL_OBJECT) console.log("drag :" + that.name + " - " + ob_obj.type + " - " + ob_obj.name);
        });

    };

    OB_TIMELINE.prototype.ob_set_scene = function () {
        if (this.ob_scene === undefined) {
            this.ob_scene = this.track(new THREE.Scene());
            this.ob_scene.background = new THREE.Color(0x000000);
        }

        if (this.ob_renderer === undefined) {
            this.ob_renderer = this.track(new THREE.WebGLRenderer({antialias: true}));
            this.ob_renderer.setClearColor(0xffffff, 1);
            this.ob_renderer.setPixelRatio(window.devicePixelRatio);
            this.ob_renderer.shadowMap.enabled = true;
        }
        this.ob_timeline_body.appendChild(this.ob_renderer.domElement);

        //this.ob_labelRenderer = new THREE.CSS2DRenderer();
        //document.body.appendChild(this.ob_labelRenderer.domElement);
        this.ob_renderer.domElement.clientWidth = this.width + "px";
        this.ob_renderer.domElement.clientHeight = this.height + "px";
        this.ob_renderer.setSize(this.width, this.height);
        //this.ob_labelRenderer.setSize(this.width, this.height);
        //this.ob_labelRenderer.domElement.style.position = 'absolute';
        //this.ob_labelRenderer.domElement.style.top = '0';
        //this.ob_create_gui(true);
    };

    OB_TIMELINE.prototype.ob_set_camera = function () {
        if (this.camera === undefined) this.camera = "Orthographic";
        if (this.camera === "Orthographic") {
            this.ob_pos_orthographic_camera_x = 0;
            this.ob_pos_orthographic_camera_y = 0;
            this.ob_pos_orthographic_camera_z = this.height;
            this.ob_camera = this.track(new THREE.OrthographicCamera(-this.width / 2, this.width / 2, this.height, 0, -this.width, this.ob_far));
            this.ob_camera.position.set(this.ob_pos_orthographic_camera_x, this.ob_pos_orthographic_camera_y, this.ob_pos_orthographic_camera_z);
            this.ob_scene.add(this.ob_camera);
            //this.ob_camera.lookAt(this.ob_lookAt_x, this.ob_lookAt_y, this.ob_lookAt_z);
        } else {
            this.ob_camera = this.track(new THREE.PerspectiveCamera(this.ob_fov, this.width / this.height, this.ob_near, this.ob_far));
            this.ob_camera.position.set(this.ob_pos_camera_x, this.ob_pos_camera_y, this.ob_pos_camera_z);
            this.ob_scene.add(this.ob_camera);
            this.ob_camera.lookAt(this.ob_lookAt_x, this.ob_lookAt_y, this.ob_lookAt_z);
            this.ob_scene.add(this.track(new THREE.AmbientLight(0xf0f0f0)));
            let light = this.track(new THREE.SpotLight(0xffffff, 1.5));
            light.position.set(0, 1500, 200);
            light.castShadow = true;
            //light.shadow = this.track(new THREE.LightShadow(new THREE.PerspectiveCamera(this.ob_fov, 1, 200, 2000)));
            light.shadow.bias = -0.000222;
            light.shadow.mapSize.width = 1024;
            light.shadow.mapSize.height = 1024;
            this.ob_scene.add(light);

            //let planeGeometry = new THREE.PlaneBufferGeometry(2000, 2000);
            // planeGeometry.rotateX(-Math.PI / 2);
            // let planeMaterial = new THREE.ShadowMaterial({opacity: 0.2});

            //let plane = new THREE.Mesh(planeGeometry, planeMaterial);
            //plane.position.y = 0;
            //plane.receiveShadow = true;
            //this.ob_scene.add(plane);

            //let helper = new THREE.GridHelper(2000, 100);
            //helper.position.y = 0;
            //helper.material.opacity = 0.25;
            //helper.material.transparent = true;
            //this.ob_scene.add(helper);

            //let axes = new THREE.AxesHelper(1);
            //axes.position.set(0, 0, 0);
            //this.ob_scene.add(axes);

            //stats = new Stats();
            //this.ob_controls = new THREE.OrbitControls(this.ob_camera, this.ob_renderer.domElement);
            //this.ob_controls.enableDamping = true; // an animation loop is required when either damping or auto-rotation are enabled
            //this.ob_controls.dampingFactor = 0.25;
            //this.ob_controls.screenSpacePanning = false;
            //this.ob_controls.minDistance = 100;
            //this.ob_controls.maxDistance = 2000;
            //this.ob_controls.maxPolarAngle = Math.PI;
        }

        // Set all listeners
        this.ob_setListeners();

        //requestAnimationFrame(this.animate);
        this.ob_renderer.render(this.ob_scene, this.ob_camera);
        //console.log("ob_set_camera() - camera:" + this.camera);
    };

    OB_TIMELINE.prototype.animate = function () {
        ob_timelines.forEach(function (ob_timeline) {
            ob_timeline.ob_renderer.render(ob_timeline.ob_scene, ob_timeline.ob_camera);
            //ob_timeline.updateSize();
            //ob_timeline.ob_canvas.style.transform = `translateY(${window.scrollY}px)`;
            //if (ob_timeline.ob_camera !== undefined) {
            //ob_timeline.ob_renderer.render(ob_timeline.ob_scene, ob_timeline.ob_camera);
            //console.log("animate(): ob_scene:" + ob_timeline.ob_scene.uuid);
            // }
        });
        //this.requestAnimationFrame(OB_TIMELINE.prototype.animate);
        // required if controls.enableDamping or controls.autoRotate are set to true
        //this.ob_controls.update();
    };

    OB_TIMELINE.prototype.runUnitTestsMinutes = function () {
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
                ob_type = "type5";
                ob_start = new Date(Date.now() - 12000);
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
                ob_type = "type2";
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
                ob_type = "type12";
                ob_title = "Session______________________________________" + i;
            } else if (i === 69) {
                ob_start = new Date(Date.now() + (30000));
                ob_end = new Date(Date.now() + (110000));
                ob_title = "Session++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++" + i;
            } else if (i === 44 || i === 57 || i === 61 || i === 89 || i === 190 || i === 342 || i === 482) {
                ob_start = new Date(Date.now() + i * 5000);
                ob_end = "";
                ob_type = "type6";
                ob_title = "event_plusplusplusplusplusplus" + i;
            } else if (i > 100 && i < 110) {
                ob_type = "type" + i;
            } else if (i > 200 && i < 210) {
                ob_type = "type" + i;
            } else if (i > 300 && i < 310) {
                ob_type = "type" + i;
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
        this.sessions = eval('(' + (sessions) + ')');

        this.update_scene(this.header, this.params, this.bands, this.model, this.sessions, this.camera);
    };
    OB_TIMELINE.prototype.runUnitTestsHours = function () {
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
                ob_type = "type11";
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
                ob_type = "type10";
                ob_title = "session" + i;
            } else if (i % 17 === 0) {
                ob_start = new Date(Date.now() + i * 50000);
                ob_end = "";
                ob_type = "type17";
                ob_title = "s" + i;
            } else if (i % 16 === 0) {
                ob_start = new Date(Date.now() + i * 50000);
                ob_end = "";
                ob_type = "type16";
                ob_title = "s" + i;
            } else if (i % 11 === 0) {
                ob_start = new Date(Date.now() + i * 50000);
                ob_end = "";
                ob_type = "type11";
                ob_title = "s" + i;
            } else if (i % 10 === 0) {
                ob_start = new Date(Date.now() + i * 50000);
                ob_end = "";
                ob_type = "type10";
                ob_title = "s" + i;
                ob_status = "RUNNING";
            } else if (i % 7 === 0) {
                ob_start = new Date(Date.now() + i * 50000);
                ob_end = "";
                ob_type = "type7";
                ob_title = "s" + i;
            } else if (i % 5 === 0) {
                ob_start = new Date(Date.now() + i * 50000);
                ob_end = "";
                ob_type = "type3";
                ob_title = "s" + i;
                ob_status = "ABORTED";
            } else if (i % 13 === 0) {
                ob_start = new Date(Date.now() + i * 50000);
                ob_end = new Date(Date.now() + i * 65000);
                ob_type = "type13";
                ob_title = "session_long_long_LONG_long_long_long_long_LONG_long_long_long_long" + i;
            } else if (i % 9 === 0) {
                ob_start = new Date(Date.now() + i * 300000);
                ob_end = new Date(Date.now() + i * 650000);
                ob_type = "type9";
                ob_title = "session" + i;
            } else if (i % 6 === 0) {
                ob_start = new Date(Date.now() + i * 300000);
                ob_end = new Date(Date.now() + i * 650000);
                ob_type = "type6";
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
                ob_type = "type" + i;
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
        this.sessions = eval('(' + (sessions) + ')');

        this.update_scene(this.header, this.params, this.bands, this.model, this.sessions, this.camera);
        console.log("Stop runUnitTestsHours at:" + Date() + " - " + new Date().getMilliseconds());
    };
    OB_TIMELINE.prototype.loadData = function () {
        if (this.minDate != undefined)
            console.log("loadData()" + "From " + this.minDate + " to " + this.maxDate);

        if (this.idInterval !== undefined)
            clearInterval(this.idInterval);
        this.ob_init();

        if (this.data === undefined) {
            this.update_scene(this.header, this.params, this.bands, this.model, this.sessions, this.camera);
            return;
        }
        if (this.data === "unit_tests_minutes") {
            this.ob_not_connected();
            this.runUnitTestsMinutes();
            return;
        }
        if (this.data === "unit_tests_hours") {
            this.ob_not_connected();
            this.runUnitTestsHours();
            return;
        }

        if (!this.data.includes(".json") && !this.data.includes("=test") && !this.data.includes("UTC")) {
            this.ob_not_connected();
            this.data_head = this.data.split("?");
            this.update_bands_MinDate(this.params[0].date);
            this.update_bands_MaxDate(this.params[0].date);
            this.data = this.data_head[0] + "?startDate=" + this.minDate + "&endDate=" + this.maxDate +
                "&ob_filter=" + this.ob_filter;
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
                that.sessions = eval('(' + (e.data) + ')');
                that.update_scene(that.header, that.params, that.bands, that.model, that.sessions, that.camera);
            };
            ws.onerror = function () {
                this.ob_not_connected();
            }
            ws.onclose = function () {
                // connection closed, discard old websocket and create a new one in 5s
                console.log("WS - onclose!");
                this.ob_not_connected();
                that.ws = null;
                setTimeout(that.loadData(), 10000)
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
                    'Content-Type': 'application/json'
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
                    that.sessions = json;
                    that.update_scene(that.header, that.params, that.bands, that.model, that.sessions, that.camera);
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
                    // If clients have set Access-Control-Allow-Credentials to true, the openbexi.timeline.server will not permit the use of
                    // credentials and access to resource by the client will be blocked by CORS policy.
                    //withCredentials: true
                });
                this.eventSource = eventSource;
                eventSource.onmessage = function (e) {
                    //console.log('onmessage: Receiving sessions:' + e.openbexi.timeline.data);
                    that.ob_connected();
                    that.sessions = eval('(' + (e.data) + ')');
                    that.update_scene(that.header, that.params, that.bands, that.model, that.sessions, that.camera);
                    //eventSource.close();
                };
                eventSource.onopen = function (e) {
                    //that.update_scene(that.header, that.params, that.bands, that.model, that.sessions, that.camera);
                    that.ob_connected();
                };
                eventSource.onerror = function (e) {
                    // Very important: Do not close the session otherwise this client would not reconnect
                    //eventSource.close();
                    that.ob_not_connected();
                    console.log('SSE - onerror');
                    that.loadData();
                    console.log('SSE - reconnecting ...');
                }

            } else {
                let that = this;
                fetch(this.data, {
                    method: 'GET',
                    dataType: 'json',
                    headers: {
                        "Accept": "application/json",
                        'Content-Type': 'application/json'
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
                        that.sessions = json;
                        that.update_scene(that.header, that.params, that.bands, that.model, that.sessions, that.camera);
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

    function ob_drop_data(event) {
        event.preventDefault();
        try {
            if (!event.dataTransfer) {
                console.log("Your browser does not support the dataTransfer object...");
                return false;
            }
            let file_type = "";
            let file_name = "";
            if (event.dataTransfer.files.length === 0)
                return;
            if (event.dataTransfer.files[0] !== undefined) {
                file_type = event.dataTransfer.files[0].type;
                file_name = event.dataTransfer.files[0].name;
            } else {
                console.log("Your browser does not support the dataTransfer object...");
                return false;
            }
            let reader = new FileReader();
            reader.filename = file_name;
            reader.onloadend = function (event) {

            };
            reader.onload = function (event) {
                let data = JSON.parse(event.target.result);
                let ob_timeline_instance = get_ob_timeline(data.params[0].name);
                if (ob_timeline_instance === null) return;
                ob_timeline_instance.params = data.params;
                ob_timeline_instance.bands = data.bands;
                ob_timeline_instance.model = data.model;
                ob_timeline_instance.ob_init();

                //ob_timeline_instance.ob_camera.aspect = ob_timeline_instance.width / ob_timeline_instance.height;
                //ob_timeline_instance.ob_renderer.setSize(ob_timeline_instance.width , ob_timeline_instance.height);
                //ob_timeline_instance.ob_set_scene();
                /*ob_timeline_instance.create_bands();
                ob_timeline_instance.add_line_current_time();
                ob_timeline_instance.create_segments_and_dates();

                ob_timeline_instance.loadData();
                ob_timeline_instance.center_bands();
                ob_timeline_instance.ob_set_camera();*/
            };
            reader.readAsText(event.dataTransfer.files[0]);
            return false;

        } catch (e) {
            return true;
        }
    }

    function ob_dragHandler(ev) {
        ev.preventDefault();
    }

    window.onscroll = function (e) {
        ob_timelines.forEach(function (ob_timeline) {
            //ob_timeline.ob_timeline_header.style.top = "0px";
        });
    };
    window.addEventListener('resize', function (e) {
        ob_timelines.forEach(function (ob_timeline) {
            ob_timeline.ob_init();
            ob_timeline.ob_camera.aspect = ob_timeline.width / ob_timeline.height;
            //ob_timeline.ob_renderer.setSize(window.innerWidth, ob_timeline.height);
            //ob_timeline.ob_set_camera();
            //ob_timeline.ob_camera.updateProjectionMatrix();
        });
    }, false);
}

function ob_load_timeline(ob_timeline_instance) {
    ob_timelines.push(ob_timeline_instance);
    ob_timeline_instance.loadData();
}