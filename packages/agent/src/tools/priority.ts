import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { Affected, derivePriority, PRIORITY_LABELS, SLA_RULES, TicketType } from '@nexo/shared'
import { turnOf } from '../context'
import { runTool } from './common'

/** The facts the model extracts; derivePriority (pure, unit-tested) turns them into a priority. */
export const PriorityFactsInput = z.object({
  type: TicketType.describe('INC = algo quebrou ou parou; REQ = pedido de acesso, equipamento ou software'),
  affected: Affected.describe('Quem é afetado: self (só a pessoa), team, company, unknown'),
  blocksWork: z.boolean().describe('Impede de trabalhar (não há alternativa)'),
  sameDayCommitment: z.boolean().describe('Há um compromisso hoje em risco (reunião, entrega, prazo)'),
})

export const classifyPriority = createTool({
  id: 'classify_priority',
  description:
    'Classifica a prioridade pela matriz do Anexo A, a partir dos fatos do caso. Você informa os fatos; a prioridade e o SLA vêm do código.',
  inputSchema: PriorityFactsInput,
  execute: async (facts, ctx) => {
    const turn = turnOf(ctx.requestContext)
    return runTool(
      turn,
      'classify_priority',
      async () => {
        const result = derivePriority(facts)
        turn.recorder.effects.priority = result
        return {
          ok: true as const,
          priority: result.priority,
          label: PRIORITY_LABELS[result.priority],
          sla: SLA_RULES[result.priority].label,
          rationale: result.rationale,
        }
      },
      (r) => `${r.label} (SLA ${r.sla})`,
    )
  },
})
