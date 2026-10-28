import type { TicketView } from '@nexo/shared'
import { formatShortDate } from '@/lib/chat/format'
import { Card } from './card'
import { TicketStatusDot } from './status-dot'

type TicketListCardProps = {
  ticketIds: string[]
  tickets: Record<string, TicketView>
  /** The ticket the employee picked (from the next message), if any. */
  selectedId?: string
  /** Only the latest message's list is clickable. */
  disabled: boolean
  onPick: (ticket: TicketView) => void
}

/** Screen 3: the employee's tickets as a radio list; picking one sends "INC-20311 · title". */
export function TicketListCard({ ticketIds, tickets, selectedId, disabled, onPick }: TicketListCardProps) {
  return (
    <Card>
      <div role="radiogroup" aria-label="Seus chamados" className="divide-y divide-border">
        {ticketIds.map((id) => {
          const ticket = tickets[id]
          const selected = id === selectedId
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled || !ticket}
              onClick={() => ticket && onPick(ticket)}
              className={`flex h-[46px] w-full items-center gap-3 px-4 text-left enabled:hover:bg-surface-muted disabled:cursor-default ${
                selected ? 'bg-primary-600/5' : ''
              }`}
            >
              <Radio checked={selected} />
              <span className="w-[82px] shrink-0 text-[13px] text-ink-muted">{id}</span>
              <span className="min-w-0 flex-1 truncate text-[14.5px] text-ink">
                {ticket?.title ?? <span className="text-ink-muted">Carregando…</span>}
              </span>
              {ticket && (
                <>
                  <TicketStatusDot status={ticket.status} muted />
                  <span className="w-[46px] shrink-0 text-right text-[12.5px] text-ink-muted">
                    {formatShortDate(ticket.createdAt)}
                  </span>
                </>
              )}
            </button>
          )
        })}
      </div>
    </Card>
  )
}

function Radio({ checked }: { checked: boolean }) {
  return checked ? (
    <span className="grid size-4 shrink-0 place-items-center rounded-full bg-primary-600" aria-hidden="true">
      <span className="size-1.5 rounded-full bg-white" />
    </span>
  ) : (
    <span className="size-4 shrink-0 rounded-full border-[1.5px] border-ink/25" aria-hidden="true" />
  )
}
