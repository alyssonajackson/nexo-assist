import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { turnOf } from '../context'
import { runTool } from './common'

export const searchKb = createTool({
  id: 'search_kb',
  description:
    'Busca artigos na central de ajuda de TI. Use antes de responder dúvidas ("como faço...", "qual o horário...") ' +
    'e antes de abrir um chamado, para ver se há uma solução que o funcionário pode aplicar sozinho.',
  inputSchema: z.object({ query: z.string().min(2).describe('Palavras-chave, ex.: "vpn erro 809"') }),
  execute: async ({ query }, ctx) => {
    const turn = turnOf(ctx.requestContext)
    return runTool(
      turn,
      'search_kb',
      async () => {
        const articles = await turn.ports.tickets.searchKb(query)
        turn.recorder.effects.kbArticleIds = articles.map((a) => a.id)
        return { ok: true as const, articles: articles.map(({ id, title, body }) => ({ id, title, body })) }
      },
      (r) =>
        r.articles.length
          ? `${r.articles.length} artigo(s): ${r.articles.map((a) => a.id).join(', ')}`
          : 'nenhum artigo',
    )
  },
})
