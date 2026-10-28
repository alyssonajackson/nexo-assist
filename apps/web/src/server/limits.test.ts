import { describe, expect, it, vi } from 'vitest'
import { InMemoryCounterStore } from '@nexo/shared'

vi.mock('server-only', () => ({}))
vi.mock('./db', () => ({ assistDb: vi.fn() }))

const { clientIp, createLimits } = await import('./limits')

const config = {
  turnsPerUserPerDay: 3,
  turnsPerMinute: 2,
  turnsPerDay: 5,
  chatPerUserPerMinute: 2,
  loginPerIpPer15Min: 3,
  loginFailuresPerEmailPer15Min: 2,
}
const setup = () =>
  createLimits({ llm: new InMemoryCounterStore(), requests: new InMemoryCounterStore() }, config)
const at = (iso: string) => new Date(iso)
const minute = (m: number) => at(`2026-10-28T10:${String(m).padStart(2, '0')}:00Z`)

describe('agent turn caps', () => {
  it('refuses for a minute when the global per-minute cap is hit, and can be retried', async () => {
    const limits = setup()
    expect(await limits.reserveAgentTurn('a', minute(0))).toBeNull()
    expect(await limits.reserveAgentTurn('b', minute(0))).toBeNull()
    expect(await limits.reserveAgentTurn('c', minute(0))).toMatchObject({ code: 'llm_busy', retry: true })
    expect(await limits.reserveAgentTurn('c', minute(1))).toBeNull()
  })

  it("refuses for the rest of the day once the user's daily turns are used", async () => {
    const limits = setup()
    for (const m of [0, 1, 2]) expect(await limits.reserveAgentTurn('a', minute(m))).toBeNull()
    const refusal = await limits.reserveAgentTurn('a', minute(3))
    expect(refusal).toMatchObject({ code: 'llm_user_daily_cap', retry: false })
    expect(refusal?.message).toContain('3 respostas')
    // Other users are still served.
    expect(await limits.reserveAgentTurn('b', minute(3))).toBeNull()
  })

  it('refuses everyone once the global daily cap is hit', async () => {
    const limits = setup()
    for (const [user, m] of [
      ['a', 0],
      ['b', 1],
      ['c', 2],
      ['d', 3],
      ['e', 4],
    ] as const)
      expect(await limits.reserveAgentTurn(user, minute(m))).toBeNull()
    expect(await limits.reserveAgentTurn('f', minute(5))).toMatchObject({
      code: 'llm_daily_cap',
      retry: false,
    })
  })

  it('a released turn is not counted', async () => {
    const limits = setup()
    for (const m of [0, 1, 2]) {
      expect(await limits.reserveAgentTurn('a', minute(m))).toBeNull()
      await limits.releaseAgentTurn('a', minute(m))
    }
    expect(await limits.reserveAgentTurn('a', minute(3))).toBeNull()
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
