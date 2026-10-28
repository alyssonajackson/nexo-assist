import type { AgentModel } from '../agent'
import type { AgentOutput } from '../output'

/**
 * A scripted stand-in for the LLM, for the browser e2e tests and for UI work without spending the
 * free-tier quota: `LLM_MODEL=demo`. Unlike scriptedModel (one fixed script per test), it picks a
 * script from the employee's message, so a whole conversation can be clicked through. The real tools,
 * recorder and policy still run around it; only the model's choices are canned.
 *
 *   "minha VPN não conecta"        -> searches the KB, asks who is affected (quick replies)
 *   "Só eu, tenho reunião às 14h"  -> classifies the priority and proposes a draft
 *   "status dos meus chamados"     -> lists the open tickets
 *   "INC-20311 · …"                -> opens that ticket
 *   "quero falar com um analista"  -> transfers
 *   anything else                  -> a plain answer
 */
type Step = { tools: { name: string; input: Record<string, unknown> }[] } | { final: AgentOutput }

type Script = { match: RegExp; steps: (text: string) => Step[] }

const final = (o: Omit<AgentOutput, 'extracted'> & { extracted?: AgentOutput['extracted'] }): Step => ({
  final: { extracted: {}, ...o },
})

const SCRIPTS: Script[] = [
  {
    match: /^s[óo] eu/i,
    steps: () => [
      {
        tools: [
          {
            name: 'classify_priority',
            input: { type: 'INC', affected: 'self', blocksWork: true, sameDayCommitment: true },
          },
          {
            name: 'propose_draft',
            input: {
              type: 'INC',
              affected: 'self',
              blocksWork: true,
              sameDayCommitment: true,
              category: 'network_vpn',
              title: 'VPN com erro 809',
              description: 'Erro 809 ao conectar na VPN. Reunião com cliente às 14h.',
            },
          },
        ],
      },
      final({
        intent: 'ticket_create',
        extracted: {
          type: 'INC',
          category: 'network_vpn',
          affected: 'self',
          sameDayCommitment: true,
          title: 'VPN com erro 809',
        },
        action: 'propose_draft',
        confidence: 0.88,
        reason:
          'Só a funcionária é afetada, mas há uma reunião hoje em risco: prioridade alta pela matriz do Anexo A.',
        reply: 'Coloquei prioridade alta por causa da reunião. Confira antes de eu criar:',
      }),
    ],
  },
  {
    match: /vpn|809/i,
    steps: () => [
      {
        // Only the KB: listing the tickets would show an overdue one and trigger the overdue rule.
        tools: [{ name: 'search_kb', input: { query: 'vpn erro 809' } }],
      },
      final({
        intent: 'ticket_create',
        extracted: { type: 'INC', category: 'network_vpn' },
        action: 'ask_clarification',
        confidence: 0.82,
        reason:
          'Não há chamado aberto sobre VPN e o artigo da central não resolve no Windows 11. Falta saber quem é afetado.',
        missingFields: ['Quem é afetado'],
        quickReplies: ['Só eu', 'Minha equipe', 'Toda a empresa', 'Não sei'],
        reply:
          'Não há chamado aberto sobre VPN, e o artigo do erro 809 vale só para Windows 10. Vou abrir um chamado.\n\nQuem está sendo afetado?',
      }),
    ],
  },
  {
    match: /^(INC|REQ)-\d{5}/i,
    steps: (text) => {
      const ticketId = text.slice(0, 9).toUpperCase()
      return [
        { tools: [{ name: 'get_ticket', input: { ticketId } }] },
        final({
          intent: 'ticket_lookup',
          extracted: { ticketId },
          action: 'show_ticket',
          confidence: 0.95,
          reason: `A funcionária escolheu o ${ticketId} na lista.`,
          reply: `Aqui está o ${ticketId}.`,
        }),
      ]
    },
  },
  {
    match: /analista|atendente|humano/i,
    steps: (text) => [
      {
        tools: [
          {
            name: 'transfer_to_analyst',
            input: { reason: 'employee_request', summary: `A funcionária pediu um analista: "${text}"` },
          },
        ],
      },
      final({
        intent: 'request_analyst',
        action: 'transfer_to_analyst',
        confidence: 0.97,
        reason: 'Pedido explícito para falar com um analista.',
        reply: 'Certo, vou chamar um analista. Ele já recebe um resumo da conversa.',
      }),
    ],
  },
  {
    match: /status|chamado|andamento/i,
    steps: () => [
      { tools: [{ name: 'list_my_tickets', input: { scope: 'open' } }] },
      final({
        intent: 'ticket_lookup',
        action: 'list_tickets',
        confidence: 0.9,
        reason: 'Pediu o status sem dizer o número: listei os chamados abertos para escolher.',
        reply: 'Estes são os seus chamados abertos. Sobre qual deles quer saber?',
      }),
    ],
  },
]

const FALLBACK: Script = {
  match: /.*/,
  steps: () => [
    { tools: [{ name: 'search_kb', input: { query: 'dúvida' } }] },
    final({
      intent: 'smalltalk',
      action: 'reply',
      confidence: 0.9,
      reason: 'Mensagem sem pedido de TI identificável.',
      reply: 'Posso tirar dúvidas de TI, abrir chamados e consultar os seus. Em que posso ajudar?',
    }),
  ],
}

type PromptMessage = { role: string; content: unknown }

const textOf = (m: PromptMessage): string =>
  typeof m.content === 'string'
    ? m.content
    : Array.isArray(m.content)
      ? m.content
          .map((p: unknown) =>
            typeof p === 'object' && p !== null && 'text' in p && typeof p.text === 'string' ? p.text : '',
          )
          .join('')
      : ''

/** The employee's message and how many model steps already ran in this turn. */
function turnOf(prompt: PromptMessage[]): { text: string; step: number } {
  const lastUser = prompt.findLastIndex((m) => m.role === 'user')
  const step = prompt.slice(lastUser + 1).filter((m) => m.role === 'assistant').length
  return { text: lastUser >= 0 ? textOf(prompt[lastUser]!).trim() : '', step }
}

const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
}

/** Chunks with a small delay, so the UI shows real streaming. */
function delayedStream<T>(chunks: T[], delayMs: number): ReadableStream<T> {
  return new ReadableStream<T>({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
      }
      controller.close()
    },
  })
}

export function demoModel({ delayMs = 25 }: { delayMs?: number } = {}): AgentModel {
  return {
    specificationVersion: 'v4' as const,
    provider: 'demo',
    modelId: 'demo',
    supportedUrls: {},
    doGenerate: () => Promise.reject(new Error('the agent always streams')),
    doStream: async (options: { prompt: PromptMessage[] }) => {
      const { text, step: n } = turnOf(options.prompt)
      const script = SCRIPTS.find((s) => s.match.test(text)) ?? FALLBACK
      const steps = script.steps(text)
      const step = steps[Math.min(n, steps.length - 1)]!
      if ('tools' in step) {
        return {
          stream: delayedStream(
            [
              ...step.tools.map((t, i) => ({
                type: 'tool-call' as const,
                toolCallId: `demo-${n}-${i}`,
                toolName: t.name,
                input: JSON.stringify(t.input),
              })),
              {
                type: 'finish' as const,
                usage,
                finishReason: { unified: 'tool-calls' as const, raw: undefined },
              },
            ],
            delayMs * 4,
          ),
        }
      }
      const json = JSON.stringify(step.final)
      const deltas = json.match(/[\s\S]{1,12}/g) ?? []
      return {
        stream: delayedStream(
          [
            { type: 'text-start' as const, id: 't' },
            ...deltas.map((delta) => ({ type: 'text-delta' as const, id: 't', delta })),
            { type: 'text-end' as const, id: 't' },
            { type: 'finish' as const, usage, finishReason: { unified: 'stop' as const, raw: undefined } },
          ],
          delayMs,
        ),
      }
    },
  }
}
