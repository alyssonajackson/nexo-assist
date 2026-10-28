import type { ReactNode } from 'react'

/** The employee's own message: dark, right-aligned. */
export function EmployeeBubble({ text, pending = false }: { text: string; pending?: boolean }) {
  return (
    <div className="flex justify-end">
      <p
        className={`max-w-[520px] rounded-[12px_12px_4px_12px] bg-bubble-employee px-4 py-[11px] text-[14.5px]/[21px] whitespace-pre-line text-white ${
          pending ? 'opacity-70' : ''
        }`}
      >
        {text}
      </p>
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

/** M5 shows analyst replies plainly; the console (M6) owns the full handoff experience. */
export function AnalystBubble({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      <span className="text-[12.5px] font-semibold text-ink">Analista de TI</span>
      <p className="max-w-[600px] rounded-[4px_12px_12px_12px] bg-bubble-analyst px-4 py-3 text-[14.5px]/[22px] whitespace-pre-line text-ink">
        {text}
      </p>
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
