import { ChatRequest } from '@nexo/shared'
import { sendMessage } from '@/server/assist/chat'
import { apiSession, ndjson } from '@/server/api'
import { limits } from '@/server/limits'

/** POST { conversationId?, text } -> NDJSON stream: chips, decision, reply deltas, stored messages. */
export async function POST(req: Request) {
  const session = await apiSession('employee')
  if (session instanceof Response) return session
  const refusal = await limits().chatRequest(session.user.userId)
  if (refusal) return Response.json({ error: refusal.code, message: refusal.message }, { status: 429 })
  const parsed = ChatRequest.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'bad_request', message: 'Mensagem inválida.' }, { status: 400 })
  }
  return ndjson((emit) => sendMessage(session, parsed.data, emit))
}
