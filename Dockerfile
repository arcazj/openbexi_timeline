# Use the specific version of OpenJDK
FROM openjdk:17

# Set the working directory for the application
WORKDIR /

# Copy the essential static files that are less likely to change frequently
COPY openbexi_timeline.html ./
COPY src src
COPY css css
COPY jsCalendar-master jsCalendar-master
COPY json json
COPY three.js three.js
COPY THREE.TextSprite THREE.TextSprite
COPY THREE.TextTexture THREE.TextTexture
COPY etc etc
COPY icon icon
COPY filters filters

# Copy Tomcat configuration if needed
COPY tomcat tomcat

# Copy the JAR file and other dependencies that might change frequently
COPY out/artifacts/openbexi_timeline_jar/openbexi_timeline.jar ./

# Expose the required ports
EXPOSE 8441 8442

# If there are any environment variables or other configurations that need to be set, you can do it here
# ENV SOME_VARIABLE=value

VOLUME /data

# Command to run the application
CMD ["java", "-cp", "openbexi_timeline.jar", "com.openbexi.timeline.server.openbexi_timeline", "-data_conf", "etc/ob_startup_conf.json"]


