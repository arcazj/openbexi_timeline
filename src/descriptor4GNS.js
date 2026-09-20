OB_TIMELINE.prototype.descriptor4GNS = function (descriptor) {
    let div = document.createElement("div");
    div.id = this.name + "_descriptor";
    div.className = "ob_descriptor";
    if (window.innerHeight > parseInt(this.height) + parseInt(this.ob_timeline_header.style.height))
        div.style.height = parseInt(this.height) + parseInt(this.ob_timeline_header.style.height) + "px";
    else
        div.style.height = window.innerHeight + "px";

    if (descriptor.id === undefined) descriptor.id = "";
    if (descriptor.end === undefined) descriptor.end = "";
    let ob_descriptor_body = "";
    for (let [key, value] of Object.entries(descriptor.data)) {
        if (key !== "sortByValue" && key !== "description" && key !== "analyze" && key !== "title" &&
            value.trim() !== "" && value !== "NA" && value !== "?" && value !== undefined)
            ob_descriptor_body += "<tr><td class=ob_descriptor_td><b>" + key + ":</b></td><td>" + value + "</td></tr>";
    }
    ob_descriptor_body += "<tr><td class=ob_descriptor_td><b>" + "DSM template name" + ":</b></td><td>" + "" + "</td></tr>";
    ob_descriptor_body += "<tr><td class=ob_descriptor_td><b>" + "Primary unary ressource" + ":</b></td><td>" + "" + "</td></tr>";
    ob_descriptor_body += "<tr><td class=ob_descriptor_td><b>" + "Backup unary ressource" + ":</b></td><td>" + "" + "</td></tr>";
    ob_descriptor_body += "<tr><td class=ob_descriptor_td><b>" + "Nominal unary ressource list" + ":</b></td><td>" + "" + "</td></tr>";
    ob_descriptor_body += "<tr><td class=ob_descriptor_td><b>" + "Conflicts" + ":</td><td>" + "" + "</b></td></tr>";
    div.innerHTML = "<div class=ob_descriptor_head >" + "data" + "<\div><br><br>" +
        "<table class=ob_descriptor_table id=" + this.name + "_table_start_end" + ">" +
        "<tr class=ob_descriptor_tr><td class=ob_descriptor_td><b>Repeater id : </b></td><td class=ob_descriptor_td2>" +
        "" + "</td></tr>" +
        "<tr class=ob_descriptor_tr><td class=ob_descriptor_td><b>Session id : </b></td><td class=ob_descriptor_td2>" +
        descriptor.id + "</td></tr>" +
        "<tr class=ob_descriptor_tr><td class=ob_descriptor_td><b>Activity id : </b></td><td class=ob_descriptor_td2>" +
        descriptor.sessionID + "</td></tr>" +
        "<tr class=ob_descriptor_tr><td class=ob_descriptor_td><b>title:</b></td><td class=ob_descriptor_td2>" +
        descriptor.data.title + "</td></tr>" +
        "<tr class=ob_descriptor_tr><td class=ob_descriptor_td><b>start : </b></td><td class=ob_descriptor_td2>" +
        descriptor.start + "</td></tr>" +
        "<tr class=ob_descriptor_tr><td class=ob_descriptor_td><b>original_start : </b></td><td class=ob_descriptor_td2>" +
        descriptor.original_start + "</td></tr>" +
        "<tr class=ob_descriptor_tr><td class=ob_descriptor_td><b>end : </b></td><td class=ob_descriptor_td2>" +
        descriptor.end + "</td></tr>" +
        "<tr class=ob_descriptor_tr><td class=ob_descriptor_td><b>original_end : </b></td><td class=ob_descriptor_td2>" +
        descriptor.original_end + "</td></tr>" +
        "<tr class=ob_descriptor_tr><td></td></tr>" +
        ob_descriptor_body +
        "<tr><td></td></tr>" +
        "<tr class=ob_descriptor_tr><td class=ob_descriptor_td><b>description:</b></td><td class=ob_descriptor_td2>" +
        descriptor.data.description + "</td></tr>" +
        "</table>";
    return div;
}