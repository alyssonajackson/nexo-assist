import 'server-only'

/** Server-side configuration. Everything comes from the environment; nothing secret reaches the browser. */
export const env = {
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/?directConnection=true',
  ticketsUrl: process.env.TICKETS_URL ?? 'http://localhost:4000',
  secureCookies: process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== 'true',
}
