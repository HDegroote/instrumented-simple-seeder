#! /usr/bin/env node
require('dotenv').config()
const setupLogger = require('pino')

const runSeeder = require('./index')

function loadConfig () {
  const config = {
    port: parseInt(process.env.DHT_PORT || 0),
    corestoreLoc: process.env.STORAGE || './corestore',
    seedListKey: process.env.SEED_LIST_KEY,
    logLevel: process.env.LOG_LEVEL || 'info',
    instrument: process.env.INSTRUMENT?.trim().toLowerCase() === 'true',
    repl: process.env.REPL?.trim().toLowerCase() === 'true',
    instrumentPort: parseInt(process.env.INSTRUMENT_PORT || 0),
    instrumentHost: process.env.INSTRUMENT_HOST || '127.0.0.1',
    detailedMetrics: process.env.DETAILED_METRICS?.trim().toLowerCase() === 'true',
    sLogInterval: parseInt(process.env.S_LOG_INTERVAL || 0), // No logging by default
    maxPeers: parseInt(process.env.MAX_PEERS) || undefined // Note: breaks hyperswarm if set to null (expects either undefined or an int)
  }

  if (!config.seedListKey) throw new Error('SEED_LIST_KEY must be set')

  return config
}

const config = loadConfig()
const logger = setupLogger(
  { name: 'simple-seeder', level: config.logLevel }
)

logger.info('Starting the seeder')
runSeeder(logger, config)
