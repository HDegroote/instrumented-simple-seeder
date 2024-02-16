const InstrumentedSwarm = require('instrumented-swarm')
const fastify = require('fastify')
const promClient = require('prom-client')
const getSeederInfo = require('./seeder-info')
const setupRepl = require('repl-swarm')

module.exports = async function instrument (tracker, logger, {
  repl, instrumentPort, instrumentHost, detailedMetrics, seedListKey
}) {
  const server = fastify({ logger })

  const replSeed = repl ? setupRepl({ tracker }) : null
  const instrumentedSwarm = new InstrumentedSwarm(tracker.swarm, { server })

  promClient.collectDefaultMetrics()
  instrumentedSwarm.registerPrometheusMetrics(promClient)
  server.get('/metrics', { logLevel: 'warn' }, async function (req, reply) {
    const metrics = await promClient.register.metrics()
    reply.send(metrics)
  })

  server.get('/info', function (req, reply) {
    const info = getSeederInfo(tracker)
    reply.send(info)
  })

  server.get('/repl', async function (req, reply) {
    if (replSeed) {
      console.log(`REPL seed exposing tracker: ${replSeed}`)
      reply.send('Repl seed logged')
    } else {
      reply.send('No repl exposed')
    }
  })

  server.get('/health', { logLevel: 'warn' }, async function (req, reply) {
    // TODO: more elaborate
    reply.send('healthy\n')
  })

  await server.listen({
    port: instrumentPort,
    host: instrumentHost,
    listenTextResolver: (address) => `Instrumentation server listening at ${address}`
  })

  return server
}
