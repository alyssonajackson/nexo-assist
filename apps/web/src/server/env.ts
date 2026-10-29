import 'server-only'
import { intFromEnv, llmKeyFor, type ProductionEnvSpec } from '@nexo/shared'

const e = process.env

/** Server-side configuration. Everything comes from the environment; nothing secret reaches the browser. */
export const env = {
  mongoUri: e.MONGODB_URI ?? 'mongodb://localhost:27017/?directConnection=true',
  ticketsUrl: e.TICKETS_URL ?? 'http://localhost:4000',
  secureCookies: e.NODE_ENV === 'production' && e.INSECURE_COOKIES !== 'true',
  /**
   * Caps that keep a public demo inside the LLM provider's free tier, counted like the provider counts:
   * model calls and tokens (cached input excluded). Defaults fit both free tiers with ~20% headroom:
   * calls from Gemini Flash-Lite (15 req/min, 500 req/day), tokens from Groq gpt-oss-120b (8K
   * tokens/min, 200K tokens/day). In MongoDB, so they hold across restarts and instances.
   */
  llm: {
    tokensPerUserPerDay: intFromEnv(e, 'LLM_TOKENS_PER_USER_PER_DAY', 40_000),
    callsPerMinute: intFromEnv(e, 'LLM_CALLS_PER_MINUTE', 12),
    tokensPerMinute: intFromEnv(e, 'LLM_TOKENS_PER_MINUTE', 6_000),
    callsPerDay: intFromEnv(e, 'LLM_CALLS_PER_DAY', 400),
    tokensPerDay: intFromEnv(e, 'LLM_TOKENS_PER_DAY', 160_000),
  },
  rateLimit: {
    chatPerUserPerMinute: intFromEnv(e, 'CHAT_REQUESTS_PER_MINUTE', 10),
    loginPerIpPer15Min: intFromEnv(e, 'LOGIN_ATTEMPTS_PER_IP', 20),
    loginFailuresPerEmailPer15Min: intFromEnv(e, 'LOGIN_FAILURES_PER_EMAIL', 5),
  },
}

/** Checked once at startup when APP_ENV=production (instrumentation.ts). */
export const PRODUCTION_ENV: ProductionEnvSpec = {
  required: [
    'MONGODB_URI',
    'TICKETS_URL',
    'AWS_REGION',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'COGNITO_USER_POOL_ID',
    'COGNITO_CLIENT_ID',
    'LLM_MODEL',
    ...[llmKeyFor(e.LLM_MODEL)].filter((k) => k !== undefined),
  ],
  forbidden: [
    'COGNITO_ENDPOINT',
    'SQS_ENDPOINT',
    'COGNITO_ISSUER_DOMAIN',
    'COGNITO_JWKS_DOMAIN',
    'INSECURE_COOKIES',
  ],
}
