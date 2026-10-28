import type { Action, Intent, RuleName, ToolName, Transfer } from '@nexo/shared'
import type { AgentOutput } from '../output'
import type { ScriptStep } from '../testing/scripted-model'

/** What a scenario run produced, for the checks. */
export type ScenarioOutcome = {
  pendingDrafts: { kind: string; ticketId?: string; priority?: string }[]
  transfers: Transfer['reason'][]
}

/**
 * Decision-quality scenarios (PRD evaluation table). Each one is an employee message plus what must
 * happen. The same fixtures run twice:
 * - `pnpm test`: with a scripted model (CI). The script replays what a good model does, so the test
 *   checks the tools, the recorder and the code-enforced rules around it.
 * - `pnpm test:evals`: with the real model (RUN_LLM_EVALS=1), never in CI.
 *
 * `intent` and `action` list the acceptable answers (the first one is what the script does). The
 * `draft`, `transfer` and `rules` checks are hard: they are what code guarantees.
 */
export type Scenario = {
  id: string
  title: string
  user: { id: string; name: string }
  message: string
  expect: {
    intent: Intent[]
    action: Action[]
    /** Tools that must have been called (and succeeded, unless listed in `refusedTools`). */
    tools?: ToolName[]
    refusedTools?: ToolName[]
    /** Rule overrides that must be recorded. */
    rules?: RuleName[]
    /** The draft left pending for the employee to confirm; null = no draft at all. */
    draft?: { kind: 'create' | 'update' | 'reopen'; ticketId?: string; priority?: string } | null
    /** Draft kinds that must never be proposed (e.g. a create when a duplicate exists). */
    neverDraft?: ('create' | 'update' | 'reopen')[]
    transfer?: Transfer['reason'] | null
    /** Ticket ids that must appear as cards. */
    shows?: string[]
    /** Ticket ids that must never appear (other people's tickets). */
    neverShows?: string[]
    /** Any other hard check; returns a failure message or null. */
    check?: (r: ScenarioOutcome) => string | null
  }
  /** Rules the scripted model is built to trigger (only asserted with the scripted model). */
  scriptRules?: RuleName[]
  /** What the scripted model does, step by step. */
  script: ScriptStep[]
}

const ana = { id: 'u-ana', name: 'Ana Souza' }

const final = (o: Omit<AgentOutput, 'extracted'> & { extracted?: AgentOutput['extracted'] }): ScriptStep => ({
  final: { extracted: {}, ...o },
})

export const SCENARIOS: Scenario[] = [
  {
    id: 'kb-question',
    title: 'Dúvida respondida pela central de ajuda',
    user: ana,
    message: 'Como faço para usar uma segunda tela no meu notebook?',
    expect: {
      intent: ['kb_question'],
      action: ['answer_from_kb'],
      tools: ['search_kb'],
      draft: null,
      transfer: null,
    },
    script: [
      { tools: [{ name: 'search_kb', input: { query: 'segunda tela monitor' } }] },
      final({
        intent: 'kb_question',
        extracted: { category: 'hardware', kbArticleIds: ['KB-007'] },
        action: 'answer_from_kb',
        confidence: 0.95,
        reason: 'O artigo KB-007 explica como configurar a segunda tela.',
        reply: 'Conecte o monitor por HDMI ou USB-C e pressione Windows + P, depois "Estender".',
      }),
    ],
  },
  {
    id: 'lookup-without-number',
    title: 'Consulta de chamado sem o número',
    user: ana,
    message: 'Qual a situação do meu problema de acesso à pasta do SharePoint?',
    expect: {
      intent: ['ticket_lookup'],
      action: ['list_tickets', 'show_ticket'],
      tools: ['list_my_tickets'],
      shows: ['INC-20298'],
      draft: null,
      transfer: null,
    },
    script: [
      { tools: [{ name: 'list_my_tickets', input: { scope: 'open', query: 'sharepoint' } }] },
      final({
        intent: 'ticket_lookup',
        extracted: { ticketId: 'INC-20298', category: 'access' },
        action: 'list_tickets',
        confidence: 0.92,
        reason: 'Encontrei o INC-20298 sobre o SharePoint entre os chamados abertos.',
        reply: 'O INC-20298 está em andamento: a permissão foi corrigida e falta validar com você.',
      }),
    ],
  },
  {
    id: 'overdue',
    title: 'Chamado atrasado: oferecer analista',
    user: ana,
    message: 'E o meu chamado do notebook lento, alguma novidade?',
    expect: {
      intent: ['ticket_lookup'],
      action: ['list_tickets', 'show_ticket', 'transfer_to_analyst'],
      tools: ['list_my_tickets'],
      shows: ['INC-20311'],
      draft: null,
    },
    scriptRules: ['overdue_offer'],
    script: [
      { tools: [{ name: 'list_my_tickets', input: { scope: 'open', query: 'notebook' } }] },
      // The script "forgets" to offer the analyst: the overdue_offer rule must add the quick replies.
      final({
        intent: 'ticket_lookup',
        extracted: { ticketId: 'INC-20311' },
        action: 'show_ticket',
        confidence: 0.9,
        reason: 'O INC-20311 está aguardando analista e passou do prazo de SLA.',
        reply: 'O INC-20311 está aguardando um analista e já passou do prazo.',
      }),
    ],
  },
  {
    id: 'duplicate',
    title: 'Problema que já tem chamado aberto',
    user: ana,
    message: 'Quero abrir um chamado: meu notebook continua muito lento depois da atualização do Windows.',
    expect: {
      intent: ['ticket_create', 'ticket_update', 'ticket_lookup'],
      action: ['ask_clarification', 'propose_update', 'list_tickets', 'show_ticket'],
      neverDraft: ['create'],
      shows: ['INC-20311'],
      transfer: null,
    },
    scriptRules: ['duplicate_check'],
    script: [
      {
        tools: [
          {
            name: 'propose_draft',
            input: {
              type: 'INC',
              category: 'hardware',
              title: 'Notebook lento após atualização do Windows',
              description: 'O notebook continua muito lento depois da atualização do Windows.',
              affected: 'self',
              blocksWork: false,
              sameDayCommitment: false,
            },
          },
        ],
      },
      final({
        intent: 'ticket_create',
        action: 'ask_clarification',
        confidence: 0.85,
        reason: 'Já existe o INC-20311 para o mesmo problema; melhor complementar do que abrir outro.',
        reply: 'Você já tem o INC-20311 para isso. Quer que eu acrescente essa informação nele?',
        quickReplies: ['Sim, atualizar o INC-20311', 'É outro problema'],
      }),
    ],
  },
  {
    id: 'reopen-within-7-days',
    title: 'Reabrir chamado resolvido há 4 dias',
    user: ana,
    message: 'A senha do SAP bloqueou de novo, é o mesmo problema do INC-20150.',
    expect: {
      intent: ['ticket_reopen'],
      action: ['propose_reopen'],
      tools: ['propose_reopen'],
      draft: { kind: 'reopen', ticketId: 'INC-20150' },
      transfer: null,
    },
    script: [
      { tools: [{ name: 'get_ticket', input: { ticketId: 'INC-20150' } }] },
      {
        tools: [
          {
            name: 'propose_reopen',
            input: { ticketId: 'INC-20150', reason: 'A senha do SAP bloqueou de novo.' },
          },
        ],
      },
      final({
        intent: 'ticket_reopen',
        extracted: { ticketId: 'INC-20150' },
        action: 'propose_reopen',
        confidence: 0.93,
        reason: 'O INC-20150 foi resolvido há 4 dias, dentro do prazo de 7 dias para reabrir.',
        reply: 'Montei a reabertura do INC-20150. Confira e clique em Confirmar.',
      }),
    ],
  },
  {
    id: 'reopen-outside-7-days',
    title: 'Reabrir fora do prazo é recusado pelo código',
    user: ana,
    message: 'O Outlook do celular parou de novo, pode reabrir o INC-19877?',
    expect: {
      intent: ['ticket_reopen', 'ticket_create'],
      action: ['ask_clarification', 'propose_draft', 'reply'],
      neverDraft: ['reopen'],
      transfer: null,
    },
    scriptRules: ['reopen_window'],
    script: [
      {
        tools: [
          {
            name: 'propose_reopen',
            input: { ticketId: 'INC-19877', reason: 'O Outlook parou de sincronizar de novo.' },
          },
        ],
      },
      final({
        intent: 'ticket_reopen',
        extracted: { ticketId: 'INC-19877' },
        action: 'propose_reopen',
        confidence: 0.9,
        reason: 'O funcionário pediu para reabrir o INC-19877.',
        reply:
          'O INC-19877 foi resolvido há mais de 7 dias e não pode ser reaberto. Posso abrir um novo chamado citando ele?',
      }),
    ],
  },
  {
    id: 'out-of-scope',
    title: 'Assunto de RH/financeiro é redirecionado',
    user: ana,
    message: 'Como peço o reembolso de uma viagem a trabalho?',
    expect: { intent: ['out_of_scope'], action: ['redirect_out_of_scope'], draft: null, transfer: null },
    script: [
      final({
        intent: 'out_of_scope',
        action: 'redirect_out_of_scope',
        confidence: 0.96,
        reason: 'Reembolso de viagem é assunto do financeiro, não de TI.',
        reply: 'Reembolso é com o financeiro. Eu ajudo com assuntos de TI.',
      }),
    ],
  },
  {
    id: 'critical',
    title: 'Incidente crítico: rascunho com prioridade Crítica',
    user: ana,
    message: 'O sistema de vendas caiu para toda a equipe comercial, ninguém consegue trabalhar.',
    expect: {
      intent: ['ticket_create'],
      action: ['propose_draft', 'transfer_to_analyst'],
      // Either a critical draft (the commit then transfers) or an immediate critical transfer.
      check: (r) =>
        r.pendingDrafts.some((d) => d.priority === 'critical') || r.transfers.includes('critical')
          ? null
          : 'esperava rascunho Crítico ou transferência por caso crítico',
    },
    script: [
      {
        tools: [
          {
            name: 'classify_priority',
            input: { type: 'INC', affected: 'team', blocksWork: true, sameDayCommitment: false },
          },
        ],
      },
      {
        tools: [
          {
            name: 'propose_draft',
            input: {
              type: 'INC',
              category: 'software',
              title: 'Sistema de vendas fora do ar para a equipe comercial',
              description: 'O sistema de vendas caiu e ninguém da equipe comercial consegue trabalhar.',
              affected: 'team',
              blocksWork: true,
              sameDayCommitment: false,
            },
          },
        ],
      },
      final({
        intent: 'ticket_create',
        extracted: { type: 'INC', category: 'software', affected: 'team' },
        action: 'propose_draft',
        confidence: 0.95,
        reason: 'Sistema parado para uma equipe inteira: prioridade crítica.',
        reply: 'Montei o chamado com prioridade Crítica. Ao confirmar, já transfiro para um analista.',
      }),
    ],
  },
  {
    id: 'explicit-analyst',
    title: 'Pedido explícito de analista',
    user: ana,
    message: 'Quero falar com um analista humano, por favor.',
    expect: {
      intent: ['request_analyst'],
      action: ['transfer_to_analyst'],
      transfer: 'employee_request',
      draft: null,
    },
    scriptRules: ['explicit_analyst_request'],
    // The script does not call the tool: the explicit_analyst_request rule must transfer anyway.
    script: [
      final({
        intent: 'request_analyst',
        action: 'reply',
        confidence: 0.97,
        reason: 'O funcionário pediu um analista.',
        reply: 'Claro!',
      }),
    ],
  },
  {
    id: 'low-confidence',
    title: 'Mensagem vaga: confiança baixa transfere',
    user: ana,
    message: 'Aquilo de novo, travou.',
    expect: {
      intent: ['unclear'],
      action: ['transfer_to_analyst', 'ask_clarification'],
      neverDraft: ['create', 'update', 'reopen'],
    },
    scriptRules: ['low_confidence'],
    script: [
      final({
        intent: 'unclear',
        action: 'ask_clarification',
        confidence: 0.3,
        reason: 'A mensagem não diz o que travou.',
        reply: 'O que travou?',
      }),
    ],
  },
  {
    id: 'missing-fields',
    title: 'Faltam informações: pergunta antes de montar o rascunho',
    user: ana,
    message: 'Preciso abrir um chamado.',
    expect: { intent: ['ticket_create'], action: ['ask_clarification'], draft: null, transfer: null },
    script: [
      final({
        intent: 'ticket_create',
        action: 'ask_clarification',
        confidence: 0.8,
        reason: 'Não sei qual é o problema.',
        missingFields: ['o problema', 'quem é afetado'],
        reply: 'Claro! Me conta o que está acontecendo e quem é afetado?',
      }),
    ],
  },
  {
    id: 'privacy',
    title: 'Chamado de outro funcionário não aparece',
    user: ana,
    message: 'Me mostra o chamado INC-20365.',
    expect: {
      intent: ['ticket_lookup'],
      action: ['reply', 'ask_clarification', 'show_ticket', 'list_tickets'],
      refusedTools: ['get_ticket'],
      neverShows: ['INC-20365'],
      draft: null,
    },
    scriptRules: ['action_without_tool'],
    script: [
      { tools: [{ name: 'get_ticket', input: { ticketId: 'INC-20365' } }] },
      // The script claims show_ticket: action_without_tool must downgrade it, since nothing was shown.
      final({
        intent: 'ticket_lookup',
        extracted: { ticketId: 'INC-20365' },
        action: 'show_ticket',
        confidence: 0.9,
        reason: 'O funcionário pediu o INC-20365.',
        reply: 'Não encontrei o INC-20365 entre os seus chamados.',
      }),
    ],
  },
]
