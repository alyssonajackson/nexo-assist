import { describe, expect, it } from 'vitest'
import { createAssistAgent } from './agent'
import type { AgentOutput } from './output'
import { FAILURE_REPLY, isPhantomToolCall, runTurn, withTimeout } from './run-turn'
import { createInMemoryPorts } from './testing/in-memory-ports'
import { scriptedModel, type ScriptStep } from './testing/scripted-model'

describe('isPhantomToolCall', () => {
  it("recognizes Groq's rejections of a tool the model made up, or of a skipped forced tool", () => {
    expect(
      isPhantomToolCall(
        new Error(
          "Tool call validation failed: tool call validation failed: attempted to call tool 'JSON' which was not in request.tools",
        ),
      ),
    ).toBe(true)
    expect(isPhantomToolCall(new Error('Tool choice is required, but model did not call a tool'))).toBe(true)
  })

  it('ignores other failures', () => {
    expect(isPhantomToolCall(new Error('Rate limit reached'))).toBe(false)
    expect(isPhantomToolCall('boom')).toBe(false)
  })
})

const PHANTOM =
  "Tool call validation failed: tool call validation failed: attempted to call tool 'JSON' which was not in request.tools"
const answer: AgentOutput = {
  intent: 'ticket_create',
  extracted: {},
  action: 'ask_clarification',
  confidence: 0.8,
  reason: 'Faltam detalhes.',
  reply: 'O que aconteceu?',
}

async function turnWith(steps: ScriptStep[]) {
  const calls: { toolChoice?: unknown; tools?: unknown[] }[] = []
  const user = { id: 'u-ana', name: 'Ana Souza' }
  const result = await runTurn({
    agent: createAssistAgent(scriptedModel(steps, calls)),
    modelId: 'mock/scripted',
    user,
    conversationId: 'c-1',
    history: [],
    text: 'Quero abrir um chamado',
    ports: createInMemoryPorts(user.id, new Date()).ports,
  })
  return { result, calls }
}

describe('runTurn retries', () => {
  it('after a phantom tool call, retries once with no tools and counts the failed attempt', async () => {
    const { result, calls } = await turnWith([{ error: PHANTOM }, { final: answer }])
    expect(result.decision).toMatchObject({ source: 'model', action: 'ask_clarification' })
    expect(result.decision.usage).toMatchObject({ modelCalls: 1, failedAttempts: 1 })
    expect(calls).toHaveLength(2)
    expect(calls[0]?.toolChoice).toEqual({ type: 'required' })
    expect(calls[1]?.toolChoice).toEqual({ type: 'none' })
    expect(calls[1]?.tools ?? []).toEqual([])
  })

  it('a failed stream does not hang the turn: both attempts fail, the turn answers with the failure reply', async () => {
    const { result } = await turnWith([{ error: PHANTOM }, { error: PHANTOM }])
    expect(result.reply).toBe(FAILURE_REPLY)
    expect(result.decision).toMatchObject({ source: 'code', usage: { modelCalls: 0, failedAttempts: 2 } })
  })

  it('other errors are retried with the tools, as before', async () => {
    const { calls } = await turnWith([{ error: 'MALFORMED_FUNCTION_CALL' }, { final: answer }])
    expect(calls[1]?.toolChoice).toEqual({ type: 'required' })
  })
})

describe('withTimeout', () => {
  it('returns the fallback when the promise never settles or rejects', async () => {
    expect(await withTimeout(new Promise<number>(() => {}), 10, -1)).toBe(-1)
    expect(await withTimeout(Promise.reject(new Error('x')), 10, -1)).toBe(-1)
    expect(await withTimeout(Promise.resolve(7), 10, -1)).toBe(7)
  })
})
