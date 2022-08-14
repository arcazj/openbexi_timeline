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
    private final Date _date;

    public Date get_date() {
        return _date;
    }

    event_generator(Date date) {
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
        String original_end;
        String end;
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
            for (int j = 0; j < 1600; j++) {
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

                    description = "description" + t + " __" + i + "__  --" + tt + "--";

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