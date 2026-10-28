import { AnalystReplyRequest } from '@nexo/shared'
import { apiSession } from '@/server/api'
import { analystReply } from '@/server/assist/handoff'

/** The analyst writes to the employee: only while the conversation is theirs (state analyst, assigned to them). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await apiSession('analyst')
  if (session instanceof Response) return session
  const body = AnalystReplyRequest.safeParse(await req.json().catch(() => null))
  if (!body.success)
    return Response.json({ error: 'invalid', message: 'Escreva uma mensagem.' }, { status: 400 })
  const { id } = await ctx.params
  const message = await analystReply(id, session.user.userId, body.data.text)
  if (!message)
    return Response.json(
      { error: 'not_assigned', message: 'Assuma o atendimento para responder.' },
      { status: 409 },
    )
  return Response.json({ message }, { status: 201 })
}
