const InstrumentedSwarm = require('instrumented-swarm')
const fastify = require('fastify')
const promClient = require('prom-client')
const getSeederInfo = require('./seeder-info')
const idEncoding = require('hypercore-id-encoding')
const InstrumentedCorestore = require('@hdegroote/instrumented-corestore')
const Hypertrace = require('hypertrace')
const Replicator = require('hypercore/lib/replicator')
const fs = require('fs')
const path = require('path')

const { version: PACKAGE_VERSION } = require('../package.json')

// TODO: refactor to have a cleaner setup of these metrics
const PEER_METRICS = [
  'Peer-_requestRangeBlock',
  'Peer-send',
  'Peer-send-start',
  'Peer-ondata',
  'Peer-broadcastRange'
]

const HYPERCORE_MSG_TYPES = new Map()
HYPERCORE_MSG_TYPES.set(0, 'sync')
HYPERCORE_MSG_TYPES.set(1, 'request')
HYPERCORE_MSG_TYPES.set(2, 'cancel')
HYPERCORE_MSG_TYPES.set(3, 'data')
HYPERCORE_MSG_TYPES.set(4, 'noData')
HYPERCORE_MSG_TYPES.set(5, 'want')
HYPERCORE_MSG_TYPES.set(6, 'unwant')
HYPERCORE_MSG_TYPES.set(7, 'bitfield')
HYPERCORE_MSG_TYPES.set(8, 'range')
HYPERCORE_MSG_TYPES.set(9, 'extension')

const PROTOMUX_METRICS = []

for (const msgType of HYPERCORE_MSG_TYPES.keys()) {
  PROTOMUX_METRICS.push(getProtomuxUid(
    'send',
    { type: msgType, protocol: 'hypercore/alpha' }
  ))
  PROTOMUX_METRICS.push(getProtomuxUid(
    'recv',
    { type: msgType, protocol: 'hypercore/alpha' }
  ))
}

const ALL_METRICS = [...PEER_METRICS, ...PROTOMUX_METRICS]

module.exports = async function instrument (tracker, logger, {
  repl, instrumentPort, instrumentHost, detailedMetrics, seedListKey, trace, getDescriptionWaitMs, supportHeapdumps, heapdumpInterval
}) {
  if (trace) setupTracing(logger)

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

  const instrumentedSwarm = new InstrumentedSwarm(tracker.swarm, { server })

  const getName = async (core) => {
    const key = idEncoding.normalize(core.key)
    try {
      logger.debug(`getting name for key ${key}`)

      if (idEncoding.normalize(seedListKey) === key) {
        return 'Simple seeder main seedbee key'
      }

      // Give some time for the description to propagate
      // (this is an ugly hack, solved by restructuring the app)
      // DEVNOTE: 5s has shown to be insufficient in some cases, whichs seems odd
      await new Promise(resolve => setTimeout(resolve, getDescriptionWaitMs))

      return tracker.get(key)?.description
    } catch (e) {
      // This error is expected for secondary cores, which have no explicit name
      // but if it happens for primary cores, something is off (might be we
      // are not waiting long enough for the description to propagate)
      logger.info(`Error while getting name for key ${key}: ${e}`)
    }
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

function registerTracingMetrics (counters) {
  const normalise = (name) => {
    return name
      .toLowerCase()
      .replaceAll('-', '_')
  }
  const metrics = []
  for (const origName of ALL_METRICS) {
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
  {
    const originalRequestRangeBlock = Replicator.Peer.prototype._requestRangeBlock
    Replicator.Peer.prototype._requestRangeBlock = function _requestRangeBlockMonkeyPatch (...args) {
      this.tracer.trace('_requestRangeBlock')
      return originalRequestRangeBlock.call(this, ...args)
    }
  }

  {
    const originalBroadcastRange = Replicator.Peer.prototype.broadcastRange
    Replicator.Peer.prototype.broadcastRange = function broadcastRangeMonkeyPatch (...args) {
      this.tracer.trace('broadcastRange')
      return originalBroadcastRange.call(this, ...args)
    }
  }
}

function setupTracing (logger) {
  logger.warn('Applying monkey patches to improve tracing')
  applyTracerMonkeyPatches()

  const counters = new Map()
  Hypertrace.setTraceFunction(({ id, object, caller }) => {
    if (object.className === 'Peer') {
      const uid = `${object.className}-${id}`
      const prev = counters.get(uid) || 0
      counters.set(uid, prev + 1)
    } else if (object.className === 'Channel') {
      const uid = getProtomuxUid(id, caller.props, logger)
      if (!uid) return

      const prev = counters.get(uid) || 0
      counters.set(uid, prev + 1)
    }
  })

  registerTracingMetrics(counters)
}

function getProtomuxUid (methodName, { type, protocol }, logger = console) {
  // TODO: consider logging this (but if it ever triggers it will be a big logspam)
  // if (protocol !== 'hypercore/alpha') logger.error(`Unexpected protocol in protomux: ${protocol}`)

  const msgName = HYPERCORE_MSG_TYPES.get(type)
  if (!msgName) {
    logger.error(`Unexpected hypercore message type. Does this module need updating? Type: ${type}`)
    return
  }

  const uid = `Protomux-${methodName}-${msgName}`
  return uid
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
