export type OutageConfig = {
  enabled: boolean
  /** Average time between outages. */
  meanIntervalMs: number
  minDurationMs: number
  maxDurationMs: number
  now?: () => number
  random?: () => number
}

/**
 * Simulates the legacy ticket system being "unavailable for a few seconds now and then" (PRD).
 * Outages are scheduled lazily: every request checks the clock, so there are no timers to clean up.
 * `force()` starts an outage on demand (dev-only chaos endpoint) to demo the queue fallback.
 */
export class OutageSimulator {
  private downUntil = 0
  private nextOutageAt: number
  private readonly now: () => number
  private readonly random: () => number

  constructor(private readonly config: OutageConfig) {
    this.now = config.now ?? Date.now
    this.random = config.random ?? Math.random
    this.nextOutageAt = this.now() + this.interval()
  }

  isDown(): boolean {
    const t = this.now()
    if (t < this.downUntil) return true
    if (this.config.enabled && t >= this.nextOutageAt) {
      this.downUntil = t + this.duration()
      this.nextOutageAt = this.downUntil + this.interval()
      console.warn(`tickets: simulated outage for ${this.downUntil - t} ms`)
      return true
    }
    return false
  }

  force(durationMs: number): void {
    this.downUntil = this.now() + durationMs
  }

  /** Milliseconds until the current outage ends (0 when up). */
  remainingMs(): number {
    return Math.max(0, this.downUntil - this.now())
  }

  private interval(): number {
    // Uniform in [0.5, 1.5] x mean: irregular but predictable on average.
    return Math.round(this.config.meanIntervalMs * (0.5 + this.random()))
  }

  private duration(): number {
    const { minDurationMs: min, maxDurationMs: max } = this.config
    return Math.round(min + this.random() * (max - min))
  }
}
