# CLAUDE.md - Nexo Assist

Take-home assessment for a hiring process: an AI chat agent for a fictional company's IT service desk ("Nexo"). The repo will be public on GitHub and discussed in a live interview, where the reviewers will ask for small changes to the code. The code has to be easy to explain and easy to change.

## Source of truth

- `_specs/Desafio_Tecnico_Nexo_Assist_PRD_v5.pdf`: the PRD (PT-BR). Read all of it before you plan anything. Annex A (service-desk rules) and the evaluation table on page 3 decide what "done" means.
- `_specs/*.png`: the prototype screens, which are the visual reference. Follow the layout and style closely; details are up to us.
  - `Identificação`: login (screen 1).
  - `Chat — Novo chamado`: opening a ticket (screen 2).
  - `Chat — Consulta e transferência`: ticket lookup and handoff (screen 3).
  - `Atendente — Conversas`: analyst console, transferred conversation (screen 4).
  - `Atendente — Atendimento assumido`: analyst taking over (screen 5).
  - `Cliente — Meu perfil`: employee profile. It is an extra screen that the PRD does not list.
- The data in the prototype is illustrative. Seed data is ours to create, following Annex B.
- `_specs/` is gitignored and never committed. Never write the hiring company's name in any tracked file, commit message, or seed data. The project is "Nexo Assist" only.

## Must-haves (PRD)

1. Login: corporate email plus password for the seeded employees, through Cognito (see "AWS services"; the PRD says any password is accepted, we relax that and document it).
2. Employee chat: streaming replies, ticket cards, ticket selection, a draft the employee confirms before anything is created, quick-reply options, and a limit of 30 messages per session (show "n/30").
3. The agent decides what to do on each message, using the help center (KB) and the ticket service, under the Annex A rules.
4. Simulated ticket service: a separate process from the agent, with query, create, update, reopen, and transfer operations. It simulates the legacy system's flakiness, being unavailable for a few seconds now and then. Clients retry with backoff and show a clear error state.
5. Handoff: the conversation is marked as waiting for an analyst, and the agent stays silent until the conversation is released.
6. Analyst console: a conversation list with filters and status (Todas / Para voce / Com o agent / Minhas), the conversation history, take over (agent paused), give back to the agent, close, and a side panel with the employee's tickets.
7. Decision visibility, which the PRD calls the MOST IMPORTANT part. Above each reply, show action chips ("consultou seus chamados", "classificou a prioridade"). Expanding the chips, or opening a side panel, shows the details: what the agent understood (intent and extracted fields), which action it took, its confidence, and why.
8. Conversations, tickets, and each conversation's state (agent or analyst) persist across restarts. "Voltar outro dia e continuar de onde parei" must work.

## Annex A rules (enforce them in code, not only in the prompt)

- Ticket types: INC (incident: something broke or stopped working) and REQ (request: access, equipment, software).
- Categories: Acesso, Rede e VPN, Hardware, Software, E-mail, Outros.
- Every ticket needs a title, description, type, category, priority, and who is affected. The agent shows a draft and creates or updates the ticket ONLY after the employee confirms it. The confirmation is a real state: the create tool refuses to run without a confirmed draft id.
- No duplicates. If an open ticket covers the same problem, update that ticket. A ticket resolved up to 7 days ago can be reopened.
- Transfer when the employee asks for it, when the case is critical, when the ticket is overdue, or when the agent's confidence is low (pick a threshold and document it). The transfer carries a case summary. While an analyst holds the conversation, the agent never replies.
- Privacy: an employee only ever sees their own tickets. Filter by the authenticated user id inside the ticket service, never only in the prompt.
- Scope: IT only. Redirect HR, finance, and facilities topics.
- Priority and SLA. The SLA applies to the first response and to each update; past it, the ticket is overdue:
  - Critica: down for a team or the company. SLA 1 h.
  - Alta: blocks one person, or a same-day commitment is at risk. SLA 4 business hours.
  - Media: in the way, but a workaround exists. SLA 3 business days.
  - Baixa: requests and improvements without urgency. SLA 5 business days.
- Business hours are Monday to Friday, 8h to 18h, per the sample KB article. SLA math lives in pure, unit-tested functions.

## Stack and architecture

- TypeScript with `strict: true` everywhere, and no `any`.
- pnpm monorepo:
  - `apps/web`: Next.js (App Router) with the employee chat and the analyst console.
  - `services/tickets`: a small HTTP API (Hono or Fastify) that owns the ticket and KB data, plus the flakiness simulation and the SQS consumer.
  - `packages/agent`: the Mastra agent, its tools, the decision schema, and the prompts.
  - `packages/shared`: types and zod schemas shared across the packages.
- Agent framework: Mastra, the PRD's preference. Mastra's API changes often, so check the current docs (the Mastra docs MCP server, or mastra.ai/docs) before you write agent code; don't rely on memory.
- LLM: Google Gemini 3.5 Flash-Lite by default (Google AI Studio free tier; Alysson has no paid Anthropic plan), with the provider and model set through env (`LLM_MODEL`, e.g. `anthropic/claude-haiku-4-5` also works). The README explains the choice, the free-tier limits, and estimates the cost per conversation.
- Structured decision per turn: the agent produces a typed `Decision` (`intent`, `extracted`, `action`, `confidence` 0-1, `reason`, `toolsCalled[]`). It is stored with each assistant message and drives both the action chips and the detail panel.
- The LLM interprets the message; code enforces the rules: draft confirmation, privacy, the agent pause during handoff, SLA and overdue, deduplication candidates, and the 30-message limit.
- Persistence: MongoDB (Alysson knows it best, which matters for the live-change interview). Use two databases, `tickets` (owned only by the tickets service) and `assist` (owned only by the web/agent side: users, conversations, messages, decisions), which keeps the service boundary real. Use the official `mongodb` driver with zod-validated documents; no Mongoose. Indexes are created at startup in code: tickets by `requesterId` + `status`, by `updatedAt`, and a text index on title/description; conversations by `state` + `assignedAnalystId`.
  - Multi-document transactions need a replica set. Atlas has one. Locally, run `mongo` as a single-node replica set (`--replSet rs0` plus `rs.initiate()` in the init container). Prefer designs that need no transactions (single-document writes, or an outbox) where it is simple.
  - Mastra storage and memory: check the docs for a MongoDB adapter (`@mastra/mongodb`) and use it if it exists; otherwise keep Mastra's working memory out of the critical path and store conversation history in our own collections.
- Seed data is generated relative to "now", so that "overdue", "resolved 4 days ago", and similar states stay true whenever the app runs. Seed 3-5 employees (one of them an analyst), 5-10 KB articles, and tickets in varied states, including other employees' tickets.

## AWS services (a deliberate showcase of AWS knowledge)

Alysson wants the reviewers to see hands-on AWS skills, so two AWS services are used for real reasons, behind interfaces:

- **Cognito** (auth): the login screen is a PRD requirement. A user pool with two groups, `employee` and `analyst`. The JWT supplies the `userId` and the role, and the tickets service uses them to enforce privacy. Seeded users have fixed, documented passwords (for example `nexo123`); the PRD's "any password" is relaxed on purpose and the README says so.
- **SQS** (resilience and events, never in the employee's happy path): the employee must see the real ticket number right after confirming the draft, so reads and writes call the tickets service synchronously, with retry and backoff. SQS is used for:
  - **Writes during an outage:** if the tickets service is still down after the retries, the confirmed write is enqueued. The chat says it will be registered as soon as the system is back, and shows the ticket as "pendente de registro". The consumer applies it later and the conversation is updated with the number. Writes must be idempotent (client-generated idempotency key), and failed messages go to a dead-letter queue.
  - **Handoff events:** transfer, take over, give back, and close events feed the analyst console and an audit trail.
  - Note: "Resolução sem fila" in the PRD means resolving without the human support queue (no analyst needed). It is not about message queues. Do not confuse the two in the README.
- No S3, DynamoDB, EC2, or ECS. Nothing in the PRD calls for them, and they would only add noise. MongoDB is the database.
- Code uses the real AWS SDK v3 and nothing else. The only difference between environments is the endpoint and the credentials.
- Both services sit behind small interfaces (`AuthProvider`, `EventQueue`), with in-memory/local fallbacks for unit tests.

Environments:

- **Local (Docker):** Floci (MIT, no account or token), one pinned container on `:4566` that emulates both Cognito and SQS. LocalStack is not an option: since March 2026 it requires an account and an auth token. (History: we started on cognito-local + ElasticMQ, then swapped to Floci after a spike, nx-4qf.) The init script creates the queues and DLQs through the AWS SDK (`ensureQueues()`). Dummy AWS credentials live in `.env.example`. A reviewer must be able to run everything with no AWS account.
- **Online (after the project is done):** Alysson's personal AWS account with a real Cognito user pool and real SQS queues, created with a small script or IaC (CDK or Terraform, whichever is quicker to explain). Guardrails: a dedicated IAM user with least privilege (only Cognito and SQS for this project), an AWS Budget alert, no secrets in git, and the IAM keys only in the hosting platform's secrets.

## Running locally (Docker)

- `docker compose up --build` must bring up the whole app: mongo (single-node replica set), Floci (Cognito and SQS), the tickets service, and web. The replica set, indexes, the Cognito user pool with seeded users, the queues, and the seed data are created automatically on the first start (an init container or script).
- Every key goes in `.env`, which is gitignored. `.env.example` lists all the variables. No secret ever goes in the code or the image.
- Document a fast dev loop in the README as well (`pnpm dev` against the dockerized mongo, Cognito, and SQS emulators).

## Commands (for working sessions)

- Checks: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test` (unit, no Docker); with the stack up: `pnpm test:integration` (`INTEGRATION_RESTARTS=1` for the restart test) and `pnpm smoke`. Do not use `pnpm -s` for checks: it hides failures.
- Real-model evals (never in CI): `source scripts/env-from-keychain.sh && pnpm test:evals`.
- Chat as a seeded user through the real API: `pnpm chat ana --nova -m "..." [-m /confirmar]`. Access token for curl: `pnpm --silent dev:token ana`.
- Refresh seed dates: `docker compose run --rm init pnpm --filter @nexo/scripts seed:reset`. Force a ticket-system outage: `curl -X POST "localhost:4000/_chaos/outage?ms=25000"`.
- Never run `docker compose down -v` while another session uses the stack. Parallel sessions work in a git worktree on their own branch; the main session merges.

## Quality bar (from the evaluation table)

- Decision quality: a scenario test suite with fixtures. Each scenario is an employee message plus the expected intent and action: a KB question, a ticket lookup without the ticket number, an overdue ticket, a duplicate, a reopen within 7 days, an out-of-scope topic, a critical incident, an explicit request for an analyst, and low confidence. Run it with a real model behind a flag, and also with a mocked model in CI.
- Conversation flow: the agent asks when information is missing, confirms before it acts, keeps the context, and answers clearly in PT-BR.
- UI: loading, streaming, empty, and error states, including "sistema de chamados indisponivel, tentando novamente".
- Commits are small and tell the development story (conventional commits, in English). Never squash the history.
- README in PT-BR: how to run, the architecture overview (a diagram), how the agent decides, how decision quality was ensured, trade-offs, what to do with more time, the model choice and its cost, and deploy notes.
- Deploy (bonus points, planned as the last milestone): so the reviewers can test online without running anything. The app is built as plain Docker containers so it stays portable. Hosting for the app itself is NOT AWS compute (no EC2/ECS); the database is MongoDB Atlas M0 (free, 512 MB, no expiry), and the app runs on Railway (free trial) or another Node container host. Decide at deploy time and check the free-tier limits first.
  - Constraints to check: anything that talks to MongoDB needs a Node runtime with raw TCP. The MongoDB driver does not run reliably on Cloudflare Workers, and the Atlas Data API is deprecated, so the web app and the tickets service run on a Node host, not on Workers. The SQS consumer also needs a long-running process. Atlas network access: allow the host's egress IPs, or 0.0.0.0/0 with a strong, least-privilege database user. Atlas M0 may pause after a long idle period, so wake it before sending the link.
  - Online setup: real Cognito and SQS in Alysson's AWS account (see above), keys in the platform's secrets, rate limiting, and a daily cap on LLM calls per session and globally, so a reviewer (or a bot) cannot run up the bill. Document the whole setup in the README.
  - Do not deploy, create AWS resources, or spend money without Alysson's explicit go-ahead in that moment. He will provide the AWS access himself.

## Conventions

- UI text in PT-BR, matching the prototype. Code, identifiers, and commits in English.
- No real people, emails, or company domains in the seed data. Use fictional `@nexo.com.br` employees.
- Do not commit or push unless Alysson asks.


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->
