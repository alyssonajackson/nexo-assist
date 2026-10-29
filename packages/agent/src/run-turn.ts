import { RequestContext } from '@mastra/core/request-context'
import type { Decision, Message, MessagePart, ToolCall } from '@nexo/shared'
import type { AssistAgent } from './agent'
import { TURN_KEY, type AgentPorts, type AgentUser, type TurnContext } from './context'
import { toModelMessages } from './history'
import { AgentOutput, OUTPUT_INSTRUCTIONS, repairOutput, toModelDecision } from './output'
import { applyPolicy, ticketsToShow, type TransferPlan } from './policy'
import { TurnRecorder, type TurnEffects } from './recorder'

/** Streamed to the chat while the turn runs. */
export type TurnEvent =
  | { type: 'tool'; call: ToolCall }
  /** The decision fields as soon as the model has written them (before the reply). */
  | { type: 'decision'; intent?: string; action?: string; confidence?: number }
  | { type: 'reply_delta'; delta: string }
  /** Code replaced the model's reply (a rule fired). */
  | { type: 'reply_replaced'; text: string }

export type TurnInput = {
  agent: AssistAgent
  modelId: string
  user: AgentUser
  conversationId: string
  /** Stored messages before this one. */
  history: Message[]
  text: string
  ports: AgentPorts
  now?: Date
  onEvent?: (event: TurnEvent) => void
  abortSignal?: AbortSignal
}

export type TurnResult = {
  reply: string
  decision: Decision
  parts: MessagePart[]
  /** Set when the conversation moved to an analyst during this turn (by the model's tool or by a rule). */
  transfer?: TransferPlan
}

const MAX_STEPS = 6
const MAX_ATTEMPTS = 2
const USAGE_TIMEOUT_MS = 5_000
const FORCE_FIRST_TOOL = process.env.AGENT_FORCE_FIRST_TOOL !== '0'

export const FAILURE_REPLY =
  'Tive um problema para processar sua mensagem agora. Pode tentar de novo em alguns instantes?'

/**
 * One agent turn: the model interprets the message and calls tools; then code applies the Annex A rules
 * (policy.ts) and builds the Decision from what really happened. The model never writes a ticket.
 */
export async function runTurn(input: TurnInput): Promise<TurnResult> {
  const started = Date.now()
  const emit = input.onEvent ?? (() => {})
  const now = input.now ?? new Date()
  // A fresh recorder per attempt, so a retried turn does not show the failed attempt's chips twice.
  const prepare = () => {
    const recorder = new TurnRecorder((call) => emit({ type: 'tool', call }))
    const turn: TurnContext = {
      user: input.user,
      conversationId: input.conversationId,
      now,
      ports: input.ports,
      recorder,
    }
    const requestContext = new RequestContext()
    requestContext.set(TURN_KEY, turn)
    return { recorder, requestContext }
  }

  let attempt = prepare()
  let recorder = attempt.recorder
  let output: AgentOutput
  let usage: Decision['usage']
  let answerOnly = false
  for (let n = 1; ; n++) {
    try {
      ;({ output, usage } = await streamModel(input, attempt.requestContext, emit, answerOnly))
      // A retried turn also spent the failed attempt's calls; the LLM caps count it too.
      if (usage && n > 1) usage = { ...usage, failedAttempts: n - 1 }
      break
    } catch (err) {
      // Provider hiccups (e.g. Gemini's MALFORMED_FUNCTION_CALL) are retried once, but only when the
      // failed attempt changed nothing (no draft, no transfer): reads are safe to repeat.
      const fx = recorder.effects
      if (n < MAX_ATTEMPTS && !fx.drafts.length && !fx.transfer) {
        console.warn('agent: model turn failed, retrying once', err instanceof Error ? err.message : err)
        // The model wanted to answer without a tool; let it (policy.ts still checks the answer).
        answerOnly = isPhantomToolCall(err)
        attempt = prepare()
        recorder = attempt.recorder
        continue
      }
      console.error('agent: model turn failed', err)
      for (const d of fx.drafts) await input.ports.drafts.cancel(d.id)
      return failedTurn(recorder, input.modelId, Date.now() - started, err, n)
    }
  }

  const model = toModelDecision(output)
  const policy = applyPolicy({
    decision: model.decision,
    reply: model.reply,
    effects: recorder.effects,
    employeeName: input.user.name,
    employeeMessage: input.text,
    overdueOffered: input.history.some((m) =>
      m.decision?.ruleOverrides.some((o) => o.rule === 'overdue_offer'),
    ),
  })

  // Execute what the rules decided.
  for (const id of policy.cancelDraftIds) await input.ports.drafts.cancel(id)
  let transfer = recorder.effects.transfer
  if (policy.transfer && (await input.ports.handoff.transfer(input.conversationId, policy.transfer))) {
    transfer = policy.transfer
  }
  if (policy.reopen) await proposeReopenByRule(input, recorder, policy.reopen)
  if (policy.reply !== model.reply) emit({ type: 'reply_replaced', text: policy.reply })

  const cancelled = new Set(policy.cancelDraftIds)
  const decision: Decision = {
    ...policy.decision,
    // Facts measured by code win over what the model wrote.
    extracted: {
      ...policy.decision.extracted,
      ...(recorder.effects.priority ? { priority: recorder.effects.priority.priority } : {}),
      ...(recorder.effects.kbArticleIds.length ? { kbArticleIds: recorder.effects.kbArticleIds } : {}),
    },
    toolsCalled: recorder.toolsCalled,
    ruleOverrides: [...recorder.overrides, ...policy.overrides],
    source: 'model',
    model: input.modelId,
    latencyMs: Date.now() - started,
    ...(usage ? { usage } : {}),
  }
  return {
    reply: policy.reply,
    decision,
    parts: buildParts(
      recorder.effects,
      ticketsToShow(policy.decision, policy.reply, recorder.effects),
      cancelled,
      transfer ? undefined : decision.quickReplies,
    ),
    ...(transfer ? { transfer } : {}),
  }
}

async function streamModel(
  input: TurnInput,
  requestContext: RequestContext,
  emit: (e: TurnEvent) => void,
  answerOnly: boolean,
): Promise<{ output: AgentOutput; usage: Decision['usage'] }> {
  const stream = await input.agent.stream(toModelMessages(input.history, input.text), {
    requestContext,
    maxSteps: MAX_STEPS,
    modelSettings: { temperature: 0.2 },
    // Gemini: a little thinking makes Flash-Lite call the tools it should (ignored by other providers).
    providerOptions: {
      google: { thinkingConfig: { thinkingLevel: 'low' } },
      groq: { reasoningEffort: 'low' },
    },
    // JSON instructions go in the system prompt instead of the provider's native JSON mode: with Gemini
    // Flash-Lite, the native mode made the model skip tools (6/12 scenarios vs 8/12, see bead nx-dwf).
    structuredOutput: {
      schema: AgentOutput,
      jsonPromptInjection: 'system',
      instructions: OUTPUT_INSTRUCTIONS,
    },
    // The first step must call a tool, so the model looks before it answers (it tended to answer from
    // memory). Later steps are free, so it can finish with the JSON answer. A retry after a phantom
    // tool call gets no tools at all.
    prepareStep: ({ stepNumber }) =>
      answerOnly
        ? { toolChoice: 'none', activeTools: [] }
        : stepNumber === 0 && FORCE_FIRST_TOOL
          ? { toolChoice: 'required' }
          : undefined,
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  })
  let sentDecision = false
  let replyLength = 0
  for await (const partial of stream.objectStream) {
    if (!sentDecision && partial.reason !== undefined) {
      sentDecision = true
      emit({
        type: 'decision',
        intent: partial.intent,
        action: partial.action,
        confidence: partial.confidence,
      })
    }
    const reply = partial.reply ?? ''
    if (reply.length > replyLength) {
      emit({ type: 'reply_delta', delta: reply.slice(replyLength) })
      replyLength = reply.length
    }
  }
  // Summed per step: one model call each. (Mastra's totalUsage dropped the input tokens on a cache hit.)
  // Bounded: usage is bookkeeping and must never hold the turn (an eval run once hung with no I/O).
  const steps = await withTimeout(stream.steps, USAGE_TIMEOUT_MS, [])
  const sum = (pick: (u: (typeof steps)[number]['usage']) => number | undefined) =>
    steps.reduce((n, s) => n + (pick(s.usage) ?? 0), 0)
  const cached = sum((u) => u.cachedInputTokens)
  const usage = steps.length
    ? {
        inputTokens: sum((u) => u.inputTokens),
        outputTokens: sum((u) => u.outputTokens),
        ...(cached ? { cachedInputTokens: cached } : {}),
        modelCalls: steps.length,
      }
    : undefined
  try {
    return { output: AgentOutput.parse(await stream.object), usage }
  } catch (err) {
    const repaired = repairOutput(rawOutput(err))
    if (repaired) return { output: repaired, usage }
    throw err
  }
}

/** The reopen draft that policy.ts decided on, through the recorder so it shows as a real chip. */
async function proposeReopenByRule(
  input: TurnInput,
  recorder: TurnRecorder,
  { ticketId, reason }: { ticketId: string; reason: string },
): Promise<void> {
  const draft = await recorder.record(
    'propose_reopen',
    () =>
      input.ports.drafts.propose({
        conversationId: input.conversationId,
        employeeId: input.user.id,
        kind: 'reopen',
        ticketId,
        note: reason,
      }),
    (d) => `${d.id}: reabrir ${ticketId} (regra do código)`,
  )
  recorder.effects.drafts.push(draft)
}

/** `promise`, or `fallback` if it rejects or has not settled after `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms)
  })
  return Promise.race([promise.catch(() => fallback), timeout]).finally(() => clearTimeout(timer))
}

/**
 * gpt-oss on Groq, when it wants to answer without a tool, sometimes "calls" a tool named JSON with its
 * answer, or refuses the forced first tool. Groq rejects both and returns no text to repair.
 */
export function isPhantomToolCall(err: unknown): boolean {
  const message = err instanceof Error ? err.message : ''
  return /attempted to call tool '[^']*' which was not in request\.tools|Tool choice is required, but model did not call a tool/.test(
    message,
  )
}

/** The model's raw text, which Mastra attaches to a structured-output validation error. */
function rawOutput(err: unknown): string {
  if (typeof err !== 'object' || err === null || !('details' in err)) return ''
  const { details } = err
  return typeof details === 'object' &&
    details !== null &&
    'value' in details &&
    typeof details.value === 'string'
    ? details.value
    : ''
}

function buildParts(
  fx: TurnEffects,
  ticketIds: string[],
  cancelled: Set<string>,
  quickReplies: string[] | undefined,
): MessagePart[] {
  const parts: MessagePart[] = []
  const [first] = ticketIds
  if (fx.shownAs === 'single' && first) parts.push({ type: 'ticket', ticketId: first })
  else if (ticketIds.length) parts.push({ type: 'ticket_list', ticketIds })
  const draft = fx.drafts.filter((d) => !cancelled.has(d.id)).at(-1)
  if (draft) parts.push({ type: 'draft', draftId: draft.id })
  if (quickReplies?.length) parts.push({ type: 'quick_replies', options: quickReplies.slice(0, 4) })
  return parts
}

function failedTurn(
  recorder: TurnRecorder,
  modelId: string,
  latencyMs: number,
  err: unknown,
  attempts: number,
): TurnResult {
  const why = err instanceof Error ? err.message.slice(0, 200) : 'erro desconhecido'
  const transfer = recorder.effects.transfer
  return {
    reply: FAILURE_REPLY,
    parts: [],
    ...(transfer ? { transfer } : {}),
    decision: {
      intent: 'unclear',
      extracted: {},
      action: 'reply',
      confidence: 0,
      reason: `O modelo falhou neste turno (${why}). Nada foi registrado.`,
      toolsCalled: recorder.toolsCalled,
      ruleOverrides: [],
      source: 'code',
      model: modelId,
      latencyMs,
      usage: { inputTokens: 0, outputTokens: 0, modelCalls: 0, failedAttempts: attempts },
    },
  }
}
