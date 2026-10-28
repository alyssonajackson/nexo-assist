import { describe, expect, it } from 'vitest'
import { createAssistAgent } from '../agent'
import { runTurn } from '../run-turn'
import { demoModel } from './demo-model'
import { createInMemoryPorts } from './in-memory-ports'

async function turn(text: string) {
  const now = new Date()
  const mem = createInMemoryPorts('u-ana', now)
  const result = await runTurn({
    agent: createAssistAgent(demoModel({ delayMs: 0 })),
    modelId: 'demo',
    user: { id: 'u-ana', name: 'Ana Souza' },
    conversationId: 'demo-conv',
    history: [],
    text,
    ports: mem.ports,
    now,
  })
  const okTools = result.decision.toolsCalled.filter((c) => c.ok).map((c) => c.tool)
  return { ...mem, result, okTools }
}

describe('demoModel scripts', () => {
  it('VPN problem: searches the KB and asks who is affected', async () => {
    const { result, okTools } = await turn('Minha VPN não conecta, aparece o erro 809.')
    expect(result.decision.action).toBe('ask_clarification')
    expect(okTools).toContain('search_kb')
    expect(result.parts).toContainEqual(
      expect.objectContaining({ type: 'quick_replies', options: expect.arrayContaining(['Só eu']) }),
    )
  })

  it('"Só eu": proposes a high priority create draft', async () => {
    const { result, okTools, drafts } = await turn('Só eu')
    expect(result.decision.action).toBe('propose_draft')
    expect(okTools).toEqual(expect.arrayContaining(['classify_priority', 'propose_draft']))
    const pending = [...drafts.drafts.values()].filter((d) => d.status === 'pending')
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ kind: 'create', fields: { priority: 'high' } })
  })

  it('ticket status: lists the tickets', async () => {
    const { result } = await turn('Qual o status dos meus chamados?')
    expect(result.decision.action).toBe('list_tickets')
    expect(result.parts.some((p) => p.type === 'ticket_list')).toBe(true)
  })

  it('ticket option: shows that ticket', async () => {
    const { result } = await turn('INC-20311 · Notebook lento')
    expect(result.decision.action).toBe('show_ticket')
    expect(result.parts).toContainEqual({ type: 'ticket', ticketId: 'INC-20311' })
  })

  it('analyst request: records a transfer', async () => {
    const { result, handoff } = await turn('quero falar com um analista')
    expect(result.decision.action).toBe('transfer_to_analyst')
    expect(handoff.transfers.map((t) => t.reason)).toEqual(['employee_request'])
  })

  it('anything else: plain reply', async () => {
    const { result, drafts, handoff } = await turn('bom dia')
    expect(result.decision.action).toBe('reply')
    expect(drafts.drafts.size).toBe(0)
    expect(handoff.transfers).toEqual([])
  })
})
