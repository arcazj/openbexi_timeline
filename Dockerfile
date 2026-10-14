FROM node:24-bookworm-slim AS browser-dependencies
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY HBDS/templates/default.hbds.json ./container.hbds.json
RUN node --input-type=module -e "import fs from 'node:fs'; const file='container.hbds.json', config=JSON.parse(fs.readFileSync(file)); for(const connector of config.connectors){connector.protocol='http';connector.port=8442;} for(const source of config.sources){source.configuration.connector='http:8442';source.configuration.data_model='/data/legacy/SOURCES2/yyyy/mm/dd';} fs.writeFileSync(file,JSON.stringify(config,null,2)+'\\n');"

FROM maven:3.9.16-eclipse-temurin-17 AS java-build
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
COPY --from=browser-dependencies /build/container.hbds.json ./HBDS/templates/container.hbds.json
COPY *.html *.png favicon.ico README.md LICENSE ./
COPY package.json ./package.json
COPY release/public-files.json ./release/public-files.json
COPY src/*.js ./src/
COPY src/vendor ./src/vendor/
COPY css ./css
COPY json/test-data ./json/test-data
COPY HBDS/schema ./HBDS/schema
COPY HBDS/templates ./HBDS/templates
COPY HBDS/aliases.json ./HBDS/aliases.json
COPY icon ./icon
COPY demos ./demos
COPY doc ./doc
COPY docs ./docs
COPY help ./help
COPY schemas ./schemas
COPY swagger ./swagger
RUN chown -R openbexi:openbexi /app /data
ENV OPENBEXI_API_DATA_DIR=/data/api
USER 10001:10001
EXPOSE 8442
VOLUME ["/data", "/app/HBDS/private"]
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:8442/api/v1/health || exit 1
CMD ["java", "-cp", "/opt/openbexi/classes:/opt/openbexi/runtime/*", "com.openbexi.timeline.server.openbexi_timeline", "-data_conf", "HBDS/templates/container.hbds.json"]
