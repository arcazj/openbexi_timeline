FROM openjdk:17
COPY out/artifacts/openbexi_timeline_jar/openbexi_timeline.jar openbexi_timeline.jar
COPY css css
COPY icon icon
COPY jsCalendar-master jsCalendar-master
COPY json json
COPY src src
COPY etc etc
COPY three.js three.js
COPY THREE.TextSprite THREE.TextSprite
COPY THREE.TextTexture THREE.TextTexture

COPY tomcat tomcat
COPY openbexi_timeline_test_secure.html openbexi_timeline_test_secure.html
COPY openbexi_timeline_test_SSE.html openbexi_timeline_test_SSE.html
COPY tests tests
EXPOSE 8441
EXPOSE 8442
CMD java -cp openbexi_timeline.jar com.openbexi.timeline.server.openbexi_timeline -data_conf "etc/ob_startup_conf.json"