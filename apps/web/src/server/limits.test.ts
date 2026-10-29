import { describe, expect, it, vi } from 'vitest'
import { InMemoryCounterStore } from '@nexo/shared'

vi.mock('server-only', () => ({}))
vi.mock('./db', () => ({ assistDb: vi.fn() }))

const { clientIp, createLimits, FAILED_ATTEMPT_USE, llmUseOf } = await import('./limits')

const config = {
  tokensPerUserPerDay: 10_000,
  callsPerMinute: 6,
  tokensPerMinute: 8_000,
  callsPerDay: 20,
  tokensPerDay: 25_000,
  chatPerUserPerMinute: 2,
  loginPerIpPer15Min: 3,
  loginFailuresPerEmailPer15Min: 2,
}
const setup = () =>
  createLimits({ llm: new InMemoryCounterStore(), requests: new InMemoryCounterStore() }, config)
const at = (iso: string) => new Date(iso)
const minute = (m: number) => at(`2026-10-28T10:${String(m).padStart(2, '0')}:00Z`)

describe('LLM caps (model calls and tokens)', () => {
  const turn = { modelCalls: 3, tokens: 4_000 }

  it('refuses for the rest of the minute once the per-minute tokens are used, and can be retried', async () => {
    const limits = setup()
    expect(await limits.checkLlm('a', minute(0))).toBeNull()
    await limits.recordLlm('a', turn, minute(0))
    // Under the cap: a second turn starts and may overshoot by one turn (it is recorded afterwards).
    expect(await limits.checkLlm('b', minute(0))).toBeNull()
    await limits.recordLlm('b', turn, minute(0))
    expect(await limits.checkLlm('c', minute(0))).toMatchObject({ code: 'llm_busy', retry: true })
    expect(await limits.checkLlm('c', minute(1))).toBeNull()
  })

  it('counts model calls, not turns', async () => {
    const limits = setup()
    await limits.recordLlm('a', { modelCalls: 6, tokens: 100 }, minute(0))
    expect(await limits.checkLlm('b', minute(0))).toMatchObject({ code: 'llm_busy' })
  })

  it('refuses the user for the rest of the day once their daily tokens are used; others are served', async () => {
    const limits = setup()
    for (const m of [0, 1, 2]) await limits.recordLlm('a', turn, minute(m))
    const refusal = await limits.checkLlm('a', minute(3))
    expect(refusal).toMatchObject({ code: 'llm_user_daily_cap', retry: false })
    expect(refusal?.message).toContain('limite desta demonstração')
    expect(await limits.checkLlm('b', minute(3))).toBeNull()
  })

  it('refuses everyone once the global daily tokens or calls are used', async () => {
    const byTokens = setup()
    for (const [user, m] of [
      ['a', 0],
      ['b', 1],
      ['c', 2],
      ['d', 3],
      ['e', 4],
      ['f', 5],
      ['g', 6],
    ] as const)
      await byTokens.recordLlm(user, turn, minute(m))
    expect(await byTokens.checkLlm('h', minute(7))).toMatchObject({ code: 'llm_daily_cap', retry: false })

    const byCalls = setup()
    for (const m of [0, 1, 2, 3]) await byCalls.recordLlm(`u${m}`, { modelCalls: 5, tokens: 10 }, minute(m))
    expect(await byCalls.checkLlm('h', minute(5))).toMatchObject({ code: 'llm_daily_cap' })
  })

  it('a check alone counts nothing', async () => {
    const limits = setup()
    for (let i = 0; i < 50; i++) expect(await limits.checkLlm('a', minute(0))).toBeNull()
  })
})

describe('llmUseOf', () => {
  it('counts input and output tokens, minus the cached input', () => {
    expect(
      llmUseOf({ inputTokens: 9_000, outputTokens: 500, cachedInputTokens: 5_000, modelCalls: 3 }),
    ).toEqual({ modelCalls: 3, tokens: 4_500 })
  })

  it('adds the failed attempts of a retried turn', () => {
    expect(llmUseOf({ inputTokens: 5_000, outputTokens: 200, modelCalls: 2, failedAttempts: 1 })).toEqual({
      modelCalls: 3,
      tokens: 5_200 + FAILED_ATTEMPT_USE.tokens,
    })
  })

  it('counts a failed turn by its attempts, and a turn without usage as one typical call', () => {
    expect(llmUseOf({ inputTokens: 0, outputTokens: 0, modelCalls: 0, failedAttempts: 2 })).toEqual({
      modelCalls: 2,
      tokens: 2 * FAILED_ATTEMPT_USE.tokens,
    })
    expect(llmUseOf(undefined)).toEqual(FAILED_ATTEMPT_USE)
  })
})

describe('chat rate limit', () => {
  it('allows a burst up to the limit per user per minute', async () => {
    const limits = setup()
    expect(await limits.chatRequest('a', minute(0))).toBeNull()
    expect(await limits.chatRequest('a', minute(0))).toBeNull()
    expect(await limits.chatRequest('a', minute(0))).toMatchObject({ code: 'rate_limited', retry: true })
    expect(await limits.chatRequest('b', minute(0))).toBeNull()
  })
})

describe('login rate limit', () => {
  it('counts every attempt per IP', async () => {
    const limits = setup()
    for (const _ of [1, 2, 3])
      expect(await limits.loginAttempt('1.2.3.4', 'x@nexo.com.br', minute(0))).toBeNull()
    const refusal = await limits.loginAttempt('1.2.3.4', 'y@nexo.com.br', minute(0))
    expect(refusal?.message).toBe('Muitas tentativas de login. Aguarde 15 min e tente de novo.')
    expect(await limits.loginAttempt('5.6.7.8', 'y@nexo.com.br', minute(0))).toBeNull()
  })

  it('counts only failed attempts per e-mail, so shared demo accounts keep working', async () => {
    const limits = setup()
    const email = 'ana.souza@nexo.com.br'
    expect(await limits.loginAttempt('ip1', email, minute(0))).toBeNull()
    await limits.loginFailed(email, minute(0))
    expect(await limits.loginAttempt('ip2', email, minute(0))).toBeNull()
    await limits.loginFailed(email, minute(0))
    expect(await limits.loginAttempt('ip3', email, minute(0))).toMatchObject({ code: 'rate_limited' })
    expect(await limits.loginAttempt('ip3', 'bruno@nexo.com.br', minute(0))).toBeNull()
  })
})

describe('clientIp', () => {
  it('trusts the entry the proxy added, not the ones the client sent', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }))).toBe('203.0.113.9')
    expect(clientIp(new Headers({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9')
    expect(clientIp(new Headers())).toBe('unknown')
  })
})
