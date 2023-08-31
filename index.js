const goodbye = require('graceful-goodbye')

const instrument = require('./lib/instrument')
const getSeederInfo = require('./lib/seeder-info')
const setupSeeder = require('./lib/seeder')

module.exports = async function runSeeder (logger, config) {
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

  setInterval(
    () => { logger.info(getSeederInfo(tracker)) },
    config.sLogInterval * 1000
  )
  logger.info(getSeederInfo(tracker))
}
