package com.openbexi.timeline.tests;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;

import javax.net.ssl.*;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.security.cert.X509Certificate;
import java.io.IOException;
import java.net.URL;

public class CrucibleInfoExtractor {
    public static void main(String[] args) {
        // URL to the resource you want to access
        String baseUrl = "https://vmit-teamforge.socit.intelsat.com:8440/fisheye/graph/GNS";

        // Start the recursive extraction process
        extractInfoRecursively(baseUrl);
    }

    public static void extractInfoRecursively(String url) {
        // Disable SSL certificate validation
        disableCertificateValidation();

        try {
            // Open a connection to the URL
            HttpsURLConnection connection = (HttpsURLConnection) new URL(url).openConnection();

            // Connect to the URL and retrieve the HTML content
            Document document = Jsoup.connect(url).get();
            // Extract the desired information
            // Process the content of the page, if needed
            String pageContent = document.text();
            System.out.println("Page Content: " + pageContent);

            // Extract and follow links
            Elements links = document.select("a[href]");
            for (Element link : links) {
                String nextUrl = link.absUrl("href");
                if (!nextUrl.isEmpty()) {
                    System.out.println("Following link: " + nextUrl);
                    //document = Jsoup.connect(nextUrl).get();
                    //pageContent = document.text();
                    //System.out.println("Page Content: " + pageContent);
                }
            }

            // Read the response or perform any desired operations
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    System.out.println(line);
                }
            }

            // Close the connection
            //connection.disconnect();
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    public static void disableCertificateValidation() {
        try {
            // Create a custom TrustManager that trusts all certificates
            TrustManager[] trustAllCertificates = new TrustManager[]{
                    new X509TrustManager() {
                        public X509Certificate[] getAcceptedIssuers() {
                            return null;
                        }
                        public void checkClientTrusted(X509Certificate[] certs, String authType) {
                        }
                        public void checkServerTrusted(X509Certificate[] certs, String authType) {
                        }
                    }
            };

            // Create an SSL context with the custom TrustManager
            SSLContext sslContext = SSLContext.getInstance("TLS");
            sslContext.init(null, trustAllCertificates, new java.security.SecureRandom());

            // Set the custom SSL context as the default
            HttpsURLConnection.setDefaultSSLSocketFactory(sslContext.getSocketFactory());

            // Disable hostname verification
            HttpsURLConnection.setDefaultHostnameVerifier((hostname, sslSession) -> true);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}