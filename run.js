#! /usr/bin/env node
require('dotenv').config()
const setupLogger = require('pino')

const runSeeder = require('./index')

function loadConfig () {
  const config = {
    port: parseInt(process.env.DHT_PORT || 0),
    corestoreLoc: process.env.storage || './corestore',
    seedListKey: process.env.SEED_LIST_KEY,
    logLevel: process.env.LOG_LEVEL || 'info',
    instrument: process.env.INSTRUMENT?.trim().toLowerCase() === 'true',
    repl: process.env.REPL?.trim().toLowerCase() === 'true',
    instrumentPort: process.env.INSTRUMENT_PORT,
    instrumentHost: process.env.INSTRUMENT_HOST || '127.0.0.1',
    sLogInterval: process.env.S_LOG_INTERVAL || 60
  }

  if (!config.seedListKey) throw new Error('SEED_LIST_KEY must be set')

  return config
}

const config = loadConfig()
const logger = setupLogger(
  { name: 'simple-seeder', level: config.logLevel }
)
logger.info(`Using config ${JSON.stringify(config, null, 1)}`)

runSeeder(logger, config)
