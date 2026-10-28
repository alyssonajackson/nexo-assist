import { describe, expect, it, vi } from 'vitest'
import { UnauthorizedError, type AuthUser } from '@nexo/shared'
import { createApp } from './app'
import { OutageSimulator } from './outage'
import { DomainError, type TicketService } from './ticket-service'

const ana: AuthUser = { userId: 'ana', username: 'ana.souza@nexo.com.br', role: 'employee' }

function setup(service: Partial<TicketService> = {}, opts: { down?: boolean } = {}) {
  const outage = new OutageSimulator({
    enabled: false,
    meanIntervalMs: 1,
    minDurationMs: 1,
    maxDurationMs: 1,
  })
  if (opts.down) outage.force(5000)
  const verify = vi.fn(async (token: string | undefined) => {
    if (token !== 'good') throw new UnauthorizedError('bad token')
    return ana
  })
  const app = createApp({ service: service as TicketService, verify, outage, chaosEnabled: true })
  const req = (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { authorization: 'Bearer good', ...init.headers } })
  return { app, req, outage }
}

describe('tickets HTTP API', () => {
  it('rejects requests without a valid token', async () => {
    const { app } = setup()
    const res = await app.request('/tickets')
    expect(res.status).toBe(401)
  })

  it('passes the actor from the token, not from the query, to the service', async () => {
    const list = vi.fn().mockResolvedValue([])
    const { req } = setup({ list })
    await req('/tickets?scope=open&requesterId=someone-else')
    expect(list).toHaveBeenCalledWith(
      { userId: 'ana', role: 'employee', name: 'ana.souza@nexo.com.br' },
      { scope: 'open', requesterId: 'someone-else' },
    )
  })

  it('maps "not found" from the service to 404', async () => {
    const get = vi.fn().mockRejectedValue(new DomainError(404, 'not_found', 'Chamado INC-1 não encontrado.'))
    const { req } = setup({ get })
    const res = await req('/tickets/INC-20365')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found', message: 'Chamado INC-1 não encontrado.' })
  })

  it('requires an Idempotency-Key on writes', async () => {
    const { req } = setup({ create: vi.fn() })
    const res = await req('/tickets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'INC',
        category: 'network_vpn',
        title: 'VPN não conecta',
        description: 'Erro 809',
        priority: 'high',
        affected: 'self',
        requesterName: 'Ana',
      }),
    })
    expect(res.status).toBe(400)
  })

  it('validates the body', async () => {
    const { req } = setup({ create: vi.fn() })
    const res = await req('/tickets', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'D-1' },
      body: JSON.stringify({ type: 'XYZ' }),
    })
    expect(res.status).toBe(400)
  })

  it('answers 503 with Retry-After during an outage, but keeps /health up', async () => {
    const { req, app } = setup({ list: vi.fn() }, { down: true })
    const res = await req('/tickets')
    expect(res.status).toBe(503)
    expect(res.headers.get('retry-after')).toBe('5')
    expect((await app.request('/health')).status).toBe(200)
  })

  it('forces an outage through the chaos endpoint', async () => {
    const { app, outage } = setup()
    await app.request('/_chaos/outage?ms=1000', { method: 'POST' })
    expect(outage.isDown()).toBe(true)
  })
})
