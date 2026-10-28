import 'server-only'
import type { Collection } from 'mongodb'
import {
  consume,
  DAY_MS,
  hit,
  MINUTE_MS,
  peek,
  release,
  type CounterStore,
  type Limit,
  type LimitResult,
} from '@nexo/shared'
import { assistDb, type UsageDoc } from './db'
import { env } from './env'

/** Counters in MongoDB: one atomic $inc per use, so the limits hold across restarts and instances. */
export class MongoCounterStore implements CounterStore {
  constructor(private readonly collection: () => Promise<Collection<UsageDoc>>) {}

  async add(id: string, by: number, expiresAt: Date): Promise<number> {
    const doc = await (
      await this.collection()
    ).findOneAndUpdate(
      { _id: id },
      { $inc: { count: by }, $setOnInsert: { expiresAt } },
      { upsert: true, returnDocument: 'after' },
    )
    return doc?.count ?? by
  }

  async get(id: string): Promise<number> {
    return (await (await this.collection()).findOne({ _id: id }))?.count ?? 0
  }
}

export type RefusalCode = 'llm_user_daily_cap' | 'llm_daily_cap' | 'llm_busy' | 'rate_limited'

/** Why a request was refused, in words for the employee. `retry`: trying again later can work. */
export type Refusal = { code: RefusalCode; message: string; retry: boolean }

export type LimitsConfig = typeof env.llm & typeof env.rateLimit
export type Stores = { llm: CounterStore; requests: CounterStore }

const FIFTEEN_MIN_MS = 15 * MINUTE_MS
const minutes = (s: number) => Math.max(1, Math.ceil(s / 60))

/**
 * The limits of a public demo. The LLM caps count agent turns (not HTTP requests): a message sent
 * during a handoff never reaches the model, so it does not count.
 */
export function createLimits(stores: Stores, config: LimitsConfig) {
  const turnLimits = (userId: string): Limit[] => [
    { key: `turns:user:${userId}`, max: config.turnsPerUserPerDay, windowMs: DAY_MS },
    { key: 'turns:global', max: config.turnsPerMinute, windowMs: MINUTE_MS },
    { key: 'turns:global', max: config.turnsPerDay, windowMs: DAY_MS },
  ]
  const chatLimit = (userId: string): Limit => ({
    key: `chat:user:${userId}`,
    max: config.chatPerUserPerMinute,
    windowMs: MINUTE_MS,
  })
  const loginIpLimit = (ip: string): Limit => ({
    key: `login:ip:${ip}`,
    max: config.loginPerIpPer15Min,
    windowMs: FIFTEEN_MIN_MS,
  })
  const loginEmailLimit = (email: string): Limit => ({
    key: `login:email:${email}`,
    max: config.loginFailuresPerEmailPer15Min,
    windowMs: FIFTEEN_MIN_MS,
  })

  function turnRefusal(result: Extract<LimitResult, { ok: false }>, userId: string): Refusal {
    const [user, perMinute] = turnLimits(userId)
    if (result.limit.key === user?.key)
      return {
        code: 'llm_user_daily_cap',
        message: `Você usou as ${config.turnsPerUserPerDay} respostas do Nexo Assist de hoje (limite desta demonstração). O limite renova às 21h (horário de Brasília).`,
        retry: false,
      }
    if (result.limit.windowMs === perMinute?.windowMs)
      return {
        code: 'llm_busy',
        message: `O Nexo Assist está com muita procura agora. Tente de novo em ${result.retryAfterS} s.`,
        retry: true,
      }
    return {
      code: 'llm_daily_cap',
      message:
        'O Nexo Assist atingiu o limite diário de uso desta demonstração. Tente de novo amanhã; seus chamados continuam salvos.',
      retry: false,
    }
  }

  return {
    /** Reserves one agent turn for the user. Undo with `releaseAgentTurn` if the turn does not run. */
    async reserveAgentTurn(userId: string, now = new Date()): Promise<Refusal | null> {
      const result = await consume(stores.llm, turnLimits(userId), now)
      return result.ok ? null : turnRefusal(result, userId)
    },

    releaseAgentTurn(userId: string, now = new Date()): Promise<void> {
      return release(stores.llm, turnLimits(userId), now)
    },

    async chatRequest(userId: string, now = new Date()): Promise<Refusal | null> {
      const result = await consume(stores.requests, [chatLimit(userId)], now)
      if (result.ok) return null
      return {
        code: 'rate_limited',
        message: `Muitas mensagens em pouco tempo. Aguarde ${result.retryAfterS} s e tente de novo.`,
        retry: true,
      }
    },

    /** Before a login: attempts per IP are counted; failed attempts per e-mail are only checked here. */
    async loginAttempt(ip: string, email: string, now = new Date()): Promise<Refusal | null> {
      const byEmail = await peek(stores.requests, loginEmailLimit(email), now)
      if (!byEmail.ok)
        return {
          code: 'rate_limited',
          message: `Muitas tentativas com senha errada para este e-mail. Aguarde ${minutes(byEmail.retryAfterS)} min e tente de novo.`,
          retry: true,
        }
      const byIp = await consume(stores.requests, [loginIpLimit(ip)], now)
      if (!byIp.ok)
        return {
          code: 'rate_limited',
          message: `Muitas tentativas de login. Aguarde ${minutes(byIp.retryAfterS)} min e tente de novo.`,
          retry: true,
        }
      return null
    },

    /** Only failures count per e-mail: reviewers share the seeded accounts and must not lock each other out. */
    loginFailed(email: string, now = new Date()): Promise<void> {
      return hit(stores.requests, loginEmailLimit(email), now)
    },
  }
}

export type Limits = ReturnType<typeof createLimits>

const globalForLimits = globalThis as unknown as { nexoLimits?: Limits }

export function limits(): Limits {
  globalForLimits.nexoLimits ??= createLimits(
    {
      llm: new MongoCounterStore(async () => (await assistDb()).llmUsage),
      requests: new MongoCounterStore(async () => (await assistDb()).rateLimits),
    },
    { ...env.llm, ...env.rateLimit },
  )
  return globalForLimits.nexoLimits
}

/**
 * The client's IP as seen by the platform's proxy: the last X-Forwarded-For entry is the one the
 * proxy added itself (earlier entries come from the client and can be forged).
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',').at(-1)?.trim()
  return forwarded || headers.get('x-real-ip') || 'unknown'
}
