package com.openbexi.timeline;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.Date;
import java.util.Random;
import java.util.TimeZone;
import java.util.UUID;

public class event_generator_zone {
    private final Date _date;

    public Date get_date() {
        return _date;
    }

    event_generator_zone(Date date) {
        _date = date;
    }

    public void log(Object msg, String err) {
        if (msg != null)
            if (err == "info")
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
        String status = "SCHEDULE";
        int type;
        String start;
        String end;
        String title;
        String description = "description1";
        String[] icon = {"icon\\/ob_stop.png", "icon\\/ob_start.png", "icon\\/ob_yellow_flag.png", "icon\\/ob_check.png",
                "icon\\/ob_red_flag.png", "icon\\/ob_green_flag.png", "icon\\/ob_info.png", "icon\\/ob_error.png",
                "icon\\/ob_check_failed.png", "icon\\/ob_warning.png", "icon\\/ob_connect.png", "icon\\/ob_phone.png",
                "icon\\/ob_conflict.png", "icon\\/ob_bug.png", "icon\\/ob_lost_connection.png", "icon\\/ob_swap.png",
                "icon\\/ob_blue_square.png", "icon\\/ob_orange_square.png", "icon\\/ob_green_square.png",
                "icon\\/ob_purple_square.png", "icon\\/ob_yellow_square.png"
        };
        String color;
        long dateL = date.getTime();

        if (!outputs.getParentFile().exists())
            outputs.getParentFile().mkdirs();

        try (FileWriter file = new FileWriter(outputs)) {
            file.write("{\n");
            file.write("  \"dateTimeFormat\": \"iso8601\",\n");
            file.write("  \"events\": [\n");

            // ZONES 1
            file.write("  {\"id\":\"" + UUID.randomUUID() + "\",");
            file.write("  \"zone\":\"" + "zone" + "\",");
            file.write("  \"start\":\"" + new Date(dateL) + "\",");
            file.write("  \"end\":\"" + new Date(dateL + (2 * 3600 * 100)) + "\",");
            file.write("\"data\":{");
            file.write("\"text\":\"" + "zone_" + 1 + "\",");
            file.write("\"description\":\"" + "zone_" + 1 + "\",");
            file.write("},");
            file.write("\"render\":{");
            color = "#" + getRandomNumberUsingNextInt(0, 9) + getRandomNumberUsingNextInt(0, 9)
                    + getRandomNumberUsingNextInt(0, 9) + getRandomNumberUsingNextInt(0, 9) +
                    getRandomNumberUsingNextInt(0, 9) + getRandomNumberUsingNextInt(0, 9);
            file.write("\"color\":\"" + color + "\",");
            file.write("}");
            file.write("},");

            // ZONES 2
            file.write("  {\"id\":\"" + UUID.randomUUID() + "\",");
            file.write("  \"zone\":\"" + "type" + "\",");
            file.write("  \"start\":\"" + new Date(dateL + (10 * 3600 * 100)) + "\",");
            file.write("  \"end\":\"" + new Date(dateL + (11 * 3600 * 100)) + "\",");
            file.write("\"data\":{");
            file.write("\"text\":\"" + "zone_" + 2 + "\",");
            file.write("\"description\":\"" + "zone_" + 2 + "\",");
            file.write("},");
            file.write("\"render\":{");
            color = "#" + getRandomNumberUsingNextInt(0, 9) + getRandomNumberUsingNextInt(0, 9)
                    + getRandomNumberUsingNextInt(0, 9) + getRandomNumberUsingNextInt(0, 9) +
                    getRandomNumberUsingNextInt(0, 9) + getRandomNumberUsingNextInt(0, 9);
            file.write("\"color\":\"" + color + "\",");
            file.write("}");
            file.write("},");

            // ZONES 3
            file.write("  {\"id\":\"" + UUID.randomUUID() + "\",");
            file.write("  \"zone\":\"" + "zone" + "\",");
            file.write("  \"start\":\"" + new Date(dateL + (15 * 3600 * 100)) + "\",");
            file.write("  \"end\":\"" + new Date(dateL + (17 * 3600 * 100)) + "\",");
            file.write("\"data\":{");
            file.write("\"text\":\"" + "zone_" + 3 + "\",");
            file.write("\"description\":\"" + "zone_" + 3 + "\",");
            file.write("},");
            file.write("\"render\":{");
            color = "#" + getRandomNumberUsingNextInt(0, 9) + getRandomNumberUsingNextInt(0, 9)
                    + getRandomNumberUsingNextInt(0, 9) + getRandomNumberUsingNextInt(0, 9) +
                    getRandomNumberUsingNextInt(0, 9) + getRandomNumberUsingNextInt(0, 9);
            file.write("\"color\":\"" + color + "\",");
            file.write("}");
            file.write("},");


            // EVENTS
            for (int j = 0; j < 23; j++) {
                if (j != 0)
                    dateL += 3600 * 1000;
                start = new Date(dateL).toString();

                for (int i = 0; i < 20; i++) {
                    color = "#" + getRandomNumberUsingNextInt(0, 9) + getRandomNumberUsingNextInt(0, 9)
                            + getRandomNumberUsingNextInt(0, 9) + getRandomNumberUsingNextInt(0, 9) +
                            getRandomNumberUsingNextInt(0, 9) + getRandomNumberUsingNextInt(0, 9);
                    if (i == 3 || i == 5 || i == 7 || i == 9 || i == 11) {
                        end = "";
                    } else {
                        end = new Date(dateL + (getRandomNumberUsingNextInt(1, 20) * 100000)).toString();
                    }

                    title = "title" + j + "_" + i;

                    // EVENTS/SESSIONS
                    file.write("  {\"id\":\"" + UUID.randomUUID() + "\",");
                    file.write("  \"start\":\"" + start + "\",");
                    file.write("  \"end\":\"" + end + "\",");
                    file.write("\"data\":{");
                    file.write("\"title\":\"" + title + "\",");
                    file.write("\"status\":\"" + status + "\",");
                    type = getRandomNumberUsingNextInt(0,2);
                    file.write("\"type\":\"" + "type" + type + "\",");
                    if (type == 0) {
                        file.write("\"zone\":\"" + "zone_" + getRandomNumberUsingNextInt(0, 1) + "\",");
                        file.write("\"description\":\"" + description + "\",");
                    } else
                        file.write("\"description\":\"" + description + " out of zone" + "\",");
                    file.write("},");
                    file.write("\"session\":{");
                    file.write("\"color\":\"" + color + "\",");
                    file.write("\"id\":\"" + getRandomNumberUsingNextInt(0, 1) + "\",");
                    file.write("},");
                    file.write("\"render\":{");
                    file.write("\"color\":\"" + color + "\",");
                    if (i == 0 || i == 1 || i == 3 || i == 5 || i == 7 || i == 9)
                        file.write("\"image\":\"" + icon[getRandomNumberUsingNextInt(0, 20)] + "\",");
                    file.write("}");
                    file.write("},");
                }
            }
            file.write("]}");
        } catch (IOException e) {
            log(e, "Exception");
        }
    }

    public static void main(String... args) throws IOException {
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
        ZonedDateTime utcTime = ZonedDateTime.now(ZoneOffset.UTC);
        Date date = new Date();
        //Instant now = Instant.now(); //current date
        //Instant before = now.minus(Duration.ofDays(1));
        //date = Date.from(before);
        //Instant now = Instant.now(); //current date
        //Instant after = now.plus(Duration.ofDays(1));
        //date = Date.from(after);

        String year = new SimpleDateFormat("yyyy").format(date);
        String month = new SimpleDateFormat("MM").format(date);
        String day = new SimpleDateFormat("dd").format(date);
        File file = new File("E:\\fdc_logs\\ESOC\\GNS_data\\" +
                year + "\\" + month + "\\" + day + "\\" + "events.json");
        event_generator_zone events = new event_generator_zone(date);
        events.generate(file);

        try {
            Thread.sleep(10000);
        } catch (InterruptedException e) {
            e.printStackTrace();
        }
    }
}