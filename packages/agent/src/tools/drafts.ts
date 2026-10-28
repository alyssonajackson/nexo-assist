import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import {
  AFFECTED_LABELS,
  CATEGORY_LABELS,
  Category,
  derivePriority,
  PRIORITY_LABELS,
  REOPEN_WINDOW_DAYS,
  SLA_RULES,
  TicketsHttpError,
  type Draft,
  type TicketView,
} from '@nexo/shared'
import { turnOf, type TurnContext } from '../context'
import { refuse, runTool, ticketForModel, type ToolRefusal } from './common'
import { PriorityFactsInput } from './priority'

/**
 * The model can only PROPOSE. Each tool saves a `pending` draft (D-381) and the employee confirms it
 * with the Confirmar button; only then does commitDraft write to the tickets service.
 */
const NOT_YET =
  'Ainda NÃO foi registrado: mostre o rascunho e peça para o funcionário confirmar pelo botão Confirmar.'

const draftCreated = (turn: TurnContext, draft: Draft) => {
  turn.recorder.effects.drafts.push(draft)
  return draft.id
}

async function loadOwnTicket(turn: TurnContext, ticketId: string): Promise<TicketView | ToolRefusal> {
  const id = ticketId.trim().toUpperCase()
  try {
    const ticket = await turn.ports.tickets.getTicket(id)
    turn.recorder.effects.shownTicketIds = [ticket.id]
    turn.recorder.effects.shownAs = 'single'
    return ticket
  } catch (err) {
    if (err instanceof TicketsHttpError && err.status === 404) {
      return refuse('not_found', `Não encontrei o chamado ${id} entre os seus chamados.`)
    }
    throw err
  }
}

export const proposeDraft = createTool({
  id: 'propose_draft',
  description:
    'Monta o rascunho de um NOVO chamado para o funcionário confirmar. Exige todos os campos do Anexo A. ' +
    'O código calcula a prioridade e procura chamados parecidos: se houver, a ferramenta recusa e você deve ' +
    'propor atualizar ou reabrir o existente, ou chamar de novo com notDuplicateOf explicando por que é outro problema.',
  inputSchema: PriorityFactsInput.extend({
    category: Category,
    title: z.string().min(5).max(120).describe('Título curto, ex.: "VPN com erro 809 no Windows 11"'),
    description: z.string().min(10).max(4000).describe('O que acontece, desde quando, o que já tentou'),
    notDuplicateOf: z
      .object({ ticketIds: z.array(z.string()).min(1), reason: z.string().min(5) })
      .optional()
      .describe(
        'Só depois de uma recusa por duplicidade: chamados parecidos que NÃO são o mesmo problema, e por quê',
      ),
  }),
  execute: async (input, ctx) => {
    const turn = turnOf(ctx.requestContext)
    return runTool(
      turn,
      'propose_draft',
      async () => {
        // Annex A: "who is affected" is a required field; the model must ask instead of guessing.
        if (input.affected === 'unknown') {
          return refuse(
            'missing_fields',
            'Para montar o chamado, preciso saber quem é afetado: só você, sua equipe ou toda a empresa?',
            { hint: 'Pergunte quem é afetado antes de chamar propose_draft de novo.' },
          )
        }

        // Annex A: no duplicates. Code finds the candidates; the model may only rule one out with a reason.
        const candidates = await turn.ports.tickets.findDuplicates(`${input.title} ${input.description}`)
        const ruledOut = new Set(input.notDuplicateOf?.ticketIds.map((id) => id.toUpperCase()) ?? [])
        const open = candidates.filter((c) => !ruledOut.has(c.ticket.id))
        if (open.length) {
          turn.recorder.effects.shownTicketIds = open.map((c) => c.ticket.id)
          turn.recorder.effects.shownAs = 'list'
          turn.recorder.override({
            rule: 'duplicate_check',
            from: 'propose_draft',
            why: `Já existe chamado parecido: ${open.map((c) => c.ticket.id).join(', ')}.`,
          })
          const ids = open.map((c) => c.ticket.id).join(', ')
          return refuse(
            'possible_duplicates',
            `Antes de abrir outro chamado: você já tem ${ids}, que pode ser o mesmo problema. É o mesmo caso? Se for, eu complemento o chamado existente.`,
            {
              hint:
                'Compare os candidatos com o pedido. Se for o mesmo problema: propose_update (em aberto) ou ' +
                `propose_reopen (resolvido há até ${REOPEN_WINDOW_DAYS} dias). Se for claramente outro assunto: ` +
                'chame propose_draft de novo AGORA, com notDuplicateOf (ids e motivo).',
              details: { candidates: open.map((c) => ticketForModel(c.ticket)) },
            },
          )
        }
        if (input.notDuplicateOf) {
          turn.recorder.override({
            rule: 'duplicate_check',
            why: `Não é duplicado de ${[...ruledOut].join(', ')}: ${input.notDuplicateOf.reason}`,
          })
        }

        const { priority, rationale } = derivePriority(input)
        turn.recorder.effects.priority = { priority, rationale }
        const fields = {
          type: input.type,
          category: input.category,
          title: input.title,
          description: input.description,
          priority,
          affected: input.affected,
        }
        const draft = await turn.ports.drafts.propose({
          conversationId: turn.conversationId,
          employeeId: turn.user.id,
          kind: 'create',
          fields,
        })
        return {
          ok: true as const,
          draftId: draftCreated(turn, draft),
          rascunho: {
            tipo: fields.type,
            categoria: CATEGORY_LABELS[fields.category],
            titulo: fields.title,
            descricao: fields.description,
            prioridade: PRIORITY_LABELS[priority],
            motivoPrioridade: rationale,
            sla: SLA_RULES[priority].label,
            afetados: AFFECTED_LABELS[fields.affected],
          },
          instrucao: NOT_YET,
        }
      },
      (r) => `${r.draftId}: ${r.rascunho.tipo} · ${r.rascunho.prioridade}`,
    )
  },
})

export const proposeUpdate = createTool({
  id: 'propose_update',
  description:
    'Monta o rascunho de uma atualização (novo comentário) em um chamado EM ABERTO do funcionário, para ele confirmar. ' +
    'Use quando o problema relatado já tem chamado aberto, em vez de abrir outro.',
  inputSchema: z.object({
    ticketId: z.string(),
    note: z.string().min(5).max(4000).describe('O que o funcionário quer acrescentar, escrito por você'),
  }),
  execute: async ({ ticketId, note }, ctx) => {
    const turn = turnOf(ctx.requestContext)
    return runTool(
      turn,
      'propose_update',
      async () => {
        const ticket = await loadOwnTicket(turn, ticketId)
        if ('ok' in ticket) return ticket
        if (ticket.status === 'resolved') {
          return refuse(
            'resolved',
            `O ${ticket.id} já está resolvido. Se o problema voltou, posso reabri-lo.`,
            {
              hint: 'Use propose_reopen.',
            },
          )
        }
        if (ticket.status === 'closed') {
          return refuse(
            'closed',
            `O ${ticket.id} está encerrado e não aceita mais atualizações. Posso abrir um novo chamado citando ele.`,
            { hint: 'Proponha um novo chamado (propose_draft).' },
          )
        }
        const draft = await turn.ports.drafts.propose({
          conversationId: turn.conversationId,
          employeeId: turn.user.id,
          kind: 'update',
          ticketId: ticket.id,
          note,
        })
        return {
          ok: true as const,
          draftId: draftCreated(turn, draft),
          ticket: ticketForModel(ticket),
          note,
          instrucao: NOT_YET,
        }
      },
      (r) => `${r.draftId}: atualizar ${r.ticket.id}`,
    )
  },
})

export const proposeReopen = createTool({
  id: 'propose_reopen',
  description: `Monta o rascunho de reabertura de um chamado RESOLVIDO há até ${REOPEN_WINDOW_DAYS} dias, para o funcionário confirmar.`,
  inputSchema: z.object({
    ticketId: z.string(),
    reason: z.string().min(5).max(4000).describe('Por que o problema voltou'),
  }),
  execute: async ({ ticketId, reason }, ctx) => {
    const turn = turnOf(ctx.requestContext)
    return runTool(
      turn,
      'propose_reopen',
      async () => {
        const ticket = await loadOwnTicket(turn, ticketId)
        if ('ok' in ticket) return ticket
        // Annex A: reopen only within 7 days of resolution (sla.reopenable is computed by the service).
        if (!ticket.sla.reopenable) {
          turn.recorder.override({
            rule: 'reopen_window',
            from: 'propose_reopen',
            why: `${ticket.id} não pode ser reaberto (${ticket.status === 'resolved' ? `resolvido há mais de ${REOPEN_WINDOW_DAYS} dias` : 'não está resolvido'}).`,
          })
          const finished = ticket.status === 'resolved' || ticket.status === 'closed'
          return refuse(
            'not_reopenable',
            finished
              ? `O ${ticket.id} passou do prazo de ${REOPEN_WINDOW_DAYS} dias para reabrir. Posso abrir um novo chamado citando ele.`
              : `O ${ticket.id} ainda está em aberto; posso acrescentar a informação nele.`,
            {
              hint: finished
                ? 'Proponha um novo chamado (propose_draft) citando o antigo.'
                : 'Use propose_update.',
            },
          )
        }
        const draft = await turn.ports.drafts.propose({
          conversationId: turn.conversationId,
          employeeId: turn.user.id,
          kind: 'reopen',
          ticketId: ticket.id,
          note: reason,
        })
        return {
          ok: true as const,
          draftId: draftCreated(turn, draft),
          ticket: ticketForModel(ticket),
          reason,
          instrucao: NOT_YET,
        }
      },
      (r) => `${r.draftId}: reabrir ${r.ticket.id}`,
    )
  },
})
