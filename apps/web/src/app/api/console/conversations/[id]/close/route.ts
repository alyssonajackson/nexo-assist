import { actorOf } from '@/server/assist/chat'
import { closeConversation } from '@/server/assist/handoff'
import { consoleConversationView } from '@/server/assist/console'
import { apiSession } from '@/server/api'

/** Atomic transition: 409 when the conversation is no longer in a state this step accepts (e.g. another analyst got there first). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await apiSession('analyst')
  if (session instanceof Response) return session
  const { id } = await ctx.params
  const conv = await closeConversation(id, actorOf(session))
  if (!conv)
    return Response.json(
      { error: 'conflict', message: 'A conversa mudou de estado. Atualize a lista.' },
      { status: 409 },
    )
  return Response.json(await consoleConversationView(session, id))
}
