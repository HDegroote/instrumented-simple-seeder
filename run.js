#! /usr/bin/env node
require('dotenv').config()
const setupLogger = require('pino')
const idEnc = require('hypercore-id-encoding')
const byteSize = require('tiny-byte-size')

const runSeeder = require('./index')

function loadConfig () {
  const heapdumpInterval = process.env.SEEDER_HEAPDUMP_INTERVAL_MINUTES
    ? parseInt(process.env.SEEDER_HEAPDUMP_INTERVAL_MINUTES) * 60 * 1000
    : null

  const config = {
    port: parseInt(process.env.DHT_PORT || 0),
    corestoreLoc: process.env.STORAGE || './corestore',
    seedListKey: process.env.SEED_LIST_KEY,
    maxCacheSize: parseInt(process.env.SEEDER_MAX_CACHE_SIZE || 1000),
    logLevel: process.env.LOG_LEVEL || 'info',
    instrument: process.env.INSTRUMENT?.trim().toLowerCase() === 'true',
    trace: process.env.SEEDER_TRACE?.trim().toLowerCase() === 'true',
    repl: process.env.REPL?.trim().toLowerCase() === 'true',
    supportHeapdumps: (process.env.SEEDER_SUPPORT_HEAPDUMPS || '').toLowerCase().trim() === 'true',
    heapdumpInterval,
    instrumentPort: parseInt(process.env.INSTRUMENT_PORT || 0),
    instrumentHost: process.env.INSTRUMENT_HOST || '127.0.0.1',
    detailedMetrics: process.env.DETAILED_METRICS?.trim().toLowerCase() === 'true',
    sLogInterval: parseInt(process.env.S_LOG_INTERVAL || 0), // No logging by default
    maxPeers: parseInt(process.env.MAX_PEERS) || undefined, // Note: breaks hyperswarm if set to null (expects either undefined or an int)
    getDescriptionWaitMs: parseInt(process.env.GET_DESCRIPTION_WAIT_MS || 30000),
    backup: process.env.SEEDER_BACKUP_MODE?.trim().toLowerCase() === 'true'
  }

  if (!config.seedListKey) throw new Error('SEED_LIST_KEY must be set')

  if (process.env.SEEDER_PROMETHEUS_ALIAS) {
    config.prometheusAlias = process.env.SEEDER_PROMETHEUS_ALIAS
    try {
      config.prometheusSharedSecret = idEnc.decode(process.env.SEEDER_PROMETHEUS_SHARED_SECRET)
      config.prometheusScraperPublicKey = idEnc.decode(process.env.SEEDER_PROMETHEUS_SCRAPER_PUBLIC_KEY)
      config.prometheusServiceName = 'seeder'
    } catch (error) {
      console.log(error)
      console.log('If SEEDER_PROMETHEUS_ALIAS is set, then SEEDER_PROMETHEUS_SHARED_SECRET and SEEDER_PROMETHEUS_SCRAPER_PUBLIC_KEY must be set to valid keys')
      process.exit(1)
    }
  }

  return config
}

async function main () {
  const config = loadConfig()
  const logger = setupLogger(
    { name: 'simple-seeder', level: config.logLevel }
  )
  monkeyPatchBuffer(logger)

  logger.info('Starting the seeder')
  runSeeder(logger, config)
}

function monkeyPatchBuffer (logger) {
  let bufCounter = 0
  const bufMap = new Map()
  const slabToKeys = new Map()
  const keyToSlab = new Map()

  const registry = new FinalizationRegistry((key) => {
    // console.log('deleting from registry', key)
    const slab = keyToSlab.get(key)
    // if (slab.byteLength > 10000) console.log(bigSlabsDel++, 'delete slab size', slab.byteLength)
    keyToSlab.delete(key)
    // console.log('slab', slab, slabToKeys)
    const slabKeys = slabToKeys.get(slab)
    // console.log(slabKeys.size)
    slabKeys.delete(key)
    // console.log('post del', slabKeys.size)
    if (slabKeys.size === 0) {
      slabToKeys.delete(slab)
    }
    clearTimeout(bufMap.get(key))
    bufMap.delete(key)
    // console.log('cleaning up', entry, `key ${key})`)
  })

  const originalAllocUnsafe = Buffer.allocUnsafe

  const bigBufferCutoff = 4000
  const msBeforeItIsALeak = 1000 * 60
  const msStatsInterval = 1000 * 90

  const leakCounters = new Map()
  setInterval(() => {
    const leaks = []
    const bigBufferLeaks = []
    for (const [location, { keys, bufferLengths, arrayBufferLengths }] of leakCounters.entries()) {
      let amount = 0
      let normalisedTotalLeakedBytes = 0
      let total = 0

      let bigBuffersAmount = 0
      let bigBuffersTotalSize = 0

      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]

        const slab = keyToSlab.get(key)
        if (!slab) continue // Already cleaned up (TODO: cleanly)
        // if (arrayBufferLengths[i] > 10000) console.log('found big slab', arrayBufferLengths[i], keyToSlab.get(key))
        const totalSlab = arrayBufferLengths[i]
        const ownSize = bufferLengths[i]
        const slabLeak = totalSlab - ownSize

        if (ownSize >= bigBufferCutoff) {
          bigBuffersAmount++
          bigBuffersTotalSize += ownSize
        }
        if (slabLeak > 0) {
          amount++
          const totalRetainers = slabToKeys.get(slab).size
          total += slabLeak
          normalisedTotalLeakedBytes += slabLeak / totalRetainers // TODO: entry-specific (not necessarily all equal)
        }
      }
      // Normalise by nr other buffers still retaining the slab
      if (amount > 0) {
        leaks.push({
          location, normalisedTotalLeakedBytes, amount, total
        })
      }

      if (bigBuffersAmount > 0) {
        bigBufferLeaks.push({ amount: bigBuffersAmount, totalSize: bigBuffersTotalSize, location })
      }
    }

    let totalSlabLeaks = 0
    console.log('Slab retainer leaks')
    leaks.sort((e1, e2) => e1.normalisedTotalLeakedBytes < e2.normalisedTotalLeakedBytes ? 1 : e1.normalisedTotalLeakedBytes > e2.normalisedTotalLeakedBytes ? -1 : 0)
    for (const { amount, total, normalisedTotalLeakedBytes, location } of leaks) {
      totalSlabLeaks += normalisedTotalLeakedBytes
      console.log(`${amount} leaks of avg (${byteSize(total / amount)}) (total: ${byteSize(normalisedTotalLeakedBytes)} normalised against retainers--summed total with full slabs: ${byteSize(total)}) at ${location}`)
    }

    let totalBigBufferLeaks = 0
    console.log('Big buffer leaks')
    bigBufferLeaks.sort((e1, e2) => e1.totalSize < e2.totalSize ? 1 : e1.totalSize > e2.totalSize ? -1 : 0)
    for (const { amount, totalSize, location } of bigBufferLeaks) {
      totalBigBufferLeaks += totalSize
      console.log(`${amount} leaks of big buffers of avg size ${byteSize(totalSize / amount)} (total: ${byteSize(totalSize)}) at ${location}`)
    }

    console.log(`Total slab leaked bytes (normalised against retainers): ${byteSize(totalSlabLeaks)}`)
    console.log(`Total big buffer leaked bytes: ${byteSize(totalBigBufferLeaks)}`)
  }, msStatsInterval)

  Buffer.allocUnsafe = function allocUnsafeMonkeyPatch (...args) {
    // console.log('unsafe alloc buffer')
    const res = originalAllocUnsafe(...args)

    if (res.byteLength >= bigBufferCutoff || res.buffer.byteLength >= 10 * res.byteLength) {
      const trace = (new Error()).stack
      const key = bufCounter++
      const slab = res.buffer

      keyToSlab.set(key, slab)
      let slabKeys = slabToKeys.get(slab)
      if (!slabKeys) {
        slabKeys = new Set()
        slabToKeys.set(slab, slabKeys)
      }
      slabKeys.add(key)

      const bufferLength = res.byteLength
      const arrayBufferLength = res.buffer.byteLength
      // const leakedBytesPerEntry = res.buffer.byteLength - res.byteLength
      const timeout = setTimeout(() => {
        const location = trace.split('\n').slice(2).join('\n')
        let current = leakCounters.get(location)
        if (current === undefined) {
          current = {
            keys: [],
            bufferLengths: [],
            arrayBufferLengths: []
          }
          leakCounters.set(location, current)
        }
        current.keys.push(key)
        current.bufferLengths.push(bufferLength)
        current.arrayBufferLengths.push(arrayBufferLength)
        bufMap.delete(key)
        // logger.warn(`location ${location}`)
        // logger.warn(`Possible memleak for buffer length ${res.buffer.byteLength} of ${res.byteLength}: ${trace} `)
      }, msBeforeItIsALeak)
      bufMap.set(key, timeout)
      registry.register(res, key)
    }
    return res
  }
}

main()
