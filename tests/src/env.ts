/**
 * Defaults that target the dockerized emulators from the host (same values as .env.example).
 * Any of them can be overridden from the shell, e.g. to point the suite at another stack.
 */
const defaults = {
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'local',
  AWS_SECRET_ACCESS_KEY: 'local',
  COGNITO_ENDPOINT: 'http://localhost:4566',
  COGNITO_USER_POOL_NAME: 'nexo-assist',
  COGNITO_ISSUER_DOMAIN: 'http://localhost:4566',
  COGNITO_JWKS_DOMAIN: 'http://localhost:4566',
  SQS_ENDPOINT: 'http://localhost:4566',
  MONGODB_URI: 'mongodb://localhost:27017/?directConnection=true',
  TICKETS_URL: 'http://localhost:4000',
  WEB_URL: 'http://localhost:3000',
  /** The tickets service's write queue; override it to point the suite at another tickets server. */
  SQS_TICKET_WRITES_QUEUE: 'ticket-writes',
  SEED_PASSWORD: 'nexo123',
  /** Set to 1 to run tests that restart containers of the shared stack (CI does). */
  INTEGRATION_RESTARTS: '0',
} as const

for (const [key, value] of Object.entries(defaults)) process.env[key] ??= value

type EnvKey = keyof typeof defaults
export const env = Object.fromEntries(
  Object.keys(defaults).map((key) => [key, process.env[key] ?? defaults[key as EnvKey]]),
) as Record<EnvKey, string>
