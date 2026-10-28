import {
  TOOL_LABELS,
  type Draft,
  type PriorityResult,
  type RuleOverride,
  type ToolCall,
  type ToolName,
  type Transfer,
} from '@nexo/shared'

/** What the tools actually did in this turn. Policy and the chat cards are built from this, not from model claims. */
export type TurnEffects = {
  /** Tickets shown to the employee, in order (from list_my_tickets or get_ticket). */
  shownTicketIds: string[]
  /** How they were shown: a list, or a single ticket card. */
  shownAs?: 'list' | 'single'
  overdueTicketIds: string[]
  /** Shown tickets resolved within the reopen window (sla.reopenable, computed by the tickets service). */
  reopenableTicketIds: string[]
  kbArticleIds: string[]
  /** Drafts proposed this turn (the last one is the live one). */
  drafts: Draft[]
  priority?: PriorityResult
  transfer?: Omit<Transfer, 'at'>
  /** Tools that refused (duplicate found, reopen window, ticket system down...), with the employee-facing message. */
  refusals: { tool: ToolName; error: string; message: string }[]
}

/**
 * Per-turn log of real tool calls. Each tool runs through `record`, so `toolsCalled` (the action
 * chips) is measured by code: a tool the model only claims to have used never shows up.
 */
export class TurnRecorder {
  readonly toolsCalled: ToolCall[] = []
  readonly overrides: RuleOverride[] = []
  readonly effects: TurnEffects = {
    shownTicketIds: [],
    overdueTicketIds: [],
    reopenableTicketIds: [],
    kbArticleIds: [],
    drafts: [],
    refusals: [],
  }

  constructor(private readonly onToolCall?: (call: ToolCall) => void) {}

  async record<T>(tool: ToolName, run: () => Promise<T>, summarize: (result: T) => string): Promise<T> {
    const started = Date.now()
    try {
      const result = await run()
      this.push({
        tool,
        label: TOOL_LABELS[tool],
        ok: true,
        ms: Date.now() - started,
        summary: summarize(result),
      })
      return result
    } catch (err) {
      const summary = err instanceof Error ? err.message : 'falhou'
      this.push({ tool, label: TOOL_LABELS[tool], ok: false, ms: Date.now() - started, summary })
      throw err
    }
  }

  override(o: RuleOverride) {
    this.overrides.push(o)
  }

  private push(call: ToolCall) {
    this.toolsCalled.push(call)
    this.onToolCall?.(call)
  }
}
