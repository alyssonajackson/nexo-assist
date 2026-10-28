/**
 * Chat with the agent as a seeded employee, through the real web API (POST /api/chat), and print each
 * Decision as JSON. Verifies M4 without the UI.
 *
 *   pnpm chat ana                       # interactive; /confirmar, /cancelar, /nova, /estado, /sair
 *   pnpm chat ana -m "minha VPN caiu" -m /confirmar   # scripted, one message per -m
 *   WEB_URL=http://localhost:3100 pnpm chat bruno --nova
 *
 * Needs the stack up (docker compose up) or `pnpm dev`. Users: ana, bruno, carla, diego.
 */
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { z } from 'zod'
import { ChatStreamEvent, Conversation, ConversationResponse, Draft, type Decision } from '@nexo/shared'
import { cognitoClient, CognitoAuthProvider, resolveCognitoConfig } from '@nexo/shared/aws'
import { seedUsers } from './seed/seed'

process.env.COGNITO_ENDPOINT ??= 'http://localhost:9229'
process.env.COGNITO_ISSUER_DOMAIN ??= 'http://localhost:9229'
process.env.AWS_ACCESS_KEY_ID ??= 'local'
process.env.AWS_SECRET_ACCESS_KEY ??= 'local'

const args = process.argv.slice(2)
const key = args.find((a) => !a.startsWith('-') && args[args.indexOf(a) - 1] !== '-m') ?? 'ana'
const scripted = args.flatMap((a, i) => (a === '-m' && args[i + 1] ? [args[i + 1] as string] : []))
const baseUrl = process.env.WEB_URL ?? 'http://localhost:3000'

const user = seedUsers.find((u) => u.key === key)
if (!user || user.role !== 'employee') {
  console.error(
    `Unknown employee "${key}". Use one of: ${seedUsers
      .filter((u) => u.role === 'employee')
      .map((u) => u.key)
      .join(', ')}`,
  )
  process.exit(1)
}

const c = {
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  reset: '\x1b[0m',
}
const paint = (color: keyof typeof c, s: string) => `${c[color]}${s}${c.reset}`

const client = cognitoClient()
const auth = new CognitoAuthProvider(client, await resolveCognitoConfig(client))
const { accessToken } = await auth.signIn(user.email, process.env.SEED_PASSWORD ?? 'nexo123')
// Same httpOnly cookie the browser gets after login (apps/web/src/server/cookies.ts).
const headers = { cookie: `nx_access=${accessToken}`, 'content-type': 'application/json' }

const ConversationBody = z.object({ conversation: Conversation.nullable() })
const DraftBody = z.object({ draft: Draft })

let conversation: Conversation | null = null
let lastDraft: Draft | null = null

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${baseUrl}${path}`, { ...init, headers })
  if (!res.ok && !res.headers.get('content-type')?.includes('ndjson')) {
    throw new Error(`${init.method ?? 'GET'} ${path}: HTTP ${res.status} ${await res.text()}`)
  }
  return res
}

/** Reads the NDJSON stream and prints it as it arrives. */
async function stream(res: Response): Promise<void> {
  if (!res.body) return
  const decoder = new TextDecoder()
  let buffer = ''
  let streaming = false
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      if (!line.trim()) continue
      const event = ChatStreamEvent.parse(JSON.parse(line))
      if (streaming && event.type !== 'reply_delta') {
        stdout.write('\n')
        streaming = false
      }
      print(event, () => (streaming = true))
    }
  }
}

function print(event: ChatStreamEvent, startedReply: () => void) {
  switch (event.type) {
    case 'tool':
      console.log(
        paint(
          event.call.ok ? 'cyan' : 'red',
          `  [${event.call.label}] ${event.call.summary ?? ''} (${event.call.ms} ms)`,
        ),
      )
      break
    case 'decision':
      console.log(paint('dim', `  decisão: ${event.intent} -> ${event.action} (${event.confidence})`))
      break
    case 'reply_delta':
      if (!stdoutHasReply) stdout.write(paint('green', 'agente: '))
      stdoutHasReply = true
      startedReply()
      stdout.write(event.delta)
      break
    case 'reply_replaced':
      console.log(paint('yellow', `  (regra substituiu a resposta) ${event.text}`))
      break
    case 'status':
      console.log(
        paint('yellow', `  ${event.message}${event.attempt ? ` (tentativa ${event.attempt})` : ''}`),
      )
      break
    case 'message':
      if (event.message.role === 'system') console.log(paint('dim', `  ── ${event.message.text} ──`))
      else if (event.message.decision)
        printDecision(event.message.text, event.message.decision, event.message.parts)
      break
    case 'draft':
      lastDraft = event.draft
      console.log(
        paint(
          'dim',
          `  rascunho ${event.draft.id}: ${event.draft.status}${event.draft.resultTicketId ? ` -> ${event.draft.resultTicketId}` : ''}`,
        ),
      )
      break
    case 'conversation':
      conversation = event.conversation
      console.log(
        paint(
          'dim',
          `  conversa ${event.conversation.id} · ${event.conversation.state} · ${event.conversation.employeeMessageCount}/30`,
        ),
      )
      break
    case 'error':
      console.log(paint('red', `  erro (${event.error}): ${event.message}`))
      break
    case 'employee_message':
      break
  }
}
let stdoutHasReply = false

function printDecision(text: string, decision: Decision, parts: unknown[]) {
  if (!stdoutHasReply || decision.source === 'code') console.log(`${paint('green', 'agente:')} ${text}`)
  stdoutHasReply = false
  console.log(paint('dim', JSON.stringify({ ...decision, parts }, null, 2)))
}

async function send(text: string) {
  await stream(
    await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ text, ...(conversation ? { conversationId: conversation.id } : {}) }),
    }),
  )
}

async function pendingDraft(): Promise<Draft | null> {
  if (lastDraft?.status === 'pending') return lastDraft
  if (!conversation) return null
  const res = ConversationResponse.parse(await (await api(`/api/conversations/${conversation.id}`)).json())
  return res.drafts.filter((d) => d.status === 'pending').at(-1) ?? null
}

async function command(input: string): Promise<boolean> {
  const cmd = input.trim()
  if (cmd === '/sair') return false
  if (cmd === '/nova') {
    conversation = ConversationBody.parse(
      await (await api('/api/conversations', { method: 'POST' })).json(),
    ).conversation
    console.log(paint('dim', `  nova conversa ${conversation?.id}`))
  } else if (cmd === '/confirmar' || cmd === '/cancelar') {
    const draft = await pendingDraft()
    if (!draft) console.log(paint('yellow', '  nenhum rascunho pendente'))
    else if (cmd === '/confirmar')
      await stream(await api(`/api/drafts/${draft.id}/confirm`, { method: 'POST' }))
    else {
      lastDraft = DraftBody.parse(
        await (await api(`/api/drafts/${draft.id}/cancel`, { method: 'POST' })).json(),
      ).draft
      console.log(paint('dim', `  rascunho ${draft.id} cancelado`))
    }
  } else if (cmd === '/estado') {
    if (!conversation) console.log(paint('dim', '  sem conversa'))
    else {
      const res = ConversationResponse.parse(
        await (await api(`/api/conversations/${conversation.id}`)).json(),
      )
      console.log(
        paint(
          'dim',
          `  ${res.conversation.state} · ${res.messages.length} mensagens · rascunhos: ${res.drafts.map((d) => `${d.id}=${d.status}`).join(', ') || '-'}`,
        ),
      )
    }
  } else if (cmd) {
    console.log(`${paint('cyan', `${user?.name.split(' ')[0]}:`)} ${cmd}`)
    await send(cmd)
  }
  return true
}

conversation = ConversationBody.parse(
  await (await api('/api/conversations', args.includes('--nova') ? { method: 'POST' } : {})).json(),
).conversation
console.log(
  paint(
    'dim',
    `${user.name} · ${baseUrl} · ${args.includes('--nova') ? 'nova conversa' : 'continuando a conversa'} ${conversation?.id ?? ''} (${conversation?.state ?? 'agent'})`,
  ),
)

if (scripted.length) {
  for (const m of scripted) if (!(await command(m))) break
} else {
  const rl = createInterface({ input: stdin, output: stdout })
  while (await command(await rl.question('> '))) {
    // keep chatting
  }
  rl.close()
}
