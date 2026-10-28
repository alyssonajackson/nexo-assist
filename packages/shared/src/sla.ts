import { TZDate } from '@date-fns/tz'
import type { Priority, Ticket } from './domain/ticket'
import { isOpenStatus } from './domain/ticket'

/**
 * Service desk calendar (KB article "Horário do service desk"):
 * Monday to Friday, 8h to 18h, America/Sao_Paulo. Critical tickets have a 24h on-call,
 * so their SLA counts calendar time. No holidays (documented trade-off).
 */
export const BUSINESS_CALENDAR = {
  timeZone: 'America/Sao_Paulo',
  openHour: 8,
  closeHour: 18,
} as const

const HOURS_PER_BUSINESS_DAY = BUSINESS_CALENDAR.closeHour - BUSINESS_CALENDAR.openHour
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const REOPEN_WINDOW_DAYS = 7

export type SlaRule =
  | { kind: 'calendar_hours'; hours: number; label: string }
  | { kind: 'business_hours'; hours: number; label: string }

/** Annex A: deadline for the first response and for each update. */
export const SLA_RULES: Record<Priority, SlaRule> = {
  critical: { kind: 'calendar_hours', hours: 1, label: '1 hora' },
  high: { kind: 'business_hours', hours: 4, label: '4 horas úteis' },
  medium: { kind: 'business_hours', hours: 3 * HOURS_PER_BUSINESS_DAY, label: '3 dias úteis' },
  low: { kind: 'business_hours', hours: 5 * HOURS_PER_BUSINESS_DAY, label: '5 dias úteis' },
}

const isWeekend = (d: TZDate): boolean => d.getDay() === 0 || d.getDay() === 6

/** Moves a date forward to the next moment inside business hours (or keeps it if already inside). */
export function nextBusinessMoment(from: Date): Date {
  const { timeZone, openHour, closeHour } = BUSINESS_CALENDAR
  const d = new TZDate(from.getTime(), timeZone)
  for (;;) {
    if (isWeekend(d) || d.getHours() >= closeHour) {
      d.setDate(d.getDate() + 1)
      d.setHours(openHour, 0, 0, 0)
      continue
    }
    if (d.getHours() < openHour) {
      d.setHours(openHour, 0, 0, 0)
      continue
    }
    return new Date(d.getTime())
  }
}

/** Adds business hours (Mon-Fri, 8h-18h, São Paulo) to a date. */
export function addBusinessHours(from: Date, hours: number): Date {
  const { timeZone, closeHour } = BUSINESS_CALENDAR
  let remaining = Math.round(hours * HOUR)
  let cursor = nextBusinessMoment(from)
  for (;;) {
    const endOfDay = new TZDate(cursor.getTime(), timeZone)
    endOfDay.setHours(closeHour, 0, 0, 0)
    const available = endOfDay.getTime() - cursor.getTime()
    if (remaining <= available) return new Date(cursor.getTime() + remaining)
    remaining -= available
    cursor = nextBusinessMoment(new Date(endOfDay.getTime()))
  }
}

/** When the next response is due for a given priority, counting from `from`. */
export function slaDueAt(priority: Priority, from: Date): Date {
  const rule = SLA_RULES[priority]
  return rule.kind === 'calendar_hours'
    ? new Date(from.getTime() + rule.hours * HOUR)
    : addBusinessHours(from, rule.hours)
}

/**
 * The SLA clock starts at creation and restarts at each update from support and at each reopen.
 * Employee updates do not restart it (otherwise adding a comment would hide an overdue ticket).
 */
export function slaClockStart(
  ticket: Pick<Ticket, 'createdAt' | 'lastSupportUpdateAt' | 'reopenedAt'>,
): Date {
  const candidates = [ticket.createdAt, ticket.lastSupportUpdateAt, ticket.reopenedAt]
  return new Date(Math.max(...candidates.filter((d): d is Date => d !== undefined).map((d) => d.getTime())))
}

export type SlaStatus = { dueAt: Date | null; overdue: boolean; reopenable: boolean }

export function slaStatus(
  ticket: Pick<
    Ticket,
    'status' | 'priority' | 'createdAt' | 'lastSupportUpdateAt' | 'reopenedAt' | 'resolvedAt'
  >,
  now: Date,
): SlaStatus {
  if (!isOpenStatus(ticket.status)) {
    return { dueAt: null, overdue: false, reopenable: isReopenable(ticket, now) }
  }
  const dueAt = slaDueAt(ticket.priority, slaClockStart(ticket))
  return { dueAt, overdue: now.getTime() > dueAt.getTime(), reopenable: false }
}

/** Annex A: a ticket resolved up to 7 days ago can be reopened. Closed tickets cannot. */
export function isReopenable(ticket: Pick<Ticket, 'status' | 'resolvedAt'>, now: Date): boolean {
  if (ticket.status !== 'resolved' || !ticket.resolvedAt) return false
  return now.getTime() - ticket.resolvedAt.getTime() <= REOPEN_WINDOW_DAYS * DAY
}
