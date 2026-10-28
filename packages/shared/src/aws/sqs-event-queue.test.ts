import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs'
import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { SqsEventQueue } from './sqs-event-queue'

/** Just enough of SQSClient: one long poll returns `bodies`, later polls return nothing. */
function fakeSqs(bodies: unknown[], onReceive: () => void = () => {}) {
  const calls: string[] = []
  let polled = false
  const client = {
    async send(command: unknown) {
      if (command instanceof GetQueueUrlCommand) return { QueueUrl: 'http://sqs/q' }
      if (command instanceof ReceiveMessageCommand) {
        if (polled) {
          await new Promise((r) => setTimeout(r, 5))
          return { Messages: [] }
        }
        polled = true
        onReceive()
        return {
          Messages: bodies.map((b, i) => ({
            MessageId: `m${i}`,
            ReceiptHandle: `r${i}`,
            Body: JSON.stringify(b),
          })),
        }
      }
      if (command instanceof DeleteMessageCommand) calls.push(`delete ${command.input.ReceiptHandle}`)
      if (command instanceof ChangeMessageVisibilityCommand) {
        calls.push(`release ${command.input.ReceiptHandle} ${command.input.VisibilityTimeout}`)
      }
      return {}
    },
  }
  return { client: client as unknown as SQSClient, calls }
}

const consumeBriefly = async (
  queue: SqsEventQueue<{ n: number }>,
  handler: (m: { n: number }) => Promise<void>,
  paused: () => boolean,
) => {
  const stop = new AbortController()
  const done = queue.consume(handler, { signal: stop.signal, paused })
  await new Promise((r) => setTimeout(r, 50))
  stop.abort()
  await done
}

describe('SqsEventQueue', () => {
  const schema = z.object({ n: z.number() })

  it('handles and deletes each received message', async () => {
    const { client, calls } = fakeSqs([{ n: 1 }, { n: 2 }])
    const handled: number[] = []
    await consumeBriefly(
      new SqsEventQueue(client, 'q', schema),
      async (m) => void handled.push(m.n),
      () => false,
    )
    expect(handled).toEqual([1, 2])
    expect(calls).toEqual(['delete r0', 'delete r1'])
  })

  it('releases, without handling or deleting, messages received after an outage started mid-poll', async () => {
    // Not paused when the long poll starts; the outage begins while it waits.
    let down = false
    const { client, calls } = fakeSqs([{ n: 1 }, { n: 2 }], () => (down = true))
    const handled: number[] = []
    await consumeBriefly(
      new SqsEventQueue(client, 'q', schema),
      async (m) => void handled.push(m.n),
      () => down,
    )
    expect(handled).toEqual([])
    expect(calls).toEqual(['release r0 0', 'release r1 0'])
  })
})
