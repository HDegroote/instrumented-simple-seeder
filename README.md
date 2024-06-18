# Instrumented Simple Seeder

Simplifies deploying a [simple-seeder](https://github.com/holepunchto/simple-seeder) with a seed list, and adds optional instrumentation.

## Install

`npm i -g instrumented-simple-seeder`

## Usage

Can be deployed as a [Docker container](https://hub.docker.com/r/hdegroote/simple-seeder).

Alternatively, from the CLI:

`SEED_LIST_KEY=<SEED-LIST-KEY> instrumented-seeder`

## Debug Builds

Push a tag containing 'debug' to trigger a debug build, including repl-swarm and heapdump support:

```
git tag debug-memleak
git push origin debug-memleak
```

Create a directory where the heapsnapshots can be stored, and make it writable by all users (or chown it to the docker user).

Then run a command like

```
docker run --name qt --env INSTRUMENT=true --env SEEDER_HEAPDUMP_INTERVAL_MINUTES=60 SEEDER_SUPPORT_HEAPDUMPS=true --SEED_LIST_KEY=<...> --mount type=volume,source=qt-volume,destination=/home/seeder/store --mount type=bind,source=/home/hans/qt/heapdumps,destination=/tmp/heapdumps hdegroote/seeder:debug
```

(hourly heapdumps will be stored in `/home/hans/qt/heapdumps` in this example)
