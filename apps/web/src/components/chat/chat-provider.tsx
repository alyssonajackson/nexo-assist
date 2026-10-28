'use client'

import { createContext, useContext, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { ConversationResponse } from '@nexo/shared'
import { useChat, type ChatApi } from '@/lib/chat/use-chat'

type ChatContextValue = ChatApi & {
  firstName: string
  composerRef: RefObject<HTMLTextAreaElement | null>
  /** "Editar" on a draft: the composer asks what to change and the agent proposes it again. */
  editingDraftId: string | undefined
  editDraft: (draftId: string) => void
  stopEditing: () => void
}

const ChatContext = createContext<ChatContextValue | null>(null)

/** Wraps the whole employee shell, so the header pill and the chat read the same state. */
export function ChatProvider({
  initial,
  firstName,
  children,
}: {
  initial: ConversationResponse | null
  firstName: string
  children: ReactNode
}) {
  const chat = useChat(initial)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const [editingDraftId, setEditingDraftId] = useState<string>()
  const value: ChatContextValue = {
    ...chat,
    firstName,
    composerRef,
    editingDraftId,
    editDraft: (draftId) => {
      setEditingDraftId(draftId)
      composerRef.current?.focus()
    },
    stopEditing: () => setEditingDraftId(undefined),
  }
  return <ChatContext value={value}>{children}</ChatContext>
}

export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChatContext must be used inside <ChatProvider>')
  return ctx
}
