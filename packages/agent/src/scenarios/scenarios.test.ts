import { describe, expect, it } from 'vitest'
import { scriptedModel } from '../testing/scripted-model'
import { runScenario } from './run-scenario'
import { SCENARIOS } from './scenarios'

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
