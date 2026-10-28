import { ConsoleConversationResponse, ConsoleListResponse, type ConsoleFilter } from '@nexo/shared'

/** Browser-side calls to /api/console/*. Errors carry the server's PT-BR message. */
export class ConsoleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`/api/console${path}`, { cache: 'no-store', ...init })
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const message =
      typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string'
        ? body.message
        : 'Não foi possível concluir. Tente de novo.'
    throw new ConsoleApiError(res.status, message)
  }
  return body
}

export const fetchList = async (filter: ConsoleFilter, q: string) =>
  ConsoleListResponse.parse(
    await request(`/conversations?${new URLSearchParams({ filter, ...(q ? { q } : {}) })}`),
  )

export const fetchConversation = async (id: string) =>
  ConsoleConversationResponse.parse(await request(`/conversations/${id}`))

export type ConsoleAction = 'take-over' | 'give-back' | 'close'

export const runAction = async (id: string, action: ConsoleAction) =>
  ConsoleConversationResponse.parse(await request(`/conversations/${id}/${action}`, { method: 'POST' }))

export const sendReply = (id: string, text: string) =>
  request(`/conversations/${id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })
