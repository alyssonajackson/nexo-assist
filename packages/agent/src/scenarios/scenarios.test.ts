import { describe, expect, it } from 'vitest'
import { scriptedModel } from '../testing/scripted-model'
import { runScenario } from './run-scenario'
import { SCENARIOS, type Scenario } from './scenarios'

// CI: the scripted model replays a plausible model; tools, recorder and policy are the real ones.
describe('decision scenarios (scripted model)', () => {
  it.each(SCENARIOS.map((s) => [s.id, s] as const))('%s', async (_id, scenario) => {
    const run = await runScenario(scenario, scriptedModel(scenario.script), 'mock/scripted', {
      checkScriptRules: true,
    })
    expect(run.failures).toEqual([])
    // Chips come only from real tool calls.
    const scripted = scenario.script.flatMap((st) => ('tools' in st ? st.tools.map((t) => t.name) : []))
    expect(run.result.decision.toolsCalled.map((c) => c.tool)).toEqual(scripted)
  })
})

describe('code-enforced rules (scripted model)', () => {
  it('proposes the reopen when the model stops at get_ticket and only asks', async () => {
    const base = SCENARIOS.find((s) => s.id === 'reopen-within-7-days')
    if (!base) throw new Error('scenario reopen-within-7-days not found')
    const asksOnly: Scenario = {
      ...base,
      expect: { ...base.expect, rules: ['reopen_window'] },
      script: [
        { tools: [{ name: 'get_ticket', input: { ticketId: 'INC-20150' } }] },
        {
          final: {
            intent: 'ticket_reopen',
            extracted: { ticketId: 'INC-20150' },
            action: 'ask_clarification',
            confidence: 0.9,
            reason: 'Confirmar se o funcionário quer reabrir.',
            reply: 'Quer que eu reabra o INC-20150?',
          },
        },
      ],
    }
    const run = await runScenario(asksOnly, scriptedModel(asksOnly.script), 'mock/scripted')
    expect(run.failures).toEqual([])
    expect(run.result.decision.toolsCalled.map((c) => c.tool)).toEqual(['get_ticket', 'propose_reopen'])
  })
})
