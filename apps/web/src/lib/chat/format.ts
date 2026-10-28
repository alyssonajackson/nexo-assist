import { BUSINESS_CALENDAR, CONFIDENCE, slaDueAt, type Priority } from '@nexo/shared'

/** Every date in the UI is shown in the service desk's time zone, wherever the browser is. */
const TZ = BUSINESS_CALENDAR.timeZone

const parts = (d: Date, opts: Intl.DateTimeFormatOptions) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, ...opts })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  )

/** "16 out" */
export function formatShortDate(d: Date): string {
  const p = parts(d, { day: '2-digit', month: 'short' })
  return `${p.day} ${String(p.month).replace('.', '')}`
}

/** "13:43" */
export function formatTime(d: Date): string {
  const p = parts(d, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return `${p.hour}:${p.minute}`
}

/** "16 out, 14:20" */
export function formatDateTime(d: Date): string {
  return `${formatShortDate(d)}, ${formatTime(d)}`
}

const dayKey = (d: Date) => {
  const p = parts(d, { year: 'numeric', month: '2-digit', day: '2-digit' })
  return `${p.year}-${p.month}-${p.day}`
}

/** "13:43" when it is today, "29 out, 10:00" otherwise. */
export function formatDeadline(due: Date, now: Date): string {
  return dayKey(due) === dayKey(now) ? formatTime(due) : formatDateTime(due)
}

/** The draft card's promise: "resposta até 13:43" (SLA counted from now, Annex A). */
export function slaPromise(priority: Priority, now: Date): string {
  return `resposta até ${formatDeadline(slaDueAt(priority, now), now)}`
}

/** "hoje", "ontem", "há 5 dias" (calendar days in the service desk's time zone). */
export function daysAgo(d: Date, now: Date): string {
  const days = Math.round((Date.parse(dayKey(now)) - Date.parse(dayKey(d))) / 86_400_000)
  if (days <= 0) return 'hoje'
  if (days === 1) return 'ontem'
  return `há ${days} dias`
}

/** 0.864 -> "86%" */
export function formatConfidence(confidence: number): string {
  return `${Math.round(Math.min(1, Math.max(0, confidence)) * 100)}%`
}

export type ConfidenceLevel = 'low' | 'medium' | 'high'

/** Same thresholds the policy enforces: below 50% transfers, below 70% asks before any draft. */
export function confidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence < CONFIDENCE.transferBelow) return 'low'
  if (confidence < CONFIDENCE.clarifyBelow) return 'medium'
  return 'high'
}

/** 320 -> "320 ms", 1840 -> "1,8 s" */
export function formatMs(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1).replace('.', ',')} s`
}
