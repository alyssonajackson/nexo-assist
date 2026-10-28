import type { ConversationResponse, TicketView } from '@nexo/shared'
import { getEmployeeConversation } from '@/server/assist/conversations'
import { listDrafts } from '@/server/assist/drafts'
import { listMessages } from '@/server/assist/messages'
import { ticketsAs } from '@/server/assist/runtime'
import { apiSession } from '@/server/api'

/** Full conversation for the chat (also polled while an analyst or the queue is working). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await apiSession('employee')
  if (session instanceof Response) return session
  const { id } = await ctx.params
  const conversation = await getEmployeeConversation(id, session.user.userId)
  if (!conversation)
    return Response.json({ error: 'not_found', message: 'Conversa não encontrada.' }, { status: 404 })

  const [messages, drafts] = await Promise.all([listMessages(id), listDrafts(id)])
  // Cards are rendered from live ticket data. The tickets service may be down: the chat still loads.
  let tickets: TicketView[] = []
  if (conversation.relatedTicketIds.length) {
    try {
      const mine = await ticketsAs(session.accessToken).listTickets({ scope: 'all' })
      tickets = mine.filter((t) => conversation.relatedTicketIds.includes(t.id))
    } catch {
      tickets = []
    }
  }
  const body: ConversationResponse = { conversation, messages, drafts, tickets }
  return Response.json(body)
}
