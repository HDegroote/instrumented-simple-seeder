const InstrumentedSwarm = require('instrumented-swarm')
const fastify = require('fastify')
const promClient = require('prom-client')
const getSeederInfo = require('./seeder-info')
const Hypermetrics = require('hypermetrics')

module.exports = async function instrument (tracker, logger, { repl, instrumentPort, instrumentHost }) {
  const server = fastify({ logger })

  const instrumentedSwarm = new InstrumentedSwarm(tracker.swarm, { server, launchRepl: repl })
  const hypermetrics = new Hypermetrics(promClient)

  tracker.store.on('core-open', core => {
    hypermetrics.add(core)
  })

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

  await server.listen({
    port: instrumentPort,
    host: instrumentHost,
    listenTextResolver: (address) => `Instrumentation server listening at ${address}`
  })

  return server
}
