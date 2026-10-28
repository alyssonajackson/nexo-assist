import { PRIORITY_LABELS, STATUS_LABELS, type Priority, type TicketStatus } from '@nexo/shared'

export type Tone = 'info' | 'warning' | 'success' | 'danger' | 'neutral'

const DOT: Record<Tone, string> = {
  info: 'bg-primary-500',
  warning: 'bg-warning-500',
  success: 'bg-success-500',
  danger: 'bg-danger-500',
  neutral: 'bg-ink/40',
}

const LABEL: Record<Tone, string> = {
  info: 'text-primary-700',
  warning: 'text-warning-700',
  success: 'text-success-700',
  danger: 'text-danger-700',
  neutral: 'text-ink-muted',
}

/** Dot + label, the prototype's status recipe. `muted` keeps the dot but uses the meta text color. */
export function StatusDot({ tone, label, muted = false }: { tone: Tone; label: string; muted?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium whitespace-nowrap">
      <span className={`size-1.5 shrink-0 rounded-full ${DOT[tone]}`} aria-hidden="true" />
      <span className={muted ? 'text-ink-muted' : LABEL[tone]}>{label}</span>
    </span>
  )
}

export const STATUS_TONES: Record<TicketStatus, Tone> = {
  open: 'info',
  in_progress: 'info',
  awaiting_analyst: 'warning',
  approved: 'success',
  resolved: 'success',
  closed: 'neutral',
}

export function TicketStatusDot({ status, muted }: { status: TicketStatus; muted?: boolean }) {
  return <StatusDot tone={STATUS_TONES[status]} label={STATUS_LABELS[status]} muted={muted ?? false} />
}

const PRIORITY_DOT: Record<Priority, string> = {
  critical: 'bg-danger-500',
  high: 'bg-warning-500',
  medium: 'bg-ink/35',
  low: 'bg-ink/20',
}

/** "● Alta" in body text size, as in the ticket and draft cards. */
export function PriorityLabel({ priority }: { priority: Priority }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`size-1.5 shrink-0 rounded-full ${PRIORITY_DOT[priority]}`} aria-hidden="true" />
      {PRIORITY_LABELS[priority]}
    </span>
  )
}
