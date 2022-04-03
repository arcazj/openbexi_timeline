package com.openbexi.timeline.tests;

import com.openbexi.timeline.data_browser.json_files_manager;
import org.junit.Assert;
import org.junit.Test;

public class test_filters {

    @Test
    /**
     * Create a first filter
     */
    public void test_case1() {
        json_files_manager data = new json_files_manager(null, null, "/data/yyyy/mm/dd", null,
                "", "", null, null, null);
        data.removeAllFilter("ob_timeline_2", "test");
        Object json = data.updateFilter("updateFilter", "ob_timeline_2", "Timeline report",
                "My_filter1", "#a1d9ff", "test", "test@mail.com",
                "0", "0", "1350", "600", "Orthographic", "NONE",
                data.get_filter());
        String filter1 = "{\"dateTimeFormat\":\"iso8601\",\"openbexi_timeline\":[{\"backgroundColor\":\"#a1d9ff\",\"start\":\"current_time\",\"title1\":\"Timeline report\",\"filters\":[{\"backgroundColor\":\"#a1d9ff\",\"current\":\"yes\",\"filter_value\":\"\",\"name\":\"My_filter1\",\"sortBy\":\"NONE\"}],\"top\":\"0\",\"left\":\"0\",\"name\":\"ob_timeline_2\",\"width\":\"1350\",\"sortBy\":\"NONE\",\"camera\":\"Orthographic\",\"user\":\"test\",\"email\":\"test@mail.com\",\"height\":\"600\"}]}";
        String filter2 = json.toString();
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    /**
     * Update the first filter
     */
    public void test_case2() {
        json_files_manager data = new json_files_manager(null, null, "/data/yyyy/mm/dd", null,
                "system:systemA;system:system1;system:system3;type:type0;type:type4+status:SCHEDULE", "", null, null, null);
        Object json = data.updateFilter("updateFilter", "ob_timeline_2", "Timeline report",
                "My_filter1", "#a1d9ff", "test", "test@mail.com",
                "0", "0", "1350", "600", "Orthographic", "NONE",
                data.get_filter());
        String filter1 = "{\"dateTimeFormat\":\"iso8601\",\"openbexi_timeline\":[{\"backgroundColor\":\"#a1d9ff\",\"start\":\"current_time\",\"title1\":\"Timeline report\",\"filters\":[{\"backgroundColor\":\"#a1d9ff\",\"current\":\"yes\",\"filter_value\":\"system:systemA;system:system1;system:system3;type:type0;type:type4+status:SCHEDULE\",\"name\":\"My_filter1\",\"sortBy\":\"NONE\"}],\"top\":\"0\",\"left\":\"0\",\"name\":\"ob_timeline_2\",\"width\":\"1350\",\"sortBy\":\"NONE\",\"camera\":\"Orthographic\",\"user\":\"test\",\"email\":\"test@mail.com\",\"height\":\"600\"}]}";
        String filter2 = json.toString();
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    /**
     * Add/update a second filter
     */
    public void test_case3() {
        json_files_manager data = new json_files_manager(null, null, "/data/yyyy/mm/dd", null,
                "", "", null, null, null);
        Object json = data.updateFilter("updateFilter", "ob_timeline_2", "Timeline report",
                "My_filter2", "#a1d9ff", "test", "test@mail.com",
                "0", "0", "1350", "600", "Orthographic", "NONE",
                data.get_filter());
        String filter1 = "{\"dateTimeFormat\":\"iso8601\",\"openbexi_timeline\":[{\"backgroundColor\":\"#a1d9ff\",\"start\":\"current_time\",\"title1\":\"Timeline report\",\"filters\":[{\"backgroundColor\":\"#a1d9ff\",\"current\":\"yes\",\"filter_value\":\"\",\"name\":\"My_filter2\",\"sortBy\":\"NONE\"},{\"backgroundColor\":\"#a1d9ff\",\"current\":\"no\",\"filter_value\":\"system:systemA;system:system1;system:system3;type:type0;type:type4+status:SCHEDULE\",\"name\":\"My_filter1\",\"sortBy\":\"NONE\"}],\"top\":\"0\",\"left\":\"0\",\"name\":\"ob_timeline_2\",\"width\":\"1350\",\"sortBy\":\"NONE\",\"camera\":\"Orthographic\",\"user\":\"test\",\"email\":\"test@mail.com\",\"height\":\"600\"}]}";
        String filter2 = json.toString();
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    /**
     * Update the second filter
     */
    public void test_case4() {
        json_files_manager data = new json_files_manager(null, null, "/data/yyyy/mm/dd", null,
                "system:system1;system:system2;system:system3|system:system3+type:type0", "", null, null, null);
        Object json = data.updateFilter("updateFilter", "ob_timeline_2", "Timeline report",
                "My_filter2", "#a1d9ff", "test", "test@mail.com",
                "0", "0", "1350", "600", "Orthographic", "system",
                data.get_filter());
        String filter1 = "{\"dateTimeFormat\":\"iso8601\",\"openbexi_timeline\":[{\"backgroundColor\":\"#a1d9ff\",\"start\":\"current_time\",\"title1\":\"Timeline report\",\"filters\":[{\"backgroundColor\":\"#a1d9ff\",\"current\":\"yes\",\"filter_value\":\"system:system1;system:system2;system:system3|system:system3+type:type0\",\"name\":\"My_filter2\",\"sortBy\":\"system\"},{\"backgroundColor\":\"#a1d9ff\",\"current\":\"no\",\"filter_value\":\"system:systemA;system:system1;system:system3;type:type0;type:type4+status:SCHEDULE\",\"name\":\"My_filter1\",\"sortBy\":\"NONE\"}],\"top\":\"0\",\"left\":\"0\",\"name\":\"ob_timeline_2\",\"width\":\"1350\",\"sortBy\":\"system\",\"camera\":\"Orthographic\",\"user\":\"test\",\"email\":\"test@mail.com\",\"height\":\"600\"}]}";
        String filter2 = json.toString();
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    /**
     * Add/update the third filter
     */
    public void test_case5() {
        json_files_manager data = new json_files_manager(null, null, "/data/yyyy/mm/dd", null,
                "system:systemA;system:system1;system:system3", "", null, null, null);
        Object json = data.updateFilter("updateFilter", "ob_timeline_2", "Timeline report",
                "My_filter3", "#a1d9ff", "test", "test@mail.com",
                "0", "0", "1350", "600", "Orthographic", "NONE",
                data.get_filter());
        String filter1 = "{\"dateTimeFormat\":\"iso8601\",\"openbexi_timeline\":[{\"backgroundColor\":\"#a1d9ff\",\"start\":\"current_time\",\"title1\":\"Timeline report\",\"filters\":[{\"backgroundColor\":\"#a1d9ff\",\"current\":\"yes\",\"filter_value\":\"system:systemA;system:system1;system:system3\",\"name\":\"My_filter3\",\"sortBy\":\"NONE\"},{\"backgroundColor\":\"#a1d9ff\",\"current\":\"no\",\"filter_value\":\"system:system1;system:system2;system:system3|system:system3+type:type0\",\"name\":\"My_filter2\",\"sortBy\":\"system\"},{\"backgroundColor\":\"#a1d9ff\",\"current\":\"no\",\"filter_value\":\"system:systemA;system:system1;system:system3;type:type0;type:type4+status:SCHEDULE\",\"name\":\"My_filter1\",\"sortBy\":\"NONE\"}],\"top\":\"0\",\"left\":\"0\",\"name\":\"ob_timeline_2\",\"width\":\"1350\",\"sortBy\":\"NONE\",\"camera\":\"Orthographic\",\"user\":\"test\",\"email\":\"test@mail.com\",\"height\":\"600\"}]}";
        String filter2 = json.toString();
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    /**
     * Add/update  the fourth filter
     */
    public void test_case6() {
        json_files_manager data = new json_files_manager(null, null, "/data/yyyy/mm/dd", null,
                "system:systemA;system:system1;system:system3", "", null, null, null);
        Object json = data.updateFilter("updateFilter", "ob_timeline_2", "Timeline report",
                "My_filter4", "#a1d9ff", "test", "test@mail.com",
                "0", "0", "1350", "600", "Orthographic", "NONE",
                data.get_filter());
        String filter1 = "{\"dateTimeFormat\":\"iso8601\",\"openbexi_timeline\":[{\"backgroundColor\":\"#a1d9ff\",\"start\":\"current_time\",\"title1\":\"Timeline report\",\"filters\":[{\"backgroundColor\":\"#a1d9ff\",\"current\":\"yes\",\"filter_value\":\"system:systemA;system:system1;system:system3\",\"name\":\"My_filter4\",\"sortBy\":\"NONE\"},{\"backgroundColor\":\"#a1d9ff\",\"current\":\"no\",\"filter_value\":\"system:systemA;system:system1;system:system3\",\"name\":\"My_filter3\",\"sortBy\":\"NONE\"},{\"backgroundColor\":\"#a1d9ff\",\"current\":\"no\",\"filter_value\":\"system:system1;system:system2;system:system3|system:system3+type:type0\",\"name\":\"My_filter2\",\"sortBy\":\"system\"},{\"backgroundColor\":\"#a1d9ff\",\"current\":\"no\",\"filter_value\":\"system:systemA;system:system1;system:system3;type:type0;type:type4+status:SCHEDULE\",\"name\":\"My_filter1\",\"sortBy\":\"NONE\"}],\"top\":\"0\",\"left\":\"0\",\"name\":\"ob_timeline_2\",\"width\":\"1350\",\"sortBy\":\"NONE\",\"camera\":\"Orthographic\",\"user\":\"test\",\"email\":\"test@mail.com\",\"height\":\"600\"}]}";
        String filter2 = json.toString();
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    /**
     * delete the first filter in the list
     */
    public void test_case7() {
        json_files_manager data = new json_files_manager(null, null, "/data/yyyy/mm/dd", null,
                "system:systemA;system:system1;system:system3", "", null, null, null);
        Object json = data.updateFilter("deleteFilter", "ob_timeline_2", "Timeline report",
                "My_filter1", "#a1d9ff", "test", "test@mail.com",
                "0", "0", "1350", "600", "Orthographic", "NONE",
                data.get_filter());
        String filter1 = "{\"dateTimeFormat\":\"iso8601\",\"openbexi_timeline\":[{\"backgroundColor\":\"#a1d9ff\",\"start\":\"current_time\",\"title1\":\"Timeline report\",\"filters\":[{\"backgroundColor\":\"#a1d9ff\",\"current\":\"yes\",\"filter_value\":\"system:systemA;system:system1;system:system3\",\"name\":\"My_filter4\",\"sortBy\":\"NONE\"},{\"backgroundColor\":\"#a1d9ff\",\"current\":\"no\",\"filter_value\":\"system:systemA;system:system1;system:system3\",\"name\":\"My_filter3\",\"sortBy\":\"NONE\"},{\"backgroundColor\":\"#a1d9ff\",\"current\":\"no\",\"filter_value\":\"system:system1;system:system2;system:system3|system:system3+type:type0\",\"name\":\"My_filter2\",\"sortBy\":\"system\"}],\"top\":\"0\",\"left\":\"0\",\"name\":\"ob_timeline_2\",\"width\":\"1350\",\"sortBy\":\"NONE\",\"camera\":\"Orthographic\",\"user\":\"test\",\"email\":\"test@mail.com\",\"height\":\"600\"}]}";
        String filter2 = json.toString();
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    /**
     * delete the second filter which is in the middle of the list
     */
    public void test_case8() {
        json_files_manager data = new json_files_manager(null, null, "/data/yyyy/mm/dd", null,
                "system:systemA;system:system1;system:system3", "", null, null, null);
        Object json = data.updateFilter("deleteFilter", "ob_timeline_2", "Timeline report",
                "My_filter3", "#a1d9ff", "test", "test@mail.com",
                "0", "0", "1350", "600", "Orthographic", "NONE",
                data.get_filter());
        String filter1 = "{\"dateTimeFormat\":\"iso8601\",\"openbexi_timeline\":[{\"backgroundColor\":\"#a1d9ff\",\"start\":\"current_time\",\"title1\":\"Timeline report\",\"filters\":[{\"backgroundColor\":\"#a1d9ff\",\"current\":\"yes\",\"filter_value\":\"system:systemA;system:system1;system:system3\",\"name\":\"My_filter4\",\"sortBy\":\"NONE\"},{\"backgroundColor\":\"#a1d9ff\",\"current\":\"no\",\"filter_value\":\"system:system1;system:system2;system:system3|system:system3+type:type0\",\"name\":\"My_filter2\",\"sortBy\":\"system\"}],\"top\":\"0\",\"left\":\"0\",\"name\":\"ob_timeline_2\",\"width\":\"1350\",\"sortBy\":\"NONE\",\"camera\":\"Orthographic\",\"user\":\"test\",\"email\":\"test@mail.com\",\"height\":\"600\"}]}";
        String filter2 = json.toString();
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case9() {
        // delete the second filter which is at the end of the list
        json_files_manager data = new json_files_manager(null, null, "/data/yyyy/mm/dd", null,
                "system:systemA;system:system1;system:system3;SCHEDULE|system:system1", "", null, null, null);
        Object json = data.updateFilter("deleteFilter", "ob_timeline_2", "Timeline report",
                "My_filter4", "#a1d9ff", "test", "test@mail.com",
                "0", "0", "1350", "600", "Orthographic", "NONE",
                data.get_filter());
        String filter1 = "{\"dateTimeFormat\":\"iso8601\",\"openbexi_timeline\":[{\"backgroundColor\":\"#a1d9ff\",\"start\":\"current_time\",\"title1\":\"Timeline report\",\"filters\":[{\"backgroundColor\":\"#a1d9ff\",\"current\":\"yes\",\"filter_value\":\"system:system1;system:system2;system:system3|system:system3+type:type0\",\"name\":\"My_filter2\",\"sortBy\":\"system\"}],\"top\":\"0\",\"left\":\"0\",\"name\":\"ob_timeline_2\",\"width\":\"1350\",\"sortBy\":\"NONE\",\"camera\":\"Orthographic\",\"user\":\"test\",\"email\":\"test@mail.com\",\"height\":\"600\"}]}";
        String filter2 = json.toString();
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case10() {
        // delete the last filter
        json_files_manager data = new json_files_manager(null, null, "/data/yyyy/mm/dd", null,
                "system:systemA;system:system1;system:system3;", "",
                null, null, null);
        Object json = data.updateFilter("deleteFilter", "ob_timeline_2", "Timeline report",
                "My_filter2", "#a1d9ff", "test", "test@mail.com",
                "0", "0", "1350", "600", "Orthographic", "NONE",
                data.get_filter());
        String filter1 = "{\"dateTimeFormat\":\"iso8601\",\"openbexi_timeline\":[{\"backgroundColor\":\"#a1d9ff\",\"start\":\"current_time\",\"title1\":\"Timeline report\",\"filters\":[],\"top\":\"0\",\"left\":\"0\",\"name\":\"ob_timeline_2\",\"width\":\"1350\",\"sortBy\":\"NONE\",\"camera\":\"Orthographic\",\"user\":\"test\",\"email\":\"test@mail.com\",\"height\":\"600\"}]}";
        String filter2 = json.toString();
        Assert.assertEquals(filter1, filter2);
    }
}

