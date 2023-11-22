FROM node:18-slim
ARG TAG=passAsBuildArg

# When port-mapping, ensure the from and to port are the same
# (else the holepunching will fail)
ENV DHT_PORT=19554

ENV INSTRUMENT=FALSE
ENV REPL=FALSE
ENV LOG_LEVEL=info

# Never really a need to change these
ENV STORAGE=/home/seeder/store
ENV INSTRUMENT_HOST=0.0.0.0
ENV INSTRUMENT_PORT=8080

RUN npm i -g hdegroote/instrumented-simple-seeder#debugging

RUN useradd --create-home seeder
USER seeder
# Ensure correct permissions on corestore dir by already creating it
# (relevant when using volumes)
RUN mkdir $STORAGE

ENTRYPOINT ["instrumented-seeder"]
