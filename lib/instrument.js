const InstrumentedSwarm = require('instrumented-swarm')
const fastify = require('fastify')
const promClient = require('prom-client')
const getSeederInfo = require('./seeder-info')
const Hypermetrics = require('hypermetrics')
const safetyCatch = require('safety-catch')

module.exports = async function instrument (tracker, logger, { repl, instrumentPort, instrumentHost }) {
  const server = fastify({ logger })

  const instrumentedSwarm = new InstrumentedSwarm(tracker.swarm, { server, launchRepl: repl })
  const hypermetrics = new Hypermetrics(promClient)

  for (const core of tracker.corestore.cores.values()) {
    pushCoreToHyperMetrics(core, hypermetrics, tracker, logger)
  }

  tracker.store.on('core-open', async core => {
    // The core-open event is emitted before the metadata
    // (with possible name) is processed.
    // This is a hack to get the name, by waiting a bit
    // TODO: cleanly
    await new Promise(resolve => setTimeout(resolve, 1000))

    pushCoreToHyperMetrics(core, hypermetrics, tracker, logger)
  })

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

  await server.listen({
    port: instrumentPort,
    host: instrumentHost,
    listenTextResolver: (address) => `Instrumentation server listening at ${address}`
  })

  return server
}

function pushCoreToHyperMetrics (core, hypermetrics, tracker, logger) {
  let name = null
  try {
    // TODO: detect when a core is the blobs core of a hyperdrive
    //  and give it a fitting name (or do at hypermetrics level)
    name = tracker.get(core.id).description
  } catch (e) { safetyCatch(e) } // No description found

  logger.info(`Adding core metrics for ${core.id} (name: ${name})`)
  hypermetrics.add(core, { name })
}
