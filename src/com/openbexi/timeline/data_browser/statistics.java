package com.openbexi.timeline.data_browser;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Iterator;
import java.util.stream.Stream;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

public class statistics {
    private File _cvsFile;
    private File _dataModelPath;
    private String _year;
    private data_configuration _data_configuration;

    statistics(data_configuration data_configuration, String year) {
        _data_configuration = data_configuration;
        _year = year;

        // _dataModelPath= "/<path>/yyyy/mm/dd"
        _dataModelPath = new File(_data_configuration.getDataModel(0));

        File dataCVSModelPath = new File(_data_configuration.getDataModel(0)).getParentFile().getParentFile();
        _cvsFile = new File(dataCVSModelPath.getAbsolutePath().replace("yyyy", year) + "/" + "index.cvs");

        if (!_cvsFile.getParentFile().exists())
            _cvsFile.mkdirs();
    }

    private void createCvs() {
        try (FileWriter writer = new FileWriter(_cvsFile)) {
            writer.write("year,month,day,filename,number_of_events\n");

            // Iterate through each day directory from January 1 to December 31
            for (int month = 1; month <= 12; month++) {
                for (int day = 1; day <= 31; day++) {
                    String monthStr = String.format("%02d", month);
                    String dayStr = String.format("%02d", day);
                    File dayDir = new File(_dataModelPath.getAbsolutePath()
                            .replace("yyyy", _year).replace("mm", monthStr).replace("dd", dayStr));
                    if (dayDir.exists() && dayDir.isDirectory()) {
                        try (Stream<Path> paths = Files.walk(Paths.get(dayDir.getAbsolutePath()))) {
                            Iterator<Path> iterator = paths.filter(path ->
                                    Files.isRegularFile(path) &&
                                            path.toString().endsWith(".json") &&
                                            !path.toString().contains("descriptors")
                            ).iterator();
                            while (iterator.hasNext()) {
                                Path path = iterator.next();
                                File jsonFile = path.toFile();
                                if (jsonFile.getName().endsWith(".json")) {
                                    int numberOfEvents = countEvents(jsonFile);
                                    writer.write(String.format("%s,%s,%s,%s,%d\n", _year, monthStr, dayStr, jsonFile.getName(), numberOfEvents));
                                }
                            }
                        } catch (IOException e) {
                            e.printStackTrace();
                        }
                    }
                }
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    private int countEvents(File jsonFile) {
        int eventCount = 0;
        try {
            String content = new String(Files.readAllBytes(jsonFile.toPath()));
            JSONObject jsonObject = new JSONObject(new JSONTokener(content));
            if (jsonObject.has("events")) {
                JSONArray events = jsonObject.getJSONArray("events");
                eventCount = events.length();
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
        return eventCount;
    }

    public static void main(String[] args) {
        data_configuration data_configuration = null;
        String data_conf = "";

        if (args.length == 2 && args[0].equals("-data_conf")) {
            data_conf = args[1];
        } else {
            System.err.println("statistics not started because of bad usage:");
            System.err.println("Argument " + args[0] + " " + "-data_conf <file> ");
            System.exit(1);
        }

        try {
            data_configuration = new data_configuration(data_conf);
        } catch (Exception e) {
        }

        statistics stats = new statistics(data_configuration, "2024");
        stats.createCvs();
    }
}
