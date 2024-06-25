const goodbye = require('graceful-goodbye')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const DHT = require('hyperdht')
const SimpleSeeder = require('simple-seeder/lib/simple-seeder')
const debounceify = require('debounceify')

const instrument = require('./lib/instrument')
const getSeederInfo = require('./lib/seeder-info')

module.exports = async function runSeeder (logger, config) {
  const { swarm, store } = await setupSwarmAndStore(config) // TODO: would be cleaner as a sync function
  const tracker = new SimpleSeeder(store, swarm, { backup: config.backup })

  goodbye(async () => {
    logger.info('Exiting simple seeder')
    await tracker.destroy()
    await swarm.destroy()
    logger.info('Destroyed swarm and tracker')
  }, 10)

  if (config.instrument) {
    const server = await instrument(tracker, logger, config)
    goodbye(async () => {
      logger.info('Closing instrumenting server')
      await server.close()
      logger.info('Closed instrumenting server')
    }, 1)

    logger.info('Instrumented the simple seeder')
  }

  await startSeeder(tracker, config.seedListKey)
  logger.info('Setup simple seeder')

  if (config.sLogInterval) {
    setInterval(
      () => { logger.info(getSeederInfo(tracker)) },
      config.sLogInterval * 1000
    )
    logger.info(getSeederInfo(tracker))
  }
}

async function setupSwarmAndStore ({ corestoreLoc, port, maxPeers }) {
  const store = new Corestore(corestoreLoc)

  const keyPair = await store.createKeyPair('simple-seeder-swarm')
  // Assume that if a DHT port was set, it's not firewalled
  const firewalled = port == null || port === 0
  const dht = new DHT({ port, firewalled })
  const swarm = new Hyperswarm({ keyPair, dht, maxPeers })

  swarm.on('connection', (socket) => {
    store.replicate(socket)
  })

  return { swarm, store }
}

async function startSeeder (tracker, seedListKey) {
  await tracker.add(seedListKey, { type: 'list', description: 'Simple Seeder main list' })

  // TODO: figure out why this logic is outside simple-seeder
  const lists = tracker.filter(r => r.type === 'list')
  if (lists[0]) {
    const info = lists[0]
    const bound = tracker.update.bind(tracker, info, info.instance)
    const debounced = debounceify(bound)
    info.instance.core.on('append', debounced)
    await debounced()
  }

  return tracker
}
