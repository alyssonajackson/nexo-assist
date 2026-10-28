import {
  MAX_EMPLOYEE_MESSAGES,
  type ChatStreamEvent,
  type Conversation,
  type ConversationResponse,
  type Draft,
  type Message,
  type TicketView,
  type ToolCall,
} from '@nexo/shared'

/**
 * Client state of the employee chat. Pure: the hook (use-chat.ts) feeds it server snapshots and
 * stream events, so every transition is unit-tested without a browser.
 */

/** What the employee asked for, kept so "Tentar novamente" can repeat it. */
export type ChatRequestKind = { kind: 'message'; text: string } | { kind: 'confirm'; draftId: string }

type DecisionEvent = Extract<ChatStreamEvent, { type: 'decision' }>
type StatusEvent = Extract<ChatStreamEvent, { type: 'status' }>

/** The agent turn being streamed: chips, early decision and text, until the stored message arrives. */
export type LiveTurn = {
  request: ChatRequestKind
  /** Shown right away, until the server echoes the stored employee message. */
  pendingEmployeeText?: string
  tools: ToolCall[]
  decision?: Omit<DecisionEvent, 'type'>
  text: string
  status?: Omit<StatusEvent, 'type'>
}

export type ChatError = { code: string; message: string; retry?: ChatRequestKind }

export type ChatState = {
  conversation: Conversation | null
  messages: Message[]
  drafts: Record<string, Draft>
  tickets: Record<string, TicketView>
  turn: LiveTurn | null
  error: ChatError | null
}

export type ChatAction =
  /** A server snapshot: first render, the refresh after each turn, and polling. */
  | { type: 'loaded'; data: ConversationResponse }
  | { type: 'conversation_started'; conversation: Conversation }
  | { type: 'turn_started'; request: ChatRequestKind }
  | { type: 'event'; event: ChatStreamEvent }
  /** The request itself failed (network, 401, 5xx before the stream started). */
  | { type: 'turn_failed'; code: string; message: string }
  | { type: 'turn_finished' }
  | { type: 'draft_updated'; draft: Draft }
  | { type: 'error_dismissed' }

/** Errors where repeating the same request cannot help. */
const FINAL_ERRORS = new Set(['message_limit', 'closed', 'not_pending', 'not_found', 'unauthorized'])

const byId = <T extends { id: string }>(items: T[]): Record<string, T> =>
  Object.fromEntries(items.map((i) => [i.id, i]))

export function initialState(data: ConversationResponse | null): ChatState {
  return {
    conversation: data?.conversation ?? null,
    messages: data?.messages ?? [],
    drafts: byId(data?.drafts ?? []),
    tickets: byId(data?.tickets ?? []),
    turn: null,
    error: null,
  }
}

const appendMessage = (messages: Message[], message: Message): Message[] =>
  messages.some((m) => m.id === message.id) ? messages : [...messages, message]

function failWith(state: ChatState, code: string, message: string): ChatState {
  const retry = state.turn && !FINAL_ERRORS.has(code) ? state.turn.request : undefined
  return { ...state, turn: null, error: { code, message, ...(retry ? { retry } : {}) } }
}

function applyEvent(state: ChatState, event: ChatStreamEvent): ChatState {
  const turn = state.turn
  switch (event.type) {
    case 'employee_message':
      return {
        ...state,
        messages: appendMessage(state.messages, event.message),
        turn: turn && { request: turn.request, tools: turn.tools, text: turn.text },
      }
    case 'tool':
      return turn ? { ...state, turn: { ...turn, tools: [...turn.tools, event.call] } } : state
    case 'decision': {
      const { type: _, ...decision } = event
      return turn ? { ...state, turn: { ...turn, decision } } : state
    }
    case 'reply_delta':
      return turn ? { ...state, turn: { ...turn, text: turn.text + event.delta } } : state
    case 'reply_replaced':
      return turn ? { ...state, turn: { ...turn, text: event.text } } : state
    case 'status': {
      const { type: _, ...status } = event
      return turn ? { ...state, turn: { ...turn, status } } : state
    }
    case 'message': {
      const messages = appendMessage(state.messages, event.message)
      // The stored agent message carries the full Decision: the live chips and text are now redundant.
      const settled =
        turn && event.message.role === 'agent' ? { request: turn.request, tools: [], text: '' } : turn
      return { ...state, messages, turn: settled }
    }
    case 'draft':
      return { ...state, drafts: { ...state.drafts, [event.draft.id]: event.draft } }
    case 'conversation':
      return { ...state, conversation: event.conversation }
    case 'error':
      return failWith(state, event.error, event.message)
  }
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'loaded':
      return { ...initialState(action.data), turn: state.turn, error: state.error }
    case 'conversation_started':
      return { ...initialState(null), conversation: action.conversation }
    case 'turn_started':
      return {
        ...state,
        error: null,
        turn: {
          request: action.request,
          tools: [],
          text: '',
          ...(action.request.kind === 'message' ? { pendingEmployeeText: action.request.text } : {}),
        },
      }
    case 'event':
      return applyEvent(state, action.event)
    case 'turn_failed':
      return failWith(state, action.code, action.message)
    case 'turn_finished':
      return state.turn ? { ...state, turn: null } : state
    case 'draft_updated':
      return { ...state, drafts: { ...state.drafts, [action.draft.id]: action.draft } }
    case 'error_dismissed':
      return { ...state, error: null }
  }
}

// ---------- Derived state (selectors) ----------

export const isTurnRunning = (state: ChatState): boolean => state.turn !== null

export const messageCount = (state: ChatState): number => state.conversation?.employeeMessageCount ?? 0

export const limitReached = (state: ChatState): boolean =>
  messageCount(state) >= MAX_EMPLOYEE_MESSAGES || state.error?.code === 'message_limit'

/** The conversation is with an analyst (or waiting for one): the agent stays silent. */
export const isHandedOff = (state: ChatState): boolean =>
  state.conversation?.state === 'waiting_analyst' || state.conversation?.state === 'analyst'

export const isClosed = (state: ChatState): boolean =>
  state.conversation?.state === 'closed' || state.error?.code === 'closed'

/** Something outside this tab will change the conversation: the queue registering a draft, or an analyst. */
export const shouldPoll = (state: ChatState): boolean =>
  !isTurnRunning(state) &&
  (isHandedOff(state) || Object.values(state.drafts).some((d) => d.status === 'pending_registration'))

/** Cards with buttons (quick replies, ticket list, draft) only act on the latest agent message. */
export function latestAgentMessageId(messages: Message[]): string | undefined {
  return messages.findLast((m) => m.role === 'agent')?.id
}

/**
 * Which option the employee picked after a message: the first later employee message that starts
 * with one of the options (e.g. "Só eu. Tenho reunião…" picks "Só eu"). Works for history too.
 */
export function pickedOption(messages: Message[], afterId: string, options: string[]): string | undefined {
  const index = messages.findIndex((m) => m.id === afterId)
  const reply = messages.slice(index + 1).find((m) => m.role === 'employee')
  if (!reply) return undefined
  const text = reply.text.trim().toLocaleLowerCase('pt-BR')
  return options.find((o) => text.startsWith(o.trim().toLocaleLowerCase('pt-BR')))
}

const draftIdsOf = (m: Message): string[] => m.parts.flatMap((p) => (p.type === 'draft' ? [p.draftId] : []))

/**
 * A draft can be referenced by several messages (proposed, then "pendente de registro"). Its card is
 * drawn once, on the message that proposed it, and shows the current status there.
 */
export function draftCardOwners(messages: Message[]): Map<string, string> {
  const owners = new Map<string, string>()
  for (const m of messages) for (const id of draftIdsOf(m)) if (!owners.has(id)) owners.set(id, m.id)
  return owners
}

/** The draft that ⌘↵ confirms: the most recent one still waiting for the employee. */
export function activeDraftId(state: ChatState): string | undefined {
  return state.messages.flatMap(draftIdsOf).findLast((id) => state.drafts[id]?.status === 'pending')
}
