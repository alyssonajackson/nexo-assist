'use client'

import { useEffect } from 'react'
import {
  AFFECTED_LABELS,
  CATEGORY_LABELS,
  type Draft,
  type DraftKind,
  type DraftStatus,
  type TicketView,
} from '@nexo/shared'
import { slaPromise } from '@/lib/chat/format'
import { Card, CardEyebrow, CardField } from './card'
import { PriorityLabel, StatusDot, type Tone } from './status-dot'

const KIND_LABELS: Record<DraftKind, string> = {
  create: 'Novo chamado',
  update: 'Atualização de chamado',
  reopen: 'Reabertura de chamado',
}

const STATUS: Record<DraftStatus, { tone: Tone; label: (d: Draft) => string }> = {
  pending: { tone: 'warning', label: () => 'Aguardando confirmação' },
  confirmed: { tone: 'info', label: () => 'Registrando…' },
  committed: { tone: 'success', label: (d) => `Registrado · ${d.resultTicketId ?? ''}` },
  pending_registration: { tone: 'warning', label: () => 'Pendente de registro' },
  cancelled: { tone: 'neutral', label: () => 'Cancelado' },
  failed: { tone: 'danger', label: () => 'Não registrado' },
}

type DraftCardProps = {
  draft: Draft
  /** Target ticket of an update or reopen, when loaded. */
  ticket?: TicketView
  /** The latest pending draft: ⌘↵ / Ctrl+↵ confirms it. */
  active: boolean
  /** A turn is running: buttons wait. */
  busy: boolean
  now: Date
  onConfirm: () => void
  onEdit: () => void
  onCancel: () => void
}

/**
 * Screen 2. Nothing is written until the employee presses Confirmar: the draft is a real state on the
 * server (pending -> confirmed -> committed / pending_registration), and only that button moves it.
 */
export function DraftCard({ draft, ticket, active, busy, now, onConfirm, onEdit, onCancel }: DraftCardProps) {
  const pending = draft.status === 'pending'
  const status = STATUS[draft.status]

  useEffect(() => {
    if (!active || !pending || busy) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onConfirm()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, pending, busy, onConfirm])

  const priority = draft.fields?.priority ?? ticket?.priority
  // The SLA clock starts when the ticket is registered; until then, it is a promise counted from now.
  const slaFrom = draft.committedAt ?? now

  return (
    <Card className={pending ? '' : 'opacity-95'}>
      <div className="px-[18px] pt-4 pb-3.5">
        <CardEyebrow
          kind={KIND_LABELS[draft.kind]}
          id={`Rascunho ${draft.id}`}
          right={<StatusDot tone={status.tone} label={status.label(draft)} />}
        />
        <h3
          className={`mt-1.5 text-[17px] font-semibold ${draft.status === 'cancelled' ? 'text-ink-muted line-through' : 'text-ink'}`}
        >
          {draft.fields?.title ?? `${draft.ticketId ?? ''}${ticket ? ` · ${ticket.title}` : ''}`}
        </h3>
        <p className="mt-1.5 text-[14px]/[21px] whitespace-pre-line text-ink-soft">
          {draft.fields?.description ?? draft.note}
        </p>
        <dl className="mt-3.5 grid grid-cols-3 gap-4 border-t border-border pt-3.5">
          {draft.fields ? (
            <CardField label="Categoria">{CATEGORY_LABELS[draft.fields.category]}</CardField>
          ) : (
            <CardField label="Chamado">{draft.ticketId}</CardField>
          )}
          {priority && (
            <CardField label="Prioridade">
              <PriorityLabel priority={priority} />
              {draft.status !== 'cancelled' && draft.status !== 'failed' && (
                <span className="text-[12.5px] text-ink-muted"> · {slaPromise(priority, slaFrom)}</span>
              )}
            </CardField>
          )}
          {draft.fields && <CardField label="Afetados">{AFFECTED_LABELS[draft.fields.affected]}</CardField>}
        </dl>
      </div>

      {pending && (
        <div className="flex items-center gap-1.5 border-t border-border bg-surface-muted p-2 pr-3.5">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex h-9 items-center gap-2.5 rounded-md bg-primary-600 px-3.5 text-[13.5px] font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            Confirmar
            <kbd className="rounded-sm bg-white/15 px-1.5 py-px font-sans text-[11px] font-medium text-white/85">
              ⌘↵
            </kbd>
          </button>
          <button
            type="button"
            onClick={onEdit}
            disabled={busy}
            className="h-9 rounded-md bg-surface px-3.5 text-[13.5px] font-medium text-ink shadow-button outline outline-1 -outline-offset-[.5px] outline-border-strong hover:bg-surface-muted disabled:opacity-60"
          >
            Editar
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-9 rounded-md px-3.5 text-[13.5px] font-medium text-ink-soft hover:bg-ink/5 disabled:opacity-60"
          >
            Cancelar
          </button>
        </div>
      )}
      {draft.status === 'pending_registration' && (
        <p className="border-t border-border bg-warning-bg/50 px-[18px] py-2.5 text-[12.5px] text-warning-ink">
          O sistema de chamados está fora do ar. Seu pedido está guardado e será registrado assim que ele
          voltar; o número aparece aqui.
        </p>
      )}
    </Card>
  )
}
