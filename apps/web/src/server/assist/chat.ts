import 'server-only'
import { runTurn, type AgentPorts } from '@nexo/agent'
import {
  MAX_EMPLOYEE_MESSAGES,
  type Actor,
  type ChatRequest,
  type Conversation,
  type Transfer,
} from '@nexo/shared'
import type { Session } from '../session'
import {
  addRelatedTickets,
  countEmployeeMessage,
  createConversation,
  getConversation,
  getEmployeeConversation,
  latestOpenConversation,
} from './conversations'
import { draftStore } from './drafts'
import { announceTransfer, moveToWaitingAnalyst } from './handoff'
import { appendMessage, listMessages, systemMessage } from './messages'
import { assistAgent, llmModelId, ticketsAs, type Emit } from './runtime'

export class ChatError extends Error {
  constructor(
    readonly code: 'not_found' | 'message_limit' | 'closed',
    message: string,
  ) {
    super(message)
  }
}

export const actorOf = (session: Session): Actor => ({
  userId: session.user.userId,
  role: session.user.role,
  name: session.profile.name,
})

/** The conversation the employee is writing to: the one asked for, the latest open one, or a new one. */
async function resolveConversation(session: Session, conversationId?: string): Promise<Conversation> {
  const employeeId = session.user.userId
  if (conversationId) {
    const conv = await getEmployeeConversation(conversationId, employeeId)
    if (!conv) throw new ChatError('not_found', 'Conversa não encontrada.')
    return conv
  }
  return (await latestOpenConversation(employeeId)) ?? createConversation(employeeId)
}

/**
 * One employee message. Code decides whether the agent runs at all: the message limit is checked
 * atomically, and the agent is called only while the conversation is with the agent (state 'agent').
 * During a handoff the message is stored for the analyst and the agent stays silent.
 */
export async function sendMessage(session: Session, req: ChatRequest, emit: Emit): Promise<void> {
  const conv = await resolveConversation(session, req.conversationId)
  if (conv.state === 'closed')
    throw new ChatError('closed', 'Esta conversa foi encerrada. Comece uma nova conversa.')
  const counted = await countEmployeeMessage(conv.id, session.user.userId)
  if (!counted) {
    throw new ChatError(
      'message_limit',
      `Você chegou ao limite de ${MAX_EMPLOYEE_MESSAGES} mensagens nesta conversa. Comece uma nova conversa.`,
    )
  }

  const history = await listMessages(conv.id)
  const employeeMessage = await appendMessage({
    conversationId: conv.id,
    role: 'employee',
    authorId: session.user.userId,
    text: req.text,
    parts: [],
  })
  emit({ type: 'employee_message', message: employeeMessage })

  // Handoff silence, enforced here and not in the prompt.
  if (counted.state !== 'agent') {
    emit({ type: 'conversation', conversation: counted })
    return
  }

  // The transfer is applied atomically mid-turn; its divider is written after the agent's reply.
  let transferred: Omit<Transfer, 'at'> | undefined
  const ports: AgentPorts = {
    tickets: ticketsAs(session.accessToken, emit),
    drafts: draftStore,
    handoff: {
      async transfer(conversationId, transfer) {
        const ok = (await moveToWaitingAnalyst(conversationId, transfer)) !== null
        if (ok) transferred = transfer
        return ok
      },
    },
  }

  const result = await runTurn({
    agent: assistAgent(),
    modelId: llmModelId(),
    user: { id: session.user.userId, name: session.profile.name },
    conversationId: conv.id,
    history,
    text: req.text,
    ports,
    onEvent: (e) => emit(e),
  })

  const agentMessage = await appendMessage({
    conversationId: conv.id,
    role: 'agent',
    text: result.reply,
    parts: result.parts,
    decision: result.decision,
  })
  emit({ type: 'message', message: agentMessage })

  // A rule that changed the model's action leaves a note in the chat (the panel has the details).
  for (const o of result.decision.ruleOverrides.filter((x) => x.to && x.to !== 'transfer_to_analyst')) {
    emit({ type: 'message', message: await systemMessage(conv.id, `Regra aplicada: ${o.why}`) })
  }
  if (transferred) {
    emit({ type: 'message', message: await announceTransfer(conv.id, transferred, actorOf(session)) })
  }

  const ticketIds = result.parts.flatMap((p) =>
    p.type === 'ticket' ? [p.ticketId] : p.type === 'ticket_list' ? p.ticketIds : [],
  )
  await addRelatedTickets(conv.id, ticketIds)
  const latest = await getConversation(conv.id)
  if (latest) emit({ type: 'conversation', conversation: latest })
}
