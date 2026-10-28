import { Search } from 'lucide-react'
import { CONSOLE_FILTER_LABELS, type ConsoleCounts, type ConsoleFilter, type ConsoleItem } from '@nexo/shared'
import { formatTime, formatShortDate } from '@/lib/chat/format'
import { statusLine, type StatusTone } from '@/lib/console/list'
import { Avatar } from '../shell/avatar'

const FILTERS: ConsoleFilter[] = ['all', 'waiting', 'agent', 'mine']

const TONE_TEXT: Record<StatusTone, string> = {
  danger: 'text-danger-700',
  warning: 'text-warning-700',
  success: 'text-success-700',
  info: 'text-primary-700',
  neutral: 'text-ink-muted',
}
const TONE_DOT: Record<StatusTone, string> = {
  danger: 'bg-danger-500',
  warning: 'bg-warning-500',
  success: 'bg-success-500',
  info: 'bg-primary-500',
  neutral: 'bg-ink/30',
}
const AVATAR_TONES = ['blue', 'orange', 'violet', 'green', 'gray'] as const

/** "10:05" today, "ontem" or "28 out" for older conversations. */
function listTime(d: Date, now: Date): string {
  const days = Math.round((now.getTime() - d.getTime()) / 86_400_000)
  if (formatShortDate(d) === formatShortDate(now)) return formatTime(d)
  return days <= 1 ? 'ontem' : formatShortDate(d)
}

type Props = {
  items: ConsoleItem[] | undefined
  counts: ConsoleCounts | undefined
  filter: ConsoleFilter
  onFilter: (f: ConsoleFilter) => void
  query: string
  onQuery: (q: string) => void
  selectedId: string | undefined
  onSelect: (id: string) => void
  analystId: string
}

/** Left pane of screens 4 and 5: title, search, tabs with counts, and the conversation rows. */
export function ConversationList({
  items,
  counts,
  filter,
  onFilter,
  query,
  onQuery,
  selectedId,
  onSelect,
  analystId,
}: Props) {
  const now = new Date()
  return (
    <section
      aria-label="Conversas"
      className="flex h-full w-[380px] shrink-0 flex-col border-r border-border"
    >
      <header className="flex flex-col gap-3 px-4 pt-4 pb-2.5">
        <div className="flex items-center gap-2">
          <h1 className="flex-1 text-[20px] font-bold tracking-[-0.3px] text-ink">Conversas</h1>
          <span className="flex items-center gap-1.5 rounded-pill bg-success-50 px-2.5 py-[5px] text-[12.5px] font-semibold text-success-700">
            <span className="size-[7px] rounded-full bg-success-500" aria-hidden="true" />
            Disponível
          </span>
        </div>
        <label className="flex h-9 items-center gap-2.5 rounded-pill bg-surface-muted px-3">
          <Search className="size-[15px] text-ink-muted" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Pesquisar conversa ou chamado"
            aria-label="Pesquisar conversa ou chamado"
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-muted"
          />
        </label>
        <div role="tablist" aria-label="Filtros" className="flex gap-1">
          {FILTERS.map((f) => {
            const active = f === filter
            return (
              <button
                key={f}
                role="tab"
                aria-selected={active}
                onClick={() => onFilter(f)}
                className={`flex items-center gap-1.5 rounded-pill px-[9px] py-1.5 text-[12.5px] font-medium ${
                  active ? 'bg-primary-50 text-primary-700' : 'bg-surface-muted text-ink-soft hover:bg-border'
                }`}
              >
                {CONSOLE_FILTER_LABELS[f]}
                {f !== 'all' && counts && (
                  <span className={`font-semibold ${active ? '' : 'text-ink-muted'}`}>{counts[f]}</span>
                )}
              </button>
            )
          })}
        </div>
      </header>

      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {!items && <li className="px-3 py-6 text-[13px] text-ink-muted">Carregando conversas…</li>}
        {items?.length === 0 && (
          <li className="px-3 py-6 text-[13px] text-ink-muted">Nenhuma conversa neste filtro.</li>
        )}
        {items?.map((item, i) => {
          const c = item.conversation
          const status = statusLine(item, analystId)
          const selected = c.id === selectedId
          return (
            <li key={c.id}>
              <button
                onClick={() => onSelect(c.id)}
                aria-current={selected ? 'true' : undefined}
                className={`flex w-full gap-3 rounded-lg px-3 py-3 text-left ${selected ? 'bg-surface-muted' : 'hover:bg-surface-muted/60'}`}
              >
                <Avatar
                  name={item.employee.name}
                  size="lg"
                  tone={AVATAR_TONES[i % AVATAR_TONES.length]!}
                  online={c.state !== 'closed'}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="flex-1 truncate text-[15px] font-semibold text-ink">
                      {item.employee.name}
                    </span>
                    <span
                      className={`text-[12.5px] ${item.unread > 0 ? 'font-semibold text-primary-700' : 'text-ink-muted'}`}
                    >
                      {listTime(c.lastMessageAt, now)}
                    </span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-2">
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[13.5px] text-ink-soft">
                      <span className="truncate">{c.preview || 'Sem mensagens'}</span>
                    </span>
                    {item.unread > 0 && (
                      <span
                        aria-label={`${item.unread} não lidas`}
                        className="grid h-[18px] min-w-[18px] place-items-center rounded-pill bg-primary-600 px-1 text-[11px] font-bold text-white"
                      >
                        {item.unread}
                      </span>
                    )}
                  </span>
                  <span className={`mt-1 flex items-center gap-1.5 text-[12.5px] ${TONE_TEXT[status.tone]}`}>
                    <span className={`size-1.5 rounded-full ${TONE_DOT[status.tone]}`} aria-hidden="true" />
                    {status.text}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
