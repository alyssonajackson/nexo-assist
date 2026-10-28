import { describe, expect, it } from 'vitest'
import type { TicketView } from '@nexo/shared'
import { latestEntry, timelineLine } from './timeline'

const entry = (kind: TicketView['timeline'][number]['kind'], min: number, note?: string) => ({
  key: `${kind}${min}`,
  kind,
  at: new Date(Date.UTC(2026, 9, 28, 10, min)),
  by: 'u',
  ...(note ? { note } : {}),
})

describe('timeline line', () => {
  it('summarizes a transfer instead of printing the case summary', () => {
    expect(timelineLine(entry('transferred', 5, 'Resumo longo do caso…'))).toBe(
      'Transferido para um analista',
    )
  })
  it('uses the stored note for take over', () => {
    expect(timelineLine(entry('assumed', 12, 'Assumido por Rafael Lima'))).toBe('Assumido por Rafael Lima')
  })
  it('picks the newest entry', () => {
    const ticket = { timeline: [entry('assumed', 12), entry('transferred', 5)] } as TicketView
    expect(latestEntry(ticket)?.kind).toBe('assumed')
  })
})
