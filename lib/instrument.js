const fs = require('fs')
const path = require('path')
const fastify = require('fastify')
const promClient = require('prom-client')
const getSeederInfo = require('./seeder-info')
const instrument = require('hyper-instrument')

module.exports = async function instrumentSeeder (tracker, logger, {
  repl, instrumentPort, instrumentHost, supportHeapdumps, heapdumpInterval, prometheusAlias, prometheusSharedSecret, prometheusScraperPublicKey, prometheusServiceName
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

  let dhtPromClient = null
  const setupPromRpcClient = prometheusAlias != null
  if (setupPromRpcClient) {
    dhtPromClient = instrument({
      swarm: tracker.swarm,
      corestore: tracker.store,
      prometheusAlias,
      scraperPublicKey: prometheusScraperPublicKey,
      scraperSecret: prometheusSharedSecret,
      prometheusServiceName
    })

    dhtPromClient.registerLogger(logger)
  }

  server.listen({
    port: instrumentPort,
    host: instrumentHost,
    listenTextResolver: (address) => `Instrumentation server listening at ${address}`
  })

  if (dhtPromClient) await dhtPromClient.ready()

  return { server, dhtPromClient }
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
