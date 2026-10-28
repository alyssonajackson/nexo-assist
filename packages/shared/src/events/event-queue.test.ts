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

describe('InMemoryEventQueue pause', () => {
  it('leaves messages reached during a pause on the queue, without counting a receive', async () => {
    const q = new InMemoryEventQueue(z.object({ n: z.number() }), 1)
    await q.send({ n: 1 })
    await q.send({ n: 2 })
    const handled: number[] = []
    // The outage starts after the first message: the second one waits for it to end.
    let down = false
    const handler = async (m: { n: number }) => {
      handled.push(m.n)
      down = true
    }
    expect(await q.drain(handler, () => down)).toBe(1)
    expect(handled).toEqual([1])
    expect(q.size).toBe(1)

    down = false
    expect(
      await q.drain(
        async (m) => void handled.push(m.n),
        () => down,
      ),
    ).toBe(1)
    expect(handled).toEqual([1, 2])
    expect(q.deadLetters).toEqual([])
  })
})
