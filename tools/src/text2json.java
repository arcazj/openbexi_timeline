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

public class text2json {

    private String directory = System.getProperty("user.dir");
    //private String fileName = "json/covid19.txt";
    //private String jsonFileName = "json/covid19.json";
    private String fileName = "json/space_exploration.txt";
    private String jsonFileName = "json/space_exploration.json";
    private String absolutePath = directory + File.separator + fileName;
    private String jsonAbsolutePath = directory + File.separator + jsonFileName;

    final static Charset ENCODING = StandardCharsets.UTF_8;

    void convert2json(String absolutePath, String jsonAbsolutePath) throws IOException {
        boolean first_start = false;
        int count_line=0;

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
                        if ((line.contains("    18")||line.contains("    19")||line.contains("    20")) && line.contains(", ")) {
                            if (first_start == true)
                                writer.write("\"},");

                            line = line.replace("    ", "").replace("\"", "'");
                            log(count_line+++" - "+line);
                            String date_s=line.substring(0, 4)+"/"+
                                    line.substring(5, 8).replace("Jan","1")
                                            .replace("Feb","2")
                                            .replace("Mar","3")
                                            .replace("Apr","4")
                                            .replace("May","5")
                                            .replace("Jun","6")
                                            .replace("Jul","7")
                                            .replace("Aug","8")
                                            .replace("Sep","9")
                                            .replace("Oct","10")
                                            .replace("Nov","11")
                                            .replace("Dec","12")+"/"+
                                    line.substring(9,11).replace(",","");
                            Date date = new Date(date_s);
                            writer.newLine();
                            writer.write("  {\"start\":\"" + date.toString() + "\",");
                            writer.newLine();
                            writer.write("\"title\":\"" + line.substring(12, line.length())+ "\",");
                            writer.write("\"text\":\"" + line.substring(12, line.length())+" ");
                        } else {
                            line = line.replace("    ", "");
                            writer.write(line.replace("\"", "'"));
                            first_start = true;
                        }
                    }
                }
                writer.write("\"}]}");
                writer.flush();
            }
        }
    }


    private static void log(Object msg) {
        System.out.println(String.valueOf(msg));
    }

    public static void main(String... args) throws IOException {
        text2json text = new text2json();
        text.convert2json(text.absolutePath, text.jsonAbsolutePath);
    }
}