import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, describe, expect, it } from 'vitest'
import {
  CreateQueueCommand,
  DeleteMessageCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  ListQueuesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs'
import { QUEUES, queueUrl, sqs } from './helpers/sqs'
import { env } from './env'

const MAX_RECEIVE_COUNT = 5

const queueArn = async (url: string) => {
  const res = await sqs.send(new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['QueueArn'] }))
  const arn = res.Attributes?.QueueArn
  if (!arn) throw new Error(`no QueueArn for ${url}`)
  return arn
}

/** One receive that leaves the message in the queue (visible again right away). */
const receiveOnce = async (url: string) => {
  const res = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: url,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 1,
      VisibilityTimeout: 0,
    }),
  )
  return res.Messages?.[0]
}

describe('ElasticMQ queues', () => {
  it('has the three queues and their dead-letter queues', async () => {
    const res = await sqs.send(new ListQueuesCommand({}))
    const names = (res.QueueUrls ?? []).map((url) => url.split('/').at(-1))
    for (const q of QUEUES) expect(names).toEqual(expect.arrayContaining([q, `${q}-dlq`]))
  })

  it.each(QUEUES)('%s redrives to %s-dlq after 5 receives', async (q) => {
    const res = await sqs.send(
      new GetQueueAttributesCommand({ QueueUrl: await queueUrl(q), AttributeNames: ['RedrivePolicy'] }),
    )
    expect(JSON.parse(res.Attributes?.RedrivePolicy ?? '{}')).toEqual({
      deadLetterTargetArn: await queueArn(await queueUrl(`${q}-dlq`)),
      maxReceiveCount: MAX_RECEIVE_COUNT,
    })
  })
})

describe('dead-letter queue', () => {
  // A throwaway pair with the same redrive policy, so a consumer on the real queues cannot
  // take the test message (the tickets service consumes ticket-writes and handoff-events).
  const name = `it-dlq-${randomUUID().slice(0, 8)}`
  const created: string[] = []
  afterAll(async () => {
    for (const url of created) await sqs.send(new DeleteQueueCommand({ QueueUrl: url }))
  })

  it('moves a message received 5 times without delete to the DLQ', async () => {
    const dlqUrl = (await sqs.send(new CreateQueueCommand({ QueueName: `${name}-dlq` }))).QueueUrl ?? ''
    created.push(dlqUrl)
    const url =
      (
        await sqs.send(
          new CreateQueueCommand({
            QueueName: name,
            Attributes: {
              RedrivePolicy: JSON.stringify({
                deadLetterTargetArn: await queueArn(dlqUrl),
                maxReceiveCount: MAX_RECEIVE_COUNT,
              }),
            },
          }),
        )
      ).QueueUrl ?? ''
    created.push(url)

    const body = JSON.stringify({ test: randomUUID() })
    await sqs.send(new SendMessageCommand({ QueueUrl: url, MessageBody: body }))

    for (let i = 0; i < MAX_RECEIVE_COUNT; i++) expect((await receiveOnce(url))?.Body).toBe(body)

    // The 6th receive exceeds maxReceiveCount: the message is moved instead of delivered.
    expect(await receiveOnce(url)).toBeUndefined()
    const dead = await receiveOnce(dlqUrl)
    expect(dead?.Body).toBe(body)
    if (dead?.ReceiptHandle) {
      await sqs.send(new DeleteMessageCommand({ QueueUrl: dlqUrl, ReceiptHandle: dead.ReceiptHandle }))
    }
  })
})

// Restarts the shared ElasticMQ container, so it is opt-in (CI turns it on).
describe.runIf(env.INTEGRATION_RESTARTS === '1')('message persistence', () => {
  it('keeps a pending message across an ElasticMQ restart', async () => {
    // A DLQ from the config: queues defined there exist after a restart, and nothing consumes it.
    const url = await queueUrl('ticket-writes-dlq')
    const body = JSON.stringify({ test: randomUUID() })
    await sqs.send(new SendMessageCommand({ QueueUrl: url, MessageBody: body }))

    await promisify(execFile)('docker', ['compose', 'restart', 'elasticmq'], {
      cwd: resolve(import.meta.dirname, '../..'),
    })
    // The server answers a moment before it has recreated the configured queues.
    await waitFor(() => queueUrl('ticket-writes-dlq'))

    const res = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: url,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 2,
        VisibilityTimeout: 0,
      }),
    )
    const ours = res.Messages?.find((m) => m.Body === body)
    expect(ours).toBeDefined()
    if (ours?.ReceiptHandle) {
      await sqs.send(new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: ours.ReceiptHandle }))
    }
  })
})

async function waitFor(probe: () => Promise<unknown>, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      return await probe()
    } catch (err) {
      if (Date.now() > deadline) throw err
      await new Promise((r) => setTimeout(r, 500))
    }
  }
}
