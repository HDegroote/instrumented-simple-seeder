const fs = require('fs')
const path = require('path')
const fastify = require('fastify')
const promClient = require('prom-client')
const getSeederInfo = require('./seeder-info')
const DhtPromClient = require('dht-prom-client')
const HyperswarmStats = require('hyperswarm-stats')
const HypercoreStats = require('hypercore-stats')

const { version: PACKAGE_VERSION } = require('../package.json')
const HyperDht = require('hyperdht')

module.exports = async function instrument (tracker, logger, {
  repl, instrumentPort, instrumentHost, detailedMetrics, seedListKey, supportHeapdumps, heapdumpInterval, prometheusAlias, prometheusSharedSecret, prometheusScraperPublicKey, prometheusServiceName
}) {
  const server = fastify({ logger })

  let replSeed = null
  if (repl) {
    logger.warn('Enabling Hyperswarm REPL')
    const setupRepl = require('repl-swarm')
    replSeed = setupRepl({ tracker })
    logger.info(`Repl seed: ${replSeed}`)
  }

  if (supportHeapdumps) {
    logger.warn('Enabling heap dumps (send a SIGUSR2 signal to trigger)')
    if (heapdumpInterval) {
      logger.info(`Creating a heapdump every ${heapdumpInterval / 1000 / 60} minutes`)
    }

    setupHeapdumpHandler(logger, heapdumpInterval)
  }

  // const instrumentedSwarm = new InstrumentedSwarm(tracker.swarm, { server })

  // new InstrumentedCorestore( // eslint-disable-line no-new
  //    tracker.store, promClient, getName, { detailed: detailedMetrics }
  // )

  promClient.collectDefaultMetrics()
  // instrumentedSwarm.registerPrometheusMetrics(promClient)
  registerPackageVersion(promClient)

  const swarmStats = new HyperswarmStats(tracker.swarm)
  swarmStats.registerPrometheusMetrics(promClient)

  const hypercoreStats = HypercoreStats.fromCorestore(tracker.store)
  hypercoreStats.registerPrometheusMetrics(promClient)

  server.get('/metrics', { logLevel: 'warn' }, async function (req, reply) {
    const metrics = await promClient.register.metrics()
    reply.send(metrics)
  })

  server.get('/info', function (req, reply) {
    const info = getSeederInfo(tracker)
    reply.send(info)
  })

  server.get('/repl', async function (req, reply) {
    if (replSeed) {
      console.log(`REPL seed exposing tracker: ${replSeed}`)
      reply.send('Repl seed logged')
    } else {
      reply.send('No repl exposed')
    }
  })

  server.get('/health', { logLevel: 'warn' }, async function (req, reply) {
    // TODO: more elaborate
    reply.send('healthy\n')
  })

  let promRpcClient = null
  const setupPromRpcClient = prometheusAlias != null
  if (setupPromRpcClient) {
    const dht = new HyperDht()

    promRpcClient = new DhtPromClient(
      dht,
      promClient,
      prometheusScraperPublicKey,
      prometheusAlias,
      prometheusSharedSecret,
      prometheusServiceName
    )

    promRpcClient.registerLogger(logger)
  }

  server.listen({
    port: instrumentPort,
    host: instrumentHost,
    listenTextResolver: (address) => `Instrumentation server listening at ${address}`
  })

  if (promRpcClient) await promRpcClient.ready()

  return server
}

function registerPackageVersion (promClient) {
  // Gauges expect a number, so we set the version as label instead
  return new promClient.Gauge({
    name: 'package_version',
    help: 'Package version in config.json',
    labelNames: ['version'],
    collect () {
      this.labels(
        PACKAGE_VERSION
      ).set(1)
    }
  })
}

function writeHeapSnapshot (logger) {
  const heapdump = require('heapdump')

  const dir = '/tmp/heapdumps'
  // recursive: true is an easy way to avoid errors when the dir already exists
  fs.mkdirSync(dir, { recursive: true })

  const currentTime = (new Date()).toISOString()
  const loc = path.join(dir, `${currentTime}.heapsnapshot`)
  logger.warn(`Writing heap snapshot to ${loc}`)

  heapdump.writeSnapshot(loc, (err, resLoc) => {
    if (err) {
      logger.error(`Error while writing heap snapshot: ${err}`)
      return
    }
    logger.info(`Finished writing heap snapshot to ${resLoc}`)
  })
}

function setupHeapdumpHandler (logger, dumpInterval = null) {
  process.on('SIGUSR2', function () {
    writeHeapSnapshot(logger)
  })

  if (dumpInterval) {
    setInterval(() => {
      writeHeapSnapshot(logger)
    }, dumpInterval)
  }
}
