'use client'

import { activeDraftId, draftCardOwners } from '@/lib/chat/chat-state'
import { AgentMessage } from './agent-message'
import { AnalystBubble, EmployeeBubble, SystemDivider } from './bubbles'
import { useChatContext } from './chat-provider'
import { LiveTurn } from './live-turn'

export function MessageList() {
  const { state } = useChatContext()
  const owners = draftCardOwners(state.messages)
  const active = activeDraftId(state)
  return (
    <div className="flex flex-col gap-5">
      {state.messages.map((m) => {
        switch (m.role) {
          case 'employee':
            return <EmployeeBubble key={m.id} text={m.text} />
          case 'agent': {
            const own = new Set([...owners].filter(([, owner]) => owner === m.id).map(([draftId]) => draftId))
            return <AgentMessage key={m.id} message={m} ownDraftIds={own} activeDraftId={active} />
          }
          case 'analyst':
            return <AnalystBubble key={m.id} text={m.text} />
          case 'system':
            return <SystemDivider key={m.id} text={m.text} />
        }
      })}
      {state.turn && <LiveTurn turn={state.turn} />}
      {state.error?.unsentText && <EmployeeBubble text={state.error.unsentText} unsent />}
    </div>
  )
}
