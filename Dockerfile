FROM node:24-bookworm-slim AS browser-dependencies
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY HBDS ./HBDS
COPY tools/verify-hbds-public.mjs ./tools/verify-hbds-public.mjs
RUN node --input-type=module -e "import fs from 'node:fs/promises'; import {inspectPublicHbds} from './tools/verify-hbds-public.mjs'; for(const name of await fs.readdir('HBDS',{recursive:true})){const file='HBDS/'+name;if((await fs.stat(file)).isFile())inspectPublicHbds(file,await fs.readFile(file,'utf8'));}"
RUN node --input-type=module -e "import fs from 'node:fs'; import {parse,stringify} from 'yaml'; for(const name of fs.readdirSync('HBDS/yaml')){if(!name.endsWith('.yml'))continue;const file='HBDS/yaml/'+name,config=parse(fs.readFileSync(file,'utf8'));config.connectors=['java_api'];if(name==='DEMO_default.yml'){config.target_path='/data/DEMO/events/yyyy/mm/dd';config.sources[0].source_path='/data/DEMO/input';}fs.writeFileSync(file,stringify(config));}const service=parse(fs.readFileSync('HBDS/service.yml','utf8'));service.connectors=[{id:'java_api',type:'http',owner:'java',host:'0.0.0.0',port:8442}];fs.writeFileSync('HBDS/service.yml',stringify(service));"

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
COPY --from=browser-dependencies /build/HBDS/yaml ./HBDS/yaml
COPY --from=browser-dependencies /build/HBDS/models ./HBDS/models
COPY --from=browser-dependencies /build/HBDS/service.yml ./HBDS/service.yml
COPY HBDS/workspace.json ./HBDS/workspace.json
COPY HBDS/GEO_Workspace.json ./HBDS/GEO_Workspace.json
COPY HBDS/users/defaults.json ./HBDS/users/defaults.json
COPY HBDS/groups/defaults.json ./HBDS/groups/defaults.json
COPY HBDS/roles/defaults.json ./HBDS/roles/defaults.json
COPY *.html *.png favicon.ico README.md LICENSE ./
COPY package.json ./package.json
COPY release/public-files.json ./release/public-files.json
COPY src/*.js ./src/
COPY src/vendor ./src/vendor/
COPY css ./css
COPY json/test-data ./json/test-data
COPY examples/geoscience ./examples/geoscience
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
VOLUME ["/data", "/app/HBDS"]
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:8442/api/v1/health || exit 1
CMD ["java", "-cp", "/opt/openbexi/classes:/opt/openbexi/runtime/*", "com.openbexi.timeline.server.openbexi_timeline", "--workspace", "HBDS/workspace.json"]
