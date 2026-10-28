import type { z } from 'zod'
import type { Category, KbArticle, TicketView } from './domain/ticket'
import { RetryExhaustedError, withRetry, DEFAULT_RETRY, type RetryOptions } from './retry'
import {
  DuplicatesResponse,
  ErrorResponse,
  IDEMPOTENCY_HEADER,
  KbSearchResponse,
  TicketListResponse,
  TicketResponse,
  type CreateTicketBody,
  type DuplicateCandidate,
  type ListTicketsQuery,
} from './tickets-api'

/** The ticket system stayed unavailable through every retry. Writes should be deferred to the queue. */
export class TicketsUnavailableError extends Error {
  override name = 'TicketsUnavailableError'
  constructor(readonly attempts: number) {
    super('Sistema de chamados indisponível')
  }
}

/** The ticket system answered with a non-retryable error (404, 409, 422...). */
export class TicketsHttpError extends Error {
  override name = 'TicketsHttpError'
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

class TransientError extends Error {
  override name = 'TransientError'
}

const RETRYABLE_STATUS = new Set([502, 503, 504])

export type TicketsClientOptions = {
  baseUrl: string
  /** The caller's Cognito access token. The service derives identity and privacy from it. */
  accessToken: string
  retry?: RetryOptions
  timeoutMs?: number
  fetch?: typeof fetch
}

/**
 * Typed client for services/tickets. Every call retries transient failures (network errors,
 * timeouts, 502/503/504) with exponential backoff. Writes carry an Idempotency-Key so a retry can
 * never create a duplicate.
 */
export function createTicketsClient(opts: TicketsClientOptions) {
  const doFetch = opts.fetch ?? fetch
  const retry = opts.retry ?? DEFAULT_RETRY
  const timeoutMs = opts.timeoutMs ?? 4000

  async function call<S extends z.ZodType>(
    schema: S,
    path: string,
    init: { method?: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string } = {},
  ): Promise<z.infer<S>> {
    try {
      return await withRetry(
        async () => {
          let res: Response
          try {
            res = await doFetch(`${opts.baseUrl}${path}`, {
              method: init.method ?? 'GET',
              headers: {
                authorization: `Bearer ${opts.accessToken}`,
                ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
                ...(init.idempotencyKey ? { [IDEMPOTENCY_HEADER]: init.idempotencyKey } : {}),
              },
              ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
              signal: AbortSignal.timeout(timeoutMs),
            })
          } catch (err) {
            throw new TransientError(err instanceof Error ? err.message : 'network error')
          }
          if (RETRYABLE_STATUS.has(res.status)) throw new TransientError(`HTTP ${res.status}`)
          const json: unknown = await res.json().catch(() => null)
          if (!res.ok) {
            const parsed = ErrorResponse.safeParse(json)
            throw new TicketsHttpError(
              res.status,
              parsed.success ? parsed.data.error : 'http_error',
              parsed.success ? parsed.data.message : `HTTP ${res.status}`,
            )
          }
          return schema.parse(json)
        },
        (err) => err instanceof TransientError,
        retry,
      )
    } catch (err) {
      if (err instanceof RetryExhaustedError) throw new TicketsUnavailableError(err.attempts)
      throw err
    }
  }

  const qs = (params: Record<string, string | undefined>) => {
    const entries = Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined)
    return entries.length ? `?${new URLSearchParams(entries).toString()}` : ''
  }

  return {
    async listTickets(query: ListTicketsQuery = {}): Promise<TicketView[]> {
      const res = await call(TicketListResponse, `/tickets${qs({ ...query })}`)
      return res.tickets
    },
    async getTicket(id: string): Promise<TicketView> {
      return (await call(TicketResponse, `/tickets/${encodeURIComponent(id)}`)).ticket
    },
    async findDuplicates(text: string, category?: Category): Promise<DuplicateCandidate[]> {
      return (await call(DuplicatesResponse, `/tickets/duplicates${qs({ text, category })}`)).candidates
    },
    async searchKb(q: string): Promise<(KbArticle & { score: number })[]> {
      return (await call(KbSearchResponse, `/kb/search${qs({ q })}`)).articles
    },
    createTicket(body: CreateTicketBody, idempotencyKey: string) {
      return call(TicketResponse, '/tickets', { method: 'POST', body, idempotencyKey })
    },
    addUpdate(id: string, note: string, idempotencyKey: string) {
      return call(TicketResponse, `/tickets/${encodeURIComponent(id)}/updates`, {
        method: 'POST',
        body: { note },
        idempotencyKey,
      })
    },
    reopen(id: string, reason: string, idempotencyKey: string) {
      return call(TicketResponse, `/tickets/${encodeURIComponent(id)}/reopen`, {
        method: 'POST',
        body: { reason },
        idempotencyKey,
      })
    },
    transfer(id: string, summary: string, idempotencyKey: string) {
      return call(TicketResponse, `/tickets/${encodeURIComponent(id)}/transfer`, {
        method: 'POST',
        body: { summary },
        idempotencyKey,
      })
    },
  }
}

export type TicketsClient = ReturnType<typeof createTicketsClient>
