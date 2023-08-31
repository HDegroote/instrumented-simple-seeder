const HypercoreId = require('hypercore-id-encoding')
const byteSize = require('tiny-byte-size')

// Taken from https://github.com/holepunchto/simple-seeder/blob/9d976b6915abe4cb9313b07ffd40bdaa52aa5bc6/index.js
module.exports = function getSeederInfo (tracker) {
  let output = ''
  const print = (...args) => { output += args.join(' ') + '\n' }

  const swarm = tracker.swarm
  const { dht } = swarm
  const cores = tracker.filter(r => r.type === 'core')
  const bees = tracker.filter(r => r.type === 'bee')
  const drives = tracker.filter(r => r.type === 'drive')
  const seeders = tracker.filter(r => !!r.seeders)
  const lists = tracker.filter(r => r.type === 'list')
  const allowedPeers = lists[0] ? lists[0].userData.allowedPeers : undefined

  const totalConnections = swarm.connections.size + seeders.reduce((acc, r) => acc + r.seeders.connections.length, 0)
  const totalConnecting = swarm.connecting + seeders.reduce((acc, r) => acc + r.seeders.clientConnecting, 0)

  print('Node')
  print('- Address:', dht.bootstrapped ? dht.host + ':' + dht.port : '~')
  print('- Firewalled?', dht.bootstrapped ? (dht.firewalled ? 'Yes' : 'No') : '~')
  print('- NAT type:', dht.bootstrapped ? (dht.port ? 'Consistent' : 'Random') : '~')
  print()

  print('Swarm')
  print('- Public key:', HypercoreId.encode(swarm.keyPair.publicKey))
  print('- Connections:', totalConnections, totalConnecting ? ('(connecting ' + totalConnecting) + ')' : '')
  print()

  if (allowedPeers !== undefined) {
    const swarmPublicKey = lists[0].userData.swarmPublicKey
    if (swarmPublicKey) {
      print('Seedbee swarm:', HypercoreId.encode(swarmPublicKey))
    }
    print('Allowed Peers')
    if (allowedPeers === null) {
      print('All peers allowed.')
    } else if (allowedPeers.length === 0) {
      print('All peers denied.')
    } else {
      allowedPeers.forEach(e => {
        print('- Peer:', e)
      })
    }
    print()
  }

  if (lists.length) {
    print('Lists')
    for (const { instance: bee, blocks, network } of lists) {
      // TODO: disable byte size?
      output += formatResource(bee.core, null, { blocks, network })
    }
    print()
  }

  if (seeders.length) {
    print('Seeders')
    for (const { seeders: sw } of seeders) {
      const seedId = HypercoreId.encode(sw.seedKeyPair.publicKey)

      if (!sw.seeder) {
        print('-', seedId, '~')
        continue
      }

      print(
        '-',
        seedId,
        sw.seeds.length + ' seeds,',
        sw.core.length + ' length,',
        sw.core.fork + ' fork'
      )
    }
    print()
  }

  if (cores.length) {
    print('Cores')
    for (const { instance: core, blocks, network } of cores) {
      output += formatResource(core, null, { blocks, network })
    }
    print()
  }

  if (bees.length) {
    print('Bees')
    for (const { instance: bee, blocks, network } of bees) {
      output += formatResource(bee.core, null, { blocks, network })
    }
    print()
  }

  if (drives.length) {
    print('Drives')
    for (const { instance: drive, blocks, network } of drives) {
      output += formatResource(drive.core, drive.blobs, { blocks, network, isDrive: true })
    }
    print()
  }

  return output
}

function formatResource (core, blobs, { blocks, network, isDrive = false } = {}) {
  const progress = [core.contiguousLength + '/' + core.length]
  if (isDrive) progress.push((blobs?.core.contiguousLength || 0) + '/' + (blobs?.core.length || 0))

  const byteLength = [byteSize(core.byteLength)]
  if (isDrive) byteLength.push(byteSize(blobs?.core.byteLength || 0))

  const peers = [core.peers.length]
  if (isDrive) peers.push(blobs?.core.peers.length || 0)

  return format(
    '-',
    core.id,
    progress.join(' + ') + ' blks,',
    byteLength.join(' + ') + ',',
    peers.join(' + ') + ' peers,',
    '↓' + ' ' + Math.ceil(blocks.down()),
    '↑' + ' ' + Math.ceil(blocks.up()) + ' blks/s',
    '↓' + ' ' + byteSize(network.down()),
    '↑' + ' ' + byteSize(network.up())
  )
}

function format (...args) {
  return args.join(' ') + '\n'
}
