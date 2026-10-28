import { describe, expect, it } from 'vitest'
import { repairOutput, toModelDecision } from './output'

describe('repairOutput', () => {
  it('repairs a JS object literal (unquoted keys, undefined)', () => {
    const raw =
      'Aqui está: {intent:"kb_question",extracted:{ticketId:undefined,category:"hardware"},action:"answer_from_kb",confidence:0.9,reason:"r",reply:"Use Windows + P"}'
    expect(repairOutput(raw)).toEqual({
      intent: 'kb_question',
      extracted: { category: 'hardware' },
      action: 'answer_from_kb',
      confidence: 0.9,
      reason: 'r',
      reply: 'Use Windows + P',
    })
  })

  it('returns null when the result still does not match the schema', () => {
    expect(repairOutput('{intent:"nope"}')).toBeNull()
    expect(repairOutput('sem json')).toBeNull()
  })

  it('never lets the model commit a draft', () => {
    expect(
      repairOutput(
        '{"intent":"ticket_create","extracted":{},"action":"commit_draft","confidence":1,"reason":"r","reply":"x"}',
      ),
    ).toBeNull()
  })
})

describe('toModelDecision', () => {
  it('clamps confidence and keeps at most 4 quick replies', () => {
    const { decision, reply } = toModelDecision({
      intent: 'smalltalk',
      extracted: {},
      action: 'reply',
      confidence: 1.4,
      reason: 'r',
      quickReplies: ['a', 'b', ' ', 'c', 'd', 'e'],
      reply: '  oi  ',
    })
    expect(decision.confidence).toBe(1)
    expect(decision.quickReplies).toEqual(['a', 'b', 'c', 'd'])
    expect(reply).toBe('oi')
  })
})
