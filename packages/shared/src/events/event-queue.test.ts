import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { InMemoryEventQueue } from './event-queue'

describe('InMemoryEventQueue', () => {
  it('validates messages on send', async () => {
    const q = new InMemoryEventQueue(z.object({ n: z.number() }))
    await expect(q.send({ n: 'x' } as never)).rejects.toThrow()
  })

  it('redelivers failed messages and dead-letters them after maxReceiveCount', async () => {
    const q = new InMemoryEventQueue(z.object({ n: z.number() }), 3)
    await q.send({ n: 1 })
    const failing = async () => {
      throw new Error('down')
    }
    for (let i = 0; i < 3; i++) await q.drain(failing)
    expect(q.size).toBe(0)
    expect(q.deadLetters).toEqual([{ n: 1 }])
  })
})
