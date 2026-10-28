import { Check, ChevronDown, ShieldCheck, X } from 'lucide-react'
import type { ToolCall } from '@nexo/shared'

type AgentHeaderProps = {
  tools: ToolCall[]
  /** Rule overrides in the stored decision: flagged right in the row. */
  ruleCount?: number
  /** Present when there is a stored decision to open. */
  panel?: { id: string; open: boolean; onToggle: () => void }
  children?: React.ReactNode
}

/** "Nexo Assist ✓ consultou seus chamados ✓ buscou na central de ajuda · Ver decisão" */
export function AgentHeader({ tools, ruleCount = 0, panel, children }: AgentHeaderProps) {
  const chips = (
    <>
      <span className="text-[12.5px] font-semibold text-ink">Nexo Assist</span>
      {tools.map((call, i) => (
        <span key={i} className="flex items-center gap-[5px] text-[12.5px] text-ink-muted">
          {call.ok ? (
            <Check className="size-3.5" aria-hidden="true" />
          ) : (
            <X className="size-3.5 text-danger-700" aria-hidden="true" />
          )}
          <span className={call.ok ? '' : 'text-danger-700'}>{call.label}</span>
        </span>
      ))}
      {ruleCount > 0 && (
        <span className="flex items-center gap-1 rounded-sm bg-warning-bg px-1.5 py-px text-[11.5px] font-medium text-warning-ink">
          <ShieldCheck className="size-3" aria-hidden="true" />
          regra aplicada
        </span>
      )}
    </>
  )

  if (!panel) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {chips}
        {children}
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={panel.onToggle}
      aria-expanded={panel.open}
      aria-controls={panel.id}
      title="Ver como o Nexo Assist decidiu"
      className="group -mx-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-1.5 py-0.5 text-left hover:bg-surface-muted"
    >
      {chips}
      <span className="flex items-center gap-0.5 text-[12.5px] font-medium text-primary-700 opacity-70 group-hover:opacity-100 group-aria-expanded:opacity-100">
        {panel.open ? 'Ocultar decisão' : 'Ver decisão'}
        <ChevronDown
          className={`size-3.5 transition-transform ${panel.open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </span>
    </button>
  )
}
