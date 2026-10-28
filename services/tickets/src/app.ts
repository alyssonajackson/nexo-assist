import { Hono, type Context } from 'hono'
import { logger } from 'hono/logger'
import type { z } from 'zod'
import {
  CreateTicketBody,
  DuplicatesQuery,
  IDEMPOTENCY_HEADER,
  ListTicketsQuery,
  NoteBody,
  ReopenBody,
  TransferBody,
  isUnauthorizedError,
  type Actor,
  type AuthUser,
  type ErrorResponse,
} from '@nexo/shared'
import type { OutageSimulator } from './outage'
import { DomainError, type TicketService } from './ticket-service'

export type AppDeps = {
  service: TicketService
  verify: (token: string | undefined) => Promise<AuthUser>
  outage: OutageSimulator
  /** Exposes POST /_chaos/outage. Never enable in production. */
  chaosEnabled: boolean
}

type Env = { Variables: { actor: Actor } }

class BadRequest extends Error {}

const parse = <S extends z.ZodType>(schema: S, value: unknown): z.infer<S> => {
  const result = schema.safeParse(value)
  if (!result.success)
    throw new BadRequest(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  return result.data
}

const fail = (c: Context, status: 400 | 401 | 403 | 404 | 409 | 422 | 500 | 503, body: ErrorResponse) =>
  c.json(body, status)

export function createApp({ service, verify, outage, chaosEnabled }: AppDeps) {
  const app = new Hono<Env>()
  if (process.env.NODE_ENV !== 'test') app.use(logger())

  app.get('/health', (c) => c.json({ ok: true, service: 'tickets', outage: outage.remainingMs() > 0 }))

  if (chaosEnabled) {
    app.post('/_chaos/outage', (c) => {
      const ms = Math.min(Number(c.req.query('ms') ?? 30_000), 300_000)
      outage.force(ms)
      return c.json({ ok: true, downForMs: ms })
    })
  }

  // The legacy system's flakiness: everything below can fail with 503 for a few seconds.
  app.use('/tickets/*', simulateOutage(outage))
  app.use('/tickets', simulateOutage(outage))
  app.use('/kb/*', simulateOutage(outage))

  // Identity always comes from the verified access token, never from the request body.
  const authenticate = async (c: Context<Env>, next: () => Promise<void>) => {
    const header = c.req.header('authorization')
    const user = await verify(header?.startsWith('Bearer ') ? header.slice(7) : undefined)
    c.set('actor', { userId: user.userId, role: user.role, name: user.username })
    await next()
  }
  app.use('/tickets/*', authenticate)
  app.use('/tickets', authenticate)
  app.use('/kb/*', authenticate)

  const idempotencyKey = (c: Context) => {
    const key = c.req.header(IDEMPOTENCY_HEADER)
    if (!key) throw new BadRequest(`${IDEMPOTENCY_HEADER} header is required for writes`)
    return key
  }

  app.get('/tickets', async (c) => {
    const query = parse(ListTicketsQuery, c.req.query())
    return c.json({ tickets: await service.list(c.get('actor'), query) })
  })

  app.get('/tickets/duplicates', async (c) => {
    const { text } = parse(DuplicatesQuery, c.req.query())
    return c.json({ candidates: await service.duplicates(c.get('actor'), text) })
  })

  app.get('/tickets/:id', async (c) => {
    return c.json({ ticket: await service.get(c.get('actor'), c.req.param('id')), replayed: false })
  })

  app.post('/tickets', async (c) => {
    const body = parse(CreateTicketBody, await c.req.json())
    const result = await service.create(c.get('actor'), body, idempotencyKey(c))
    return c.json(result, result.replayed ? 200 : 201)
  })

  app.post('/tickets/:id/updates', async (c) => {
    const { note } = parse(NoteBody, await c.req.json())
    return c.json(await service.addUpdate(c.get('actor'), c.req.param('id'), note, idempotencyKey(c)))
  })

  app.post('/tickets/:id/reopen', async (c) => {
    const { reason } = parse(ReopenBody, await c.req.json())
    return c.json(await service.reopen(c.get('actor'), c.req.param('id'), reason, idempotencyKey(c)))
  })

  app.post('/tickets/:id/transfer', async (c) => {
    const { summary } = parse(TransferBody, await c.req.json())
    return c.json(await service.transfer(c.get('actor'), c.req.param('id'), summary, idempotencyKey(c)))
  })

  app.get('/kb/search', async (c) => {
    const q = c.req.query('q') ?? ''
    if (q.trim().length < 2) throw new BadRequest('q must have at least 2 characters')
    return c.json({ articles: await service.searchKb(q) })
  })

  app.onError((err, c) => {
    if (isUnauthorizedError(err)) return fail(c, 401, { error: 'unauthorized', message: err.message })
    if (err instanceof DomainError) return fail(c, err.status, { error: err.code, message: err.message })
    if (err instanceof BadRequest || err instanceof SyntaxError) {
      return fail(c, 400, { error: 'bad_request', message: err.message })
    }
    console.error(err)
    return fail(c, 500, { error: 'internal', message: 'Erro interno no sistema de chamados.' })
  })

  return app
}

function simulateOutage(outage: OutageSimulator) {
  return async (c: Context, next: () => Promise<void>) => {
    if (outage.isDown()) {
      c.header('Retry-After', String(Math.ceil(outage.remainingMs() / 1000)))
      return fail(c, 503, { error: 'unavailable', message: 'Sistema de chamados indisponível.' })
    }
    await next()
  }
}
