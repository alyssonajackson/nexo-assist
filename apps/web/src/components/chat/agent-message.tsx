'use client'

import { useState } from 'react'
import type { Message, MessagePart } from '@nexo/shared'
import {
  isHandedOff,
  isTurnRunning,
  latestAgentMessageId,
  limitReached,
  pickedOption,
} from '@/lib/chat/chat-state'
import { AgentHeader } from './agent-header'
import { AgentBubble } from './bubbles'
import { useChatContext } from './chat-provider'
import { DecisionPanel } from './decision-panel'
import { DraftCard } from './draft-card'
import { QuickReplies } from './quick-replies'
import { TicketCard } from './ticket-card'
import { TicketListCard } from './ticket-list-card'

const partsOf = <T extends MessagePart['type']>(message: Message, type: T) =>
  message.parts.filter((p): p is Extract<MessagePart, { type: T }> => p.type === type)

type AgentMessageProps = {
  message: Message
  /** Drafts whose card is drawn on this message (see draftCardOwners). */
  ownDraftIds: Set<string>
  activeDraftId: string | undefined
}

/**
 * A stored agent message: chips (click -> decision panel), then a single ticket card, the text bubble
 * with its quick replies, and the ticket list or draft card below.
 */
export function AgentMessage({ message, ownDraftIds, activeDraftId }: AgentMessageProps) {
  const chat = useChatContext()
  const { state } = chat
  const [open, setOpen] = useState(false)
  const now = new Date()

  const busy = isTurnRunning(state)
  // Only the latest message's buttons act, and only while the agent is the one answering.
  const interactive =
    latestAgentMessageId(state.messages) === message.id &&
    !busy &&
    !isHandedOff(state) &&
    !limitReached(state)

  const decision = message.decision
  const panelId = `decision-${message.id}`
  const singleTickets = partsOf(message, 'ticket')
  const lists = partsOf(message, 'ticket_list')
  const drafts = partsOf(message, 'draft').filter((p) => ownDraftIds.has(p.draftId))
  const quickReplies = partsOf(message, 'quick_replies').flatMap((p) => p.options)

  return (
    <article className="flex flex-col items-start gap-1.5" aria-label="Mensagem do Nexo Assist">
      <AgentHeader
        tools={decision?.toolsCalled ?? []}
        ruleCount={decision?.ruleOverrides.length ?? 0}
        {...(decision ? { panel: { id: panelId, open, onToggle: () => setOpen((o) => !o) } } : {})}
      />
      {decision && open && <DecisionPanel decision={decision} id={panelId} />}

      {singleTickets.map(({ ticketId }) => {
        const ticket = state.tickets[ticketId]
        return ticket ? <TicketCard key={ticketId} ticket={ticket} now={now} /> : null
      })}

      {(message.text || quickReplies.length > 0) && (
        <AgentBubble>
          {message.text && <p className="whitespace-pre-line">{message.text}</p>}
          {quickReplies.length > 0 && (
            <QuickReplies
              options={quickReplies}
              selected={pickedOption(state.messages, message.id, quickReplies)}
              disabled={!interactive}
              onPick={chat.send}
            />
          )}
        </AgentBubble>
      )}

      {lists.map((list, i) => (
        <TicketListCard
          key={i}
          ticketIds={list.ticketIds}
          tickets={state.tickets}
          selectedId={pickedOption(state.messages, message.id, list.ticketIds)}
          disabled={!interactive}
          onPick={(t) => chat.send(`${t.id} · ${t.title}`)}
        />
      ))}

      {drafts.map(({ draftId }) => {
        const draft = state.drafts[draftId]
        if (!draft) return null
        const target = draft.ticketId ? state.tickets[draft.ticketId] : undefined
        return (
          <DraftCard
            key={draftId}
            draft={draft}
            {...(target ? { ticket: target } : {})}
            active={draftId === activeDraftId}
            busy={busy}
            now={now}
            onConfirm={() => chat.confirmDraft(draftId)}
            onEdit={() => chat.editDraft(draftId)}
            onCancel={() => chat.cancelDraft(draftId)}
          />
        )
      })}
    </article>
  )
}
