import type { ReactNode } from 'react'
import type { ConsoleAuthor } from '@nexo/shared'
import { Avatar } from '../shell/avatar'

/** The employee's own message: dark, right-aligned. */
export function EmployeeBubble({
  text,
  pending = false,
  unsent = false,
}: {
  text: string
  pending?: boolean
  unsent?: boolean
}) {
  return (
    <div className="flex flex-col items-end gap-1">
      <p
        className={`max-w-[520px] rounded-[12px_12px_4px_12px] bg-bubble-employee px-4 py-[11px] text-[14.5px]/[21px] whitespace-pre-line text-white ${
          pending || unsent ? 'opacity-70' : ''
        }`}
      >
        {text}
      </p>
      {unsent && <span className="text-[12px] text-danger-700">Não enviada</span>}
    </div>
  )
}

/** The agent's text bubble (white, outlined); quick replies go inside it. */
export function AgentBubble({ children, live = false }: { children: ReactNode; live?: boolean }) {
  return (
    <div
      className="flex max-w-[600px] flex-col gap-3 rounded-[4px_12px_12px_12px] bg-surface px-4 py-3 text-[14.5px]/[22px] text-ink outline outline-1 -outline-offset-[.5px] outline-border"
      {...(live ? { 'aria-live': 'polite', 'aria-busy': true } : {})}
    >
      {children}
    </div>
  )
}

/** An analyst's reply in the employee's chat: avatar, name and team above a light green bubble. */
export function AnalystBubble({ text, author }: { text: string; author: ConsoleAuthor | undefined }) {
  const name = author?.name ?? 'Analista de TI'
  return (
    <div className="flex items-start gap-2.5">
      <Avatar name={name} size="sm" tone="green" />
      <div className="flex flex-col items-start gap-1.5">
        <span className="flex items-center gap-2 text-[12.5px]">
          <span className="font-semibold text-ink">{name}</span>
          {author?.team && (
            <span className="rounded-sm bg-success-50 px-1.5 py-px text-[11.5px] font-medium text-success-700">
              {author.team}
            </span>
          )}
        </span>
        <p className="max-w-[600px] rounded-[4px_12px_12px_12px] bg-bubble-analyst px-4 py-3 text-[14.5px]/[22px] whitespace-pre-line text-ink">
          {text}
        </p>
      </div>
    </div>
  )
}

/** System notes ("Regra aplicada: …", "Conversa transferida…") as a centered divider. */
export function SystemDivider({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 text-[11.5px] text-ink-muted" role="note">
      <span className="h-px flex-1 bg-ink/10" />
      <span className="max-w-[80%] text-center">{text}</span>
      <span className="h-px flex-1 bg-ink/10" />
    </div>
  )
}

/** Three dots while the agent is thinking. */
export function TypingDots() {
  return (
    <span className="flex items-center gap-1 py-1.5" role="status" aria-label="Nexo Assist está pensando">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="size-1.5 animate-bounce rounded-full bg-ink/35"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  )
}
