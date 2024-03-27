const goodbye = require('graceful-goodbye')
const Replicator = require('hypercore/lib/replicator')

const instrument = require('./lib/instrument')
const getSeederInfo = require('./lib/seeder-info')
const setupSeeder = require('./lib/seeder')

module.exports = async function runSeeder (logger, config) {
  if (config.trace) {
    logger.warn('Applying monkey patches to improve tracing')
    // TODO: clean up flow
    // Metrics should be setup before the seeder starts, then
    // the monkey patching can live in the metrics logic itself
    applyTracerMonkeyPatches()
  }

  const tracker = await setupSeeder(config)
  goodbye(async () => {
    logger.info('Exiting simple seeder')
    await tracker.destroy()
    await tracker.swarm.destroy()
    logger.info('Destroyed swarm and tracker')
  }, 10)

  logger.info('Setup simple seeder')

  if (config.instrument) {
    const server = await instrument(tracker, logger, config)
    goodbye(async () => {
      logger.info('Closing instrumenting server')
      await server.close()
      logger.info('Closed instrumenting server')
    }, 1)

    logger.info('Instrumented the simple seeder')
  }

  if (config.sLogInterval) {
    setInterval(
      () => { logger.info(getSeederInfo(tracker)) },
      config.sLogInterval * 1000
    )
    logger.info(getSeederInfo(tracker))
  }
}

function applyTracerMonkeyPatches () {
  const originalRequestRangeBlock = Replicator.Peer.prototype._requestRangeBlock
  Replicator.Peer.prototype._requestRangeBlock = function _requestRangeBlockMonkeyPatch (...args) {
    this.tracer.trace('_requestRangeBlock')
    return originalRequestRangeBlock.call(this, ...args)
  }
}
