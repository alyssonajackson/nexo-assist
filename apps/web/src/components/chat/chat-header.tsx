'use client'

import { MessageSquarePlus } from 'lucide-react'
import { isTurnRunning } from '@/lib/chat/chat-state'
import { useChatContext } from './chat-provider'

const PILLS = {
  agent: { label: 'Assistente online', className: 'bg-success-50 text-success-700', dot: 'bg-success-500' },
  waiting_analyst: {
    label: 'Aguardando analista',
    className: 'bg-warning-bg text-warning-ink',
    dot: 'bg-warning-500',
  },
  analyst: { label: 'Com um analista', className: 'bg-warning-bg text-warning-ink', dot: 'bg-warning-500' },
  closed: { label: 'Conversa encerrada', className: 'bg-surface-muted text-ink-muted', dot: 'bg-ink/40' },
} as const

/** Header right side: "Nova conversa" and the "Assistente online" pill (or who has the conversation). */
export function ChatHeaderRight() {
  const { state, newConversation } = useChatContext()
  const pill = PILLS[state.conversation?.state ?? 'agent']
  const hasMessages = state.messages.length > 0
  return (
    <div className="flex items-center gap-3">
      {hasMessages && (
        <button
          type="button"
          onClick={newConversation}
          disabled={isTurnRunning(state)}
          className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-ink-soft hover:bg-surface-muted disabled:opacity-50"
        >
          <MessageSquarePlus className="size-4 text-ink-muted" aria-hidden="true" />
          Nova conversa
        </button>
      )}
      <span
        className={`flex h-[34px] items-center gap-2 rounded-pill px-3.5 text-[12.5px] font-semibold ${pill.className}`}
      >
        <span className={`size-2 rounded-full ${pill.dot}`} aria-hidden="true" />
        {pill.label}
      </span>
    </div>
  )
}
