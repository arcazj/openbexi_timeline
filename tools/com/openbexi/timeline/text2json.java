package com.openbexi.timeline;

import java.io.BufferedWriter;
import java.io.File;
import java.io.IOException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Date;
import java.util.Scanner;
import java.util.UUID;

public class text2json {

    final static Charset ENCODING = StandardCharsets.UTF_8;

    void convert2json(String type) throws IOException {
        String fileName = null;
        String jsonFileName = null;
        if (type.equals("covid19")) {
            fileName = "json/covid19.txt";
            jsonFileName = "json/covid19.json";
        }
        if (type.equals("space_exploration")) {
            fileName = "json/space_exploration.txt";
            jsonFileName = "json/space_exploration.json";
        }

        String directory = System.getProperty("user.dir");
        String absolutePath = directory + File.separator + fileName;
        String jsonAbsolutePath = directory + File.separator + jsonFileName;
        boolean first_start = false;
        int count_line = 0;

        String line = "{\n" +
                "  \"dateTimeFormat\": \"iso8601\",\n" +
                "  \"events\": [\n";
        Path path = Paths.get(absolutePath);
        Path jsonPath = Paths.get(jsonAbsolutePath);
        try (BufferedWriter writer = Files.newBufferedWriter(jsonPath, ENCODING)) {
            writer.write(line);
            try (Scanner scanner = new Scanner(path, ENCODING.name())) {
                while (scanner.hasNextLine()) {
                    line = scanner.nextLine();
                    if (!line.equals("")) {
                        if ((line.contains("    18") || line.contains("    19") || line.contains("    20")) && line.contains(", ")) {
                            if (first_start == true)
                                writer.write("\"}},");

                            line = line.replace("    ", "").replace("\"", "'");
                            log(count_line++ + " - " + line);
                            String date_s = line.substring(0, 4) + "/" +
                                    line.substring(5, 8).replace("Jan", "1")
                                            .replace("Feb", "2")
                                            .replace("Mar", "3")
                                            .replace("Apr", "4")
                                            .replace("May", "5")
                                            .replace("Jun", "6")
                                            .replace("Jul", "7")
                                            .replace("Aug", "8")
                                            .replace("Sep", "9")
                                            .replace("Oct", "10")
                                            .replace("Nov", "11")
                                            .replace("Dec", "12") + "/" +
                                    line.substring(9, 11).replace(",", "");
                            Date date = new Date(date_s);
                            writer.newLine();
                            writer.write("  {\"start\":\"" + date.toString() + "\",");
                            writer.write("\"data\":{");
                            writer.write("\"title\":\"" + line.substring(12, line.length()) + "\",");
                            writer.write("\"text\":\"" + line.substring(12, line.length()) + " ");
                        } else {
                            line = line.replace("    ", "");
                            writer.write(line.replace("\"", "'"));
                            first_start = true;
                        }
                    }
                }
                writer.write("\"}}]}");
                writer.flush();
            }
        }
    }

    void convert2ephemerisjson() throws IOException {
        String fileName = null;
        String jsonFileName = null;

        fileName = "json/ephemeris.txt";
        jsonFileName = "json/ephemeris.json";

        String directory = System.getProperty("user.dir");
        String absolutePath = directory + File.separator + fileName;
        String jsonAbsolutePath = directory + File.separator + jsonFileName;
        boolean first_start = false;
        int count_line = 0;
        int count_eph = 0;
        String ref = "";
        String region = "";
        String longitude = "";
        String latitude = "";
        String spacecraft = "";
        String entering = "";
        String exiting = "";
        String previous_line = "";
        String start_epoch = "";
        String end_epoch = "";
        Date date_entering = null;
        Date date_exiting = null;

        String line = "{\n" +
                "  \"dateTimeFormat\": \"iso8601\",\n" +
                "  \"events\": [\n";
        Path path = Paths.get(absolutePath);
        Path jsonPath = Paths.get(jsonAbsolutePath);
        try (BufferedWriter writer = Files.newBufferedWriter(jsonPath, ENCODING)) {
            writer.write(line);
            try (Scanner scanner = new Scanner(path, ENCODING.name())) {
                while (scanner.hasNextLine()) {
                    line = scanner.nextLine();
                    if ((line.contains("Ref:"))) {
                        ref = line;
                    }
                    if ((line.contains("Region"))) {
                        region = line;
                        count_eph = 0;
                    }
                    if ((line.contains("Longitude")))
                        longitude = line;
                    if ((line.contains("Latitude")))
                        latitude = line;
                    if ((line.contains("start epoch")))
                        latitude = line;
                    if ((line.contains("enf epoch")))
                        latitude = line;
                    if ((line.contains("Spacecraft")))
                        spacecraft = line;

                    if (line.contains("[Center of Box]")) {
                        String yyyy = line.substring(0, 4);
                        String mm = line.substring(5, 7);
                        String dd = line.substring(8, 10);
                        String t = line.substring(11, 19);
                        if ((line.contains("Entering Polygon"))) {
                            entering = yyyy + "/" + mm + "/" + dd + " " + t;
                            date_entering = new Date(entering);
                            previous_line = line;
                            log(count_line++ + ":" + spacecraft + " - " + line);
                        }
                        if ((line.contains("Exiting Polygon"))) {
                            exiting = yyyy + "/" + mm + "/" + dd + " " + t;
                            date_exiting = new Date(exiting);
                            log(count_line++ + ":" + spacecraft + " - " + line);
                            writer.newLine();
                            writer.write("  {\"ID\":\"" + UUID.randomUUID().toString() + "\",");
                            writer.write("  \"start\":\"" + date_entering.toString() + "\",");
                            writer.write("  \"end\":\"" + date_exiting.toString() + "\",");
                            writer.write("\"data\":{");
                            writer.write("\"title\":\"" + "Ephemeris-" + count_eph++ + "\",");
                            writer.write("\"satellite\":\"" + spacecraft.substring(21, 26) + "\",");
                            writer.write("\"text\":\"" + spacecraft + " " + region + " " + start_epoch + " " + end_epoch + " " + longitude + " " + latitude + " " + previous_line + " " + line + " - " + ref + "\"");
                            writer.write("}},");
                            log(count_line + ":" + spacecraft + "- eph=" + count_eph + " date_entering:" + date_entering + "|date_exiting:" + date_exiting + " - " + line);
                        }
                    }
                }
                writer.write("]}");
                writer.flush();
            }
        }
    }

    private static void log(Object msg) {
        System.out.println(String.valueOf(msg));
    }

    public static void main(String... args) throws IOException {
        text2json text = new text2json();
        text.convert2json("covid19");
        text.convert2json("space_exploration");
        text.convert2ephemerisjson();
    }
}