import { describe, expect, it } from 'vitest'
import { derivePriority } from './priority'

describe('derivePriority', () => {
  it('critical when something is down for a team', () => {
    expect(
      derivePriority({ type: 'INC', affected: 'team', blocksWork: true, sameDayCommitment: false }).priority,
    ).toBe('critical')
  })
  it('critical when down for the whole company', () => {
    expect(
      derivePriority({ type: 'INC', affected: 'company', blocksWork: true, sameDayCommitment: false }).priority,
    ).toBe('critical')
  })
  it('high when one person has a same-day commitment (VPN before the 14h meeting)', () => {
    expect(
      derivePriority({ type: 'INC', affected: 'self', blocksWork: false, sameDayCommitment: true }).priority,
    ).toBe('high')
  })
  it('high when one person cannot work', () => {
    expect(
      derivePriority({ type: 'INC', affected: 'self', blocksWork: true, sameDayCommitment: false }).priority,
    ).toBe('high')
  })
  it('medium when it gets in the way but there is a workaround', () => {
    expect(
      derivePriority({ type: 'INC', affected: 'self', blocksWork: false, sameDayCommitment: false }).priority,
    ).toBe('medium')
  })
  it('low for requests without urgency', () => {
    expect(
      derivePriority({ type: 'REQ', affected: 'self', blocksWork: false, sameDayCommitment: false }).priority,
    ).toBe('low')
  })
  it('a team-wide request is not critical', () => {
    expect(
      derivePriority({ type: 'REQ', affected: 'team', blocksWork: true, sameDayCommitment: false }).priority,
    ).toBe('high')
  })
})
