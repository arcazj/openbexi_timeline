package com.openbexi.timeline;

import com.openbexi.timeline.data_browser.data_configuration;
import com.openbexi.timeline.data_browser.event_descriptor;
import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import org.json.simple.parser.ParseException;

import java.io.*;
import java.text.SimpleDateFormat;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.*;

public class event_generator {
    private final Date _date;
    private JSONObject _data_configuration_node;

    public Date get_date() {
        return _date;
    }

    event_generator(Date date, JSONObject data_configuration_node) {
        _data_configuration_node = data_configuration_node;
        _date = date;
    }

    public void log(Object msg, String err) {
        if (msg != null)
            if (err.equals("info"))
                System.out.println(msg);
            else
                System.err.println(msg);
    }

    public int getRandomNumberUsingNextInt(int min, int max) {
        Random random = new Random();
        return random.nextInt(max - min) + min;
    }

    private void generate(File outputs) {
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
        Date date = this.get_date();
        String status;
        String type;
        String priority;
        String tolerance;
        String system;
        String original_start;
        String start;
        String start_a;
        String original_end;
        String end;
        String end_a;
        String title;
        String description;
        String[] icon = {"icon\\/ob_stop.png", "icon\\/ob_start.png", "icon\\/ob_yellow_flag.png", "icon\\/ob_check.png",
                "icon\\/ob_red_flag.png", "icon\\/ob_green_flag.png", "icon\\/ob_info.png", "icon\\/ob_error.png",
                "icon\\/ob_check_failed.png", "icon\\/ob_warning.png", "icon\\/ob_connect.png", "icon\\/ob_phone.png",
                "icon\\/ob_conflict.png", "icon\\/ob_bug.png", "icon\\/ob_lost_connection.png", "icon\\/ob_swap.png",
                "icon\\/ob_blue_square.png", "icon\\/ob_orange_square.png", "icon\\/ob_green_square.png",
                "icon\\/ob_purple_square.png", "icon\\/ob_yellow_square.png"
        };
        String color;
        long dateL = date.getTime();

        String line_start = "{\n" +
                "  \"dateTimeFormat\": \"iso8601\",\n" +
                "  \"events\": [\n";

        if (!outputs.getParentFile().exists())
            outputs.getParentFile().mkdirs();

        try (FileWriter file = new FileWriter(outputs)) {
            file.write(line_start);
            for (int j = 0; j < 650; j++) {
                if (j != 0)
                    dateL += 3600L * getRandomNumberUsingNextInt(10, 500);
                start = new Date(dateL).toString();

                for (int i = 0; i < 8; i++) {
                    color = "#" + getRandomNumberUsingNextInt(0, 9) + getRandomNumberUsingNextInt(0, 9)
                            + getRandomNumberUsingNextInt(0, 9) + getRandomNumberUsingNextInt(0, 9) +
                            getRandomNumberUsingNextInt(0, 9) + getRandomNumberUsingNextInt(0, 9);
                    if (i == 1 || i == 3 || i == 5 || i == 7) {
                        end = "";
                    } else {
                        end = new Date(dateL + (getRandomNumberUsingNextInt(1, 20) * 100000L)).toString();
                    }
                    original_start = start;
                    original_end = end;
                    int s = getRandomNumberUsingNextInt(0, 4);
                    if (s == 1)
                        status = "STARTED";
                    else if (s == 2)
                        status = "COMPLETED";
                    else
                        status = "SCHEDULE";

                    int ss = getRandomNumberUsingNextInt(0, 8);
                    system = "system" + ss;

                    int p = getRandomNumberUsingNextInt(0, 2);
                    priority = String.valueOf(p);
                    int t = getRandomNumberUsingNextInt(10, 400);
                    if (i == 2) {
                        tolerance = String.valueOf(t);
                        int o = getRandomNumberUsingNextInt(0, t);
                        if (o > 50)
                            original_start = new Date(dateL - (getRandomNumberUsingNextInt(1, 5) * 100000L)).toString();
                        if (o > 100) {
                            long te = dateL + (getRandomNumberUsingNextInt(1, 10) * 100000L);
                            long te2 = dateL + (getRandomNumberUsingNextInt(11, 15) * 100000L);
                            end = new Date(te2).toString();
                            original_end = new Date(te).toString();
                        }
                    } else
                        tolerance = String.valueOf(0);

                    title = "title" + j + "_" + i;
                    int tt = getRandomNumberUsingNextInt(0, 5);
                    type = "type" + tt;

                    description = "description_" + title;

                    file.write("  {\"id\":\"" + UUID.randomUUID() + "\",");
                    if (!start.equals(original_start))
                        file.write("  \"original_start\":\"" + original_start + "\",");
                    file.write("  \"start\":\"" + start + "\",");
                    if (!end.equals(original_end))
                        file.write("  \"original_end\":\"" + original_end + "\",");
                    file.write("  \"end\":\"" + end + "\",");
                    file.write("\"data\":{");
                    file.write("\"title\":\"" + title + "\",");
                    file.write("\"status\":\"" + status + "\",");
                    file.write("\"type\":\"" + type + "\",");
                    file.write("\"system\":\"" + system + "\",");
                    file.write("\"priority\":\"" + priority + "\",");
                    if (!tolerance.equals("0"))
                        file.write("\"tolerance\":\"" + tolerance + "\",");
                    file.write("\"description\":\"" + description + "\",");
                    file.write("},");
                    file.write("\"render\":{");
                    file.write("\"color\":\"" + color + "\",");
                    if (i == 0 || i == 1 || i == 3 || i == 5 || i == 7)
                        file.write("\"image\":\"" + icon[getRandomNumberUsingNextInt(0, 20)] + "\",");
                    file.write("},");

                    // Add activities randomly inside session
                    int act = getRandomNumberUsingNextInt(0, 6);
                    if (act == 5 && !end.equals("")) {
                        int aa = getRandomNumberUsingNextInt(1, 5);
                        file.write("\"activities\":[");
                        for (int a = 0; a < aa; a++) {
                            file.write("  {\"id\":\"" + UUID.randomUUID() + "\",");
                            if (!start.equals(original_start))
                                file.write("  \"original_start\":\"" + original_start + "\",");
                            start_a = new Date(dateL + (getRandomNumberUsingNextInt(1, 40) * 1000L)).toString();
                            file.write("  \"start\":\"" + start_a + "\",");
                            if (!end.equals(original_end))
                                file.write("  \"original_end\":\"" + original_end + "\",");
                            int ee = getRandomNumberUsingNextInt(0, 2);
                            if (ee == 0)
                                end_a = new Date(dateL + (getRandomNumberUsingNextInt(1, 20) * 100000L)).toString();
                            else
                                end_a = end;
                            file.write("  \"end\":\"" + end_a + "\",");
                            file.write("\"data\":{");
                            file.write("\"title\":\"" + "activity_" + a + "\",");
                            file.write("\"status\":\"" + status + "\",");
                            file.write("\"priority\":\"" + priority + "\",");
                            if (!tolerance.equals("0"))
                                file.write("\"tolerance\":\"" + tolerance + "\",");

                            description = "description_" + title + "_" + "activity_" + a;
                            file.write("\"description\":\"" + description + "\",");
                            file.write("},");
                            file.write("\"render\":{");
                            file.write("\"color\":\"" + color + "\",");
                            if (i == 0 || i == 1 || i == 3 || i == 5 || i == 7)
                                file.write("\"image\":\"" + icon[getRandomNumberUsingNextInt(0, 20)] + "\",");
                            file.write("},");
                            file.write("},");
                        }
                        file.write("]");
                    }
                    file.write("},");
                }
            }

            file.write("]}");
        } catch (IOException e) {
            log(e, "Exception");
        }
    }

    private void generate_simple(File outputs) {
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
        Date date = this.get_date();
        String status;
        String type;
        String platform = "";
        String priority;
        String tolerance;
        String system;
        String original_start;
        String start;
        String original_end;
        String end;
        String title;
        String description;
        String output_parent;
        int nb_act = 0;
        String[] icon = {"icon\\/ob_stop.png", "icon\\/ob_start.png", "icon\\/ob_yellow_flag.png", "icon\\/ob_check.png",
                "icon\\/ob_red_flag.png", "icon\\/ob_green_flag.png", "icon\\/ob_info.png", "icon\\/ob_error.png",
                "icon\\/ob_check_failed.png", "icon\\/ob_warning.png", "icon\\/ob_connect.png", "icon\\/ob_phone.png",
                "icon\\/ob_conflict.png", "icon\\/ob_bug.png", "icon\\/ob_lost_connection.png", "icon\\/ob_swap.png",
                "icon\\/ob_blue_square.png", "icon\\/ob_orange_square.png", "icon\\/ob_green_square.png",
                "icon\\/ob_purple_square.png", "icon\\/ob_yellow_square.png"
        };
        String color = "#" + getRandomNumberUsingNextInt(0, 9) + getRandomNumberUsingNextInt(0, 9)
                + getRandomNumberUsingNextInt(0, 9) + getRandomNumberUsingNextInt(0, 9) +
                getRandomNumberUsingNextInt(0, 9) + getRandomNumberUsingNextInt(0, 9);

        String line_start = "{\n" +
                "  \"dateTimeFormat\": \"iso8601\",\n" +
                "  \"events\": [\n";

        if (!outputs.getParentFile().exists())
            outputs.getParentFile().mkdirs();

        try (FileWriter file = new FileWriter(outputs)) {
            file.write(line_start);
            for (int j = 0; j < 350; j++) {
                color = "#" + getRandomNumberUsingNextInt(0, 9) + getRandomNumberUsingNextInt(0, 9)
                        + getRandomNumberUsingNextInt(0, 9) + getRandomNumberUsingNextInt(0, 9) +
                        getRandomNumberUsingNextInt(0, 9) + getRandomNumberUsingNextInt(0, 9);
                Date current_date = new Date();
                long dateL = current_date.getTime();
                int s = getRandomNumberUsingNextInt(0, 4);
                if (s == 1)
                    status = "STARTED";
                else if (s == 2)
                    status = "RUNNING";
                else
                    status = "FINISHED";
                priority = String.valueOf(getRandomNumberUsingNextInt(0, 5));
                system = "system1";
                tolerance = String.valueOf(100);
                type = "type1";
                original_start = "";
                original_end = "";

                if (j < 30000) {
                    if (j == 0) {
                        nb_act = 4;
                        start = new Date(dateL).toString();
                        end = new Date(dateL + 1000000L).toString();
                        original_start = new Date(dateL).toString();
                        original_end = new Date(dateL + 100000L).toString();
                    } else if (j == 1) {
                        nb_act = 3;
                        start = new Date(dateL).toString();
                        end = new Date(dateL + 1000000L).toString();
                        original_start = new Date(dateL).toString();
                        original_end = new Date(dateL + 100000L).toString();
                    } else if (j == 3) {
                        nb_act = 1;
                        start = new Date(dateL - 1500000L).toString();
                        end = new Date(dateL + 1500000L).toString();
                        original_start = new Date(dateL - 1800000L).toString();
                        original_end = new Date(dateL + 1400000L).toString();
                        tolerance = String.valueOf(1000);
                    } else if (j == 4) {
                        nb_act = 6;
                        start = new Date(dateL + 2000000L).toString();
                        end = new Date(dateL + 3000000L).toString();
                        original_start = new Date(dateL + 2000000L).toString();
                        original_end = new Date(dateL + 300000L).toString();
                    } else if (j == 5) {
                        nb_act = 2;
                        start = new Date(dateL + 2000000L).toString();
                        end = new Date(dateL + 3000000L).toString();
                        original_start = new Date(dateL + 2000000L).toString();
                        original_end = new Date(dateL + 300000L).toString();
                    } else if (j == 6) {
                        nb_act = 1;
                        start = new Date(dateL + 2000000L).toString();
                        end = new Date(dateL + 5500000L).toString();
                    } else if (j == 7) {
                        nb_act = 1;
                        start = new Date(dateL + 2500000L).toString();
                        end = new Date(dateL + 3000000L).toString();
                        original_start = new Date(dateL + 2400000L).toString();
                        original_end = new Date(dateL + 290000L).toString();
                    } else if (j == 8 || j == 10 || j == 12) {
                        nb_act = 1;
                        start = new Date(dateL - 1000000L).toString();
                        end = "";
                    } else if (j == 20) {
                        nb_act = 1;
                        start = new Date(dateL + 5000000L).toString();
                        end = "";
                    } else if (j > 20 && j < 24) {
                        nb_act = 1;
                        start = new Date(dateL + 4000000L).toString();
                        end = "";
                    } else if (j == 24) {
                        nb_act = 2;
                        start = new Date(dateL + 4000000L).toString();
                        end = "";
                    } else if (j > 24 && j < 29) {
                        nb_act = 1;
                        start = new Date(dateL + 4000000L).toString();
                        end = "";
                    } else if (j == 30) {
                        nb_act = 12;
                        start = new Date(dateL + 5000000L).toString();
                        end = new Date(dateL + 8000000L).toString();
                        original_start = new Date(dateL + 5000000L).toString();
                        original_end = new Date(dateL + 800000L).toString();
                    } else if (j > 50 && j < 60) {
                        nb_act = 1;
                        start = new Date(dateL + 600000L).toString();
                        end = "";
                    } else if (j == 61) {
                        nb_act = 1;
                        start = new Date(dateL + 5200000L).toString();
                        end = "";
                    } else if (j > 61 && j <= 71) {
                        nb_act = 1;
                        start = new Date(dateL + 5200000L).toString();
                        end = "";
                    } else {
                        int a = getRandomNumberUsingNextInt(2, 6);
                        int aa = getRandomNumberUsingNextInt(0, 10);
                        if (aa == 0)
                            nb_act = a;
                        else
                            nb_act = 1;
                        int t = getRandomNumberUsingNextInt(2, 30);
                        int t2 = getRandomNumberUsingNextInt(0, 20);
                        long tl = dateL + t * (1000000L + (t2 * 100000L));
                        start = new Date(tl).toString();
                        tolerance = String.valueOf(getRandomNumberUsingNextInt(0, 30) * getRandomNumberUsingNextInt(0, 30));
                        if (t2 < 10)
                            end = "";
                        else {
                            end = new Date(tl + (t2 * 200000L)).toString();
                            original_start = new Date(tl - (t2 * 2000L)).toString();
                        }
                    }

                    if (end.equals(""))
                        title = "Events" + j;
                    else
                        title = "Session_" + j;
                    if (nb_act > 1)
                        title = "Activity_" + j;
                    description = "description_" + j + " " + title;
                    UUID id = UUID.randomUUID();
                    file.write("  {\"id\":\"" + id + "\",");
                    file.write("  \"original_start\":\"" + original_start + "\",");
                    file.write("  \"start\":\"" + start + "\",");
                    file.write("  \"original_end\":\"" + original_end + "\",");
                    file.write("  \"end\":\"" + end + "\",");
                    file.write("\"data\":{");
                    int des = getRandomNumberUsingNextInt(0, 2);
                    if (des == 0)
                        file.write("\"title\":\"" + title + "_read_descriptor" + "\",");
                    else {
                        file.write("\"title\":\"" + title + "\",");
                    }
                    file.write("\"status\":\"" + status + "\",");
                    file.write("\"type\":\"" + type + "\",");
                    file.write("\"system\":\"" + system + "\",");
                    file.write("\"priority\":\"" + priority + "\",");
                    if (!tolerance.equals("0"))
                        file.write("\"tolerance\":\"" + tolerance + "\",");

                    if (des == 0) {
                        event_descriptor event_descriptor = new event_descriptor(id.toString(),
                                original_start,
                                start,
                                original_end,
                                end,
                                title,
                                type,
                                status,
                                priority,
                                tolerance,
                                platform,
                                _data_configuration_node);
                        event_descriptor.write(description + "_read_descriptor_in_file");
                        file.write("\"description\":\"" + "" + "\",");
                    } else
                        file.write("\"description\":\"" + description + "\",");
                    file.write("\"description\":\"" + description + "\",");
                    file.write("},");
                    file.write("\"render\":{");
                    file.write("\"color\":\"" + color + "\",");
                    int ic = getRandomNumberUsingNextInt(0, 40);
                    if (end.equals(""))
                        if (ic < icon.length - 1)
                            file.write("\"image\":\"" + icon[ic] + "\",");
                    file.write("},");

                    // Add activities randomly inside session
                    int act = 0;
                    if (act == 0 || !end.equals("")) {
                        file.write("\"activities\":[");
                        for (int a = 0; a < nb_act; a++) {
                            id = UUID.randomUUID();
                            file.write("  {\"id\":\"" + id + "\",");
                            file.write("  \"original_start\":\"" + original_start + "\",");
                            file.write("  \"start\":\"" + start + "\",");
                            file.write("  \"original_end\":\"" + original_end + "\",");
                            file.write("  \"end\":\"" + end + "\",");
                            file.write("\"data\":{");
                            if (end.equals(""))
                                title = "Events_" + j + "_" + a;
                            else
                                title = "Session_" + j + "_" + a;
                            if (nb_act > 1)
                                title = "Activity_" + j + "_" + a;
                            des = getRandomNumberUsingNextInt(0, 2);
                            if (des == 0)
                                file.write("\"title\":\"" + title + "_read_descriptor" + "\",");
                            else {
                                int ob_long_text = getRandomNumberUsingNextInt(1, 10);
                                int ob_long_text2 = getRandomNumberUsingNextInt(1, 15);
                                if (ob_long_text > 7) {
                                    for (int l = 0; l < ob_long_text2; l++)
                                        title = title + "_long_text";
                                }
                                file.write("\"title\":\"" + title + "\",");
                            }
                            file.write("\"status\":\"" + status + "\",");
                            file.write("\"priority\":\"" + priority + "\",");
                            if (!tolerance.equals("0"))
                                file.write("\"tolerance\":\"" + tolerance + "\",");
                            description = "description_" + title + "_" + "activity_" + a;
                            if (des == 0) {
                                event_descriptor event_descriptor = new event_descriptor(id.toString(),
                                        original_start,
                                        start,
                                        original_end,
                                        end,
                                        title,
                                        type,
                                        status,
                                        priority,
                                        tolerance,
                                        platform,
                                        _data_configuration_node);
                                event_descriptor.write(description + "_read_descriptor_in_file");
                                file.write("\"description\":\"" + "" + "\",");
                            } else
                                file.write("\"description\":\"" + description + "\",");
                            file.write("},");
                            file.write("\"render\":{");
                            file.write("\"color\":\"" + color + "\",");
                            if (end.equals("")) {
                                if (ic < icon.length - 1)
                                    file.write("\"image\":\"" + icon[ic] + "\",");
                            } else {
                                int ob_icon = getRandomNumberUsingNextInt(1, 10);
                                if (ob_icon > 7)
                                    if (ic < icon.length - 1)
                                        file.write("\"image\":\"" + icon[ic] + "\",");
                            }
                            file.write("},");
                            file.write("},");
                        }
                        file.write("]");
                    }
                    file.write("},");
                }
            }
            file.write("]}");
        } catch (IOException e) {
            log(e, "Exception");
        }
    }

    public static void main(String... args) throws IOException {
        data_configuration data_configuration;
        List<String> models;
        try {
            data_configuration = new data_configuration("yaml/sources_startup.yml");
            models = data_configuration.getDataModels();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }

        for (int d = 0; d <= data_configuration.getConfiguration().size(); d++) {
            JSONObject configNode = (JSONObject) ((JSONArray) data_configuration.getConfiguration().get("startup configuration")).get(d);
            for (int i = 0; i < 1; i++) {
                TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
                ZonedDateTime utcTime = ZonedDateTime.now(ZoneOffset.UTC);
                long todayMidnight = utcTime.toLocalDate().atStartOfDay().toEpochSecond(ZoneOffset.UTC) * 1000;
                Date date = new Date(todayMidnight);
                long dateL = date.getTime();
                long enddateL = date.getTime() + 3600 * 12 * 1000;

                while (dateL < enddateL) {
                    date = new Date(dateL);
                    String year = new SimpleDateFormat("yyyy").format(date);
                    String month = new SimpleDateFormat("MM").format(date);
                    String day = new SimpleDateFormat("dd").format(date);
                    String data_model = (String) configNode.get("data_model");
                    data_model = data_model.replace("yyyy",year).replace("mm",month).replace("dd",day);
                    File file = new File(data_model+ "/events.json");
                    event_generator events = new event_generator(date, configNode);
                    events.generate_simple(file);
                    dateL = dateL + 3600 * 24 * 1000;
                }
                try {
                    Thread.sleep(10000);
                } catch (InterruptedException e) {
                    e.printStackTrace();
                }
            }
        }
    }
}