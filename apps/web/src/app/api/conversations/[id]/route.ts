import { employeeConversationView } from '@/server/assist/view'
import { apiSession } from '@/server/api'

/** Full conversation for the chat (also polled while an analyst or the queue is working). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await apiSession('employee')
  if (session instanceof Response) return session
  const { id } = await ctx.params
  const view = await employeeConversationView(session, id)
  if (!view)
    return Response.json({ error: 'not_found', message: 'Conversa não encontrada.' }, { status: 404 })
  return Response.json(view)
}
