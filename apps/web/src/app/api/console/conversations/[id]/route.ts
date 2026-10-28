import { apiSession } from '@/server/api'
import { consoleConversationView } from '@/server/assist/console'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await apiSession('analyst')
  if (session instanceof Response) return session
  const { id } = await ctx.params
  const view = await consoleConversationView(session, id)
  if (!view)
    return Response.json({ error: 'not_found', message: 'Conversa não encontrada.' }, { status: 404 })
  return Response.json(view)
}
