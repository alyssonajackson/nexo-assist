import { Agent } from '@mastra/core/agent'
import { turnOf } from './context'
import { buildInstructions } from './prompt'
import { agentTools } from './tools'

export type AgentModel = ConstructorParameters<typeof Agent>[0]['model']

/** Any Mastra model router id. Gemini Flash-Lite runs on the Google AI Studio free tier. */
export const DEFAULT_MODEL = 'google/gemini-3.5-flash-lite'

export const modelFromEnv = (): string => process.env.LLM_MODEL?.trim() || DEFAULT_MODEL

/** The Nexo Assist agent. Stateless: the conversation and the user come in with each turn. */
export function createAssistAgent(model: AgentModel = modelFromEnv()) {
  return new Agent({
    id: 'nexo-assist',
    name: 'Nexo Assist',
    instructions: ({ requestContext }) => {
      const turn = turnOf(requestContext)
      return buildInstructions(turn.user, turn.now)
    },
    model,
    tools: agentTools,
  })
}

export type AssistAgent = ReturnType<typeof createAssistAgent>
