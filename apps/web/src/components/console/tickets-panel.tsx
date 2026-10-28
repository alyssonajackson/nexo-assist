import { ChevronRight, Repeat, Headset, X } from 'lucide-react'
import { CATEGORY_LABELS, PRIORITY_LABELS, STATUS_LABELS, isOpenStatus, type TicketView } from '@nexo/shared'
import { formatShortDate, formatTime } from '@/lib/chat/format'
import { latestEntry, timelineLine } from '@/lib/console/timeline'
import { StatusDot, STATUS_TONES } from '../chat/status-dot'

const firstName = (name: string) => name.split(' ')[0] ?? name

type Props = {
  employeeName: string
  tickets: TicketView[]
  currentTicketId: string | undefined
  unavailable: boolean
  onClose: () => void
}

/** Right pane: "Chamados da Ana · 3 abertos · 2 encerrados", the ticket of this conversation, then the others. */
export function TicketsPanel({ employeeName, tickets, currentTicketId, unavailable, onClose }: Props) {
  const current = tickets.find((t) => t.id === currentTicketId)
  const others = tickets.filter((t) => t.id !== currentTicketId)
  const open = tickets.filter((t) => isOpenStatus(t.status)).length
  return (
    <aside
      aria-label="Chamados do colaborador"
      className="flex h-full w-[360px] shrink-0 flex-col border-l border-border bg-surface"
    >
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border px-6">
        <div className="flex-1">
          <h2 className="text-[16px] font-semibold text-ink">Chamados da {firstName(employeeName)}</h2>
          <p className="text-[12.5px] text-ink-muted">
            {open} {open === 1 ? 'aberto' : 'abertos'} · {tickets.length - open}{' '}
            {tickets.length - open === 1 ? 'encerrado' : 'encerrados'}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Fechar painel"
          className="rounded-md p-1.5 text-ink-muted hover:bg-surface-muted"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {unavailable && (
          <p
            role="alert"
            className="mb-4 rounded-lg bg-warning-bg px-3.5 py-2.5 text-[13px] text-warning-ink"
          >
            Sistema de chamados indisponível, tentando novamente…
          </p>
        )}
        {current && (
          <>
            <h3 className="mb-3 text-[12.5px] font-medium text-ink-muted">Desta conversa</h3>
            <CurrentTicket ticket={current} />
          </>
        )}
        <h3 className="mt-6 mb-1 text-[12.5px] font-medium text-ink-muted">Outros chamados</h3>
        {others.length === 0 ? (
          <p className="py-3 text-[13px] text-ink-muted">Nenhum outro chamado.</p>
        ) : (
          <ul className="divide-y divide-border">
            {others.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-3">
                <span
                  className={`size-1.5 shrink-0 rounded-full ${isOpenStatus(t.status) ? 'bg-primary-500' : 'bg-ink/30'}`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] text-ink">{t.title}</span>
                  <span className="block text-[12.5px] text-ink-muted">
                    {t.id} · {STATUS_LABELS[t.status]}
                    {t.resolvedAt && !isOpenStatus(t.status) ? ` em ${formatShortDate(t.resolvedAt)}` : ''}
                  </span>
                </span>
                <ChevronRight className="size-4 text-ink-muted" aria-hidden="true" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}

function CurrentTicket({ ticket }: { ticket: TicketView }) {
  const last = latestEntry(ticket)
  const Icon = last?.kind === 'assumed' ? Headset : Repeat
  return (
    <article className="rounded-xl bg-surface-muted px-4 py-3.5">
      <div className="flex items-center gap-2 text-[12.5px] text-ink-muted">
        <span>{ticket.id}</span>
        <span className="flex-1" />
        <StatusDot tone={STATUS_TONES[ticket.status]} label={STATUS_LABELS[ticket.status]} />
      </div>
      <h4 className="mt-1.5 text-[16px] font-semibold text-ink">{ticket.title}</h4>
      <p className="mt-1 text-[13.5px] text-ink-muted">
        {CATEGORY_LABELS[ticket.category]} · prioridade {PRIORITY_LABELS[ticket.priority].toLowerCase()}
      </p>
      {last && (
        <p className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-[13.5px] text-ink-soft">
          <Icon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="flex-1">{timelineLine(last)}</span>
          <span className="text-ink-muted">{formatTime(last.at)}</span>
        </p>
      )}
    </article>
  )
}
