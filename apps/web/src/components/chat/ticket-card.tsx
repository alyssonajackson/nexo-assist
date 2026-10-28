import { CATEGORY_LABELS, isOpenStatus, type TicketView } from '@nexo/shared'
import { daysAgo, formatDateTime, formatDeadline } from '@/lib/chat/format'
import { Card, CardEyebrow, CardField } from './card'
import { PriorityLabel, TicketStatusDot } from './status-dot'

/** Screen 3: one ticket with its SLA situation ("há 5 dias · prazo vencido"). */
export function TicketCard({ ticket, now }: { ticket: TicketView; now: Date }) {
  const category = CATEGORY_LABELS[ticket.category] + (ticket.subcategory ? ` › ${ticket.subcategory}` : '')
  return (
    <Card>
      <div className="px-[18px] pt-4 pb-3.5">
        <CardEyebrow kind="Chamado" id={ticket.id} right={<TicketStatusDot status={ticket.status} />} />
        <h3 className="mt-1.5 text-[17px] font-semibold text-ink">{ticket.title}</h3>
        <p className="mt-1.5 line-clamp-3 text-[14px]/[21px] text-ink-soft">{ticket.description}</p>
        <dl className="mt-3.5 grid grid-cols-4 gap-4 border-t border-border pt-3.5">
          <CardField label="Categoria">{category}</CardField>
          <CardField label="Prioridade">
            <PriorityLabel priority={ticket.priority} />
          </CardField>
          <CardField label="Aberto em">{formatDateTime(ticket.createdAt)}</CardField>
          <CardField label="Última atualização">
            <LastUpdate ticket={ticket} now={now} />
          </CardField>
        </dl>
      </div>
    </Card>
  )
}

function LastUpdate({ ticket, now }: { ticket: TicketView; now: Date }) {
  const ago = daysAgo(ticket.updatedAt, now)
  if (ticket.sla.overdue) {
    return (
      <>
        <span className="text-warning-700">{ago}</span>
        <span className="text-[12.5px] text-ink-muted"> · prazo vencido</span>
      </>
    )
  }
  const note =
    isOpenStatus(ticket.status) && ticket.sla.dueAt
      ? `prazo até ${formatDeadline(ticket.sla.dueAt, now)}`
      : ticket.sla.reopenable
        ? 'pode ser reaberto'
        : undefined
  return (
    <>
      {ago}
      {note && <span className="text-[12.5px] text-ink-muted"> · {note}</span>}
    </>
  )
}
