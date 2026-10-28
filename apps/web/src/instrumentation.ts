/** Next.js calls this once when the server starts. Long-running work lives here (not in a request). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // Fail fast: a production deploy with a missing secret stops here, not on the first request.
  const { assertProductionEnv } = await import('@nexo/shared')
  const { PRODUCTION_ENV } = await import('./server/env')
  try {
    assertProductionEnv('web', PRODUCTION_ENV)
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
  if (process.env.ASSIST_CONSUMER === 'off') return
  const { startAssistEventsConsumer } = await import('./server/assist/events')
  startAssistEventsConsumer()
}
