const InstrumentedSwarm = require('instrumented-swarm')
const fastify = require('fastify')
const promClient = require('prom-client')
const getSeederInfo = require('./seeder-info')
const setupRepl = require('repl-swarm')
const idEncoding = require('hypercore-id-encoding')
const InstrumentedCorestore = require('@hdegroote/instrumented-corestore')
const Hypertrace = require('hypertrace')
const Replicator = require('hypercore/lib/replicator')

const { version: PACKAGE_VERSION, name: PACKAGE_NAME } = require('../package.json')

const PEER_METRICS = [
  'Peer-_requestRangeBlock',
  'Peer-send',
  'Peer-send-start',
  'Peer-ondata'
]

module.exports = async function instrument (tracker, logger, {
  repl, instrumentPort, instrumentHost, detailedMetrics, seedListKey, trace
}) {
  if (trace) {
    logger.warn('Applying monkey patches to improve tracing')
    applyTracerMonkeyPatches()

    const counters = new Map()
    Hypertrace.setTraceFunction(({ id, object }) => {
      if (object.className !== 'Peer') return

      const uid = `${object.className}-${id}`
      const prev = counters.get(uid) || 0
      counters.set(uid, prev + 1)
    })

    registerTracingMetrics(counters)
  }

  const server = fastify({ logger })

  const replSeed = repl ? setupRepl({ tracker }) : null
  const instrumentedSwarm = new InstrumentedSwarm(tracker.swarm, { server })

  const getName = async (core) => {
    const key = idEncoding.normalize(core.key)

    if (idEncoding.normalize(seedListKey) === key) {
      return 'Simple seeder main seedbee key'
    }

    // Give some time for the description to propagate
    await new Promise(resolve => setTimeout(resolve, 1000))
    return tracker.get(key)?.description
  }

  // TODO: consider function instead of class
  new InstrumentedCorestore( // eslint-disable-line no-new
    tracker.store, promClient, getName, { detailed: detailedMetrics }
  )

  promClient.collectDefaultMetrics()
  instrumentedSwarm.registerPrometheusMetrics(promClient)
  registerPackageVersion()

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

function registerPackageVersion () {
  const name = PACKAGE_NAME.toLowerCase()
    .replaceAll('@', '')
    .replaceAll('/', '_')
    .replaceAll('-', '_') + '_version'

  // Gauges expect a number, so we set the version as label instead
  return new promClient.Gauge({
    name,
    help: 'Package version in config.json',
    labelNames: ['version'],
    collect () {
      this.labels(
        PACKAGE_VERSION
      ).set(1)
    }
  })
}

function registerTracingMetrics (counters) {
  const normalise = (name) => {
    return name
      .toLowerCase()
      .replaceAll('-', '_')
  }
  const metrics = []
  for (const origName of PEER_METRICS) {
    const name = normalise(origName)
    metrics.push(new promClient.Gauge({
      name,
      help: `Hypertrace trigger count for ${origName}`,
      collect () {
        const value = counters.get(origName) || 0
        this.set(value)
      }
    }))
  }

  return metrics
}

function applyTracerMonkeyPatches () {
  const originalRequestRangeBlock = Replicator.Peer.prototype._requestRangeBlock
  Replicator.Peer.prototype._requestRangeBlock = function _requestRangeBlockMonkeyPatch (...args) {
    this.tracer.trace('_requestRangeBlock')
    return originalRequestRangeBlock.call(this, ...args)
  }
}
