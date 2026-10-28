import { proposeDraft, proposeReopen, proposeUpdate } from './drafts'
import { searchKb } from './kb'
import { classifyPriority } from './priority'
import { getTicket, listMyTickets } from './tickets'
import { transferToAnalyst } from './transfer'

/** Read tools, the priority matrix, proposals and the handoff. There is no tool that writes a ticket. */
export const agentTools = {
  search_kb: searchKb,
  list_my_tickets: listMyTickets,
  get_ticket: getTicket,
  classify_priority: classifyPriority,
  propose_draft: proposeDraft,
  propose_update: proposeUpdate,
  propose_reopen: proposeReopen,
  transfer_to_analyst: transferToAnalyst,
}
