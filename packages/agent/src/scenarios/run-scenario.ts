import type { AgentModel } from '../agent'
import { createAssistAgent } from '../agent'
import { runTurn, type TurnResult } from '../run-turn'
import { createInMemoryPorts } from '../testing/in-memory-ports'
import type { Scenario, ScenarioOutcome } from './scenarios'

export type ScenarioRun = {
  scenario: Scenario
  result: TurnResult
  outcome: ScenarioOutcome
  failures: string[]
}

/** Runs one scenario against fresh in-memory ports and returns every failed expectation. */
export async function runScenario(
  scenario: Scenario,
  model: AgentModel,
  modelId: string,
  opts: { checkScriptRules?: boolean } = {},
): Promise<ScenarioRun> {
  const now = new Date()
  const { ports, drafts, handoff } = createInMemoryPorts(scenario.user.id, now)
  const result = await runTurn({
    agent: createAssistAgent(model),
    modelId,
    user: scenario.user,
    conversationId: `scenario-${scenario.id}`,
    history: [],
    text: scenario.message,
    ports,
    now,
  })
  const pending = [...drafts.drafts.values()].filter((d) => d.status === 'pending')
  const outcome: ScenarioOutcome = {
    pendingDrafts: pending.map((d) => ({
      kind: d.kind,
      ...(d.ticketId ? { ticketId: d.ticketId } : {}),
      ...(d.fields ? { priority: d.fields.priority } : {}),
    })),
    transfers: handoff.transfers.map((t) => t.reason),
  }
  const failures = check(scenario, result, outcome, opts.checkScriptRules ?? false)
  return { scenario, result, outcome, failures }
}

function check(s: Scenario, r: TurnResult, o: ScenarioOutcome, scriptRules: boolean): string[] {
  const e = s.expect
  const d = r.decision
  const fails: string[] = []
  const fail = (msg: string) => fails.push(msg)
  const calls = (ok: boolean) => new Set(d.toolsCalled.filter((c) => c.ok === ok).map((c) => c.tool))
  const rules = new Set(d.ruleOverrides.map((x) => x.rule))
  const shown = new Set(
    r.parts.flatMap((p) =>
      p.type === 'ticket' ? [p.ticketId] : p.type === 'ticket_list' ? p.ticketIds : [],
    ),
  )

  if (!e.intent.includes(d.intent)) fail(`intent ${d.intent}, esperava ${e.intent.join('|')}`)
  if (!e.action.includes(d.action)) fail(`action ${d.action}, esperava ${e.action.join('|')}`)
  for (const t of e.tools ?? []) if (!calls(true).has(t)) fail(`não chamou ${t}`)
  for (const t of e.refusedTools ?? []) if (!calls(false).has(t)) fail(`${t} deveria ter sido recusado`)
  const allowed: string[] | undefined = e.onlyTools
  for (const c of d.toolsCalled) if (allowed && !allowed.includes(c.tool)) fail(`não podia chamar ${c.tool}`)
  for (const rule of [...(e.rules ?? []), ...(scriptRules ? (s.scriptRules ?? []) : [])]) {
    if (!rules.has(rule)) fail(`regra ${rule} não aplicada`)
  }
  if (e.draft === null && o.pendingDrafts.length)
    fail(`rascunho inesperado: ${o.pendingDrafts.map((x) => x.kind).join(', ')}`)
  if (e.draft) {
    const want = e.draft
    const hit = o.pendingDrafts.find(
      (x) =>
        x.kind === want.kind &&
        (!want.ticketId || x.ticketId === want.ticketId) &&
        (!want.priority || x.priority === want.priority),
    )
    if (!hit) fail(`esperava rascunho ${want.kind} ${want.ticketId ?? ''}`.trim())
  }
  for (const kind of e.neverDraft ?? [])
    if (o.pendingDrafts.some((x) => x.kind === kind)) fail(`não podia propor ${kind}`)
  if (e.transfer === null && o.transfers.length) fail(`transferência inesperada (${o.transfers.join(', ')})`)
  if (e.transfer && !o.transfers.includes(e.transfer)) fail(`esperava transferência ${e.transfer}`)
  for (const id of e.shows ?? []) if (!shown.has(id)) fail(`não mostrou ${id}`)
  for (const id of e.neverShows ?? []) if (shown.has(id)) fail(`mostrou ${id} (de outro funcionário)`)
  const extra = e.check?.(o)
  if (extra) fail(extra)
  return fails
}
