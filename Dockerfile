FROM node:20-slim

# When port-mapping, ensure the from and to port are the same
# else the holepunching will fail (irrelevant for host-networking)
# Only set when you know the port is unfirewalled
ENV DHT_PORT=0

ENV INSTRUMENT=TRUE
ENV REPL=FALSE
ENV LOG_LEVEL=info
ENV INSTRUMENT_HOST=127.0.0.1
ENV INSTRUMENT_PORT=8080

# Never really a need to change this
ENV STORAGE=/home/seeder/store

RUN useradd -u 19554 --create-home seeder

COPY lib /home/seeder/lib
COPY package.json /home/seeder/package.json
COPY run.js /home/seeder/run.js
COPY index.js /home/seeder/index.js
COPY LICENSE /home/seeder/LICENSE
COPY NOTICE /home/seeder/NOTICE
COPY package-lock.json /home/seeder/package-lock.json
COPY node_modules /home/seeder/node_modules

USER seeder

# Ensure correct permissions on corestore dir by already creating it
# (relevant when using volumes)
RUN mkdir $STORAGE

WORKDIR /home/seeder/
ENTRYPOINT ["node", "/home/seeder/run.js"]
