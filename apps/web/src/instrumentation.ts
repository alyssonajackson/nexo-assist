/** Next.js calls this once when the server starts. Long-running work lives here (not in a request). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.ASSIST_CONSUMER === 'off') return
  const { startAssistEventsConsumer } = await import('./server/assist/events')
  startAssistEventsConsumer()
}
