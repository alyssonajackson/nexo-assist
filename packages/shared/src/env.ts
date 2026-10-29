/**
 * Production guard. `APP_ENV=production` is set only on the hosting platform (the local Docker
 * stack also runs with NODE_ENV=production, so NODE_ENV cannot tell them apart). In production a
 * service refuses to start with missing secrets, emulator endpoints or the chaos endpoint on,
 * instead of failing on the first request.
 */
export type Env = Record<string, string | undefined>

export type ProductionEnvSpec = {
  required: string[]
  /** Local-only settings (emulator endpoints, insecure cookies) that must not reach production. */
  forbidden?: string[]
}

export const isProduction = (env: Env = process.env) => env.APP_ENV === 'production'

/** The API key the configured LLM provider needs (none for the scripted demo model). */
export function llmKeyFor(model: string | undefined): string | undefined {
  if (model?.startsWith('anthropic/')) return 'ANTHROPIC_API_KEY'
  if (model?.startsWith('groq/')) return 'GROQ_API_KEY'
  if (model === 'demo') return undefined
  return 'GOOGLE_GENERATIVE_AI_API_KEY'
}

export function productionEnvProblems(spec: ProductionEnvSpec, env: Env = process.env): string[] {
  if (!isProduction(env)) return []
  const set = (name: string) => Boolean(env[name]?.trim())
  return [
    ...spec.required.filter((name) => !set(name)).map((name) => `${name} is required`),
    ...(spec.forbidden ?? []).filter(set).map((name) => `${name} must not be set`),
  ]
}

/** Throws with every problem at once, so one failed deploy shows the whole list. */
export function assertProductionEnv(service: string, spec: ProductionEnvSpec, env: Env = process.env): void {
  const problems = productionEnvProblems(spec, env)
  if (problems.length) throw new Error(`${service}: invalid production env: ${problems.join('; ')}`)
}

/** A positive integer from env, or the default. Invalid values fail loudly instead of disabling a limit. */
export function intFromEnv(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer, got "${raw}"`)
  return value
}
