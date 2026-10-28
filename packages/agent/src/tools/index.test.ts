import { describe, expect, it } from 'vitest'
import { agentTools } from './index'

describe('agentTools', () => {
  it('reads, classifies, proposes and transfers; nothing writes a ticket', () => {
    expect(Object.keys(agentTools).sort()).toEqual([
      'classify_priority',
      'get_ticket',
      'list_my_tickets',
      'propose_draft',
      'propose_reopen',
      'propose_update',
      'search_kb',
      'transfer_to_analyst',
    ])
    // Each key is the tool's own id, so the model sees exactly these names.
    for (const [name, tool] of Object.entries(agentTools)) expect(tool.id).toBe(name)
  })
})
