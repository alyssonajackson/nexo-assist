import type { ReactNode } from 'react'

/** The prototype's card shell: ticket list, ticket detail and draft cards. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`w-full overflow-hidden rounded-xl bg-surface shadow-card outline outline-1 -outline-offset-[.5px] outline-border-card ${className}`}
    >
      {children}
    </div>
  )
}

/** "Chamado · INC-20311 ............ ● Aguardando analista" */
export function CardEyebrow({ kind, id, right }: { kind: string; id: string; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 pb-0.5 text-[12.5px] text-ink-muted">
      <span className="font-medium">{kind}</span>
      <span className="size-[3px] rounded-full bg-border" aria-hidden="true" />
      <span>{id}</span>
      <span className="flex-1" />
      {right}
    </div>
  )
}

/** One labelled value in the card's bottom grid ("Categoria / Rede e VPN"). */
export function CardField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12.5px] text-ink-muted">{label}</dt>
      <dd className="mt-1 text-[14.5px] text-ink">{children}</dd>
    </div>
  )
}
