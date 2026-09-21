FROM node:24-bookworm-slim AS browser-dependencies
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM maven:3-eclipse-temurin-26 AS java-build
WORKDIR /build
COPY pom.xml ./
COPY src ./src
COPY schemas ./schemas
RUN mvn --batch-mode --no-transfer-progress -Dmaven.test.skip=true package

FROM eclipse-temurin:17-jre-noble
RUN apt-get update \
    && apt-get install --yes --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 openbexi \
    && useradd --uid 10001 --gid openbexi --no-create-home openbexi \
    && mkdir -p /app/tomcat /data/api /opt/openbexi
WORKDIR /app
COPY --from=java-build /build/target/classes /opt/openbexi/classes
COPY --from=java-build /build/target/runtime /opt/openbexi/runtime
COPY --from=browser-dependencies /build/node_modules ./node_modules
COPY *.html *.png favicon.ico README.md LICENSE ./
COPY src/*.js ./src/
COPY css ./css
COPY json ./json
COPY models ./models
COPY filters ./filters
COPY icon ./icon
COPY demos ./demos
COPY doc ./doc
COPY docs ./docs
COPY help ./help
COPY schemas ./schemas
COPY swagger ./swagger
COPY yaml/sources_container.yml ./yaml/sources_container.yml
RUN chown -R openbexi:openbexi /app /data
ENV OPENBEXI_API_DATA_DIR=/data/api
USER 10001:10001
EXPOSE 8442
VOLUME /data
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:8442/api/v1/health || exit 1
CMD ["java", "-cp", "/opt/openbexi/classes:/opt/openbexi/runtime/*", "com.openbexi.timeline.server.openbexi_timeline", "-data_conf", "yaml/sources_container.yml"]
