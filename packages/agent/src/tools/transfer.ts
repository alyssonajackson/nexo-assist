import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { Transfer } from '@nexo/shared'
import { turnOf } from '../context'
import { refuse, runTool } from './common'

export const transferToAnalyst = createTool({
  id: 'transfer_to_analyst',
  description:
    'Transfere a conversa para um analista humano, com um resumo do caso. Use quando o funcionário pedir, quando o caso ' +
    'for crítico (parado para uma equipe ou a empresa) ou quando ele aceitar a transferência de um chamado atrasado. ' +
    'Depois disso você não responde mais nesta conversa até o analista devolvê-la.',
  inputSchema: z.object({
    reason: Transfer.shape.reason.describe('employee_request | critical | overdue | low_confidence'),
    summary: z
      .string()
      .min(20)
      .max(1000)
      .describe('Resumo para o analista: quem, o problema, o que já foi tentado, chamados relacionados'),
    ticketId: z.string().optional().describe('Chamado relacionado, se houver'),
  }),
  execute: async ({ reason, summary, ticketId }, ctx) => {
    const turn = turnOf(ctx.requestContext)
    return runTool(
      turn,
      'transfer_to_analyst',
      async () => {
        const transfer = {
          reason,
          summary,
          by: 'agent' as const,
          ...(ticketId ? { ticketId: ticketId.toUpperCase() } : {}),
        }
        // Atomic state change (agent -> waiting_analyst); from now on the chat API stops calling the agent.
        if (!(await turn.ports.handoff.transfer(turn.conversationId, transfer))) {
          return refuse('not_with_agent', 'Esta conversa já está com um analista.')
        }
        turn.recorder.effects.transfer = transfer
        return { ok: true as const, transferred: true }
      },
      () => 'resumo do caso enviado',
    )
  },
})
