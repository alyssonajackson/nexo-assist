import type { RequestContext } from '@mastra/core/request-context'
import type { Draft, DraftKind, NewTicketInput, TicketsClient, Transfer } from '@nexo/shared'
import { TurnRecorder } from './recorder'

/** The authenticated employee. Always comes from the verified session, never from model output. */
export type AgentUser = { id: string; name: string }

/** Read side of the tickets service. The client carries the user's access token, so privacy is enforced there. */
export type AgentTickets = Pick<TicketsClient, 'listTickets' | 'getTicket' | 'findDuplicates' | 'searchKb'>

export type ProposedDraft = {
  conversationId: string
  employeeId: string
  kind: DraftKind
  ticketId?: string
  fields?: NewTicketInput
  note?: string
}

/** Pending drafts live in the `assist` db. The agent can only propose; committing needs the employee's click. */
export interface DraftStore {
  /** Saves a `pending` draft (and cancels older pending drafts of the conversation). */
  propose(draft: ProposedDraft): Promise<Draft>
  cancel(draftId: string): Promise<void>
}

export interface Handoff {
  /** Atomically moves the conversation from `agent` to `waiting_analyst`. False if it was not with the agent. */
  transfer(conversationId: string, transfer: Omit<Transfer, 'at'>): Promise<boolean>
}

export type AgentPorts = { tickets: AgentTickets; drafts: DraftStore; handoff: Handoff }

/** Everything a tool needs for one turn, passed through Mastra's RequestContext. */
export type TurnContext = {
  user: AgentUser
  conversationId: string
  now: Date
  ports: AgentPorts
  recorder: TurnRecorder
}

export const TURN_KEY = 'turn'

const isTurnContext = (v: unknown): v is TurnContext =>
  typeof v === 'object' && v !== null && 'recorder' in v && v.recorder instanceof TurnRecorder

export function turnOf(requestContext: RequestContext | undefined): TurnContext {
  const turn = requestContext?.get(TURN_KEY)
  if (!isTurnContext(turn)) throw new Error('Agent tools need a turn context (runTurn sets it)')
  return turn
}
