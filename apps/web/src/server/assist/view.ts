import 'server-only'
import type { ConversationResponse, TicketView } from '@nexo/shared'
import type { Session } from '../session'
import { authorsOf } from './console'
import { getEmployeeConversation } from './conversations'
import { listDrafts } from './drafts'
import { listMessages } from './messages'
import { ticketsAs } from './runtime'

/**
 * Everything the chat renders for one of the employee's conversations: the page's first render and
 * GET /api/conversations/:id (polling) both use it. Null when it is not theirs.
 */
export async function employeeConversationView(
  session: Session,
  conversationId: string,
): Promise<ConversationResponse | null> {
  const conversation = await getEmployeeConversation(conversationId, session.user.userId)
  if (!conversation) return null

  const [messages, drafts] = await Promise.all([listMessages(conversationId), listDrafts(conversationId)])
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
  return { conversation, messages, drafts, tickets, authors: await authorsOf(messages) }
}
