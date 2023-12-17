# Use the specific version of OpenJDK
FROM openjdk:17

# Set the working directory for the application
WORKDIR /

# Copy the essential static files that are less likely to change frequently
COPY openbexi_timeline.html ./
COPY src src
COPY css css
COPY simple-jscalendar simple-jscalendar
COPY json json
COPY three three
COPY three.text-sprite three.text-sprite
COPY three.text-texture three.text-texture
COPY etc etc
COPY models models
COPY filters filters
COPY icon icon

# Copy Tomcat configuration if needed
COPY tomcat tomcat

# Copy the JAR file and other dependencies that might change frequently
COPY out/artifacts/openbexi_timeline_jar/openbexi_timeline.jar ./

# Expose the required ports;
#     use port 8441 to enable the openbexi timeline server to push real-time updates or events via the Server-Sent Events (SSE) technology.
#     use port 8442 to make asynchronous HTTP requests to the openbexi timeline server
EXPOSE 8441 8442

# If there are any environment variables or other configurations that need to be set, you can do it here
# ENV SOME_VARIABLE=value

VOLUME /data

# Command to run the application
CMD ["java", "-cp", "openbexi_timeline.jar", "com.openbexi.timeline.server.openbexi_timeline", "-data_conf", "etc/ob_startup_conf.json"]

#  docker push arcazj/openbexi_timeline

