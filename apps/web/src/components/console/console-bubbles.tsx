import { useState } from 'react'
import type { ConsoleAuthor, Message, MessagePart, TicketView } from '@nexo/shared'
import { formatTime } from '@/lib/chat/format'
import { AgentHeader } from '../chat/agent-header'
import { DecisionPanel } from '../chat/decision-panel'
import { SystemDivider } from '../chat/bubbles'

const Time = ({ at }: { at: Date }) => (
  <span className="ml-3 self-end text-[11.5px] text-ink-muted">{formatTime(at)}</span>
)

/** Employee: white, left (console view; the employee's own chat shows it dark on the right). */
export function ConsoleEmployeeBubble({ message }: { message: Message }) {
  return (
    <div className="flex">
      <p className="flex max-w-[560px] items-baseline rounded-[4px_12px_12px_12px] bg-surface px-4 py-2.5 text-[14.5px]/[21px] whitespace-pre-line text-ink shadow-bubble">
        {message.text}
        <Time at={message.createdAt} />
      </p>
    </div>
  )
}

/** Small lines for what the agent attached: ticket cards and drafts, as plain references. */
function Attachments({ message, tickets }: { message: Message; tickets: Record<string, TicketView> }) {
  const ids = message.parts.flatMap((p: MessagePart) =>
    p.type === 'ticket' ? [p.ticketId] : p.type === 'ticket_list' ? p.ticketIds : [],
  )
  const drafts = message.parts.filter((p) => p.type === 'draft').length
  if (ids.length === 0 && drafts === 0) return null
  return (
    <ul className="flex flex-wrap justify-end gap-1.5 text-[12px] text-ink-soft">
      {ids.map((id) => (
        <li
          key={id}
          className="rounded-md bg-surface px-2 py-0.5 outline outline-1 -outline-offset-[.5px] outline-border"
        >
          {id}
          {tickets[id] ? ` · ${tickets[id].title}` : ''}
        </li>
      ))}
      {drafts > 0 && (
        <li className="rounded-md bg-surface px-2 py-0.5 outline outline-1 -outline-offset-[.5px] outline-border">
          Rascunho de chamado
        </li>
      )}
    </ul>
  )
}

/** Agent: light blue, right, with the same action chips and decision panel as the employee's chat. */
export function ConsoleAgentBubble({
  message,
  tickets,
}: {
  message: Message
  tickets: Record<string, TicketView>
}) {
  const [open, setOpen] = useState(false)
  const decision = message.decision
  const panelId = `decision-${message.id}`
  return (
    <div className="flex flex-col items-end gap-1.5">
      <AgentHeader
        tools={decision?.toolsCalled ?? []}
        ruleCount={decision?.ruleOverrides.length ?? 0}
        {...(decision ? { panel: { id: panelId, open, onToggle: () => setOpen((o) => !o) } } : {})}
      />
      {decision && open && (
        <div className="w-full max-w-[640px] text-left">
          <DecisionPanel decision={decision} id={panelId} />
        </div>
      )}
      <Attachments message={message} tickets={tickets} />
      {message.text && (
        <p className="flex max-w-[620px] items-baseline rounded-[12px_4px_12px_12px] bg-bubble-agent px-4 py-2.5 text-[14.5px]/[21px] whitespace-pre-line text-ink shadow-bubble">
          {message.text}
          <Time at={message.createdAt} />
        </p>
      )}
    </div>
  )
}

/** Analyst: light green, right, with name and team ("Rafael Lima · Suporte N2"). */
export function ConsoleAnalystBubble({
  message,
  author,
}: {
  message: Message
  author: ConsoleAuthor | undefined
}) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      <span className="flex items-center gap-2 text-[12.5px]">
        <span className="font-semibold text-ink">{author?.name ?? 'Analista'}</span>
        {author?.team && (
          <span className="rounded-sm bg-success-50 px-1.5 py-px text-[11.5px] font-medium text-success-700">
            {author.team}
          </span>
        )}
      </span>
      <p className="flex max-w-[620px] items-baseline rounded-[12px_4px_12px_12px] bg-bubble-analyst px-4 py-2.5 text-[14.5px]/[21px] whitespace-pre-line text-ink shadow-bubble">
        {message.text}
        <Time at={message.createdAt} />
      </p>
    </div>
  )
}

export { SystemDivider }
