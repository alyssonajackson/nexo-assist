import { describe, expect, it } from 'vitest'
import { addBusinessHours, isReopenable, nextBusinessMoment, slaDueAt, slaStatus } from './sla'

// São Paulo is UTC-3 all year (no DST since 2019). 2026-10-28 is a Wednesday.
const sp = (local: string) => new Date(`${local}-03:00`)

describe('nextBusinessMoment', () => {
  it('keeps a moment inside business hours', () => {
    expect(nextBusinessMoment(sp('2026-10-28T10:30:00'))).toEqual(sp('2026-10-28T10:30:00'))
  })
  it('moves early morning to 8h the same day', () => {
    expect(nextBusinessMoment(sp('2026-10-28T06:00:00'))).toEqual(sp('2026-10-28T08:00:00'))
  })
  it('moves after-hours to 8h the next business day', () => {
    expect(nextBusinessMoment(sp('2026-10-28T19:00:00'))).toEqual(sp('2026-10-29T08:00:00'))
  })
  it('skips the weekend', () => {
    expect(nextBusinessMoment(sp('2026-10-30T18:30:00'))).toEqual(sp('2026-11-02T08:00:00'))
    expect(nextBusinessMoment(sp('2026-10-31T11:00:00'))).toEqual(sp('2026-11-02T08:00:00'))
  })
})

describe('addBusinessHours', () => {
  it('adds within the same day', () => {
    expect(addBusinessHours(sp('2026-10-28T09:43:00'), 4)).toEqual(sp('2026-10-28T13:43:00'))
  })
  it('rolls over to the next business day', () => {
    // 16h + 4h business = 2h today + 2h tomorrow -> 10h
    expect(addBusinessHours(sp('2026-10-28T16:00:00'), 4)).toEqual(sp('2026-10-29T10:00:00'))
  })
  it('rolls over the weekend', () => {
    expect(addBusinessHours(sp('2026-10-30T17:00:00'), 4)).toEqual(sp('2026-11-02T11:00:00'))
  })
  it('starts counting at opening when created at night', () => {
    expect(addBusinessHours(sp('2026-10-28T22:00:00'), 4)).toEqual(sp('2026-10-29T12:00:00'))
  })
})

describe('slaDueAt', () => {
  it('critical counts one calendar hour (24h on-call)', () => {
    expect(slaDueAt('critical', sp('2026-10-31T23:30:00'))).toEqual(sp('2026-11-01T00:30:00'))
  })
  it('high is 4 business hours', () => {
    expect(slaDueAt('high', sp('2026-10-28T09:43:00'))).toEqual(sp('2026-10-28T13:43:00'))
  })
  it('medium is 3 business days', () => {
    expect(slaDueAt('medium', sp('2026-10-28T10:00:00'))).toEqual(sp('2026-11-02T10:00:00'))
  })
  it('low is 5 business days', () => {
    expect(slaDueAt('low', sp('2026-10-28T10:00:00'))).toEqual(sp('2026-11-04T10:00:00'))
  })
})

describe('slaStatus', () => {
  const now = sp('2026-10-28T10:00:00')

  it('flags an open medium ticket without support update for 5 days as overdue', () => {
    const s = slaStatus(
      { status: 'awaiting_analyst', priority: 'medium', createdAt: sp('2026-10-23T09:00:00') },
      now,
    )
    expect(s.overdue).toBe(true)
  })
  it('restarts the clock at the last support update', () => {
    const s = slaStatus(
      {
        status: 'in_progress',
        priority: 'medium',
        createdAt: sp('2026-10-16T09:00:00'),
        lastSupportUpdateAt: sp('2026-10-27T15:00:00'),
      },
      now,
    )
    expect(s.overdue).toBe(false)
  })
  it('has no due date for resolved tickets', () => {
    const s = slaStatus(
      {
        status: 'resolved',
        priority: 'medium',
        createdAt: sp('2026-10-20T09:00:00'),
        resolvedAt: sp('2026-10-24T09:00:00'),
      },
      now,
    )
    expect(s).toEqual({ dueAt: null, overdue: false, reopenable: true })
  })
})

describe('isReopenable', () => {
  const now = sp('2026-10-28T10:00:00')
  it('allows resolved tickets up to 7 days', () => {
    expect(isReopenable({ status: 'resolved', resolvedAt: sp('2026-10-21T10:00:00') }, now)).toBe(true)
  })
  it('refuses after 7 days', () => {
    expect(isReopenable({ status: 'resolved', resolvedAt: sp('2026-10-21T09:59:00') }, now)).toBe(false)
  })
  it('refuses closed tickets', () => {
    expect(isReopenable({ status: 'closed', resolvedAt: sp('2026-10-27T10:00:00') }, now)).toBe(false)
  })
})

describe('slaClockStart', () => {
  it('restarts the clock when a resolved ticket is reopened', () => {
    const s = slaStatus(
      {
        status: 'open',
        priority: 'medium',
        createdAt: sp('2026-10-01T09:00:00'),
        lastSupportUpdateAt: sp('2026-10-10T09:00:00'),
        reopenedAt: sp('2026-10-28T09:00:00'),
      },
      sp('2026-10-28T10:00:00'),
    )
    expect(s.overdue).toBe(false)
    expect(s.dueAt).toEqual(sp('2026-11-02T09:00:00'))
  })
})
