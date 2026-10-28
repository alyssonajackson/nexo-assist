'use client'

import { useCallback, useEffect, useReducer, useRef } from 'react'
import { z } from 'zod'
import { Conversation, ConversationResponse, Draft } from '@nexo/shared'
import { chatReducer, initialState, shouldPoll, type ChatRequestKind, type ChatState } from './chat-state'
import { readEvents } from './ndjson'

/** How often the chat asks for news while an analyst or the queue is working (M6 may replace it). */
export const POLL_MS = 4000

const ApiError = z.object({ error: z.string(), message: z.string() })

const NETWORK_ERROR = {
  code: 'network',
  message: 'Não foi possível falar com o servidor. Verifique sua conexão e tente de novo.',
}

async function readError(res: Response): Promise<{ code: string; message: string }> {
  const body = ApiError.safeParse(await res.json().catch(() => null))
  if (body.success) return { code: body.data.error, message: body.data.message }
  return { code: `http_${res.status}`, message: 'Algo deu errado do nosso lado. Tente de novo em instantes.' }
}

export type ChatApi = {
  state: ChatState
  send: (text: string) => void
  confirmDraft: (draftId: string) => void
  cancelDraft: (draftId: string) => void
  retry: () => void
  dismissError: () => void
  newConversation: () => void
}

/**
 * The employee chat: the reducer plus the HTTP calls. Streams POST /api/chat and
 * POST /api/drafts/:id/confirm, then reloads the conversation so cards get fresh ticket data.
 */
export function useChat(initial: ConversationResponse | null): ChatApi {
  const [state, dispatch] = useReducer(chatReducer, initial, initialState)
  // Read by the async calls below, which outlive the render that started them.
  const conversationId = useRef(state.conversation?.id)
  useEffect(() => {
    conversationId.current = state.conversation?.id
  }, [state.conversation?.id])

  const refresh = useCallback(async () => {
    const id = conversationId.current
    if (!id) return
    try {
      const res = await fetch(`/api/conversations/${id}`, { cache: 'no-store' })
      if (!res.ok) return
      const data = ConversationResponse.safeParse(await res.json())
      if (data.success) dispatch({ type: 'loaded', data: data.data })
    } catch {
      // Polling is best effort; the next tick tries again.
    }
  }, [])

  const run = useCallback(
    async (request: ChatRequestKind) => {
      dispatch({ type: 'turn_started', request })
      try {
        const res =
          request.kind === 'message'
            ? await fetch('/api/chat', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ conversationId: conversationId.current, text: request.text }),
              })
            : await fetch(`/api/drafts/${request.draftId}/confirm`, { method: 'POST' })
        if (!res.ok || !res.body) {
          dispatch({ type: 'turn_failed', ...(await readError(res)) })
          return
        }
        for await (const event of readEvents(res.body)) {
          if (event.type === 'conversation') conversationId.current = event.conversation.id
          dispatch({ type: 'event', event })
        }
      } catch {
        dispatch({ type: 'turn_failed', ...NETWORK_ERROR })
        return
      } finally {
        dispatch({ type: 'turn_finished' })
      }
      await refresh()
    },
    [refresh],
  )

  const cancelDraft = useCallback(async (draftId: string) => {
    try {
      const res = await fetch(`/api/drafts/${draftId}/cancel`, { method: 'POST' })
      if (!res.ok) {
        dispatch({ type: 'turn_failed', ...(await readError(res)) })
        return
      }
      const body = z.object({ draft: Draft }).safeParse(await res.json())
      if (body.success) dispatch({ type: 'draft_updated', draft: body.data.draft })
    } catch {
      dispatch({ type: 'turn_failed', ...NETWORK_ERROR })
    }
  }, [])

  const newConversation = useCallback(async () => {
    try {
      const res = await fetch('/api/conversations', { method: 'POST' })
      if (!res.ok) {
        dispatch({ type: 'turn_failed', ...(await readError(res)) })
        return
      }
      const body = z.object({ conversation: Conversation }).safeParse(await res.json())
      if (body.success) dispatch({ type: 'conversation_started', conversation: body.data.conversation })
    } catch {
      dispatch({ type: 'turn_failed', ...NETWORK_ERROR })
    }
  }, [])

  const polling = shouldPoll(state)
  useEffect(() => {
    if (!polling) return
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [polling, refresh])

  const retryRequest = state.error?.retry
  return {
    state,
    send: (text) => void run({ kind: 'message', text }),
    confirmDraft: (draftId) => void run({ kind: 'confirm', draftId }),
    cancelDraft: (draftId) => void cancelDraft(draftId),
    retry: () => {
      if (retryRequest) void run(retryRequest)
    },
    dismissError: () => dispatch({ type: 'error_dismissed' }),
    newConversation: () => void newConversation(),
  }
}
