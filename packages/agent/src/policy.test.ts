import { describe, expect, it } from 'vitest'
import type { Draft, ModelDecision } from '@nexo/shared'
import {
  afterCommit,
  applyPolicy,
  CONFIDENCE,
  DUPLICATE_QUICK_REPLIES,
  OVERDUE_QUICK_REPLIES,
  REPLIES,
  type PolicyInput,
} from './policy'
import type { TurnEffects } from './recorder'

const effects = (fx: Partial<TurnEffects> = {}): TurnEffects => ({
  shownTicketIds: [],
  overdueTicketIds: [],
  reopenableTicketIds: [],
  kbArticleIds: [],
  drafts: [],
  refusals: [],
  ...fx,
})

const decision = (d: Partial<ModelDecision> = {}): ModelDecision => ({
  intent: 'ticket_create',
  extracted: {},
  action: 'reply',
  confidence: 0.9,
  reason: 'motivo',
  ...d,
})

const draft = (d: Partial<Draft> = {}): Draft => ({
  id: 'D-381',
  conversationId: 'c1',
  employeeId: 'u-ana',
  kind: 'create',
  status: 'pending',
  createdAt: new Date(),
  fields: {
    type: 'INC',
    category: 'software',
    title: 'Sistema fora',
    description: 'Caiu',
    priority: 'medium',
    affected: 'self',
  },
  ...d,
})

const run = (d: Partial<ModelDecision>, fx: Partial<TurnEffects> = {}, extra: Partial<PolicyInput> = {}) =>
  applyPolicy({
    decision: decision(d),
    reply: 'resposta do modelo',
    effects: effects(fx),
    employeeName: 'Ana Souza',
    employeeMessage: 'mensagem',
    ...extra,
  })

describe('applyPolicy', () => {
  it('keeps a confident, consistent decision as is', () => {
    const r = run({ intent: 'kb_question', action: 'answer_from_kb' }, { kbArticleIds: ['KB-001'] })
    expect(r.decision.action).toBe('answer_from_kb')
    expect(r.overrides).toEqual([])
    expect(r.reply).toBe('resposta do modelo')
    expect(r.transfer).toBeUndefined()
  })

  it('transfers below the low-confidence threshold and withdraws drafts', () => {
    const r = run(
      { action: 'propose_draft', confidence: CONFIDENCE.transferBelow - 0.01 },
      { drafts: [draft()] },
    )
    expect(r.decision.action).toBe('transfer_to_analyst')
    expect(r.transfer?.reason).toBe('low_confidence')
    expect(r.cancelDraftIds).toEqual(['D-381'])
    expect(r.overrides[0]).toMatchObject({
      rule: 'low_confidence',
      from: 'propose_draft',
      to: 'transfer_to_analyst',
    })
    expect(r.reply).toBe(REPLIES.lowConfidence)
  })

  it('asks instead of proposing a write in the gray zone', () => {
    const r = run(
      { action: 'propose_draft', confidence: 0.6, missingFields: ['quem é afetado'] },
      { drafts: [draft()] },
    )
    expect(r.decision.action).toBe('ask_clarification')
    expect(r.cancelDraftIds).toEqual(['D-381'])
    expect(r.overrides.map((o) => o.rule)).toContain('gray_zone_confidence')
    expect(r.reply).toContain('quem é afetado')
  })

  it('does not touch read-only answers in the gray zone', () => {
    const r = run({ action: 'list_tickets', confidence: 0.6 }, { shownTicketIds: ['INC-20298'] })
    expect(r.decision.action).toBe('list_tickets')
    expect(r.overrides).toEqual([])
  })

  it('transfers on an explicit request even if the model did not', () => {
    const r = run({ intent: 'request_analyst', action: 'reply' })
    expect(r.transfer).toMatchObject({ reason: 'employee_request', by: 'rule' })
    expect(r.transfer?.summary).toContain('Ana Souza')
    expect(r.decision.action).toBe('transfer_to_analyst')
  })

  it('leaves a transfer done by the tool alone', () => {
    const r = run(
      { intent: 'request_analyst', action: 'reply' },
      {
        transfer: { reason: 'employee_request', summary: 's', by: 'agent' },
      },
    )
    expect(r.transfer).toBeUndefined()
    expect(r.decision.action).toBe('transfer_to_analyst')
  })

  it('redirects out-of-scope topics and never keeps a draft for them', () => {
    const r = run({ intent: 'out_of_scope', action: 'propose_draft' }, { drafts: [draft()] })
    expect(r.decision.action).toBe('redirect_out_of_scope')
    expect(r.cancelDraftIds).toEqual(['D-381'])
    expect(r.reply).toBe(REPLIES.outOfScope)
  })

  it('keeps the model reply when it already redirected', () => {
    const r = run({ intent: 'out_of_scope', action: 'redirect_out_of_scope' })
    expect(r.reply).toBe('resposta do modelo')
    expect(r.overrides).toEqual([])
  })

  it('downgrades a claimed draft that was never created', () => {
    const r = run({ action: 'propose_draft' })
    expect(r.decision.action).toBe('ask_clarification')
    expect(r.overrides[0]?.rule).toBe('action_without_tool')
  })

  it('answers a refused proposal with the refusal, written by code', () => {
    const r = run(
      { action: 'propose_draft' },
      {
        refusals: [
          { tool: 'propose_draft', error: 'possible_duplicates', message: 'Você já tem INC-20311...' },
        ],
      },
    )
    expect(r.decision.action).toBe('ask_clarification')
    expect(r.reply).toBe('Você já tem INC-20311...')
    expect(r.decision.quickReplies).toEqual([...DUPLICATE_QUICK_REPLIES])
    expect(r.overrides).toEqual([])
  })

  it('aligns the action with the draft actually proposed', () => {
    const r = run({ action: 'reply' }, { drafts: [draft({ kind: 'update', ticketId: 'INC-20311' })] })
    expect(r.decision.action).toBe('propose_update')
  })

  it('downgrades lookups and KB answers with no tool call behind them', () => {
    expect(run({ action: 'show_ticket' }).decision.action).toBe('reply')
    expect(run({ action: 'answer_from_kb' }).decision.action).toBe('reply')
  })

  it('performs a transfer the model announced but did not call', () => {
    const r = run(
      { action: 'transfer_to_analyst' },
      { overdueTicketIds: ['INC-20311'], shownTicketIds: ['INC-20311'] },
    )
    expect(r.transfer?.reason).toBe('overdue')
    expect(r.overrides.map((o) => o.rule)).toContain('action_without_tool')
  })

  it('transfers a case classified critical when no draft was made', () => {
    const r = run({ action: 'ask_clarification' }, { priority: { priority: 'critical', rationale: 'r' } })
    expect(r.transfer?.reason).toBe('critical')
    expect(r.overrides.map((o) => o.rule)).toContain('critical_transfer')
  })

  it('keeps a critical draft for confirmation (the commit transfers)', () => {
    const r = run(
      { action: 'propose_draft' },
      { priority: { priority: 'critical', rationale: 'r' }, drafts: [draft()] },
    )
    expect(r.transfer).toBeUndefined()
    expect(r.decision.action).toBe('propose_draft')
  })

  it('offers an analyst for overdue tickets', () => {
    const r = run(
      { action: 'show_ticket' },
      { shownTicketIds: ['INC-20311'], overdueTicketIds: ['INC-20311'] },
    )
    expect(r.decision.quickReplies).toEqual([...OVERDUE_QUICK_REPLIES])
    expect(r.overrides.map((o) => o.rule)).toEqual(['overdue_offer'])
  })

  it('does not repeat the overdue offer when the model already made it', () => {
    const r = run(
      { action: 'show_ticket', quickReplies: ['Transferir para analista'] },
      { shownTicketIds: ['INC-20311'], overdueTicketIds: ['INC-20311'] },
    )
    expect(r.overrides).toEqual([])
  })

  describe('reopen within the window', () => {
    const back = { employeeMessage: 'A senha do SAP bloqueou de novo, é o mesmo problema do inc-20150.' }
    const shown: Partial<TurnEffects> = {
      shownTicketIds: ['INC-20150'],
      shownAs: 'single',
      reopenableTicketIds: ['INC-20150'],
    }

    it('proposes the reopen when the model only asked about a named, reopenable ticket', () => {
      const r = run(
        { intent: 'ticket_lookup', action: 'ask_clarification', quickReplies: ['Sim'] },
        shown,
        back,
      )
      expect(r.reopen).toEqual({
        ticketId: 'INC-20150',
        reason: `Ana Souza: "${back.employeeMessage}"`,
      })
      expect(r.decision).toMatchObject({ intent: 'ticket_reopen', action: 'propose_reopen' })
      expect(r.decision.extracted.ticketId).toBe('INC-20150')
      expect(r.decision.quickReplies).toBeUndefined()
      expect(r.reply).toBe(REPLIES.reopen('INC-20150'))
      expect(r.overrides).toEqual([expect.objectContaining({ rule: 'reopen_window', to: 'propose_reopen' })])
    })

    it('leaves it to the model when the ticket is not reopenable, not named, or already proposed', () => {
      expect(
        run({ action: 'ask_clarification' }, { ...shown, reopenableTicketIds: [] }, back).reopen,
      ).toBeUndefined()
      expect(
        run({ action: 'ask_clarification' }, shown, { employeeMessage: 'A senha do SAP bloqueou de novo.' })
          .reopen,
      ).toBeUndefined()
      expect(
        run({ action: 'propose_reopen' }, { ...shown, drafts: [draft({ kind: 'reopen' })] }, back).reopen,
      ).toBeUndefined()
    })

    it('needs a sign that the problem is back', () => {
      const r = run({ intent: 'ticket_lookup', action: 'show_ticket' }, shown, {
        employeeMessage: 'Qual o status do INC-20150?',
      })
      expect(r.reopen).toBeUndefined()
      expect(r.decision.action).toBe('show_ticket')
    })

    it('does not retry a reopen the tool refused', () => {
      const refusals: TurnEffects['refusals'] = [
        { tool: 'propose_reopen', error: 'not_reopenable', message: 'passou do prazo' },
      ]
      const r = run({ action: 'propose_reopen' }, { ...shown, refusals }, back)
      expect(r.reopen).toBeUndefined()
      expect(r.reply).toBe('passou do prazo')
    })
  })

  it('never offers "Confirmar" as a quick reply', () => {
    const r = run({ quickReplies: ['Confirmar', 'Editar'] })
    expect(r.decision.quickReplies).toEqual(['Editar'])
  })
})

describe('afterCommit', () => {
  it('transfers a committed critical ticket', () => {
    const d = draft({ fields: { ...draft().fields!, priority: 'critical' } })
    const r = afterCommit(d, 'INC-20501', 'Ana Souza')
    expect(r.transfer).toMatchObject({ reason: 'critical', ticketId: 'INC-20501', by: 'rule' })
    expect(r.override?.rule).toBe('critical_transfer')
  })

  it('does nothing for other priorities or kinds', () => {
    expect(afterCommit(draft(), 'INC-20501', 'Ana')).toEqual({})
    expect(afterCommit(draft({ kind: 'update', fields: undefined }), 'INC-20311', 'Ana')).toEqual({})
  })
})
