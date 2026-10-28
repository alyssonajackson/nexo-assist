import 'server-only'
import { afterCommit } from '@nexo/agent'
import {
  TicketsHttpError,
  TicketsUnavailableError,
  type Decision,
  type Draft,
  type DraftKind,
  type Intent,
  type RuleOverride,
  type TicketWriteMessage,
} from '@nexo/shared'
import { queues } from '../queues'
import type { Session } from '../session'
import { actorOf } from './chat'
import { addRelatedTickets, getConversation } from './conversations'
import { getDraft, moveDraft } from './drafts'
import { transferToAnalyst } from './handoff'
import { appendMessage } from './messages'
import { ticketsAs, type Emit } from './runtime'

export class DraftError extends Error {
  constructor(
    readonly code: 'not_found' | 'not_pending' | 'not_confirmed',
    message: string,
  ) {
    super(message)
  }
}

const INTENT_BY_KIND: Record<DraftKind, Intent> = {
  create: 'ticket_create',
  update: 'ticket_update',
  reopen: 'ticket_reopen',
}

/** The step after "Confirmar" is deterministic, so its Decision is built by code (confidence 1). */
function codeDecision(
  draft: Draft,
  ticketId: string | undefined,
  reason: string,
  overrides: RuleOverride[],
): Decision {
  return {
    intent: INTENT_BY_KIND[draft.kind],
    extracted: {
      ...(ticketId ? { ticketId } : {}),
      ...(draft.fields
        ? { type: draft.fields.type, category: draft.fields.category, priority: draft.fields.priority }
        : {}),
    },
    action: 'commit_draft',
    confidence: 1,
    reason,
    toolsCalled: [],
    ruleOverrides: overrides,
    source: 'code',
  }
}

/**
 * "Confirmar": pending -> confirmed (atomic, so a double click confirms once), then commitDraft.
 * Only this endpoint confirms; typed text never does.
 */
export async function confirmDraft(session: Session, draftId: string, emit: Emit): Promise<void> {
  const existing = await getDraft(draftId, session.user.userId)
  if (!existing) throw new DraftError('not_found', `Rascunho ${draftId} não encontrado.`)
  const confirmed = await moveDraft(draftId, ['pending'], 'confirmed', { confirmedAt: new Date() })
  if (!confirmed)
    throw new DraftError('not_pending', `O rascunho ${draftId} já foi ${STATUS_TEXT[existing.status]}.`)
  emit({ type: 'draft', draft: confirmed })
  await commitDraft(session, confirmed, emit)
  const conv = await getConversation(confirmed.conversationId)
  if (conv) emit({ type: 'conversation', conversation: conv })
}

export async function cancelDraft(session: Session, draftId: string): Promise<Draft> {
  const existing = await getDraft(draftId, session.user.userId)
  if (!existing) throw new DraftError('not_found', `Rascunho ${draftId} não encontrado.`)
  const cancelled = await moveDraft(draftId, ['pending'], 'cancelled')
  if (!cancelled)
    throw new DraftError('not_pending', `O rascunho ${draftId} já foi ${STATUS_TEXT[existing.status]}.`)
  return cancelled
}

const STATUS_TEXT: Record<Draft['status'], string> = {
  pending: 'aberto',
  confirmed: 'confirmado',
  committed: 'registrado',
  pending_registration: 'confirmado e aguarda registro',
  cancelled: 'cancelado',
  failed: 'recusado pelo sistema de chamados',
}

/**
 * Writes a CONFIRMED draft to the tickets service. Refuses anything else: the agent can never reach
 * this. The draft id is the idempotency key, so retries and the queue can never create a duplicate.
 *
 * - success: the employee sees the real ticket number right away;
 * - still down after the retries: the write goes to SQS, the draft becomes pending_registration and
 *   the assist-events consumer finishes it when the system is back;
 * - a business rejection (e.g. reopen window expired meanwhile): the draft fails, with the reason.
 */
export async function commitDraft(session: Session, draft: Draft, emit: Emit): Promise<void> {
  if (draft.status !== 'confirmed') {
    throw new DraftError(
      'not_confirmed',
      `O rascunho ${draft.id} precisa ser confirmado antes de ser registrado.`,
    )
  }
  const tickets = ticketsAs(session.accessToken, emit)
  const say = (text: string, decision: Decision, ticketId?: string) =>
    appendMessage({
      conversationId: draft.conversationId,
      role: 'agent',
      text,
      parts: ticketId ? [{ type: 'ticket', ticketId }] : [{ type: 'draft', draftId: draft.id }],
      decision,
    })

  try {
    const { ticket } =
      draft.kind === 'create' && draft.fields
        ? await tickets.createTicket({ ...draft.fields, requesterName: session.profile.name }, draft.id)
        : draft.kind === 'update' && draft.ticketId
          ? await tickets.addUpdate(draft.ticketId, draft.note ?? '', draft.id)
          : draft.kind === 'reopen' && draft.ticketId
            ? await tickets.reopen(draft.ticketId, draft.note ?? '', draft.id)
            : invalid(draft)
    const committed = await moveDraft(draft.id, ['confirmed'], 'committed', {
      resultTicketId: ticket.id,
      committedAt: new Date(),
    })
    if (committed) emit({ type: 'draft', draft: committed })
    await addRelatedTickets(draft.conversationId, [ticket.id])

    const critical = afterCommit(draft, ticket.id, session.profile.name)
    const text = {
      create: `Pronto! Chamado ${ticket.id} registrado.`,
      update: `Pronto! Atualização registrada no ${ticket.id}.`,
      reopen: `Pronto! O ${ticket.id} foi reaberto.`,
    }[draft.kind]
    const reason = `O funcionário confirmou o rascunho ${draft.id}.`
    const overrides = critical.override ? [critical.override] : []
    emit({
      type: 'message',
      message: await say(text, codeDecision(draft, ticket.id, reason, overrides), ticket.id),
    })
    if (critical.transfer) await transferAndAnnounce(session, draft.conversationId, critical.transfer, emit)
  } catch (err) {
    if (err instanceof TicketsUnavailableError) return deferWrite(session, draft, emit)
    if (err instanceof TicketsHttpError) {
      const failed = await moveDraft(draft.id, ['confirmed'], 'failed')
      if (failed) emit({ type: 'draft', draft: failed })
      const reason = `O sistema de chamados recusou o rascunho ${draft.id}: ${err.message}`
      emit({
        type: 'message',
        message: await say(
          `Não consegui registrar: ${err.message}`,
          codeDecision(draft, undefined, reason, []),
        ),
      })
      return
    }
    throw err
  }
}

/** Ticket system still down after the retries: queue the confirmed write (SQS) and tell the employee. */
async function deferWrite(session: Session, draft: Draft, emit: Emit): Promise<void> {
  const base = {
    idempotencyKey: draft.id,
    draftId: draft.id,
    conversationId: draft.conversationId,
    actor: actorOf(session),
    enqueuedAt: new Date(),
  }
  const message: TicketWriteMessage =
    draft.kind === 'create' && draft.fields
      ? { op: 'create', input: draft.fields, ...base }
      : draft.kind === 'update' && draft.ticketId
        ? { op: 'update', ticketId: draft.ticketId, note: draft.note ?? '', ...base }
        : draft.kind === 'reopen' && draft.ticketId
          ? { op: 'reopen', ticketId: draft.ticketId, reason: draft.note ?? '', ...base }
          : invalid(draft)
  try {
    await queues().ticketWrites.send(message)
  } catch (err) {
    // Neither the ticket system nor the queue: give the draft back so the employee can try again.
    console.error('commit: could not enqueue the deferred write', err)
    const back = await moveDraft(draft.id, ['confirmed'], 'pending')
    if (back) emit({ type: 'draft', draft: back })
    throw err
  }
  const pending = await moveDraft(draft.id, ['confirmed'], 'pending_registration')
  if (pending) emit({ type: 'draft', draft: pending })
  emit({
    type: 'status',
    status: 'tickets_queued',
    message:
      'Sistema de chamados indisponível. Seu pedido foi guardado e será registrado assim que ele voltar.',
  })

  const critical = afterCommit(draft, undefined, session.profile.name)
  const reason = `O funcionário confirmou o rascunho ${draft.id}; o sistema de chamados está fora do ar, então o registro foi para a fila.`
  emit({
    type: 'message',
    message: await appendMessage({
      conversationId: draft.conversationId,
      role: 'agent',
      text: 'O sistema de chamados está indisponível agora. Seu pedido foi guardado (pendente de registro) e eu aviso aqui com o número assim que ele for registrado.',
      parts: [{ type: 'draft', draftId: draft.id }],
      decision: codeDecision(draft, undefined, reason, critical.override ? [critical.override] : []),
    }),
  })
  if (critical.transfer) await transferAndAnnounce(session, draft.conversationId, critical.transfer, emit)
}

async function transferAndAnnounce(
  session: Session,
  conversationId: string,
  transfer: Parameters<typeof transferToAnalyst>[1],
  emit: Emit,
) {
  const conv = await transferToAnalyst(conversationId, transfer, actorOf(session))
  if (conv) emit({ type: 'conversation', conversation: conv })
}

function invalid(draft: Draft): never {
  throw new Error(`Draft ${draft.id} is missing the fields for a ${draft.kind}`)
}
