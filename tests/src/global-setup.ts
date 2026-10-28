import { ListQueuesCommand } from '@aws-sdk/client-sqs'
import { cognitoConfig } from './helpers/cognito'
import { connectMongo } from './helpers/mongo'
import { sqs } from './helpers/sqs'
import { env } from './env'

const check = async (name: string, probe: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await probe()
    return undefined
  } catch (err) {
    const code = err instanceof Error && 'code' in err ? String(err.code) : undefined
    const reason = err instanceof Error ? err.message || code || err.name : String(err)
    return `  - ${name}: ${reason}`
  }
}

/** Fails fast, with one clear message, when the docker compose stack is not up. */
export default async function setup() {
  const failures = (
    await Promise.all([
      check(`mongo (${env.MONGODB_URI})`, async () => (await connectMongo()).close()),
      check(`cognito-local (${env.COGNITO_ENDPOINT})`, cognitoConfig),
      check(`ElasticMQ (${env.SQS_ENDPOINT})`, () => sqs.send(new ListQueuesCommand({}))),
    ])
  ).filter((f): f is string => f !== undefined)

  if (failures.length) {
    const message = [
      'Integration tests need the docker compose stack, but these services are not reachable:',
      ...failures,
      'Start it with `docker compose up --build -d` from the repo root and try again.',
    ].join('\n')
    // A stack trace adds nothing here (and vitest's source mapping chokes on it in globalSetup).
    const error = new Error(message)
    error.stack = message
    throw error
  }
}
