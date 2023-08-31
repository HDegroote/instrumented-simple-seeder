const HypercoreId = require('hypercore-id-encoding')
const crayon = require('tiny-crayon')
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
  print('- Address:', dht.bootstrapped ? crayon.yellow(dht.host + ':' + dht.port) : crayon.gray('~'))
  print('- Firewalled?', dht.bootstrapped ? (dht.firewalled ? crayon.red('Yes') : crayon.green('No')) : crayon.gray('~'))
  print('- NAT type:', dht.bootstrapped ? (dht.port ? crayon.green('Consistent') : crayon.red('Random')) : crayon.gray('~'))
  print()

  print('Swarm')
  print('- Public key:', crayon.green(HypercoreId.encode(swarm.keyPair.publicKey)))
  print('- Connections:', crayon.yellow(totalConnections), totalConnecting ? ('(connecting ' + crayon.yellow(totalConnecting) + ')') : '')
  print()

  if (allowedPeers !== undefined) {
    const swarmPublicKey = lists[0].userData.swarmPublicKey
    if (swarmPublicKey) {
      print('Seedbee swarm:', crayon.green(HypercoreId.encode(swarmPublicKey)))
    }
    print('Allowed Peers')
    if (allowedPeers === null) {
      print(crayon.green('All peers allowed.'))
    } else if (allowedPeers.length === 0) {
      print(crayon.red('All peers denied.'))
    } else {
      allowedPeers.forEach(e => {
        print('- Peer:', crayon.green(e))
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
        print('-', crayon.green(seedId), crayon.gray('~'))
        continue
      }

      print(
        '-',
        crayon.green(seedId),
        crayon.yellow(sw.seeds.length) + ' seeds,',
        crayon.yellow(sw.core.length) + ' length,',
        crayon.yellow(sw.core.fork) + ' fork'
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
  const progress = [crayon.yellow(core.contiguousLength + '/' + core.length)]
  if (isDrive) progress.push(crayon.yellow((blobs?.core.contiguousLength || 0) + '/' + (blobs?.core.length || 0)))

  const byteLength = [crayon.yellow(byteSize(core.byteLength))]
  if (isDrive) byteLength.push(crayon.yellow(byteSize(blobs?.core.byteLength || 0)))

  const peers = [crayon.yellow(core.peers.length)]
  if (isDrive) peers.push(crayon.yellow(blobs?.core.peers.length || 0))

  return format(
    '-',
    crayon.green(core.id),
    progress.join(' + ') + ' blks,',
    byteLength.join(' + ') + ',',
    peers.join(' + ') + ' peers,',
    crayon.green('↓') + ' ' + crayon.yellow(Math.ceil(blocks.down())),
    crayon.cyan('↑') + ' ' + crayon.yellow(Math.ceil(blocks.up())) + ' blks/s',
    crayon.green('↓') + ' ' + crayon.yellow(byteSize(network.down())),
    crayon.cyan('↑') + ' ' + crayon.yellow(byteSize(network.up()))
  )
}

function format (...args) {
  return args.join(' ') + '\n'
}
