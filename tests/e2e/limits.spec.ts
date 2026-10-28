import { expect, test } from '@playwright/test'
import { counterId, DAY_MS } from '@nexo/shared'
import { login, send, startFreshChat, USERS, userId, withMongo } from './helpers'

const FIFTEEN_MIN_MS = 15 * 60_000
type UsageDoc = { _id: string; count: number; expiresAt: Date }

/**
 * Marks a counter as far over its limit, for this window and the next (a test may cross the edge),
 * runs the test, then removes it. So the tests need no wrong passwords or real turns.
 */
async function withExhausted(collection: string, key: string, windowMs: number, run: () => Promise<void>) {
  const now = Date.now()
  const ids = [now, now + windowMs].map((t) => counterId(key, windowMs, new Date(t)))
  const expiresAt = new Date(now + 3 * windowMs)
  const counters = (c: Parameters<Parameters<typeof withMongo>[0]>[0]) =>
    c.db('assist').collection<UsageDoc>(collection)
  await withMongo(async (c) => {
    for (const _id of ids)
      await counters(c).updateOne({ _id }, { $set: { count: 1_000_000, expiresAt } }, { upsert: true })
  })
  try {
    await run()
  } finally {
    await withMongo((c) => counters(c).deleteMany({ _id: { $in: ids } }))
  }
}

test('too many failed logins for one e-mail show a clear message', async ({ page }) => {
  await withExhausted('rate_limits', `login:email:${USERS.rafael}`, FIFTEEN_MIN_MS, async () => {
    await login(page, USERS.rafael)
    await expect(page.getByText(/Muitas tentativas com senha errada para este e-mail/)).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })
})

test("the user's daily LLM cap shows a notice and keeps the message in the composer", async ({ page }) => {
  const id = await withMongo((c) => userId(c, USERS.ana))
  await startFreshChat(page)
  await withExhausted('llm_usage', `turns:user:${id}`, DAY_MS, async () => {
    await send(page, 'Minha VPN não conecta')
    await expect(page.getByText(/Você usou as \d+ respostas do Nexo Assist de hoje/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Tentar novamente' })).toHaveCount(0)
    await expect(page.locator('#chat-input')).toBeEnabled()
    await expect(page.getByText('0/30 mensagens nesta sessão')).toBeVisible()
  })
})
