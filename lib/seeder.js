const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const DHT = require('hyperdht')
const debounceify = require('debounceify')
const SimpleSeeder = require('simple-seeder/lib/simple-seeder')

module.exports = async function setupSeeder ({ port, corestoreLoc, seedListKey, maxPeers }) {
  const store = new Corestore(corestoreLoc)

  const keyPair = await store.createKeyPair('simple-seeder-swarm')
  const firewalled = port == null || port === 0 // Assume that if a DHT port was set, it's not firewalled
  const dht = new DHT({ port, firewalled })
  const swarm = new Hyperswarm({ keyPair, dht, maxPeers })
  swarm.on('connection', (socket) => {
    store.replicate(socket)
    // socket.on('error', (e) => console.error('Socket error:', e))
  })

  const tracker = new SimpleSeeder(store, swarm)

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
