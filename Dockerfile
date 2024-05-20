# Use the specific version of OpenJDK
FROM openjdk:17

# Set the working directory for the application
WORKDIR /

# Copy the essential static files that are less likely to change frequently
COPY openbexi_timeline.html ./
COPY src src
COPY css css
COPY lib lib
COPY json json
COPY yaml yaml
COPY models models
COPY filters filters
COPY icon icon
COPY tests tests
COPY tomcat tomcat
COPY node_modules node_modules

# Copy the JAR file and other dependencies that might change frequently
COPY out/artifacts/openbexi_timeline_jar/openbexi_timeline.jar ./

# Expose the required ports;
# use port 8441 to enable the openbexi timeline server to push real-time updates or events via the Server-Sent Events (SSE) technology.
# use port 8442 to make asynchronous HTTP requests to the openbexi timeline server
EXPOSE 8441 8442

# If there are any environment variables or other configurations that need to be set, you can do it here
# ENV SOME_VARIABLE=value

# Define volumes if needed
VOLUME /data

# Health check for Kubernetes to know when the container is ready
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl --fail http://localhost:8442/health || exit 1

# Command to run the application with the javaagent option
CMD ["java", "-cp", "openbexi_timeline.jar", "com.openbexi.timeline.server.openbexi_timeline", "-data_conf", "yaml/sources_startup.yml"]

#  docker push arcazj/openbexi_timeline

