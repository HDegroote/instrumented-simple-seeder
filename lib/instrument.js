const InstrumentedSwarm = require('instrumented-swarm')
const fastify = require('fastify')
const promClient = require('prom-client')
const getSeederInfo = require('./seeder-info')
const setupRepl = require('repl-swarm')
const idEncoding = require('hypercore-id-encoding')

const InstrumentedCorestore = require('@hdegroote/instrumented-corestore')

module.exports = async function instrument (tracker, logger, {
  repl, instrumentPort, instrumentHost, detailedMetrics, seedListKey
}) {
  const server = fastify({ logger })

  const replSeed = repl ? setupRepl({ tracker }) : null
  const instrumentedSwarm = new InstrumentedSwarm(tracker.swarm, { server })

  const uniqueKeys = new Set()
  const getName = async (key) => {
    try {
      logger.info(`Getting name for core key ${key}`)
      const initL = uniqueKeys.size
      uniqueKeys.add(key)
      if (initL === uniqueKeys.size) logger.warn(`${key} duplicate  added`)
      if (idEncoding.normalize(seedListKey) === idEncoding.normalize(key)) {
        return 'Simple seeder main seedbee key'
      }
      await new Promise(resolve => setTimeout(resolve, 1000)) // Give some time for the description to propagate
      const name = tracker.get(key)?.description
      logger.info(`Setting name for core key ${key} to ${name}`)
      return name
    } catch (e) {
      logger.debug(e)
      logger.info(`Failed to fetch name for key ${key}`)
    }
  }
  // TODO: consider function instead of class
  new InstrumentedCorestore( // eslint-disable-line no-new
    tracker.store, promClient, getName, { detailed: detailedMetrics }
  )

  promClient.collectDefaultMetrics()
  instrumentedSwarm.registerPrometheusMetrics(promClient)
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

  await server.listen({
    port: instrumentPort,
    host: instrumentHost,
    listenTextResolver: (address) => `Instrumentation server listening at ${address}`
  })

  return server
}
