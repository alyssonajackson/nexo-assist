import 'server-only'
import { intFromEnv } from '@nexo/shared'

const e = process.env

/** Server-side configuration. Everything comes from the environment; nothing secret reaches the browser. */
export const env = {
  mongoUri: e.MONGODB_URI ?? 'mongodb://localhost:27017/?directConnection=true',
  ticketsUrl: e.TICKETS_URL ?? 'http://localhost:4000',
  secureCookies: e.NODE_ENV === 'production' && e.INSECURE_COOKIES !== 'true',
  /**
   * Caps that keep a public demo inside the Gemini free tier (~15 req/min, 500 req/day; a turn makes
   * 2-4 model calls). Counted per agent turn, in MongoDB, so they hold across restarts and instances.
   */
  llm: {
    turnsPerUserPerDay: intFromEnv(e, 'LLM_TURNS_PER_USER_PER_DAY', 40),
    turnsPerMinute: intFromEnv(e, 'LLM_TURNS_PER_MINUTE', 4),
    turnsPerDay: intFromEnv(e, 'LLM_TURNS_PER_DAY', 150),
  },
  rateLimit: {
    chatPerUserPerMinute: intFromEnv(e, 'CHAT_REQUESTS_PER_MINUTE', 10),
    loginPerIpPer15Min: intFromEnv(e, 'LOGIN_ATTEMPTS_PER_IP', 20),
    loginFailuresPerEmailPer15Min: intFromEnv(e, 'LOGIN_FAILURES_PER_EMAIL', 5),
  },
}
