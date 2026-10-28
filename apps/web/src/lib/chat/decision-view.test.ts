import { describe, expect, it } from 'vitest'
import { ACTION_LABELS, INTENT_LABELS } from '@nexo/shared'
import { decisionLabel, extractedRows, intentLabel } from './decision-view'

describe('extractedRows', () => {
  it('returns nothing for empty extracted fields', () => {
    expect(extractedRows({})).toEqual([])
  })
  it('formats values in PT-BR', () => {
    const rows = extractedRows({
      type: 'INC',
      category: 'network_vpn',
      affected: 'self',
      priority: 'high',
    })
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ['Tipo', 'Incidente (INC)'],
      ['Categoria', 'Rede e VPN'],
      ['Prioridade', 'Alta'],
      ['Afetados', 'Somente você'],
    ])
  })
  it('keeps the display order regardless of the input key order', () => {
    const rows = extractedRows({ description: 'd', priority: 'low', title: 't', ticketId: 'INC-20311' })
    expect(rows.map((r) => r.key)).toEqual(['ticketId', 'title', 'priority', 'description'])
  })
  it('shows booleans as Sim/Não, including false', () => {
    const rows = extractedRows({ sameDayCommitment: true, hasWorkaround: false })
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ['Compromisso hoje', 'Sim'],
      ['Tem alternativa', 'Não'],
    ])
  })
  it('joins KB article ids and drops an empty list', () => {
    expect(extractedRows({ kbArticleIds: ['KB-1', 'KB-2'] })[0]?.value).toBe('KB-1, KB-2')
    expect(extractedRows({ kbArticleIds: [] })).toEqual([])
  })
})

describe('decisionLabel', () => {
  it('labels action names', () => {
    expect(decisionLabel('propose_draft')).toBe(ACTION_LABELS.propose_draft)
  })
  it('labels intent names', () => {
    expect(decisionLabel('ticket_lookup')).toBe(INTENT_LABELS.ticket_lookup)
  })
  it('passes unknown names through', () => {
    expect(decisionLabel('something_else')).toBe('something_else')
  })
  it('is undefined for undefined', () => {
    expect(decisionLabel(undefined)).toBeUndefined()
  })
})

describe('intentLabel', () => {
  it('labels known intents, passes unknown through and handles undefined', () => {
    expect(intentLabel('kb_question')).toBe(INTENT_LABELS.kb_question)
    expect(intentLabel('whatever')).toBe('whatever')
    expect(intentLabel(undefined)).toBeUndefined()
  })
})
