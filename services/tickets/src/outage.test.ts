import { describe, expect, it } from 'vitest'
import { OutageSimulator } from './outage'

const clock = () => {
  let t = 0
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

describe('OutageSimulator', () => {
  it('stays up until the next scheduled outage, then is down for its duration', () => {
    const c = clock()
    // random() = 0.5 -> interval = mean (10s), duration = midpoint (5s)
    const sim = new OutageSimulator({
      enabled: true,
      meanIntervalMs: 10_000,
      minDurationMs: 3000,
      maxDurationMs: 7000,
      now: c.now,
      random: () => 0.5,
    })
    c.advance(9_999)
    expect(sim.isDown()).toBe(false)
    c.advance(1)
    expect(sim.isDown()).toBe(true)
    c.advance(4_999)
    expect(sim.isDown()).toBe(true)
    c.advance(1)
    expect(sim.isDown()).toBe(false)
  })

  it('never goes down on its own when disabled', () => {
    const c = clock()
    const sim = new OutageSimulator({
      enabled: false,
      meanIntervalMs: 1,
      minDurationMs: 1,
      maxDurationMs: 1,
      now: c.now,
    })
    c.advance(60_000)
    expect(sim.isDown()).toBe(false)
  })

  it('can be forced down on demand', () => {
    const c = clock()
    const sim = new OutageSimulator({
      enabled: false,
      meanIntervalMs: 1,
      minDurationMs: 1,
      maxDurationMs: 1,
      now: c.now,
    })
    sim.force(30_000)
    expect(sim.isDown()).toBe(true)
    expect(sim.remainingMs()).toBe(30_000)
    c.advance(30_000)
    expect(sim.isDown()).toBe(false)
  })
})
