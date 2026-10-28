import { mkdirSync, writeFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { modelFromEnv } from '../agent'
import { runScenario, type ScenarioRun } from './run-scenario'
import { SCENARIOS } from './scenarios'

/**
 * Real model, same fixtures as the CI suite. `pnpm test:evals` (needs the LLM key in env).
 * LLM_EVAL_RUNS=3 repeats each scenario; LLM_EVAL_DELAY_MS spaces calls for free-tier rate limits.
 */
const model = modelFromEnv()
const runs = Number(process.env.LLM_EVAL_RUNS ?? 1)
const delayMs = Number(process.env.LLM_EVAL_DELAY_MS ?? 4000)
const only = process.env.LLM_EVAL_ONLY?.split(',')
const results: ScenarioRun[] = []

describe(`decision scenarios (${model})`, () => {
  const scenarios = SCENARIOS.filter((s) => !only || only.includes(s.id))
  it.each(scenarios.map((s) => [s.id, s] as const))('%s', async (_id, scenario) => {
    const failures: string[] = []
    for (let i = 0; i < runs; i++) {
      const run = await runScenario(scenario, model, model)
      results.push(run)
      failures.push(...run.failures.map((f) => `#${i + 1} ${f}`))
      await new Promise((r) => setTimeout(r, delayMs))
    }
    expect(failures).toEqual([])
  })

  afterAll(() => {
    const rows = results.map((r) => ({
      scenario: r.scenario.id,
      ok: r.failures.length === 0 ? 'yes' : 'NO',
      intent: r.result.decision.intent,
      action: r.result.decision.action,
      confidence: r.result.decision.confidence,
      tools: r.result.decision.toolsCalled.map((c) => (c.ok ? c.tool : `${c.tool}!`)).join(' '),
      rules: r.result.decision.ruleOverrides.map((o) => o.rule).join(' '),
      ms: r.result.decision.latencyMs,
      tokensIn: r.result.decision.usage?.inputTokens,
      tokensOut: r.result.decision.usage?.outputTokens,
      failures:
        r.failures.join('; ') + (r.result.decision.source === 'code' ? ` [${r.result.decision.reason}]` : ''),
    }))
    console.table(rows)
    // Kept out of git; the README summarizes the latest numbers.
    mkdirSync('.evals', { recursive: true })
    writeFileSync(
      '.evals/last-run.json',
      JSON.stringify({ model, runs, at: new Date(), rows, results }, null, 2),
    )
  })
})
