import { MongoClient } from 'mongodb'
import { expect, type Page } from '@playwright/test'

export const PASSWORD = process.env.SEED_PASSWORD ?? 'nexo123'

export const USERS = {
  ana: 'ana.souza@nexo.com.br',
  carla: 'carla.mendes@nexo.com.br',
  rafael: 'rafael.lima@nexo.com.br',
} as const

export async function login(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('E-mail corporativo').fill(email)
  await page.getByLabel('Senha', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
}

/** Logs in as an employee and starts from an empty conversation. */
export async function startFreshChat(page: Page, email: string = USERS.ana): Promise<void> {
  await login(page, email)
  await expect(page).toHaveURL(/\/atendimento/)
  await expect(page.locator('#chat-input')).toBeVisible()
  const fresh = page.getByRole('button', { name: 'Nova conversa' })
  if (await fresh.isVisible()) await fresh.click()
  await expect(page.getByText('0/30 mensagens nesta sessão')).toBeVisible()
}

export async function send(page: Page, text: string): Promise<void> {
  const input = page.locator('#chat-input')
  await input.fill(text)
  await input.press('Enter')
}

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/?directConnection=true'

/** Runs `fn` with a Mongo client; the e2e tests use it to inspect and tidy the shared data. */
export async function withMongo<T>(fn: (client: MongoClient) => Promise<T>): Promise<T> {
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 5_000 })
  try {
    await client.connect()
    return await fn(client)
  } finally {
    await client.close()
  }
}

export async function userId(client: MongoClient, email: string): Promise<string> {
  const user = await client
    .db(process.env.ASSIST_DB ?? 'assist')
    .collection('users')
    .findOne({ email })
  if (!user) throw new Error(`seeded user ${email} not found`)
  return String(user._id)
}

/**
 * Removes the tickets a test created (anything newer than `since`), so the duplicate rule does not
 * see them in the next test. Seeded tickets are all older than the suite start.
 */
export async function deleteTicketsCreatedSince(email: string, since: Date): Promise<void> {
  await withMongo(async (client) => {
    const requesterId = await userId(client, email)
    await client
      .db(process.env.TICKETS_DB ?? 'tickets')
      .collection<{ _id: string; requesterId: string; createdAt: Date }>('tickets')
      .deleteMany({ requesterId, createdAt: { $gt: since } })
  })
}
