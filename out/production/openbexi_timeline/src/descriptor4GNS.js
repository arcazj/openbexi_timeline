OB_TIMELINE.prototype.descriptor4GNS = function (descriptor) {
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
    return div;
}