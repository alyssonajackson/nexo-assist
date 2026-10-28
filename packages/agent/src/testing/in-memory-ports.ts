import type { ConversationState, Draft, Transfer } from '@nexo/shared'
import type { AgentPorts, DraftStore, Handoff } from '../context'
import { createFakeTickets } from './fake-tickets'

export class InMemoryDrafts implements DraftStore {
  readonly drafts = new Map<string, Draft>()
  private seq = 380

  async propose(input: Parameters<DraftStore['propose']>[0]): Promise<Draft> {
    for (const d of this.drafts.values()) {
      if (d.conversationId === input.conversationId && d.status === 'pending') d.status = 'cancelled'
    }
    const draft: Draft = { ...input, id: `D-${++this.seq}`, status: 'pending', createdAt: new Date() }
    this.drafts.set(draft.id, draft)
    return draft
  }

  async cancel(draftId: string): Promise<void> {
    const d = this.drafts.get(draftId)
    if (d?.status === 'pending') d.status = 'cancelled'
  }
}

export class InMemoryHandoff implements Handoff {
  state: ConversationState = 'agent'
  transfers: Omit<Transfer, 'at'>[] = []

  async transfer(_conversationId: string, transfer: Omit<Transfer, 'at'>): Promise<boolean> {
    if (this.state !== 'agent') return false
    this.state = 'waiting_analyst'
    this.transfers.push(transfer)
    return true
  }
}

export function createInMemoryPorts(userId: string, now: Date) {
  const drafts = new InMemoryDrafts()
  const handoff = new InMemoryHandoff()
  const tickets = createFakeTickets(userId, now)
  const ports: AgentPorts = { tickets, drafts, handoff }
  return { ports, drafts, handoff, tickets }
}
