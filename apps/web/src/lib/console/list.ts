import type { ConsoleCounts, ConsoleFilter, ConsoleItem } from '@nexo/shared'
import { formatConfidence } from '@/lib/chat/format'

/**
 * The console list as pure functions: tabs, counts, search and the status line under each row.
 * The API applies them on the server; the UI reuses `statusLine` and `statePill`.
 */

const matchesFilter = (item: ConsoleItem, filter: ConsoleFilter, analystId: string): boolean => {
  const { state, assignedAnalystId } = item.conversation
  switch (filter) {
    case 'all':
      return true
    case 'waiting':
      return state === 'waiting_analyst'
    case 'agent':
      return state === 'agent'
    case 'mine':
      return state === 'analyst' && assignedAnalystId === analystId
  }
}

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()

/** Search by employee name or ticket id (the transferred one or any related one). */
export function matchesQuery(item: ConsoleItem, query: string): boolean {
  const q = normalize(query)
  if (!q) return true
  const { transfer, relatedTicketIds } = item.conversation
  const ticketIds = [...(transfer?.ticketId ? [transfer.ticketId] : []), ...relatedTicketIds]
  return normalize(item.employee.name).includes(q) || ticketIds.some((id) => normalize(id).includes(q))
}

export function filterItems(
  items: ConsoleItem[],
  filter: ConsoleFilter,
  query: string,
  analystId: string,
): ConsoleItem[] {
  return items.filter((i) => matchesFilter(i, filter, analystId) && matchesQuery(i, query))
}

/** Tab counts ignore the search box, like the prototype's badges. */
export function countItems(items: ConsoleItem[], analystId: string): ConsoleCounts {
  const count = (filter: ConsoleFilter) => items.filter((i) => matchesFilter(i, filter, analystId)).length
  return { all: items.length, waiting: count('waiting'), agent: count('agent'), mine: count('mine') }
}

export type StatusTone = 'danger' | 'warning' | 'success' | 'info' | 'neutral'

/** "Transferida · INC-20311", "Agent pediu ajuda · confiança 41%", "Você está atendendo", … */
export function statusLine(item: ConsoleItem, analystId: string): { text: string; tone: StatusTone } {
  const { state, transfer, assignedAnalystId } = item.conversation
  switch (state) {
    case 'waiting_analyst': {
      if (transfer?.reason === 'low_confidence') {
        const confidence =
          item.lastConfidence === undefined ? '' : ` · confiança ${formatConfidence(item.lastConfidence)}`
        return { text: `Agent pediu ajuda${confidence}`, tone: 'warning' }
      }
      return { text: `Transferida${transfer?.ticketId ? ` · ${transfer.ticketId}` : ''}`, tone: 'danger' }
    }
    case 'analyst':
      return assignedAnalystId === analystId
        ? { text: 'Você está atendendo', tone: 'info' }
        : { text: 'Com outro analista', tone: 'info' }
    case 'agent':
      return { text: 'Agent atendendo', tone: 'success' }
    case 'closed':
      return { text: transfer ? 'Encerrada' : 'Resolvida pelo agent', tone: 'neutral' }
  }
}

/** The pill in the conversation header. */
export function statePill(
  item: Pick<ConsoleItem, 'conversation'>,
  analystId: string,
): { text: string; tone: StatusTone } {
  const { state, assignedAnalystId } = item.conversation
  switch (state) {
    case 'waiting_analyst':
      return { text: 'Aguardando atendente', tone: 'warning' }
    case 'analyst':
      return {
        text: assignedAnalystId === analystId ? 'Você está atendendo' : 'Com outro analista',
        tone: 'info',
      }
    case 'agent':
      return { text: 'Com o agent', tone: 'success' }
    case 'closed':
      return { text: 'Encerrada', tone: 'neutral' }
  }
}
