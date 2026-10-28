'use client'

import { useEffect } from 'react'
import { isClosed, isTurnRunning, limitReached, messageCount } from '@/lib/chat/chat-state'
import { useChatContext } from './chat-provider'
import { Composer } from './composer'
import { EmptyState } from './empty-state'
import { MessageList } from './message-list'
import { ErrorNotice, HandoffNotice, LimitNotice } from './notices'
import { useStickToBottom } from './use-stick-to-bottom'

/** Screens 2 and 3: the message column, the banners and the composer. */
export function ChatView() {
  const chat = useChatContext()
  const { state } = chat
  const { scroller, content, pin } = useStickToBottom<HTMLDivElement, HTMLDivElement>()

  const running = isTurnRunning(state)
  const limit = limitReached(state)
  const closed = isClosed(state)
  const empty = state.messages.length === 0 && !state.turn

  // A new turn always brings the view back to the bottom.
  useEffect(() => {
    if (running) pin()
  }, [running, pin])

  // Give the focus back to the input when a turn ends (it was disabled while streaming).
  const composerRef = chat.composerRef
  useEffect(() => {
    if (!running) composerRef.current?.focus()
  }, [running, composerRef])

  const conversationState = state.conversation?.state
  return (
    <div className="flex h-full flex-col">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div
          ref={content}
          className="mx-auto flex min-h-full w-full max-w-[860px] flex-col justify-end gap-5 px-6 pt-7 pb-4"
        >
          {empty ? <EmptyState firstName={chat.firstName} onPick={chat.send} /> : <MessageList />}
          {(conversationState === 'waiting_analyst' || conversationState === 'analyst') && (
            <HandoffNotice state={conversationState} />
          )}
          {state.error && !limit && !closed && (
            <ErrorNotice
              message={state.error.message}
              {...(state.error.retry ? { onRetry: chat.retry } : {})}
            />
          )}
          {(limit || closed) && (
            <LimitNotice reason={limit ? 'limit' : 'closed'} onNew={chat.newConversation} />
          )}
        </div>
      </div>
      <div className="mx-auto w-full max-w-[860px] shrink-0 px-6 pb-4">
        <Composer
          disabled={running || limit || closed}
          disabledHint={
            running
              ? 'O Nexo Assist está respondendo…'
              : limit
                ? 'Limite de mensagens atingido: comece uma nova conversa.'
                : 'Conversa encerrada: comece uma nova conversa.'
          }
          count={messageCount(state)}
          {...(chat.editingDraftId ? { editingDraftId: chat.editingDraftId } : {})}
          onStopEditing={chat.stopEditing}
          onSend={chat.send}
          inputRef={chat.composerRef}
        />
      </div>
    </div>
  )
}
