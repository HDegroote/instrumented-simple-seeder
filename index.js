const goodbye = require('graceful-goodbye')
const Replicator = require('hypercore/lib/replicator')

const instrument = require('./lib/instrument')
const getSeederInfo = require('./lib/seeder-info')
const setupSeeder = require('./lib/seeder')

module.exports = async function runSeeder (logger, config) {
  // TODO: use a separate config var for adding tracing
  if (config.instrument) {
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
  // Ideally we'd just add a trace counter before calling, to keep
  // it updated as this method changes in Hypercore
  // But for now we replace it completely because we need more detailed tracing
  // const original = Replicator.Peer.prototype._requestRangeBlock

  /* Replicator.Peer.prototype.getMaxInflight = function () {
    return 16
  } */

  /*
  Replicator.Peer.prototype._requestRangeBlock = function (index, length) {
    this.tracer.trace('_requestRangeBlock')
    if (this.core.bitfield.get(index) === true || !this._hasTreeParent(index)) return false

    this.tracer.trace('_requestRangeBlock_add-block-to-replicator')
    const b = this.replicator._blocks.add(index, 0)
    if (b.inflight.length > 0) return false

    this.tracer.trace('_requestRangeBlock_make-request')
    const req = this._makeRequest(index >= length, b.priority)

    // If the request cannot be satisfied, dealloc the block request if no one is subscribed to it
    if (req === null) {
      b.gc()
      this.tracer.trace('_requestRangeBlock_insta-gc')
      return false
    }

    req.block = { index, nodes: 0 }

    this.tracer.trace('_requestRangeBlock_adding-inflight')
    b.inflight.push(req)
    this._send(req)

    // Don't think this will ever happen, as the pending queue is drained before the range queue
    // but doesn't hurt to check this explicitly here also.
    if (b.queued) b.queued = false
    return true
  } */

  Replicator.Peer.prototype._requestRangeBlock = function (index, length) {
    this.tracer.trace('_requestRangeBlock')
    if (this.core.bitfield.get(index) === true || !this._hasTreeParent(index)) return false

    this.tracer.trace('_requestRangeBlock_add-block-to-replicator')
    const b = this.replicator._blocks.add(index, 0)
    if (b.inflight.length > 0) return false

    this.tracer.trace('_requestRangeBlock_make-request')
    const req = this._makeRequest(index >= length, b.priority)

    // If the request cannot be satisfied, dealloc the block request if no one is subscribed to it
    if (req === null) {
      b.gc()
      return false
    }

    this.tracer.trace('_requestRangeBlock_adding-inflight')
    this._sendBlockRequest(req, b)

    // Don't think this will ever happen, as the pending queue is drained before the range queue
    // but doesn't hurt to check this explicitly here also.
    if (b.queued) b.queued = false
    return true
  }
}
