import { serve } from '@hono/node-server'
import { AssistEvent, createJwtVerifier, HandoffEvent, QUEUES, TicketWriteMessage } from '@nexo/shared'
import { cognitoClient, resolveCognitoConfig, SqsEventQueue, sqsClient } from '@nexo/shared/aws'
import { createApp } from './app'
import { handoffEventsHandler, ticketWritesHandler } from './consumers'
import { connectTicketsDb } from './db'
import { OutageSimulator } from './outage'
import { TicketService } from './ticket-service'

const env = {
  port: Number(process.env.TICKETS_PORT ?? 4000),
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/?directConnection=true',
  flaky: process.env.FLAKY_ENABLED !== 'false',
  flakyMeanIntervalMs: Number(process.env.FLAKY_MEAN_INTERVAL_S ?? 120) * 1000,
  flakyMinMs: Number(process.env.FLAKY_MIN_MS ?? 3000),
  flakyMaxMs: Number(process.env.FLAKY_MAX_MS ?? 8000),
  chaosEnabled: process.env.CHAOS_ENABLED === 'true',
}

async function main() {
  const { client: mongo, db } = await connectTicketsDb(env.mongoUri)
  const service = new TicketService(db)

  const cognito = await resolveCognitoConfig(cognitoClient())
  const verify = createJwtVerifier({
    issuer: cognito.issuer,
    clientId: cognito.clientId,
    jwksUrl: cognito.jwksUrl,
  })

  const outage = new OutageSimulator({
    enabled: env.flaky,
    meanIntervalMs: env.flakyMeanIntervalMs,
    minDurationMs: env.flakyMinMs,
    maxDurationMs: env.flakyMaxMs,
  })

  const app = createApp({ service, verify, outage, chaosEnabled: env.chaosEnabled })
  const server = serve({ fetch: app.fetch, port: env.port }, () =>
    console.log(`tickets: listening on :${env.port} (flaky=${env.flaky}, chaos=${env.chaosEnabled})`),
  )

  // SQS consumers. They pause during an outage, like the rest of the legacy system.
  const sqs = sqsClient()
  const assistEvents = new SqsEventQueue(sqs, QUEUES.assistEvents, AssistEvent)
  const stop = new AbortController()
  const paused = () => outage.isDown()
  void new SqsEventQueue(sqs, QUEUES.ticketWrites, TicketWriteMessage).consume(
    ticketWritesHandler(service, assistEvents),
    { signal: stop.signal, paused },
  )
  void new SqsEventQueue(sqs, QUEUES.handoffEvents, HandoffEvent).consume(handoffEventsHandler(service), {
    signal: stop.signal,
    paused,
  })

  const shutdown = () => {
    stop.abort()
    server.close()
    void mongo.close().then(() => process.exit(0))
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
