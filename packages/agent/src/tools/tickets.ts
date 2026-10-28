import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { TicketsHttpError } from '@nexo/shared'
import { turnOf } from '../context'
import { refuse, runTool, ticketForModel } from './common'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export const listMyTickets = createTool({
  id: 'list_my_tickets',
  description:
    'Lista os chamados do funcionário autenticado (somente os dele). Use quando ele perguntar por chamados sem dar o número, ' +
    'ou para achar o chamado certo antes de atualizar ou reabrir. Cada chamado já vem com status, prazo de SLA e se está atrasado.',
  inputSchema: z.object({
    scope: z.enum(['open', 'all']).describe('"open" = em aberto; "all" inclui resolvidos e encerrados'),
    query: z.string().optional().describe('Palavras para filtrar, ex.: "notebook", "vpn"'),
  }),
  execute: async ({ scope, query }, ctx) => {
    const turn = turnOf(ctx.requestContext)
    return runTool(
      turn,
      'list_my_tickets',
      async () => {
        // No requesterId here on purpose: the service takes the user from the access token.
        let tickets = await turn.ports.tickets.listTickets({ scope, ...(query ? { q: query } : {}) })
        // A text filter with no hits falls back to the full list, so "meu chamado do note" still finds something.
        if (query && tickets.length === 0) tickets = await turn.ports.tickets.listTickets({ scope })
        const fx = turn.recorder.effects
        fx.shownTicketIds = tickets.map((t) => t.id)
        fx.shownAs = 'list'
        fx.overdueTicketIds = tickets.filter((t) => t.sla.overdue).map((t) => t.id)
        return { ok: true as const, tickets: tickets.map(ticketForModel) }
      },
      (r) => {
        const overdue = r.tickets.filter((t) => t.atrasado).length
        return (
          plural(r.tickets.length, 'chamado encontrado', 'chamados encontrados') +
          (overdue ? `, ${overdue} atrasado` : '')
        )
      },
    )
  },
})

export const getTicket = createTool({
  id: 'get_ticket',
  description:
    'Abre um chamado do funcionário pelo número (ex.: INC-20311 ou REQ-10442), com o histórico recente.',
  inputSchema: z.object({ ticketId: z.string().describe('Número do chamado, ex.: INC-20311') }),
  execute: async ({ ticketId }, ctx) => {
    const turn = turnOf(ctx.requestContext)
    const id = ticketId.trim().toUpperCase()
    return runTool(
      turn,
      'get_ticket',
      async () => {
        try {
          const t = await turn.ports.tickets.getTicket(id)
          const fx = turn.recorder.effects
          fx.shownTicketIds = [t.id]
          fx.shownAs = 'single'
          fx.overdueTicketIds = t.sla.overdue ? [t.id] : []
          const timeline = t.timeline
            .slice(-4)
            .map((e) => ({ em: e.at.toISOString(), tipo: e.kind, nota: e.note ?? null }))
          return {
            ok: true as const,
            ticket: { ...ticketForModel(t), descricao: t.description, historico: timeline },
          }
        } catch (err) {
          // The service answers 404 for other employees' tickets too, so their existence never leaks.
          if (err instanceof TicketsHttpError && err.status === 404) {
            return refuse('not_found', `Não encontrei o chamado ${id} entre os seus chamados.`)
          }
          throw err
        }
      },
      (r) => `${r.ticket.id}: ${r.ticket.status}${r.ticket.atrasado ? ', atrasado' : ''}`,
    )
  },
})
