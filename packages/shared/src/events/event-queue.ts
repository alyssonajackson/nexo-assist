import type { z } from 'zod'

export type ConsumeOptions = {
  signal: AbortSignal
  /** When it returns true the consumer pauses instead of receiving (e.g. during an outage). */
  paused?: () => boolean
}

/**
 * Message queue port. SqsEventQueue (@nexo/shared/aws) runs on SQS or ElasticMQ;
 * InMemoryEventQueue is for unit tests.
 *
 * Delivery is at-least-once: handlers must be idempotent. A handler that throws leaves the
 * message on the queue; after maxReceiveCount attempts SQS moves it to the dead-letter queue.
 */
export interface EventQueue<T> {
  send(message: T): Promise<void>
  consume(handler: (message: T) => Promise<void>, options: ConsumeOptions): Promise<void>
}

/** In-memory queue with the same retry/DLQ semantics, for tests. */
export class InMemoryEventQueue<T> implements EventQueue<T> {
  readonly deadLetters: T[] = []
  private readonly pending: { message: T; receives: number }[] = []

  constructor(
    private readonly schema: z.ZodType<T>,
    private readonly maxReceiveCount = 5,
  ) {}

  async send(message: T): Promise<void> {
    this.pending.push({ message: this.schema.parse(message), receives: 0 })
  }

  get size(): number {
    return this.pending.length
  }

  /** Processes everything currently queued once. Returns how many messages were handled successfully. */
  async drain(handler: (message: T) => Promise<void>): Promise<number> {
    let ok = 0
    for (const item of this.pending.splice(0)) {
      item.receives++
      try {
        await handler(item.message)
        ok++
      } catch {
        if (item.receives >= this.maxReceiveCount) this.deadLetters.push(item.message)
        else this.pending.push(item)
      }
    }
    return ok
  }

  async consume(handler: (message: T) => Promise<void>, { signal, paused }: ConsumeOptions): Promise<void> {
    while (!signal.aborted) {
      if (!paused?.()) await this.drain(handler)
      await new Promise((r) => setTimeout(r, 10))
    }
  }
}
