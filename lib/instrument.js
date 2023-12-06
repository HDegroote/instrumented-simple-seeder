const InstrumentedSwarm = require('instrumented-swarm')
const fastify = require('fastify')
const promClient = require('prom-client')
const getSeederInfo = require('./seeder-info')
const Hypermetrics = require('hypermetrics')
const safetyCatch = require('safety-catch')
const detectType = require('hypercore-detector')
const Hyperbee = require('hyperbee')
const idEncoding = require('hypercore-id-encoding')

module.exports = async function instrument (tracker, logger, { repl, instrumentPort, instrumentHost }) {
  const server = fastify({ logger })

  const instrumentedSwarm = new InstrumentedSwarm(tracker.swarm, { server, launchRepl: repl })
  const hypermetrics = new Hypermetrics(promClient)

  // Best-effort map, but not guaranteed to contain all drives
  // (if we process a drive whose header is not yet available)
  // In particular, on first run the blobs cores won't be named
  // TODO: rethink architecture, and simplify linking the hyperdrive cores
  const blobsToDrives = new Map()

  const alreadyOpenedCores = [...tracker.corestore.cores.values()]

  tracker.store.on('core-open', async core => {
    // The core-open event is emitted before the metadata
    // (with possible name) is processed.
    // This is a hack to get the name, by waiting a bit
    // TODO: cleanly
    await new Promise(resolve => setTimeout(resolve, 1000))
    await updateDrivesMap(core, blobsToDrives)

    pushCoreToHyperMetrics(core, hypermetrics, tracker, logger, blobsToDrives)
  })

  for (const core of alreadyOpenedCores) {
    await updateDrivesMap(core, blobsToDrives)
  }

  for (const core of alreadyOpenedCores) {
    pushCoreToHyperMetrics(core, hypermetrics, tracker, logger, blobsToDrives)
  }

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

function pushCoreToHyperMetrics (core, hypermetrics, tracker, logger, blobsToDrives) {
  let name = null
  const parentKey = blobsToDrives.get(core.id)
  try {
    name = parentKey
      ? `${tracker.get(parentKey).description} (secondary core)`
      : tracker.get(core.id).description
  } catch (e) { safetyCatch(e) } // No description found

  logger.info(`Adding core metrics for ${core.id} (name: ${name})`)
  hypermetrics.add(core, { name })
}

async function updateDrivesMap (core, blobsToDrives) {
  if (await detectType(core) === 'drive') {
    const bee = new Hyperbee(core)
    await bee.ready()
    // Once here, we can assume the header exists (else detectType wouldn't return hyperdrive)
    const blobsKey = (await bee.getHeader()).metadata?.contentFeed
    blobsToDrives.set(idEncoding.encode(blobsKey), core.id)
  }
}
