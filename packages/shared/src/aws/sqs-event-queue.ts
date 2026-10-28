import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs'
import type { z } from 'zod'
import type { ConsumeOptions, EventQueue } from '../events/event-queue'

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true })
  })

/**
 * EventQueue on SQS (or Floci). Messages are JSON validated with zod on both ends.
 * Long polling keeps the consumer cheap; failed messages are retried by SQS (visibility timeout)
 * and moved to the queue's DLQ by its redrive policy.
 */
export class SqsEventQueue<T> implements EventQueue<T> {
  private queueUrl?: Promise<string>

  constructor(
    private readonly client: SQSClient,
    private readonly queueName: string,
    private readonly schema: z.ZodType<T>,
    private readonly log: (msg: string, err?: unknown) => void = (msg, err) => console.error(msg, err ?? ''),
  ) {}

  private url(): Promise<string> {
    this.queueUrl ??= this.client
      .send(new GetQueueUrlCommand({ QueueName: this.queueName }))
      .then((r) => {
        if (!r.QueueUrl) throw new Error(`Queue ${this.queueName} not found`)
        return r.QueueUrl
      })
      .catch((err: unknown) => {
        this.queueUrl = undefined
        throw err
      })
    return this.queueUrl
  }

  async send(message: T): Promise<void> {
    const body = JSON.stringify(this.schema.parse(message))
    await this.client.send(new SendMessageCommand({ QueueUrl: await this.url(), MessageBody: body }))
  }

  async consume(handler: (message: T) => Promise<void>, { signal, paused }: ConsumeOptions): Promise<void> {
    while (!signal.aborted) {
      if (paused?.()) {
        await sleep(1000, signal)
        continue
      }
      try {
        const res = await this.client.send(
          new ReceiveMessageCommand({
            QueueUrl: await this.url(),
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 20,
          }),
          { abortSignal: signal },
        )
        for (const msg of res.Messages ?? []) {
          // An outage can start during the 20 s long poll: hand the message back instead of handling it.
          if (paused?.()) {
            await this.release(msg.ReceiptHandle)
            continue
          }
          try {
            const parsed = this.schema.parse(JSON.parse(msg.Body ?? 'null'))
            await handler(parsed)
            await this.client.send(
              new DeleteMessageCommand({ QueueUrl: await this.url(), ReceiptHandle: msg.ReceiptHandle }),
            )
          } catch (err) {
            // Leave it on the queue: it becomes visible again and, after maxReceiveCount, goes to the DLQ.
            this.log(`[${this.queueName}] message ${msg.MessageId} failed`, err)
          }
        }
      } catch (err) {
        if (signal.aborted) return
        this.log(`[${this.queueName}] receive failed, retrying in 2s`, err)
        await sleep(2000, signal)
      }
    }
  }

  /** Makes a received message visible again right away; the paused loop takes it after the outage. */
  private async release(receiptHandle: string | undefined): Promise<void> {
    try {
      await this.client.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: await this.url(),
          ReceiptHandle: receiptHandle,
          VisibilityTimeout: 0,
        }),
      )
    } catch (err) {
      // Not fatal: the message comes back anyway when its visibility timeout expires.
      this.log(`[${this.queueName}] could not release a message`, err)
    }
  }
}
