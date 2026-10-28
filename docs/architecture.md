# Arquitetura

Visão detalhada do Nexo Assist. O [README](../README.md) tem o resumo; aqui ficam os diagramas e os
fluxos que o README só cita.

## Componentes

```mermaid
flowchart LR
  browser["Navegador<br/>funcionário e analista"]

  subgraph web["apps/web (Next.js, Node)"]
    ui["UI: chat e console"]
    api["Rotas /api<br/>chat, drafts, console"]
    agent["packages/agent<br/>Mastra Agent + tools + policy.ts"]
    assistConsumer["consumer assist-events<br/>(instrumentation.ts)"]
  end

  subgraph tickets["services/tickets (Hono, Node)"]
    tapi["API REST<br/>chamados + central de ajuda"]
    flaky["simulação de instabilidade<br/>+ /_chaos/outage"]
    tconsumers["consumers<br/>ticket-writes, handoff-events"]
  end

  subgraph mongo["MongoDB (replica set rs0)"]
    assistDb[("assist<br/>users, conversations,<br/>messages, drafts")]
    ticketsDb[("tickets<br/>tickets, kb_articles,<br/>counters")]
  end

  subgraph aws["AWS: Floci local / AWS real online"]
    cognito["Cognito<br/>user pool, grupos<br/>employee e analyst"]
    subgraph sqs["SQS"]
      qWrites["ticket-writes<br/>+ DLQ"]
      qAssist["assist-events<br/>+ DLQ"]
      qHandoff["handoff-events<br/>+ DLQ"]
    end
  end

  llm["Gemini 3.5 Flash-Lite<br/>(LLM_MODEL)"]

  browser -- "HTTPS, cookie httpOnly" --> ui
  ui --> api
  api --> agent
  agent -- "prompt + tools" --> llm
  api -- "login, refresh" --> cognito
  agent -- "HTTP + JWT do funcionário<br/>retry com backoff" --> tapi
  api --> assistDb
  tapi --> ticketsDb
  tapi -- "verifica JWT (JWKS)" --> cognito
  api -- "escrita confirmada<br/>durante queda" --> qWrites
  qWrites --> tconsumers
  tconsumers -- "ticket.registered" --> qAssist
  qAssist --> assistConsumer
  assistConsumer --> assistDb
  api -- "transfer, take over,<br/>give back, close" --> qHandoff
  qHandoff --> tconsumers
  tconsumers --> ticketsDb
```

**Fronteira de serviço.** Só o tickets service lê e escreve o banco `tickets`; só o web lê e escreve o banco
`assist`. O web nunca abre o banco de chamados: tudo passa pela API HTTP, com o access token do
funcionário. O filtro de privacidade (`requesterId = sub do JWT`) mora no tickets service, então nenhum
prompt consegue ver chamado de outra pessoa: um chamado alheio responde 404.

**AWS atrás de interfaces.** `AuthProvider` (Cognito) e `EventQueue` (SQS) ficam em `packages/shared`,
com implementações em memória para os testes unitários. O código usa o AWS SDK v3 nos dois ambientes; só
mudam o endpoint e as credenciais (Floci em `:4566` localmente).

| Fila             | Produtor | Consumidor | Para quê                                                         |
| ---------------- | -------- | ---------- | ---------------------------------------------------------------- |
| `ticket-writes`  | web      | tickets    | escrita confirmada que não passou durante uma queda              |
| `assist-events`  | tickets  | web        | resultado dessa escrita (`ticket.registered` / `write_failed`)   |
| `handoff-events` | web      | tickets    | transferência, assumir, devolver, encerrar: timeline e auditoria |

Cada fila tem uma `<nome>-dlq`; uma mensagem recebida 5 vezes sem sucesso vai para a DLQ.

## Um turno do chat

```mermaid
sequenceDiagram
  autonumber
  actor F as Funcionário
  participant W as web /api/chat
  participant A as Agent (Mastra)
  participant L as LLM
  participant T as tickets service
  participant P as policy.ts
  participant DB as Mongo assist

  F->>W: POST mensagem (NDJSON stream)
  W->>DB: grava a mensagem, confere estado == agent e limite 30
  alt conversa com analista
    W-->>F: mensagem guardada, agent em silêncio
  else conversa com o agent
    W->>A: runTurn(últimas 20 mensagens + texto)
    A->>L: prompt + schema da decisão (1º passo exige uma tool)
    loop até 6 passos
      L->>A: chamada de tool
      A->>T: search_kb / list_my_tickets / get_ticket (JWT do funcionário)
      T-->>A: dados só do próprio funcionário
      A-->>W: chip "consultou seus chamados" (TurnRecorder)
      W-->>F: chip em tempo real
    end
    L-->>A: JSON: intent, extracted, action, confidence, reason, reply
    A-->>F: reply em streaming
    A->>P: applyPolicy(decisão do modelo, efeitos reais das tools)
    P-->>A: decisão final + ruleOverrides (transferir, perguntar, reabrir...)
    A-->>W: Decision completa (toolsCalled vem do código)
    W->>DB: grava a resposta com a Decision
    W-->>F: mensagem final, cards, opções rápidas
  end
```

O modelo **não tem tool de escrita**. `propose_draft`, `propose_update` e `propose_reopen` só criam um
rascunho no banco `assist`. Quem grava o chamado é o botão **Confirmar**:

```mermaid
sequenceDiagram
  actor F as Funcionário
  participant W as web /api/drafts/:id/confirm
  participant T as tickets service
  F->>W: Confirmar (clique, opção rápida ou ⌘↵)
  W->>W: pending → confirmed (update atômico)
  W->>W: commitDraft recusa tudo que não está confirmed
  W->>T: POST /tickets, Idempotency-Key = id do rascunho
  T-->>W: INC-20518
  W-->>F: "Registrado · INC-20518" (se Crítico: transfere para analista)
```

## Queda do sistema de chamados

```mermaid
sequenceDiagram
  autonumber
  actor F as Funcionário
  participant W as web
  participant T as tickets service
  participant Q1 as SQS ticket-writes
  participant Q2 as SQS assist-events
  participant DB as Mongo assist

  F->>W: Confirmar rascunho D-381
  W->>T: POST /tickets (Idempotency-Key D-381)
  T--xW: 503 (queda simulada)
  W-->>F: "sistema de chamados indisponível, tentando novamente"
  loop 4 tentativas, backoff exponencial com jitter (~5 s)
    W->>T: POST /tickets
    T--xW: 503
  end
  W->>Q1: {op: create, payload, idempotencyKey: D-381}
  W->>DB: rascunho → pending_registration
  W-->>F: card "pendente de registro"
  Note over T: consumer espera a queda acabar
  Q1->>T: mensagem D-381
  T->>T: cria o chamado (chave idempotente: nunca duplica)
  T->>Q2: ticket.registered {D-381, INC-20518}
  Q2->>W: consumer assist-events
  W->>DB: rascunho → committed + mensagem "Chamado INC-20518 registrado"
  W-->>F: polling (4 s) mostra o número real
  Note over Q1,Q2: falhou 5 vezes → DLQ
```

A leitura (consultar chamados, central de ajuda) usa o mesmo retry, mas não vai para a fila: se o sistema
continua fora, a tool falha, o chip aparece como "tentou consultar seus chamados" e o agent avisa.

## Estados da conversa

```mermaid
stateDiagram-v2
  [*] --> agent
  agent --> waiting_analyst: transferred
  waiting_analyst --> analyst: assumed
  waiting_analyst --> agent: released
  analyst --> agent: released
  waiting_analyst --> closed: closed
  analyst --> closed: closed
  closed --> [*]

  note right of agent
    Só aqui o LLM é chamado
  end note
  note right of analyst
    O agent fica em silêncio;
    só o analista responde
  end note
```

- Cada transição é um único `findOneAndUpdate({ _id, state: <origem> })`. Se dois analistas clicam em
  "Assumir atendimento" ao mesmo tempo, só um ganha.
- A transferência acontece por pedido do funcionário, caso crítico, chamado vencido (oferecida, com
  "sim") ou confiança abaixo de 0,5. Ela grava um resumo do caso, que o analista vê no console.
- Cada transição grava uma mensagem de sistema (o divisor "Transferida para Suporte N2 · 10:05") e
  publica um evento em `handoff-events` (`transferred`, `assumed`, `released`, `closed`). O tickets
  service põe o evento na timeline do chamado relacionado, que aparece no painel lateral do console.
- O evento é best effort: se a fila falha, a transição já aconteceu e não é desfeita.

## Persistência

| Banco     | Coleção         | Índices principais                                                                        |
| --------- | --------------- | ----------------------------------------------------------------------------------------- |
| `tickets` | `tickets`       | `{requesterId, status}`, `{updatedAt}`, texto em título/descrição, `idempotencyKey` único |
| `tickets` | `kb_articles`   | texto em título/corpo/tags                                                                |
| `tickets` | `counters`      | sequência de INC e REQ (`$inc`)                                                           |
| `assist`  | `users`         | `email` único (cópia do perfil; o Cognito é a fonte)                                      |
| `assist`  | `conversations` | `{state, assignedAnalystId, lastMessageAt}`, `{employeeId, lastMessageAt}`                |
| `assist`  | `messages`      | `{conversationId, createdAt}`; a Decision vai junto da mensagem                           |
| `assist`  | `drafts`        | `{conversationId, status}`                                                                |

Os índices são criados no start de cada serviço. Nenhum fluxo precisa de transação multi-documento:
escritas são de um documento só, e a idempotência vem de chave única ou de filtro
(`'timeline.key': {$ne: key}`).
