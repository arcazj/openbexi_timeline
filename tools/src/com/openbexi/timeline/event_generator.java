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

public class event_generator {
    private Date _date;

    public Date get_date() {
        return _date;
    }

    event_generator(Date date) {
        _date = date;
    }

    public void log(Object msg, String err) {
        if (msg != null)
            if (err == "info")
                System.out.println(String.valueOf(msg));
            else
                System.err.println(String.valueOf(msg));
    }

    public int getRandomNumberUsingNextInt(int min, int max) {
        Random random = new Random();
        return random.nextInt(max - min) + min;
    }

    private void generate(File outputs) {
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
        Date date = this.get_date();
        String status = "SCHEDULE";
        String type;
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

        String line_start = "{\n" +
                "  \"dateTimeFormat\": \"iso8601\",\n" +
                "  \"events\": [\n";

        if (!outputs.getParentFile().exists())
            outputs.getParentFile().mkdirs();

        try (FileWriter file = new FileWriter(outputs)) {
            file.write(line_start);
            for (int j = 0; j < 600; j++) {
                if (j != 0)
                    dateL += 3600 * getRandomNumberUsingNextInt(10, 500);
                start = new Date(dateL).toString();

                for (int i = 0; i < 6; i++) {
                    color = "#" + getRandomNumberUsingNextInt(0, 9) + getRandomNumberUsingNextInt(0, 9)
                            + getRandomNumberUsingNextInt(0, 9) + getRandomNumberUsingNextInt(0, 9) +
                            getRandomNumberUsingNextInt(0, 9) + getRandomNumberUsingNextInt(0, 9);
                    if (i == 1 || i == 3 || i == 5 || i == 7 || i == 9 || i == 11) {
                        end = "";
                    } else {
                        end = new Date(dateL + (getRandomNumberUsingNextInt(1, 20) * 100000)).toString();
                    }

                    title = "title" + j + "_" + i;
                    type = "type" + i;

                    file.write("  {\"id\":\"" + UUID.randomUUID().toString() + "\",");
                    file.write("  \"start\":\"" + start + "\",");
                    file.write("  \"end\":\"" + end + "\",");
                    file.write("\"data\":{");
                    file.write("\"title\":\"" + title + "\",");
                    file.write("\"status\":\"" + status + "\",");
                    file.write("\"type\":\"" + type + "\",");
                    file.write("\"description\":\"" + description + "\",");
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

        for (int i = 0; i < 1; i++) {
            TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
            ZonedDateTime utcTime = ZonedDateTime.now(ZoneOffset.UTC);
            long todayMidnight = utcTime.toLocalDate().atStartOfDay().toEpochSecond(ZoneOffset.UTC) * 1000;
            Date date = new Date(todayMidnight);
            long dateL = date.getTime() - (3600 * 48 * 1000);
            long enddateL = date.getTime() + 3600 * 48 * 1000;

            while (dateL < enddateL) {
                date = new Date(dateL);
                String year = new SimpleDateFormat("yyyy").format(date);
                String month = new SimpleDateFormat("MM").format(date);
                String day = new SimpleDateFormat("dd").format(date);
                File file = new File("/data/" +
                        year + "/" + month + "/" + day + "/" + "events.json");
                event_generator events = new event_generator(date);
                events.generate(file);
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