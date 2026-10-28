import { convertArrayToReadableStream } from 'ai/test'
import type { AgentModel } from '../agent'
import type { AgentOutput } from '../output'

/** One model step: either tool calls, or the final structured answer. */
export type ScriptStep =
  { tools: { name: string; input: Record<string, unknown> }[] } | { final: AgentOutput }

const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 50, text: 50, reasoning: 0 },
}

/**
 * A deterministic stand-in for the LLM (CI never calls a real model). It replays the steps a real model
 * would take, so the test exercises the real tools, recorder and policy around it.
 */
export function scriptedModel(steps: ScriptStep[]): AgentModel {
  let i = 0
  // A plain LanguageModelV4 object: ai/test's MockLanguageModelV4 has the same shape, but its types come
  // from a different @ai-sdk/provider copy than the one Mastra bundles.
  return {
    specificationVersion: 'v4' as const,
    provider: 'mock',
    modelId: 'scripted',
    supportedUrls: {},
    doGenerate: () => Promise.reject(new Error('the agent always streams')),
    doStream: async () => {
      const step = steps[Math.min(i++, steps.length - 1)]
      if (!step) throw new Error('empty script')
      if ('tools' in step) {
        return {
          stream: convertArrayToReadableStream([
            ...step.tools.map((t, n) => ({
              type: 'tool-call' as const,
              toolCallId: `call-${i}-${n}`,
              toolName: t.name,
              input: JSON.stringify(t.input),
            })),
            {
              type: 'finish' as const,
              usage,
              finishReason: { unified: 'tool-calls' as const, raw: undefined },
            },
          ]),
        }
      }
      const json = JSON.stringify(step.final)
      // Two chunks, so reply streaming is exercised.
      const cut = Math.floor(json.length / 2)
      return {
        stream: convertArrayToReadableStream([
          { type: 'text-start' as const, id: 't' },
          { type: 'text-delta' as const, id: 't', delta: json.slice(0, cut) },
          { type: 'text-delta' as const, id: 't', delta: json.slice(cut) },
          { type: 'text-end' as const, id: 't' },
          { type: 'finish' as const, usage, finishReason: { unified: 'stop' as const, raw: undefined } },
        ]),
      }
    },
  }
}
