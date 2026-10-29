import { describe, expect, it } from 'vitest'
import {
  consume,
  counterId,
  DAY_MS,
  hit,
  InMemoryCounterStore,
  MINUTE_MS,
  peek,
  peekAll,
  release,
  type Limit,
} from './rate-limit'

const at = (iso: string) => new Date(iso)
const perMinute = (key: string, max: number): Limit => ({ key, max, windowMs: MINUTE_MS })

describe('counterId', () => {
  it('buckets by the start of the window', () => {
    expect(counterId('k', MINUTE_MS, at('2026-10-28T10:42:37Z'))).toBe('k@2026-10-28T10:42:00.000Z')
    expect(counterId('k', DAY_MS, at('2026-10-28T23:59:59Z'))).toBe('k@2026-10-28T00:00:00.000Z')
  })
})

describe('consume', () => {
  it('allows up to max per window, then blocks until the window ends', async () => {
    const store = new InMemoryCounterStore()
    const limit = perMinute('chat:u1', 2)
    const now = at('2026-10-28T10:42:15Z')
    expect(await consume(store, [limit], now)).toEqual({ ok: true })
    expect(await consume(store, [limit], now)).toEqual({ ok: true })
    expect(await consume(store, [limit], now)).toEqual({ ok: false, limit, retryAfterS: 45 })
    expect(await consume(store, [limit], at('2026-10-28T10:43:00Z'))).toEqual({ ok: true })
  })

  it('does not use the user quota when the global cap blocks', async () => {
    const store = new InMemoryCounterStore()
    const now = at('2026-10-28T10:42:00Z')
    const user = (id: string): Limit => ({ key: `turns:user:${id}`, max: 10, windowMs: DAY_MS })
    const global = perMinute('turns:global', 1)

    expect((await consume(store, [user('a'), global], now)).ok).toBe(true)
    const result = await consume(store, [user('b'), global], now)
    expect(result).toMatchObject({ ok: false, limit: global })
    expect(await store.get(counterId('turns:user:b', DAY_MS, now))).toBe(0)
    expect(await store.get(counterId('turns:global', MINUTE_MS, now))).toBe(1)
  })

  it('release gives the use back', async () => {
    const store = new InMemoryCounterStore()
    const limit = perMinute('k', 1)
    const now = at('2026-10-28T10:42:00Z')
    await consume(store, [limit], now)
    await release(store, [limit], now)
    expect(await consume(store, [limit], now)).toEqual({ ok: true })
  })
})

describe('peek and hit', () => {
  it('only counts what is hit', async () => {
    const store = new InMemoryCounterStore()
    const limit = perMinute('login:email:ana', 2)
    const now = at('2026-10-28T10:42:00Z')
    expect(await peek(store, limit, now)).toEqual({ ok: true })
    await hit(store, limit, now)
    expect(await peek(store, limit, now)).toEqual({ ok: true })
    await hit(store, limit, now)
    expect(await peek(store, limit, now)).toMatchObject({ ok: false, retryAfterS: 60 })
  })
})

describe('peekAll and counted hits', () => {
  it('returns the first limit already used up, counting `by` per hit', async () => {
    const store = new InMemoryCounterStore()
    const calls = perMinute('calls:global', 10)
    const tokens = perMinute('tokens:global', 8000)
    const now = at('2026-10-28T10:42:00Z')
    await hit(store, calls, now, 3)
    await hit(store, tokens, now, 7999)
    expect(await peekAll(store, [calls, tokens], now)).toEqual({ ok: true })
    await hit(store, tokens, now, 1)
    expect(await peekAll(store, [calls, tokens], now)).toMatchObject({ ok: false, limit: tokens })
  })
})
