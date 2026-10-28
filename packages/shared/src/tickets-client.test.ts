import { describe, expect, it, vi } from 'vitest'
import { createTicketsClient, TicketsHttpError, TicketsUnavailableError } from './tickets-client'

const ticket = {
  id: 'INC-20311',
  type: 'INC',
  category: 'hardware',
  title: 'Notebook lento',
  description: 'Lento desde a atualização',
  priority: 'medium',
  affected: 'self',
  status: 'awaiting_analyst',
  requesterId: 'u1',
  requesterName: 'Ana Souza',
  createdAt: '2026-10-20T12:00:00.000Z',
  updatedAt: '2026-10-22T12:00:00.000Z',
  timeline: [],
  sla: { dueAt: '2026-10-23T12:00:00.000Z', overdue: true, reopenable: false },
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const client = (fetchImpl: typeof fetch, onRetry = vi.fn()) =>
  createTicketsClient({
    baseUrl: 'http://tickets',
    accessToken: 'token-1',
    fetch: fetchImpl,
    retry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 1, sleep: async () => {}, onRetry },
  })

describe('tickets client', () => {
  it('sends the bearer token and parses the response', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json(200, { tickets: [ticket] }))
    const tickets = await client(fetchMock).listTickets({ scope: 'open' })
    expect(tickets[0]?.sla.overdue).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('http://tickets/tickets?scope=open')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer token-1')
  })

  it('retries a 503 and succeeds, reporting each retry', async () => {
    const onRetry = vi.fn()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(503, { error: 'unavailable', message: 'down' }))
      .mockResolvedValueOnce(json(200, { ticket, replayed: false }))
    await expect(client(fetchMock, onRetry).getTicket('INC-20311')).resolves.toMatchObject({
      id: 'INC-20311',
    })
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('retries network errors and gives up with TicketsUnavailableError', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'))
    await expect(client(fetchMock).getTicket('INC-20311')).rejects.toBeInstanceOf(TicketsUnavailableError)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not retry a 404 (privacy: another employee ticket looks missing)', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json(404, { error: 'not_found', message: 'x' }))
    const err = await client(fetchMock)
      .getTicket('INC-20365')
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TicketsHttpError)
    expect((err as TicketsHttpError).status).toBe(404)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sends the same Idempotency-Key on every retry of a write', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(503, { error: 'unavailable', message: 'down' }))
      .mockResolvedValueOnce(json(201, { ticket, replayed: false }))
    await client(fetchMock).addUpdate('INC-20311', 'Continua lento', 'D-381')
    const keys = fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get('Idempotency-Key'))
    expect(keys).toEqual(['D-381', 'D-381'])
  })
})
