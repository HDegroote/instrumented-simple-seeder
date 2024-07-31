#! /usr/bin/env node
require('dotenv').config()
const setupLogger = require('pino')
const idEnc = require('hypercore-id-encoding')

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

  logger.warn('polyfilling allocUnsafe')
  Buffer.allocUnsafe = Buffer.alloc

  logger.info('Starting the seeder')
  runSeeder(logger, config)
}

main()
