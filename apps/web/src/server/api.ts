import 'server-only'
import type { ChatStreamEvent, Role } from '@nexo/shared'
import { ChatError } from './assist/chat'
import { DraftError } from './assist/commit'
import type { Emit } from './assist/runtime'
import { getSession, type Session } from './session'

const json = (status: number, error: string, message: string) => Response.json({ error, message }, { status })

/** Route handlers answer 401/403 as JSON instead of redirecting like pages do. */
export async function apiSession(role: Role): Promise<Session | Response> {
  const session = await getSession()
  if (!session) return json(401, 'unauthorized', 'Sessão expirada. Entre novamente.')
  if (session.user.role !== role) return json(403, 'forbidden', 'Acesso não permitido para o seu perfil.')
  return session
}

/** Known domain errors become an `error` event the UI can show; anything else is logged and generic. */
export function errorEvent(err: unknown): Extract<ChatStreamEvent, { type: 'error' }> {
  if (err instanceof ChatError || err instanceof DraftError)
    return { type: 'error', error: err.code, message: err.message }
  console.error(err)
  return {
    type: 'error',
    error: 'internal',
    message: 'Algo deu errado do nosso lado. Tente de novo em instantes.',
  }
}

/**
 * Streams NDJSON (one JSON event per line). Simple to read from the browser and from the CLI, and it
 * works on any Node host.
 */
export function ndjson(run: (emit: Emit) => Promise<void>): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      // The browser may leave mid-turn (reload, lost connection): the turn still finishes and is
      // stored, so "voltar e continuar" shows it; only the live stream stops.
      let open = true
      const emit: Emit = (event) => {
        if (!open) return
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        } catch {
          open = false
        }
      }
      try {
        await run(emit)
      } catch (err) {
        emit(errorEvent(err))
      } finally {
        if (open) controller.close()
      }
    },
  })
  return new Response(body, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
  })
}
