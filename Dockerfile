FROM adoptopenjdk/openjdk13
COPY out/artifacts/openbexi_timeline_jar/openbexi_timeline.jar openbexi_timeline.jar
COPY css css
COPY icon icon
COPY jsCalendar-master jsCalendar-master
COPY json json
COPY src src
COPY three.js three.js
COPY THREE.TextSprite THREE.TextSprite
COPY THREE.TextTexture THREE.TextTexture

COPY tomcat tomcat
COPY openbexi_timeline_secure.html openbexi_timeline_secure.html
COPY openbexi_timeline_SSE.html openbexi_timeline_SSE.html
COPY openbexi_timeline_overview_SSE.html openbexi_timeline_overview_SSE.html
COPY tests tests
EXPOSE 8443
EXPOSE 8445
CMD java -cp openbexi_timeline.jar com.openbexi.timeline.server.openbexi_timeline -data_path "/data/yyyy/mm/dd" -connector "secure_sse:8443|secure:8445"