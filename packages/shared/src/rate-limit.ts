/**
 * Fixed-window counters for rate limits and the LLM caps. One counter per key and window
 * ("turns:user:u1" for the minute that started at 10:42:00). Fixed windows are the simplest
 * thing that works: at a window edge a client can get up to 2x the limit, which is fine here.
 *
 * The store only needs an atomic increment, so it can be MongoDB in the app and a Map in tests.
 */

export type Limit = {
  /** What is counted and for whom, e.g. `turns:user:<id>` or `login:ip:<ip>`. */
  key: string
  /** Maximum count per window. */
  max: number
  windowMs: number
}

export type LimitResult = { ok: true } | { ok: false; limit: Limit; retryAfterS: number }

export interface CounterStore {
  /** Atomically adds `by` (may be negative) and returns the new count. Expired counters may be dropped. */
  add(id: string, by: number, expiresAt: Date): Promise<number>
  get(id: string): Promise<number>
}

export const MINUTE_MS = 60_000
export const DAY_MS = 24 * 60 * MINUTE_MS

const windowStart = (now: Date, windowMs: number) => Math.floor(now.getTime() / windowMs) * windowMs

/** Counter document id: the key plus the window's start. Daily windows start at 00:00 UTC. */
export const counterId = (key: string, windowMs: number, now: Date) =>
  `${key}@${new Date(windowStart(now, windowMs)).toISOString()}`

const windowEnd = (now: Date, windowMs: number) => new Date(windowStart(now, windowMs) + windowMs)

const blocked = (limit: Limit, now: Date): LimitResult => ({
  ok: false,
  limit,
  retryAfterS: Math.max(1, Math.ceil((windowEnd(now, limit.windowMs).getTime() - now.getTime()) / 1000)),
})

/**
 * Counts one use against every limit, all or nothing: if any limit is over, the increments made
 * by this call are undone and the first limit hit is returned. So a request blocked by the global
 * cap does not use up the user's own quota.
 */
export async function consume(store: CounterStore, limits: Limit[], now = new Date()): Promise<LimitResult> {
  const taken: Limit[] = []
  for (const limit of limits) {
    const expiresAt = windowEnd(now, limit.windowMs)
    const count = await store.add(counterId(limit.key, limit.windowMs, now), 1, expiresAt)
    taken.push(limit)
    if (count > limit.max) {
      await release(store, taken, now)
      return blocked(limit, now)
    }
  }
  return { ok: true }
}

/** Gives back one use per limit (a consume that turned out not to need it). */
export async function release(store: CounterStore, limits: Limit[], now = new Date()): Promise<void> {
  for (const limit of limits) {
    await store.add(counterId(limit.key, limit.windowMs, now), -1, windowEnd(now, limit.windowMs))
  }
}

/** Checks a limit without counting (e.g. failed logins: check first, count only on failure). */
export async function peek(store: CounterStore, limit: Limit, now = new Date()): Promise<LimitResult> {
  const count = await store.get(counterId(limit.key, limit.windowMs, now))
  return count >= limit.max ? blocked(limit, now) : { ok: true }
}

/** Counts one use without checking (the check is a later `peek`). */
export async function hit(store: CounterStore, limit: Limit, now = new Date()): Promise<void> {
  await store.add(counterId(limit.key, limit.windowMs, now), 1, windowEnd(now, limit.windowMs))
}

/** For unit tests and local tools. Not shared across processes. */
export class InMemoryCounterStore implements CounterStore {
  private readonly counts = new Map<string, number>()

  add(id: string, by: number): Promise<number> {
    const next = (this.counts.get(id) ?? 0) + by
    this.counts.set(id, next)
    return Promise.resolve(next)
  }

  get(id: string): Promise<number> {
    return Promise.resolve(this.counts.get(id) ?? 0)
  }
}
