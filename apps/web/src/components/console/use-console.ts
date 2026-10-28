'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConsoleConversationResponse, ConsoleFilter, ConsoleListResponse } from '@nexo/shared'
import {
  ConsoleApiError,
  fetchConversation,
  fetchList,
  runAction,
  sendReply,
  type ConsoleAction,
} from '@/lib/console/api'

/** Same cadence as the employee chat: the console is near real time by polling (SSE would be the upgrade). */
export const CONSOLE_POLL_MS = 4000

/**
 * State of the analyst console: the list (tab + search), the open conversation, and the actions.
 * Both the list and the open conversation are re-fetched on a timer, so a new transfer or an
 * employee's message shows up without a reload.
 */
export function useConsole() {
  const [filter, setFilter] = useState<ConsoleFilter>('waiting')
  const [query, setQuery] = useState('')
  const [list, setList] = useState<ConsoleListResponse | null>(null)
  const [selectedId, setSelectedId] = useState<string>()
  const [detail, setDetail] = useState<ConsoleConversationResponse | null>(null)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  // The newest request wins: a slow answer for an old tab must not overwrite a newer one.
  const listSeq = useRef(0)
  const refreshList = useCallback(async () => {
    const seq = ++listSeq.current
    try {
      const next = await fetchList(filter, query)
      if (seq === listSeq.current) setList(next)
    } catch (err) {
      if (seq === listSeq.current) setError(messageOf(err))
    }
  }, [filter, query])

  const refreshDetail = useCallback(async () => {
    if (!selectedId) return
    try {
      const next = await fetchConversation(selectedId)
      setDetail((current) => (selectedId === next.conversation.id ? next : current))
    } catch (err) {
      setError(messageOf(err))
    }
  }, [selectedId])

  // Search is debounced; tab changes go through right away (same effect, no delay when the query is empty).
  useEffect(() => {
    const timer = setTimeout(() => void refreshList(), query ? 250 : 0)
    return () => clearTimeout(timer)
  }, [refreshList, query])

  useEffect(() => {
    void refreshDetail()
  }, [refreshDetail])

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'hidden') return
      void refreshList()
      void refreshDetail()
    }, CONSOLE_POLL_MS)
    return () => clearInterval(timer)
  }, [refreshList, refreshDetail])

  // Open the first conversation of the list when none is open yet.
  const firstId = list?.items[0]?.conversation.id
  useEffect(() => {
    if (!selectedId && firstId) setSelectedId(firstId)
  }, [selectedId, firstId])

  const select = (id: string) => {
    setError(undefined)
    setDetail(null)
    setSelectedId(id)
  }

  const act = async (action: ConsoleAction) => {
    if (!selectedId || busy) return
    setBusy(true)
    setError(undefined)
    try {
      setDetail(await runAction(selectedId, action))
    } catch (err) {
      // 409: someone else moved it first. Show why and reload the real state.
      setError(messageOf(err))
      await refreshDetail()
    } finally {
      setBusy(false)
      void refreshList()
    }
  }

  const reply = async (text: string): Promise<boolean> => {
    if (!selectedId) return false
    setError(undefined)
    try {
      await sendReply(selectedId, text)
      await refreshDetail()
      void refreshList()
      return true
    } catch (err) {
      setError(messageOf(err))
      await refreshDetail()
      return false
    }
  }

  return {
    filter,
    setFilter,
    query,
    setQuery,
    list,
    selectedId,
    select,
    detail: detail && detail.conversation.id === selectedId ? detail : null,
    error,
    dismissError: () => setError(undefined),
    busy,
    takeOver: () => act('take-over'),
    giveBack: () => act('give-back'),
    close: () => act('close'),
    reply,
  }
}

const messageOf = (err: unknown) =>
  err instanceof ConsoleApiError ? err.message : 'Sem conexão com o servidor. Tentando de novo…'
