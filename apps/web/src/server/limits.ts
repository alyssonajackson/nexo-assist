import 'server-only'
import type { Collection } from 'mongodb'
import {
  consume,
  DAY_MS,
  hit,
  MINUTE_MS,
  peek,
  peekAll,
  type CounterStore,
  type Decision,
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

/** What one agent turn cost against the provider's limits. */
export type LlmUse = { modelCalls: number; tokens: number }

/** A failed attempt reports no usage; count it as one call with a typical prompt (~3k tokens). */
export const FAILED_ATTEMPT_USE: LlmUse = { modelCalls: 1, tokens: 3000 }

/**
 * Tokens as the provider counts them: input plus output, minus the input served from the prompt cache
 * (Groq does not count cached tokens toward its limits). Failed attempts (a retried or failed turn)
 * are added at FAILED_ATTEMPT_USE each.
 */
export function llmUseOf(usage: Decision['usage']): LlmUse {
  if (!usage) return FAILED_ATTEMPT_USE
  const { inputTokens, outputTokens, cachedInputTokens = 0, modelCalls = 1, failedAttempts = 0 } = usage
  return {
    modelCalls: modelCalls + failedAttempts * FAILED_ATTEMPT_USE.modelCalls,
    tokens:
      Math.max(0, inputTokens - cachedInputTokens) +
      outputTokens +
      failedAttempts * FAILED_ATTEMPT_USE.tokens,
  }
}

type LlmLimit = Limit & { unit: keyof LlmUse }

/**
 * The limits of a public demo. The LLM caps count what the provider counts: model calls and tokens
 * (one agent turn makes 2-6 calls). A turn's cost is only known after it runs, so a turn starts while
 * every counter is under its cap and is recorded afterwards; it can overshoot by one turn, which the
 * defaults leave room for. A message sent during a handoff never reaches the model, so it does not count.
 */
export function createLimits(stores: Stores, config: LimitsConfig) {
  const llmLimits = (userId: string): LlmLimit[] => [
    { key: `tokens:user:${userId}`, max: config.tokensPerUserPerDay, windowMs: DAY_MS, unit: 'tokens' },
    { key: 'calls:global', max: config.callsPerMinute, windowMs: MINUTE_MS, unit: 'modelCalls' },
    { key: 'tokens:global', max: config.tokensPerMinute, windowMs: MINUTE_MS, unit: 'tokens' },
    { key: 'calls:global', max: config.callsPerDay, windowMs: DAY_MS, unit: 'modelCalls' },
    { key: 'tokens:global', max: config.tokensPerDay, windowMs: DAY_MS, unit: 'tokens' },
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

  function llmRefusal(result: Extract<LimitResult, { ok: false }>, userId: string): Refusal {
    if (result.limit.key === `tokens:user:${userId}`)
      return {
        code: 'llm_user_daily_cap',
        message:
          'Você usou a cota de respostas do Nexo Assist de hoje (limite desta demonstração). O limite renova às 21h (horário de Brasília).',
        retry: false,
      }
    if (result.limit.windowMs === MINUTE_MS)
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
    /** Before an agent turn: refused when any LLM counter is already at its cap. */
    async checkLlm(userId: string, now = new Date()): Promise<Refusal | null> {
      const result = await peekAll(stores.llm, llmLimits(userId), now)
      return result.ok ? null : llmRefusal(result, userId)
    },

    /** After an agent turn: counts the calls and tokens it used. */
    async recordLlm(userId: string, use: LlmUse, now = new Date()): Promise<void> {
      for (const limit of llmLimits(userId)) await hit(stores.llm, limit, now, use[limit.unit])
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
