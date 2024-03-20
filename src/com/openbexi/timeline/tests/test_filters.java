package com.openbexi.timeline.tests;

import com.openbexi.timeline.data_browser.data_configuration;
import com.openbexi.timeline.data_browser.json_files_manager;
import org.json.simple.parser.ParseException;
import org.junit.Assert;
import org.junit.Test;

import java.io.IOException;

public class test_filters {

    private data_configuration _data_configuration;

    public void set_data_configuration() {
        try {
            this._data_configuration = new data_configuration("yaml/sources_startup.yml");
        } catch (IOException e) {
            throw new RuntimeException(e);
        } catch (ParseException e) {
            throw new RuntimeException(e);
        }
    }

    @Test
    /**
     * Create a first filter
     */
    public void test_case1() {
        this.set_data_configuration();
        _data_configuration.getConfiguration().put("startDate", null);
        _data_configuration.getConfiguration().put("endDate", null);
        _data_configuration.getConfiguration().put("search", null);
        _data_configuration.getConfiguration().put("filter", "");
        _data_configuration.getConfiguration().put("request", "");
        json_files_manager data = new json_files_manager(null, null, _data_configuration);
        data.removeAllFilter("ob_timeline_0", "test");
        Object json = data.updateFilter("updateFilter", "ob_timeline_0", "0", "",
                "Timeline report", "My_filter1", "#a1d9ff", "test",
                "test@mail.com", "0", "0", "1350", "600",
                "Orthographic", "NONE",
                data.get_filter());
        String filter1 = "{\"dateTimeFormat\":\"iso8601\",\"openbexi_timeline\":[{\"backgroundColor\":\"#a1d9ff\",\"sources\":[{\"data_model\":\"\\/data\\/SOURCES1\\/yyyy\\/mm\\/dd\",\"converter2events_class\":\"build_in\",\"permission\":\"\",\"type\":\"json_file\",\"url\":null,\"data_path\":\"\\/data\\/\",\"filter\":{\"include\":\"\",\"exclude\":\"\"},\"database\":null,\"password\":null,\"connector\":\"secure_sse:8441|secure:8442\",\"enable\":true,\"namespace\":\"SOURCE1\",\"user\":null,\"dataSources\":null,\"render\":{\"color\":\"#00b300\",\"alternateColor\\\"\":\"#6ac1db\"}},{\"data_model\":\"\\/data\\/SOURCES2\\/yyyy\\/mm\\/dd\",\"converter2events_class\":\"build_in\",\"permission\":\"\",\"type\":\"json_file\",\"url\":null,\"data_path\":\"\\/data\\/\",\"filter\":{\"include\":\"\",\"exclude\":\"\"},\"database\":null,\"password\":null,\"connector\":\"secure_sse:8441|secure:8442\",\"enable\":false,\"namespace\":\"SOURCE2\",\"user\":null,\"dataSources\":null,\"render\":{\"color\":\"#10b300\",\"alternateColor\\\"\":\"#9ac1db\"}}],\"start\":\"current_time\",\"title1\":\"Timeline report\",\"filters\":[{\"backgroundColor\":\"#a1d9ff\",\"current\":\"yes\",\"filter_value\":\"\",\"name\":\"My_filter1\",\"sortBy\":\"NONE\"}],\"top\":\"0\",\"left\":\"0\",\"name\":\"ob_timeline_0\",\"width\":\"1350\",\"sortBy\":\"NONE\",\"camera\":\"Orthographic\",\"user\":\"test\",\"email\":\"test@mail.com\",\"height\":\"600\"}],\"namespace\":\"\",\"scene\":\"0\"}";
        String filter2 = json.toString();
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    /**
     * Update the first filter
     */
    public void test_case2() {
        this.set_data_configuration();
        _data_configuration.getConfiguration().put("startDate", null);
        _data_configuration.getConfiguration().put("endDate", null);
        _data_configuration.getConfiguration().put("search", null);
        _data_configuration.getConfiguration().put("filter", "system:systemA;system:system1;system:system3;type:type0;type:type4+status:SCHEDULE");
        _data_configuration.getConfiguration().put("request", "");
        json_files_manager data = new json_files_manager(null, null, _data_configuration);
        Object json = data.updateFilter("updateFilter", "ob_timeline_0", "0", "", "Timeline report",
                "My_filter1", "#a1d9ff", "test", "test@mail.com",
                "0", "0", "1350", "600", "Orthographic", "NONE",
                data.get_filter());
        String filter1 = "{\"dateTimeFormat\":\"iso8601\",\"openbexi_timeline\":[{\"backgroundColor\":\"#a1d9ff\",\"sources\":[{\"data_model\":\"\\/data\\/SOURCES1\\/yyyy\\/mm\\/dd\",\"converter2events_class\":\"build_in\",\"permission\":\"\",\"type\":\"json_file\",\"url\":null,\"data_path\":\"\\/data\\/\",\"filter\":{\"include\":\"\",\"exclude\":\"\"},\"database\":null,\"password\":null,\"connector\":\"secure_sse:8441|secure:8442\",\"enable\":true,\"namespace\":\"SOURCE1\",\"user\":null,\"dataSources\":null,\"render\":{\"color\":\"#00b300\",\"alternateColor\\\"\":\"#6ac1db\"}},{\"data_model\":\"\\/data\\/SOURCES2\\/yyyy\\/mm\\/dd\",\"converter2events_class\":\"build_in\",\"permission\":\"\",\"type\":\"json_file\",\"url\":null,\"data_path\":\"\\/data\\/\",\"filter\":{\"include\":\"\",\"exclude\":\"\"},\"database\":null,\"password\":null,\"connector\":\"secure_sse:8441|secure:8442\",\"enable\":false,\"namespace\":\"SOURCE2\",\"user\":null,\"dataSources\":null,\"render\":{\"color\":\"#10b300\",\"alternateColor\\\"\":\"#9ac1db\"}}],\"start\":\"current_time\",\"title1\":\"Timeline report\",\"filters\":[{\"backgroundColor\":\"#a1d9ff\",\"current\":\"yes\",\"filter_value\":\"system:systemA;system:system1;system:system3;type:type0;type:type4+status:SCHEDULE\",\"name\":\"My_filter1\",\"sortBy\":\"NONE\"}],\"top\":\"0\",\"left\":\"0\",\"name\":\"ob_timeline_0\",\"width\":\"1350\",\"sortBy\":\"NONE\",\"camera\":\"Orthographic\",\"user\":\"test\",\"email\":\"test@mail.com\",\"height\":\"600\"}],\"namespace\":\"\",\"scene\":\"0\"}";
        String filter2 = json.toString();
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    /**
     * Add/update a second filter
     */
    public void test_case3() {
        this.set_data_configuration();
        _data_configuration.getConfiguration().put("startDate", null);
        _data_configuration.getConfiguration().put("endDate", null);
        _data_configuration.getConfiguration().put("search", null);
        _data_configuration.getConfiguration().put("filter", "");
        _data_configuration.getConfiguration().put("request", "");
        json_files_manager data = new json_files_manager(null, null, _data_configuration);
        Object json = data.updateFilter("updateFilter", "ob_timeline_0", "0", "", "Timeline report",
                "My_filter2", "#a1d9ff", "test", "test@mail.com",
                "0", "0", "1350", "600", "Orthographic", "NONE",
                data.get_filter());
        String filter1 = "{\"dateTimeFormat\":\"iso8601\",\"openbexi_timeline\":[{\"backgroundColor\":\"#a1d9ff\",\"sources\":[{\"data_model\":\"\\/data\\/SOURCES1\\/yyyy\\/mm\\/dd\",\"converter2events_class\":\"build_in\",\"permission\":\"\",\"type\":\"json_file\",\"url\":null,\"data_path\":\"\\/data\\/\",\"filter\":{\"include\":\"\",\"exclude\":\"\"},\"database\":null,\"password\":null,\"connector\":\"secure_sse:8441|secure:8442\",\"enable\":true,\"namespace\":\"SOURCE1\",\"user\":null,\"dataSources\":null,\"render\":{\"color\":\"#00b300\",\"alternateColor\\\"\":\"#6ac1db\"}},{\"data_model\":\"\\/data\\/SOURCES2\\/yyyy\\/mm\\/dd\",\"converter2events_class\":\"build_in\",\"permission\":\"\",\"type\":\"json_file\",\"url\":null,\"data_path\":\"\\/data\\/\",\"filter\":{\"include\":\"\",\"exclude\":\"\"},\"database\":null,\"password\":null,\"connector\":\"secure_sse:8441|secure:8442\",\"enable\":false,\"namespace\":\"SOURCE2\",\"user\":null,\"dataSources\":null,\"render\":{\"color\":\"#10b300\",\"alternateColor\\\"\":\"#9ac1db\"}}],\"start\":\"current_time\",\"title1\":\"Timeline report\",\"filters\":[{\"backgroundColor\":\"#a1d9ff\",\"current\":\"yes\",\"filter_value\":\"\",\"name\":\"My_filter2\",\"sortBy\":\"NONE\"},{\"backgroundColor\":\"#a1d9ff\",\"current\":\"no\",\"filter_value\":\"system:systemA;system:system1;system:system3;type:type0;type:type4+status:SCHEDULE\",\"name\":\"My_filter1\",\"sortBy\":\"NONE\"}],\"top\":\"0\",\"left\":\"0\",\"name\":\"ob_timeline_0\",\"width\":\"1350\",\"sortBy\":\"NONE\",\"camera\":\"Orthographic\",\"user\":\"test\",\"email\":\"test@mail.com\",\"height\":\"600\"}],\"namespace\":\"\",\"scene\":\"0\"}";
        String filter2 = json.toString();
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    /**
     * Update the second filter
     */
    public void test_case4() {
        this.set_data_configuration();
        _data_configuration.getConfiguration().put("startDate", null);
        _data_configuration.getConfiguration().put("endDate", null);
        _data_configuration.getConfiguration().put("search", null);
        _data_configuration.getConfiguration().put("filter", "system:system1;system:system2;system:system3|system:system3+type:type0");
        _data_configuration.getConfiguration().put("request", "");
        json_files_manager data = new json_files_manager(null, null, _data_configuration);
        Object json = data.updateFilter("updateFilter", "ob_timeline_0", "0", "", "Timeline report",
                "My_filter2", "#a1d9ff", "test", "test@mail.com",
                "0", "0", "1350", "600", "Orthographic", "system",
                data.get_filter());
        String filter1 = "{\"dateTimeFormat\":\"iso8601\",\"openbexi_timeline\":[{\"backgroundColor\":\"#a1d9ff\",\"sources\":[{\"data_model\":\"\\/data\\/SOURCES1\\/yyyy\\/mm\\/dd\",\"converter2events_class\":\"build_in\",\"permission\":\"\",\"type\":\"json_file\",\"url\":null,\"data_path\":\"\\/data\\/\",\"filter\":{\"include\":\"\",\"exclude\":\"\"},\"database\":null,\"password\":null,\"connector\":\"secure_sse:8441|secure:8442\",\"enable\":true,\"namespace\":\"SOURCE1\",\"user\":null,\"dataSources\":null,\"render\":{\"color\":\"#00b300\",\"alternateColor\\\"\":\"#6ac1db\"}},{\"data_model\":\"\\/data\\/SOURCES2\\/yyyy\\/mm\\/dd\",\"converter2events_class\":\"build_in\",\"permission\":\"\",\"type\":\"json_file\",\"url\":null,\"data_path\":\"\\/data\\/\",\"filter\":{\"include\":\"\",\"exclude\":\"\"},\"database\":null,\"password\":null,\"connector\":\"secure_sse:8441|secure:8442\",\"enable\":false,\"namespace\":\"SOURCE2\",\"user\":null,\"dataSources\":null,\"render\":{\"color\":\"#10b300\",\"alternateColor\\\"\":\"#9ac1db\"}}],\"start\":\"current_time\",\"title1\":\"Timeline report\",\"filters\":[{\"backgroundColor\":\"#a1d9ff\",\"current\":\"yes\",\"filter_value\":\"system:system1;system:system2;system:system3|system:system3+type:type0\",\"name\":\"My_filter2\",\"sortBy\":\"system\"},{\"backgroundColor\":\"#a1d9ff\",\"current\":\"no\",\"filter_value\":\"system:systemA;system:system1;system:system3;type:type0;type:type4+status:SCHEDULE\",\"name\":\"My_filter1\",\"sortBy\":\"NONE\"}],\"top\":\"0\",\"left\":\"0\",\"name\":\"ob_timeline_0\",\"width\":\"1350\",\"sortBy\":\"system\",\"camera\":\"Orthographic\",\"user\":\"test\",\"email\":\"test@mail.com\",\"height\":\"600\"}],\"namespace\":\"\",\"scene\":\"0\"}";
        String filter2 = json.toString();
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    /**
     * Add/update the third filter
     */
    public void test_case5() {
        this.set_data_configuration();
        _data_configuration.getConfiguration().put("startDate", null);
        _data_configuration.getConfiguration().put("endDate", null);
        _data_configuration.getConfiguration().put("search", null);
        _data_configuration.getConfiguration().put("filter", "system:systemA;system:system1;system:system3");
        _data_configuration.getConfiguration().put("request", "");
        json_files_manager data = new json_files_manager(null, null,
                _data_configuration);
        Object json = data.updateFilter("updateFilter", "ob_timeline_0", "0", "", "Timeline report",
                "My_filter3", "#a1d9ff", "test", "test@mail.com",
                "0", "0", "1350", "600", "Orthographic", "NONE",
                data.get_filter());
        String filter1 = "{\"dateTimeFormat\":\"iso8601\",\"openbexi_timeline\":[{\"backgroundColor\":\"#a1d9ff\",\"sources\":[{\"data_model\":\"\\/data\\/SOURCES1\\/yyyy\\/mm\\/dd\",\"converter2events_class\":\"build_in\",\"permission\":\"\",\"type\":\"json_file\",\"url\":null,\"data_path\":\"\\/data\\/\",\"filter\":{\"include\":\"\",\"exclude\":\"\"},\"database\":null,\"password\":null,\"connector\":\"secure_sse:8441|secure:8442\",\"enable\":true,\"namespace\":\"SOURCE1\",\"user\":null,\"dataSources\":null,\"render\":{\"color\":\"#00b300\",\"alternateColor\\\"\":\"#6ac1db\"}},{\"data_model\":\"\\/data\\/SOURCES2\\/yyyy\\/mm\\/dd\",\"converter2events_class\":\"build_in\",\"permission\":\"\",\"type\":\"json_file\",\"url\":null,\"data_path\":\"\\/data\\/\",\"filter\":{\"include\":\"\",\"exclude\":\"\"},\"database\":null,\"password\":null,\"connector\":\"secure_sse:8441|secure:8442\",\"enable\":false,\"namespace\":\"SOURCE2\",\"user\":null,\"dataSources\":null,\"render\":{\"color\":\"#10b300\",\"alternateColor\\\"\":\"#9ac1db\"}}],\"start\":\"current_time\",\"title1\":\"Timeline report\",\"filters\":[{\"backgroundColor\":\"#a1d9ff\",\"current\":\"yes\",\"filter_value\":\"system:systemA;system:system1;system:system3\",\"name\":\"My_filter3\",\"sortBy\":\"NONE\"},{\"backgroundColor\":\"#a1d9ff\",\"current\":\"no\",\"filter_value\":\"system:system1;system:system2;system:system3|system:system3+type:type0\",\"name\":\"My_filter2\",\"sortBy\":\"system\"},{\"backgroundColor\":\"#a1d9ff\",\"current\":\"no\",\"filter_value\":\"system:systemA;system:system1;system:system3;type:type0;type:type4+status:SCHEDULE\",\"name\":\"My_filter1\",\"sortBy\":\"NONE\"}],\"top\":\"0\",\"left\":\"0\",\"name\":\"ob_timeline_0\",\"width\":\"1350\",\"sortBy\":\"NONE\",\"camera\":\"Orthographic\",\"user\":\"test\",\"email\":\"test@mail.com\",\"height\":\"600\"}],\"namespace\":\"\",\"scene\":\"0\"}";
        String filter2 = json.toString();
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    /**
     * Add/update  the fourth filter
     */
    public void test_case6() {
        this.set_data_configuration();
        _data_configuration.getConfiguration().put("startDate", null);
        _data_configuration.getConfiguration().put("endDate", null);
        _data_configuration.getConfiguration().put("search", null);
        _data_configuration.getConfiguration().put("filter", "system:systemA;system:system1;system:system3");
        _data_configuration.getConfiguration().put("request", "");
        json_files_manager data = new json_files_manager(null, null, _data_configuration);
        Object json = data.updateFilter("updateFilter", "ob_timeline_0", "0", "", "Timeline report",
                "My_filter4", "#a1d9ff", "test", "test@mail.com",
                "0", "0", "1350", "600", "Orthographic", "NONE",
                data.get_filter());
        String filter1 = "{\"dateTimeFormat\":\"iso8601\",\"openbexi_timeline\":[{\"backgroundColor\":\"#a1d9ff\",\"sources\":[{\"data_model\":\"\\/data\\/SOURCES1\\/yyyy\\/mm\\/dd\",\"converter2events_class\":\"build_in\",\"permission\":\"\",\"type\":\"json_file\",\"url\":null,\"data_path\":\"\\/data\\/\",\"filter\":{\"include\":\"\",\"exclude\":\"\"},\"database\":null,\"password\":null,\"connector\":\"secure_sse:8441|secure:8442\",\"enable\":true,\"namespace\":\"SOURCE1\",\"user\":null,\"dataSources\":null,\"render\":{\"color\":\"#00b300\",\"alternateColor\\\"\":\"#6ac1db\"}},{\"data_model\":\"\\/data\\/SOURCES2\\/yyyy\\/mm\\/dd\",\"converter2events_class\":\"build_in\",\"permission\":\"\",\"type\":\"json_file\",\"url\":null,\"data_path\":\"\\/data\\/\",\"filter\":{\"include\":\"\",\"exclude\":\"\"},\"database\":null,\"password\":null,\"connector\":\"secure_sse:8441|secure:8442\",\"enable\":false,\"namespace\":\"SOURCE2\",\"user\":null,\"dataSources\":null,\"render\":{\"color\":\"#10b300\",\"alternateColor\\\"\":\"#9ac1db\"}}],\"start\":\"current_time\",\"title1\":\"Timeline report\",\"filters\":[{\"backgroundColor\":\"#a1d9ff\",\"current\":\"yes\",\"filter_value\":\"system:systemA;system:system1;system:system3\",\"name\":\"My_filter4\",\"sortBy\":\"NONE\"},{\"backgroundColor\":\"#a1d9ff\",\"current\":\"no\",\"filter_value\":\"system:systemA;system:system1;system:system3\",\"name\":\"My_filter3\",\"sortBy\":\"NONE\"},{\"backgroundColor\":\"#a1d9ff\",\"current\":\"no\",\"filter_value\":\"system:system1;system:system2;system:system3|system:system3+type:type0\",\"name\":\"My_filter2\",\"sortBy\":\"system\"},{\"backgroundColor\":\"#a1d9ff\",\"current\":\"no\",\"filter_value\":\"system:systemA;system:system1;system:system3;type:type0;type:type4+status:SCHEDULE\",\"name\":\"My_filter1\",\"sortBy\":\"NONE\"}],\"top\":\"0\",\"left\":\"0\",\"name\":\"ob_timeline_0\",\"width\":\"1350\",\"sortBy\":\"NONE\",\"camera\":\"Orthographic\",\"user\":\"test\",\"email\":\"test@mail.com\",\"height\":\"600\"}],\"namespace\":\"\",\"scene\":\"0\"}";
        String filter2 = json.toString();
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    /**
     * delete the first filter in the list
     */
    public void test_case7() {
        this.set_data_configuration();
        _data_configuration.getConfiguration().put("startDate", null);
        _data_configuration.getConfiguration().put("endDate", null);
        _data_configuration.getConfiguration().put("search", null);
        _data_configuration.getConfiguration().put("filter", "system:systemA;system:system1;system:system3");
        _data_configuration.getConfiguration().put("request", "");
        json_files_manager data = new json_files_manager(null, null, _data_configuration);
        Object json = data.updateFilter("deleteFilter", "ob_timeline_0", "0", "", "Timeline report",
                "My_filter1", "#a1d9ff", "test", "test@mail.com",
                "0", "0", "1350", "600", "Orthographic", "NONE",
                data.get_filter());
        String filter1 = "{\"dateTimeFormat\":\"iso8601\",\"openbexi_timeline\":[{\"backgroundColor\":\"#a1d9ff\",\"sources\":[{\"data_model\":\"\\/data\\/SOURCES1\\/yyyy\\/mm\\/dd\",\"converter2events_class\":\"build_in\",\"permission\":\"\",\"type\":\"json_file\",\"url\":null,\"data_path\":\"\\/data\\/\",\"filter\":{\"include\":\"\",\"exclude\":\"\"},\"database\":null,\"password\":null,\"connector\":\"secure_sse:8441|secure:8442\",\"enable\":true,\"namespace\":\"SOURCE1\",\"user\":null,\"dataSources\":null,\"render\":{\"color\":\"#00b300\",\"alternateColor\\\"\":\"#6ac1db\"}},{\"data_model\":\"\\/data\\/SOURCES2\\/yyyy\\/mm\\/dd\",\"converter2events_class\":\"build_in\",\"permission\":\"\",\"type\":\"json_file\",\"url\":null,\"data_path\":\"\\/data\\/\",\"filter\":{\"include\":\"\",\"exclude\":\"\"},\"database\":null,\"password\":null,\"connector\":\"secure_sse:8441|secure:8442\",\"enable\":false,\"namespace\":\"SOURCE2\",\"user\":null,\"dataSources\":null,\"render\":{\"color\":\"#10b300\",\"alternateColor\\\"\":\"#9ac1db\"}}],\"start\":\"current_time\",\"title1\":\"Timeline report\",\"filters\":[{\"backgroundColor\":\"#a1d9ff\",\"current\":\"yes\",\"filter_value\":\"system:systemA;system:system1;system:system3\",\"name\":\"My_filter4\",\"sortBy\":\"NONE\"},{\"backgroundColor\":\"#a1d9ff\",\"current\":\"no\",\"filter_value\":\"system:systemA;system:system1;system:system3\",\"name\":\"My_filter3\",\"sortBy\":\"NONE\"},{\"backgroundColor\":\"#a1d9ff\",\"current\":\"no\",\"filter_value\":\"system:system1;system:system2;system:system3|system:system3+type:type0\",\"name\":\"My_filter2\",\"sortBy\":\"system\"}],\"top\":\"0\",\"left\":\"0\",\"name\":\"ob_timeline_0\",\"width\":\"1350\",\"sortBy\":\"NONE\",\"camera\":\"Orthographic\",\"user\":\"test\",\"email\":\"test@mail.com\",\"height\":\"600\"}],\"namespace\":\"\",\"scene\":\"0\"}";
        String filter2 = json.toString();
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    /**
     * delete the second filter which is in the middle of the list
     */
    public void test_case8() {
        this.set_data_configuration();
        _data_configuration.getConfiguration().put("startDate", null);
        _data_configuration.getConfiguration().put("endDate", null);
        _data_configuration.getConfiguration().put("search", null);
        _data_configuration.getConfiguration().put("filter", "system:systemA;system:system1;system:system3");
        _data_configuration.getConfiguration().put("request", "");
        json_files_manager data = new json_files_manager(null, null, _data_configuration);
        Object json = data.updateFilter("deleteFilter", "ob_timeline_0", "0", "", "Timeline report",
                "My_filter3", "#a1d9ff", "test", "test@mail.com",
                "0", "0", "1350", "600", "Orthographic", "NONE",
                data.get_filter());
        String filter1 = "{\"dateTimeFormat\":\"iso8601\",\"openbexi_timeline\":[{\"backgroundColor\":\"#a1d9ff\",\"sources\":[{\"data_model\":\"\\/data\\/SOURCES1\\/yyyy\\/mm\\/dd\",\"converter2events_class\":\"build_in\",\"permission\":\"\",\"type\":\"json_file\",\"url\":null,\"data_path\":\"\\/data\\/\",\"filter\":{\"include\":\"\",\"exclude\":\"\"},\"database\":null,\"password\":null,\"connector\":\"secure_sse:8441|secure:8442\",\"enable\":true,\"namespace\":\"SOURCE1\",\"user\":null,\"dataSources\":null,\"render\":{\"color\":\"#00b300\",\"alternateColor\\\"\":\"#6ac1db\"}},{\"data_model\":\"\\/data\\/SOURCES2\\/yyyy\\/mm\\/dd\",\"converter2events_class\":\"build_in\",\"permission\":\"\",\"type\":\"json_file\",\"url\":null,\"data_path\":\"\\/data\\/\",\"filter\":{\"include\":\"\",\"exclude\":\"\"},\"database\":null,\"password\":null,\"connector\":\"secure_sse:8441|secure:8442\",\"enable\":false,\"namespace\":\"SOURCE2\",\"user\":null,\"dataSources\":null,\"render\":{\"color\":\"#10b300\",\"alternateColor\\\"\":\"#9ac1db\"}}],\"start\":\"current_time\",\"title1\":\"Timeline report\",\"filters\":[{\"backgroundColor\":\"#a1d9ff\",\"current\":\"yes\",\"filter_value\":\"system:systemA;system:system1;system:system3\",\"name\":\"My_filter4\",\"sortBy\":\"NONE\"},{\"backgroundColor\":\"#a1d9ff\",\"current\":\"no\",\"filter_value\":\"system:system1;system:system2;system:system3|system:system3+type:type0\",\"name\":\"My_filter2\",\"sortBy\":\"system\"}],\"top\":\"0\",\"left\":\"0\",\"name\":\"ob_timeline_0\",\"width\":\"1350\",\"sortBy\":\"NONE\",\"camera\":\"Orthographic\",\"user\":\"test\",\"email\":\"test@mail.com\",\"height\":\"600\"}],\"namespace\":\"\",\"scene\":\"0\"}";
        String filter2 = json.toString();
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case9() {
        this.set_data_configuration();
        // delete the second filter which is at the end of the list
        _data_configuration.getConfiguration().put("startDate", null);
        _data_configuration.getConfiguration().put("endDate", null);
        _data_configuration.getConfiguration().put("search", null);
        _data_configuration.getConfiguration().put("filter", "system:systemA;system:system1;system:system3;SCHEDULE|system:system1");
        _data_configuration.getConfiguration().put("request", "");
        json_files_manager data = new json_files_manager(null, null, _data_configuration);
        Object json = data.updateFilter("deleteFilter", "ob_timeline_0", "0", "", "Timeline report",
                "My_filter4", "#a1d9ff", "test", "test@mail.com",
                "0", "0", "1350", "600", "Orthographic", "NONE",
                data.get_filter());
        String filter1 = "{\"dateTimeFormat\":\"iso8601\",\"openbexi_timeline\":[{\"backgroundColor\":\"#a1d9ff\",\"sources\":[{\"data_model\":\"\\/data\\/SOURCES1\\/yyyy\\/mm\\/dd\",\"converter2events_class\":\"build_in\",\"permission\":\"\",\"type\":\"json_file\",\"url\":null,\"data_path\":\"\\/data\\/\",\"filter\":{\"include\":\"\",\"exclude\":\"\"},\"database\":null,\"password\":null,\"connector\":\"secure_sse:8441|secure:8442\",\"enable\":true,\"namespace\":\"SOURCE1\",\"user\":null,\"dataSources\":null,\"render\":{\"color\":\"#00b300\",\"alternateColor\\\"\":\"#6ac1db\"}},{\"data_model\":\"\\/data\\/SOURCES2\\/yyyy\\/mm\\/dd\",\"converter2events_class\":\"build_in\",\"permission\":\"\",\"type\":\"json_file\",\"url\":null,\"data_path\":\"\\/data\\/\",\"filter\":{\"include\":\"\",\"exclude\":\"\"},\"database\":null,\"password\":null,\"connector\":\"secure_sse:8441|secure:8442\",\"enable\":false,\"namespace\":\"SOURCE2\",\"user\":null,\"dataSources\":null,\"render\":{\"color\":\"#10b300\",\"alternateColor\\\"\":\"#9ac1db\"}}],\"start\":\"current_time\",\"title1\":\"Timeline report\",\"filters\":[{\"backgroundColor\":\"#a1d9ff\",\"current\":\"yes\",\"filter_value\":\"system:system1;system:system2;system:system3|system:system3+type:type0\",\"name\":\"My_filter2\",\"sortBy\":\"system\"}],\"top\":\"0\",\"left\":\"0\",\"name\":\"ob_timeline_0\",\"width\":\"1350\",\"sortBy\":\"NONE\",\"camera\":\"Orthographic\",\"user\":\"test\",\"email\":\"test@mail.com\",\"height\":\"600\"}],\"namespace\":\"\",\"scene\":\"0\"}";
        String filter2 = json.toString();
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case10() {
        this.set_data_configuration();
        // delete the last filter
        _data_configuration.getConfiguration().put("startDate", null);
        _data_configuration.getConfiguration().put("endDate", null);
        _data_configuration.getConfiguration().put("search", null);
        _data_configuration.getConfiguration().put("filter", "system:systemA;system:system1;system:system3;");
        _data_configuration.getConfiguration().put("request", "");
        json_files_manager data = new json_files_manager(null, null, _data_configuration);
        Object json = data.updateFilter("deleteFilter", "ob_timeline_0", "0", "", "Timeline report",
                "My_filter2", "#a1d9ff", "test", "test@mail.com",
                "0", "0", "1350", "600", "Orthographic", "NONE",
                data.get_filter());
        String filter1 = "{\"dateTimeFormat\":\"iso8601\",\"openbexi_timeline\":[{\"backgroundColor\":\"#a1d9ff\",\"sources\":[{\"data_model\":\"\\/data\\/SOURCES1\\/yyyy\\/mm\\/dd\",\"converter2events_class\":\"build_in\",\"permission\":\"\",\"type\":\"json_file\",\"url\":null,\"data_path\":\"\\/data\\/\",\"filter\":{\"include\":\"\",\"exclude\":\"\"},\"database\":null,\"password\":null,\"connector\":\"secure_sse:8441|secure:8442\",\"enable\":true,\"namespace\":\"SOURCE1\",\"user\":null,\"dataSources\":null,\"render\":{\"color\":\"#00b300\",\"alternateColor\\\"\":\"#6ac1db\"}},{\"data_model\":\"\\/data\\/SOURCES2\\/yyyy\\/mm\\/dd\",\"converter2events_class\":\"build_in\",\"permission\":\"\",\"type\":\"json_file\",\"url\":null,\"data_path\":\"\\/data\\/\",\"filter\":{\"include\":\"\",\"exclude\":\"\"},\"database\":null,\"password\":null,\"connector\":\"secure_sse:8441|secure:8442\",\"enable\":false,\"namespace\":\"SOURCE2\",\"user\":null,\"dataSources\":null,\"render\":{\"color\":\"#10b300\",\"alternateColor\\\"\":\"#9ac1db\"}}],\"start\":\"current_time\",\"title1\":\"Timeline report\",\"filters\":[],\"top\":\"0\",\"left\":\"0\",\"name\":\"ob_timeline_0\",\"width\":\"1350\",\"sortBy\":\"NONE\",\"camera\":\"Orthographic\",\"user\":\"test\",\"email\":\"test@mail.com\",\"height\":\"600\"}],\"namespace\":\"\",\"scene\":\"0\"}";
        String filter2 = json.toString();
        Assert.assertEquals(filter1, filter2);
    }
}

