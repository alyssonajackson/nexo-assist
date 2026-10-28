import { describe, expect, it } from 'vitest'
import type { ConsoleItem, Conversation } from '@nexo/shared'
import { countItems, filterItems, statePill, statusLine } from './list'

const ME = 'analyst-1'
const at = new Date('2026-10-28T10:00:00Z')

function item(
  name: string,
  conv: Partial<Conversation>,
  extra: Partial<Omit<ConsoleItem, 'conversation'>> = {},
): ConsoleItem {
  return {
    conversation: {
      id: name,
      employeeId: name,
      state: 'agent',
      relatedTicketIds: [],
      employeeMessageCount: 1,
      lastMessageAt: at,
      preview: '',
      createdAt: at,
      ...conv,
    },
    employee: { id: name, name, department: 'TI' },
    unread: 0,
    ...extra,
  }
}

const transfer = (o: Partial<NonNullable<Conversation['transfer']>> = {}) => ({
  reason: 'employee_request' as const,
  summary: 's',
  at,
  by: 'agent' as const,
  ...o,
})

const items = [
  item('Carla Mendes', { state: 'waiting_analyst', transfer: transfer({ ticketId: 'REQ-10501' }) }),
  item(
    'Bruno Tavares',
    { state: 'waiting_analyst', transfer: transfer({ reason: 'low_confidence' }) },
    { lastConfidence: 0.41 },
  ),
  item('Diego Ramos', { state: 'agent', relatedTicketIds: ['INC-20001'] }),
  item('Ana Souza', { state: 'analyst', assignedAnalystId: ME, transfer: transfer() }),
  item('Elisa Prado', { state: 'analyst', assignedAnalystId: 'other' }),
  item('Fábio Nunes', { state: 'closed' }),
]

describe('console list', () => {
  it('counts every tab', () => {
    expect(countItems(items, ME)).toEqual({ all: 6, waiting: 2, agent: 1, mine: 1 })
  })

  it('filters by tab', () => {
    const names = (f: Parameters<typeof filterItems>[1]) =>
      filterItems(items, f, '', ME).map((i) => i.employee.name)
    expect(names('waiting')).toEqual(['Carla Mendes', 'Bruno Tavares'])
    expect(names('agent')).toEqual(['Diego Ramos'])
    expect(names('mine')).toEqual(['Ana Souza'])
    expect(names('all')).toHaveLength(6)
  })

  it('searches by employee name (accent-insensitive) or ticket id', () => {
    const found = (q: string) => filterItems(items, 'all', q, ME).map((i) => i.employee.name)
    expect(found('fabio')).toEqual(['Fábio Nunes'])
    expect(found('req-10501')).toEqual(['Carla Mendes'])
    expect(found('20001')).toEqual(['Diego Ramos'])
    expect(found('zzz')).toEqual([])
  })

  it('combines tab and search', () => {
    expect(filterItems(items, 'waiting', 'bruno', ME)).toHaveLength(1)
    expect(filterItems(items, 'agent', 'bruno', ME)).toHaveLength(0)
  })

  it('writes the status line', () => {
    const line = (i: number) => statusLine(items[i]!, ME)
    expect(line(0)).toEqual({ text: 'Transferida · REQ-10501', tone: 'danger' })
    expect(line(1)).toEqual({ text: 'Agent pediu ajuda · confiança 41%', tone: 'warning' })
    expect(line(2)).toEqual({ text: 'Agent atendendo', tone: 'success' })
    expect(line(3).text).toBe('Você está atendendo')
    expect(line(4).text).toBe('Com outro analista')
    expect(line(5).text).toBe('Resolvida pelo agent')
  })

  it('names the header pill', () => {
    expect(statePill(items[0]!, ME).text).toBe('Aguardando atendente')
    expect(statePill(items[3]!, ME).text).toBe('Você está atendendo')
  })
})
