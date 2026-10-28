import { decodeJwt } from 'jose'
import { ChatStreamEvent } from '@nexo/shared'
import { env } from '../env'
import { login } from './cognito'

export type Session = { email: string; userId: string; accessToken: string; cookie: string }

/** Logs in through Cognito; the same access token is the web cookie and the tickets Bearer token. */
export async function session(email: string): Promise<Session> {
  const { accessToken } = await login(email)
  const userId = decodeJwt(accessToken).sub
  if (!userId) throw new Error(`token for ${email} has no sub`)
  return { email, userId, accessToken, cookie: `nx_access=${accessToken}` }
}

/** POST to a web route that streams NDJSON and returns the parsed events, in order. */
export async function postNdjson(path: string, cookie: string, body?: unknown): Promise<ChatStreamEvent[]> {
  const res = await fetch(`${env.WEB_URL}${path}`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await res.text()
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => ChatStreamEvent.parse(JSON.parse(line)))
}

/** Raw call to the tickets service: a 503 is returned as is (the simulated outage). */
export const ticketsFetchRaw = (path: string, accessToken: string, init: RequestInit = {}) =>
  fetch(`${env.TICKETS_URL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', ...init.headers },
  })

/** Like ticketsFetchRaw, but waits out the random outages the service simulates (503 + Retry-After). */
export async function ticketsFetch(path: string, accessToken: string, init: RequestInit = {}) {
  const deadline = Date.now() + 30_000
  for (;;) {
    const res = await ticketsFetchRaw(path, accessToken, init)
    if (res.status !== 503 || Date.now() > deadline) return res
    await new Promise((r) => setTimeout(r, 500))
  }
}

export async function waitUntil<T>(probe: () => Promise<T | undefined | null | false>, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await probe()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs} ms`)
    await new Promise((r) => setTimeout(r, 500))
  }
}

/** Polls /health until the simulated outage is over, so a test never leaves the service down. */
export async function waitForNoOutage(timeoutMs = 30_000): Promise<void> {
  await waitUntil(async () => {
    const res = await fetch(`${env.TICKETS_URL}/health`)
    const body = (await res.json()) as { outage: boolean }
    return !body.outage
  }, timeoutMs)
}
