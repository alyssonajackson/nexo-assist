import 'server-only'
import { createAssistAgent, modelFromEnv, type AssistAgent } from '@nexo/agent'
import { createTicketsClient, DEFAULT_RETRY, type ChatStreamEvent } from '@nexo/shared'
import { env } from '../env'

export type Emit = (event: ChatStreamEvent) => void

const globalForAgent = globalThis as unknown as { nexoAgent?: AssistAgent }

/** The agent is stateless (the conversation comes with each turn), so one instance serves every request. */
export function assistAgent(): AssistAgent {
  globalForAgent.nexoAgent ??= createAssistAgent()
  return globalForAgent.nexoAgent
}

export const llmModelId = modelFromEnv

/**
 * Tickets client acting as the signed-in user (privacy is enforced by the service from this token).
 * Retries are streamed to the chat as "sistema de chamados indisponível, tentando novamente".
 */
export function ticketsAs(accessToken: string, emit?: Emit) {
  return createTicketsClient({
    baseUrl: env.ticketsUrl,
    accessToken,
    retry: {
      ...DEFAULT_RETRY,
      onRetry: ({ attempt }) =>
        emit?.({
          type: 'status',
          status: 'tickets_retrying',
          attempt,
          message: 'Sistema de chamados indisponível, tentando novamente…',
        }),
    },
  })
}
