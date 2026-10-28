import { describe, expect, it } from 'vitest'
import {
  confidenceLevel,
  daysAgo,
  formatConfidence,
  formatDateTime,
  formatDeadline,
  formatMs,
  formatShortDate,
  formatTime,
  slaPromise,
} from './format'

// São Paulo is UTC-3 all year (no DST since 2019). 2026-10-28 is a Wednesday.
const sp = (local: string) => new Date(`${local}-03:00`)

describe('formatShortDate', () => {
  it('abbreviates the month without the dot', () => {
    expect(formatShortDate(sp('2026-10-16T14:20:00'))).toBe('16 out')
    expect(formatShortDate(sp('2026-03-05T10:00:00'))).toBe('05 mar')
  })
  it('uses the São Paulo day, not the UTC day', () => {
    // 23:00 in São Paulo is already the next day in UTC.
    expect(formatShortDate(sp('2026-10-16T23:00:00'))).toBe('16 out')
  })
})

describe('formatTime', () => {
  it('formats 24h time', () => {
    expect(formatTime(sp('2026-10-28T13:43:00'))).toBe('13:43')
    expect(formatTime(sp('2026-10-28T08:05:00'))).toBe('08:05')
  })
  it('shows midnight as 00:00', () => {
    expect(formatTime(sp('2026-10-28T00:00:00'))).toBe('00:00')
  })
})

describe('formatDateTime', () => {
  it('joins date and time', () => {
    expect(formatDateTime(sp('2026-10-16T14:20:00'))).toBe('16 out, 14:20')
  })
})

describe('formatDeadline', () => {
  const now = sp('2026-10-28T09:43:00')
  it('shows only the time when due today', () => {
    expect(formatDeadline(sp('2026-10-28T13:43:00'), now)).toBe('13:43')
  })
  it('shows date and time on another day', () => {
    expect(formatDeadline(sp('2026-10-29T10:00:00'), now)).toBe('29 out, 10:00')
  })
})

describe('slaPromise', () => {
  it('counts high as 4 business hours from a weekday morning', () => {
    expect(slaPromise('high', sp('2026-10-28T09:43:00'))).toBe('resposta até 13:43')
  })
  it('rolls high over to the next business day', () => {
    // 17:00 + 1h today + 3h tomorrow -> 11:00
    expect(slaPromise('high', sp('2026-10-28T17:00:00'))).toBe('resposta até 29 out, 11:00')
  })
  it('counts critical as 1 calendar hour', () => {
    expect(slaPromise('critical', sp('2026-10-28T09:43:00'))).toBe('resposta até 10:43')
    expect(slaPromise('critical', sp('2026-10-28T23:30:00'))).toBe('resposta até 29 out, 00:30')
  })
})

describe('daysAgo', () => {
  const now = sp('2026-10-28T00:30:00')
  it('says hoje for the same São Paulo day', () => {
    expect(daysAgo(sp('2026-10-28T00:01:00'), now)).toBe('hoje')
    expect(daysAgo(sp('2026-10-28T23:59:00'), sp('2026-10-28T00:00:00'))).toBe('hoje')
  })
  it('says ontem across midnight even when under 24h apart', () => {
    expect(daysAgo(sp('2026-10-27T23:30:00'), now)).toBe('ontem')
  })
  it('says há N dias for older dates', () => {
    expect(daysAgo(sp('2026-10-25T12:00:00'), now)).toBe('há 3 dias')
    expect(daysAgo(sp('2026-10-21T08:00:00'), now)).toBe('há 7 dias')
  })
  it('treats a future date as hoje', () => {
    expect(daysAgo(sp('2026-10-30T12:00:00'), now)).toBe('hoje')
  })
})

describe('formatConfidence', () => {
  it('rounds to a whole percent', () => {
    expect(formatConfidence(0.864)).toBe('86%')
    expect(formatConfidence(0.865)).toBe('87%')
  })
  it('clamps to 0-100%', () => {
    expect(formatConfidence(1.4)).toBe('100%')
    expect(formatConfidence(-0.2)).toBe('0%')
  })
})

describe('confidenceLevel', () => {
  it('is low below 0.5', () => {
    expect(confidenceLevel(0.49)).toBe('low')
  })
  it('is medium from 0.5 up to below 0.7', () => {
    expect(confidenceLevel(0.5)).toBe('medium')
    expect(confidenceLevel(0.69)).toBe('medium')
  })
  it('is high from 0.7', () => {
    expect(confidenceLevel(0.7)).toBe('high')
    expect(confidenceLevel(1)).toBe('high')
  })
})

describe('formatMs', () => {
  it('shows milliseconds under one second', () => {
    expect(formatMs(320)).toBe('320 ms')
    expect(formatMs(999)).toBe('999 ms')
  })
  it('shows seconds with a decimal comma', () => {
    expect(formatMs(1000)).toBe('1,0 s')
    expect(formatMs(1840)).toBe('1,8 s')
  })
})
