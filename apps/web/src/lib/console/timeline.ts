import type { TicketView } from '@nexo/shared'

type Entry = TicketView['timeline'][number]

/** The latest timeline entry as the side panel shows it: "Transferido para um analista", "Assumido por Rafael Lima". */
export function timelineLine(entry: Entry): string {
  switch (entry.kind) {
    case 'transferred':
      // The stored note is the long case summary; the card only needs the fact.
      return 'Transferido para um analista'
    case 'created':
      return 'Chamado aberto'
    case 'reopened':
      return 'Chamado reaberto'
    case 'resolved':
      return 'Chamado resolvido'
    default:
      return entry.note ?? 'Atualizado'
  }
}

export const latestEntry = (ticket: TicketView): Entry | undefined =>
  [...ticket.timeline].sort((a, b) => a.at.getTime() - b.at.getTime()).at(-1)
