'use client'

import { AlertTriangle, LoaderCircle } from 'lucide-react'
import { DEFAULT_RETRY } from '@nexo/shared'
import type { LiveTurn as LiveTurnState } from '@/lib/chat/chat-state'
import { intentLabel } from '@/lib/chat/decision-view'
import { formatConfidence } from '@/lib/chat/format'
import { AgentHeader } from './agent-header'
import { AgentBubble, EmployeeBubble, TypingDots } from './bubbles'

/**
 * The turn being streamed: the employee's message right away, then chips as each tool finishes, the
 * early decision (intent + confidence), the reply text as it arrives, and ticket-system retries.
 */
export function LiveTurn({ turn }: { turn: LiveTurnState }) {
  const hasAgentActivity = turn.tools.length > 0 || turn.decision || turn.text || !turn.pendingEmployeeText
  return (
    <>
      {turn.pendingEmployeeText && <EmployeeBubble text={turn.pendingEmployeeText} pending />}
      {turn.status && <TicketsStatus status={turn.status} />}
      {hasAgentActivity && (
        <article className="flex flex-col items-start gap-1.5" aria-label="Nexo Assist respondendo">
          <AgentHeader tools={turn.tools}>
            {turn.decision?.intent && (
              <span className="rounded-sm bg-primary-50 px-1.5 py-px text-[11.5px] font-medium text-primary-700">
                {intentLabel(turn.decision.intent)}
                {turn.decision.confidence !== undefined && ` · ${formatConfidence(turn.decision.confidence)}`}
              </span>
            )}
          </AgentHeader>
          <AgentBubble live>
            {turn.text ? <p className="whitespace-pre-line">{turn.text}</p> : <TypingDots />}
          </AgentBubble>
        </article>
      )}
    </>
  )
}

/** "Sistema de chamados indisponível, tentando novamente (2/4)…" */
function TicketsStatus({ status }: { status: NonNullable<LiveTurnState['status']> }) {
  const retrying = status.status === 'tickets_retrying'
  const attempt = retrying && status.attempt ? ` (${status.attempt}/${DEFAULT_RETRY.attempts})` : ''
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-lg bg-warning-bg/70 px-3.5 py-2.5 text-[13px] text-warning-ink"
    >
      {retrying ? (
        <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden="true" />
      ) : (
        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
      )}
      {retrying ? `Sistema de chamados indisponível, tentando novamente${attempt}…` : status.message}
    </div>
  )
}
