import { describe, expect, it } from 'vitest'
import type {
  ChatStreamEvent,
  Conversation,
  ConversationResponse,
  Draft,
  Message,
  TicketView,
  ToolCall,
} from '@nexo/shared'
import {
  activeDraftId,
  chatReducer,
  draftCardOwners,
  initialState,
  isClosed,
  isHandedOff,
  latestAgentMessageId,
  limitReached,
  pickedOption,
  shouldPoll,
  type ChatAction,
  type ChatRequestKind,
  type ChatState,
} from './chat-state'

const NOW = new Date('2026-10-28T12:00:00-03:00')

const conversation = (over: Partial<Conversation> = {}): Conversation => ({
  id: 'c1',
  employeeId: 'u1',
  state: 'agent',
  relatedTicketIds: [],
  employeeMessageCount: 0,
  lastMessageAt: NOW,
  preview: '',
  createdAt: NOW,
  ...over,
})

const message = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  conversationId: 'c1',
  role: 'employee',
  text: 'oi',
  parts: [],
  createdAt: NOW,
  ...over,
})

const draft = (over: Partial<Draft> = {}): Draft => ({
  id: 'D-381',
  conversationId: 'c1',
  employeeId: 'u1',
  kind: 'create',
  status: 'pending',
  createdAt: NOW,
  ...over,
})

const toolCall = (over: Partial<ToolCall> = {}): ToolCall => ({
  tool: 'listTickets',
  label: 'consultou seus chamados',
  ok: true,
  ms: 120,
  ...over,
})

const ticket = (id: string): TicketView => ({
  id,
  type: 'INC',
  category: 'hardware',
  title: 'Notebook lento',
  description: 'Notebook muito lento',
  priority: 'medium',
  affected: 'self',
  status: 'open',
  requesterId: 'u1',
  requesterName: 'Ana',
  createdAt: NOW,
  updatedAt: NOW,
  timeline: [],
  sla: { dueAt: NOW, overdue: false, reopenable: false },
})

const response = (over: Partial<ConversationResponse> = {}): ConversationResponse => ({
  conversation: conversation(),
  messages: [],
  drafts: [],
  tickets: [],
  ...over,
})

const msgRequest: ChatRequestKind = { kind: 'message', text: 'meu notebook quebrou' }
const confirmRequest: ChatRequestKind = { kind: 'confirm', draftId: 'D-381' }

const empty = () => initialState(response())
const run = (state: ChatState, ...actions: ChatAction[]) => actions.reduce(chatReducer, state)
const ev = (event: ChatStreamEvent): ChatAction => ({ type: 'event', event })
const running = (request: ChatRequestKind = msgRequest) => run(empty(), { type: 'turn_started', request })

describe('initialState', () => {
  it('is empty without data', () => {
    expect(initialState(null)).toEqual({
      conversation: null,
      messages: [],
      drafts: {},
      tickets: {},
      authors: {},
      turn: null,
      error: null,
    })
  })
  it('indexes drafts and tickets by id', () => {
    const state = initialState(
      response({
        messages: [message()],
        drafts: [draft()],
        tickets: [ticket('INC-20311')],
      }),
    )
    expect(state.conversation?.id).toBe('c1')
    expect(state.messages).toHaveLength(1)
    expect(Object.keys(state.drafts)).toEqual(['D-381'])
    expect(Object.keys(state.tickets)).toEqual(['INC-20311'])
    expect(state.turn).toBeNull()
  })
})

describe('turn_started', () => {
  it('shows the employee text right away for a message', () => {
    const state = running()
    expect(state.turn).toEqual({
      request: msgRequest,
      tools: [],
      text: '',
      pendingEmployeeText: msgRequest.text,
    })
  })
  it('has no pending text for a confirmation', () => {
    expect(running(confirmRequest).turn).toEqual({ request: confirmRequest, tools: [], text: '' })
  })
  it('clears a previous error', () => {
    const failed = run(empty(), { type: 'turn_failed', code: 'network', message: 'x' })
    expect(chatReducer(failed, { type: 'turn_started', request: msgRequest }).error).toBeNull()
  })
})

describe('stream events', () => {
  it('employee_message appends and clears pendingEmployeeText', () => {
    const state = run(running(), ev({ type: 'employee_message', message: message() }))
    expect(state.messages.map((m) => m.id)).toEqual(['m1'])
    expect(state.turn).toEqual({ request: msgRequest, tools: [], text: '' })
    expect(state.turn).not.toHaveProperty('pendingEmployeeText')
  })
  it('employee_message is deduplicated by id', () => {
    const e = ev({ type: 'employee_message', message: message() })
    expect(run(running(), e, e).messages).toHaveLength(1)
  })
  it('tool events accumulate chips', () => {
    const state = run(
      running(),
      ev({ type: 'tool', call: toolCall() }),
      ev({ type: 'tool', call: toolCall({ tool: 'derivePriority', label: 'classificou a prioridade' }) }),
    )
    expect(state.turn?.tools.map((t) => t.label)).toEqual([
      'consultou seus chamados',
      'classificou a prioridade',
    ])
  })
  it('decision stores the fields without the type', () => {
    const state = run(
      running(),
      ev({ type: 'decision', intent: 'ticket_lookup', action: 'list', confidence: 0.9 }),
    )
    expect(state.turn?.decision).toEqual({ intent: 'ticket_lookup', action: 'list', confidence: 0.9 })
  })
  it('reply_delta concatenates', () => {
    const state = run(
      running(),
      ev({ type: 'reply_delta', delta: 'Olá, ' }),
      ev({ type: 'reply_delta', delta: 'Ana' }),
    )
    expect(state.turn?.text).toBe('Olá, Ana')
  })
  it('reply_replaced swaps the text', () => {
    const state = run(
      running(),
      ev({ type: 'reply_delta', delta: 'rascunho' }),
      ev({ type: 'reply_replaced', text: 'Texto final' }),
    )
    expect(state.turn?.text).toBe('Texto final')
  })
  it('status keeps the attempt', () => {
    const state = run(
      running(),
      ev({ type: 'status', status: 'tickets_retrying', attempt: 2, message: 'tentando novamente' }),
    )
    expect(state.turn?.status).toEqual({
      status: 'tickets_retrying',
      attempt: 2,
      message: 'tentando novamente',
    })
  })
  it('live events are ignored when no turn runs', () => {
    const state = run(
      empty(),
      ev({ type: 'tool', call: toolCall() }),
      ev({ type: 'reply_delta', delta: 'x' }),
      ev({ type: 'reply_replaced', text: 'x' }),
      ev({ type: 'decision', intent: 'a' }),
      ev({ type: 'status', status: 'tickets_queued', message: 'm' }),
    )
    expect(state).toEqual(empty())
  })

  describe('message', () => {
    const live = () =>
      run(
        running(),
        ev({ type: 'tool', call: toolCall() }),
        ev({ type: 'reply_delta', delta: 'abc' }),
        ev({ type: 'decision', intent: 'x' }),
      )

    it('an agent message appends and resets live tools and text, but the turn keeps running', () => {
      const state = chatReducer(
        live(),
        ev({ type: 'message', message: message({ id: 'a1', role: 'agent' }) }),
      )
      expect(state.messages.map((m) => m.id)).toEqual(['a1'])
      expect(state.turn).toEqual({ request: msgRequest, tools: [], text: '' })
    })
    it('a system message keeps the live state', () => {
      const before = live()
      const state = chatReducer(
        before,
        ev({ type: 'message', message: message({ id: 's1', role: 'system' }) }),
      )
      expect(state.messages.map((m) => m.id)).toEqual(['s1'])
      expect(state.turn).toEqual(before.turn)
    })
    it('an agent message without a turn just appends', () => {
      const state = run(empty(), ev({ type: 'message', message: message({ id: 'a1', role: 'agent' }) }))
      expect(state.messages).toHaveLength(1)
      expect(state.turn).toBeNull()
    })
  })

  it('draft upserts by id', () => {
    const state = run(
      empty(),
      ev({ type: 'draft', draft: draft() }),
      ev({ type: 'draft', draft: draft({ status: 'confirmed' }) }),
    )
    expect(Object.values(state.drafts)).toHaveLength(1)
    expect(state.drafts['D-381']?.status).toBe('confirmed')
  })
  it('conversation replaces the conversation', () => {
    const state = run(
      empty(),
      ev({ type: 'conversation', conversation: conversation({ state: 'waiting_analyst' }) }),
    )
    expect(state.conversation?.state).toBe('waiting_analyst')
  })

  describe('error', () => {
    it('ends the turn and offers retry with the same request', () => {
      const state = run(
        running(confirmRequest),
        ev({ type: 'error', error: 'llm_failed', message: 'falhou' }),
      )
      expect(state.turn).toBeNull()
      expect(state.error).toEqual({ code: 'llm_failed', message: 'falhou', retry: confirmRequest })
    })
    it('keeps the text on screen when the server never stored it', () => {
      const state = run(running(), ev({ type: 'error', error: 'llm_failed', message: 'falhou' }))
      expect(state.error).toEqual({
        code: 'llm_failed',
        message: 'falhou',
        retry: msgRequest,
        unsentText: msgRequest.text,
      })
    })
    it('does not mark the text unsent once the server echoed it', () => {
      const state = run(
        running(),
        ev({ type: 'employee_message', message: message({ role: 'employee', text: msgRequest.text }) }),
        ev({ type: 'error', error: 'llm_failed', message: 'falhou' }),
      )
      expect(state.error).not.toHaveProperty('unsentText')
    })
    it.each(['message_limit', 'closed', 'not_pending', 'not_found', 'unauthorized'])(
      'has no retry for the final code %s',
      (code) => {
        const state = run(running(confirmRequest), ev({ type: 'error', error: code, message: 'm' }))
        expect(state.turn).toBeNull()
        expect(state.error).toEqual({ code, message: 'm' })
        expect(state.error).not.toHaveProperty('retry')
      },
    )
    it('has no retry when no turn was running', () => {
      const state = run(empty(), ev({ type: 'error', error: 'llm_failed', message: 'm' }))
      expect(state.error).not.toHaveProperty('retry')
    })
  })
})

describe('turn_failed', () => {
  it('behaves like an error event', () => {
    const state = run(running(confirmRequest), { type: 'turn_failed', code: 'network', message: 'sem rede' })
    expect(state.turn).toBeNull()
    expect(state.error).toEqual({ code: 'network', message: 'sem rede', retry: confirmRequest })
  })
  it('has no retry for a final code', () => {
    const state = run(running(), { type: 'turn_failed', code: 'unauthorized', message: 'x' })
    expect(state.error).toEqual({ code: 'unauthorized', message: 'x', unsentText: msgRequest.text })
  })
})

describe('turn_finished', () => {
  it('clears the turn', () => {
    expect(run(running(), { type: 'turn_finished' }).turn).toBeNull()
  })
  it('keeps the same state object when there is no turn', () => {
    const state = empty()
    expect(chatReducer(state, { type: 'turn_finished' })).toBe(state)
  })
})

describe('loaded', () => {
  it('replaces the snapshot but keeps the running turn and the error', () => {
    const failed = run(running(), { type: 'turn_failed', code: 'network', message: 'x' })
    const withTurn = { ...running(), error: failed.error }
    const state = chatReducer(withTurn, {
      type: 'loaded',
      data: response({ messages: [message({ id: 'm9' })], drafts: [draft()] }),
    })
    expect(state.messages.map((m) => m.id)).toEqual(['m9'])
    expect(Object.keys(state.drafts)).toEqual(['D-381'])
    expect(state.turn).toEqual(withTurn.turn)
    expect(state.error).toEqual(withTurn.error)
  })
})

describe('conversation_started', () => {
  it('resets everything to the new conversation', () => {
    const busy = run(
      empty(),
      ev({ type: 'message', message: message() }),
      { type: 'draft_updated', draft: draft() },
      { type: 'turn_started', request: msgRequest },
      { type: 'turn_failed', code: 'network', message: 'x' },
    )
    const state = chatReducer(busy, {
      type: 'conversation_started',
      conversation: conversation({ id: 'c2' }),
    })
    expect(state).toEqual({ ...initialState(null), conversation: conversation({ id: 'c2' }) })
  })
})

describe('draft_updated and error_dismissed', () => {
  it('draft_updated upserts the draft', () => {
    const state = run(empty(), { type: 'draft_updated', draft: draft({ status: 'cancelled' }) })
    expect(state.drafts['D-381']?.status).toBe('cancelled')
  })
  it('error_dismissed clears the error', () => {
    const failed = run(empty(), { type: 'turn_failed', code: 'network', message: 'x' })
    expect(chatReducer(failed, { type: 'error_dismissed' }).error).toBeNull()
  })
})

describe('selectors', () => {
  const withConv = (over: Partial<Conversation>, drafts: Draft[] = []) =>
    initialState(response({ conversation: conversation(over), drafts }))

  describe('limitReached', () => {
    it('is true at 30 employee messages', () => {
      expect(limitReached(withConv({ employeeMessageCount: 30 }))).toBe(true)
    })
    it('is false at 29', () => {
      expect(limitReached(withConv({ employeeMessageCount: 29 }))).toBe(false)
    })
    it('is true after a message_limit error', () => {
      const state = run(running(), ev({ type: 'error', error: 'message_limit', message: 'm' }))
      expect(limitReached(state)).toBe(true)
    })
    it('is false without a conversation', () => {
      expect(limitReached(initialState(null))).toBe(false)
    })
  })

  describe('isHandedOff and isClosed', () => {
    it('hands off for waiting_analyst and analyst only', () => {
      expect(isHandedOff(withConv({ state: 'waiting_analyst' }))).toBe(true)
      expect(isHandedOff(withConv({ state: 'analyst' }))).toBe(true)
      expect(isHandedOff(withConv({ state: 'agent' }))).toBe(false)
      expect(isHandedOff(withConv({ state: 'closed' }))).toBe(false)
    })
    it('is closed by state or by a closed error', () => {
      expect(isClosed(withConv({ state: 'closed' }))).toBe(true)
      expect(isClosed(withConv({ state: 'agent' }))).toBe(false)
      const state = run(running(), ev({ type: 'error', error: 'closed', message: 'm' }))
      expect(isClosed(state)).toBe(true)
    })
  })

  describe('shouldPoll', () => {
    it('polls while waiting for an analyst or with one', () => {
      expect(shouldPoll(withConv({ state: 'waiting_analyst' }))).toBe(true)
      expect(shouldPoll(withConv({ state: 'analyst' }))).toBe(true)
    })
    it('polls while a draft is pending registration', () => {
      expect(shouldPoll(withConv({}, [draft({ status: 'pending_registration' })]))).toBe(true)
    })
    it('does not poll for a normal agent conversation or other draft statuses', () => {
      expect(shouldPoll(withConv({}))).toBe(false)
      expect(
        shouldPoll(withConv({}, [draft({ status: 'pending' }), draft({ id: 'D-2', status: 'committed' })])),
      ).toBe(false)
    })
    it('does not poll while a turn runs', () => {
      const state = chatReducer(withConv({ state: 'waiting_analyst' }), {
        type: 'turn_started',
        request: msgRequest,
      })
      expect(shouldPoll(state)).toBe(false)
    })
  })

  describe('latestAgentMessageId', () => {
    it('returns the last agent message', () => {
      const messages = [
        message({ id: 'a1', role: 'agent' }),
        message({ id: 'e1' }),
        message({ id: 'a2', role: 'agent' }),
        message({ id: 'e2' }),
      ]
      expect(latestAgentMessageId(messages)).toBe('a2')
    })
    it('is undefined without agent messages', () => {
      expect(latestAgentMessageId([message()])).toBeUndefined()
      expect(latestAgentMessageId([])).toBeUndefined()
    })
  })

  describe('pickedOption', () => {
    const options = ['Só eu', 'Minha equipe', 'Toda a empresa']
    const base = [message({ id: 'a1', role: 'agent' })]

    it('matches an option at the start of the next employee message, case-insensitive', () => {
      const messages = [...base, message({ id: 'e1', text: 'Só eu. Tenho reunião às 15h.' })]
      expect(pickedOption(messages, 'a1', options)).toBe('Só eu')
      const lower = [...base, message({ id: 'e1', text: 'minha EQUIPE toda' })]
      expect(pickedOption(lower, 'a1', options)).toBe('Minha equipe')
    })
    it('is undefined when no employee message follows', () => {
      expect(pickedOption(base, 'a1', options)).toBeUndefined()
    })
    it('ignores non-employee messages and looks only at the first employee reply', () => {
      const messages = [
        ...base,
        message({ id: 's1', role: 'system', text: 'Só eu' }),
        message({ id: 'e1', text: 'Outra coisa' }),
        message({ id: 'e2', text: 'Só eu' }),
      ]
      expect(pickedOption(messages, 'a1', options)).toBeUndefined()
    })
    it('ignores employee messages before the agent message', () => {
      const messages = [message({ id: 'e0', text: 'Só eu' }), ...base]
      expect(pickedOption(messages, 'a1', options)).toBeUndefined()
    })
    it('matches ticket list options', () => {
      const ticketOptions = ['INC-20311 · Notebook lento', 'REQ-20400 · Acesso ao ERP']
      const messages = [...base, message({ id: 'e1', text: 'inc-20311 · notebook lento' })]
      expect(pickedOption(messages, 'a1', ticketOptions)).toBe('INC-20311 · Notebook lento')
    })
  })
})

const withDraftPart = (id: string, draftId: string): Message =>
  message({ id, role: 'agent', parts: [{ type: 'draft', draftId }] })

describe('draftCardOwners', () => {
  it('gives the card to the first message that references the draft', () => {
    const owners = draftCardOwners([withDraftPart('a1', 'D-1'), withDraftPart('a2', 'D-1')])
    expect(owners.get('D-1')).toBe('a1')
  })
  it('tracks several drafts independently', () => {
    const owners = draftCardOwners([
      withDraftPart('a1', 'D-1'),
      message({ id: 'e1' }),
      withDraftPart('a2', 'D-2'),
      withDraftPart('a3', 'D-1'),
    ])
    expect([...owners]).toEqual([
      ['D-1', 'a1'],
      ['D-2', 'a2'],
    ])
  })
  it('is empty when no message has a draft part', () => {
    expect(draftCardOwners([message()]).size).toBe(0)
  })
})

describe('activeDraftId', () => {
  const stateWith = (messages: Message[], drafts: Draft[]): ChatState => ({
    ...initialState(null),
    messages,
    drafts: Object.fromEntries(drafts.map((d) => [d.id, d])),
  })

  it('returns the most recent referenced draft that is pending', () => {
    const state = stateWith(
      [withDraftPart('a1', 'D-1'), withDraftPart('a2', 'D-2')],
      [draft({ id: 'D-1' }), draft({ id: 'D-2' })],
    )
    expect(activeDraftId(state)).toBe('D-2')
  })
  it('skips later drafts that are no longer pending', () => {
    const state = stateWith(
      [withDraftPart('a1', 'D-1'), withDraftPart('a2', 'D-2')],
      [draft({ id: 'D-1' }), draft({ id: 'D-2', status: 'cancelled' })],
    )
    expect(activeDraftId(state)).toBe('D-1')
  })
  it('is undefined when nothing is pending', () => {
    const state = stateWith([withDraftPart('a1', 'D-1')], [draft({ id: 'D-1', status: 'cancelled' })])
    expect(activeDraftId(state)).toBeUndefined()
  })
  it('ignores pending drafts that no message references', () => {
    expect(activeDraftId(stateWith([message()], [draft({ id: 'D-9' })]))).toBeUndefined()
  })
})
