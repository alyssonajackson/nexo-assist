import type { ReactNode } from 'react'
import { AlertCircle, Headset, MessageSquarePlus, RotateCcw } from 'lucide-react'

type Tone = 'info' | 'warning' | 'danger'

const TONES: Record<Tone, string> = {
  info: 'bg-primary-50 text-primary-700 outline-primary-500/25',
  warning: 'bg-warning-bg/70 text-warning-ink outline-warning-500/30',
  danger: 'bg-danger-50 text-danger-700 outline-danger-500/25',
}

function Notice({ tone, icon, children }: { tone: Tone; icon: ReactNode; children: ReactNode }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`flex items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-[13px] outline outline-1 -outline-offset-[.5px] ${TONES[tone]}`}
    >
      {icon}
      <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1">{children}</div>
    </div>
  )
}

const actionClass =
  'flex h-8 items-center gap-1.5 rounded-md bg-surface px-3 text-[13px] font-medium text-ink shadow-button outline outline-1 -outline-offset-[.5px] outline-border-strong hover:bg-surface-muted'

export function ErrorNotice({
  message,
  onRetry,
  signedOut = false,
}: {
  message: string
  onRetry?: () => void
  /** The session expired: the way out is signing in again. */
  signedOut?: boolean
}) {
  return (
    <Notice tone="danger" icon={<AlertCircle className="size-4 shrink-0" aria-hidden="true" />}>
      <span className="flex-1">{message}</span>
      {signedOut && (
        <a href="/login" className={actionClass}>
          Entrar novamente
        </a>
      )}
      {onRetry && (
        <button type="button" onClick={onRetry} className={actionClass}>
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Tentar novamente
        </button>
      )}
    </Notice>
  )
}

/** M5: a simple banner while an analyst has the conversation; M6 builds the full handoff. */
export function HandoffNotice({ state }: { state: 'waiting_analyst' | 'analyst' }) {
  return (
    <Notice tone="warning" icon={<Headset className="size-4 shrink-0" aria-hidden="true" />}>
      {state === 'waiting_analyst'
        ? 'Sua conversa foi transferida para um analista. O Nexo Assist fica em silêncio até lá; pode continuar escrevendo que o analista lê tudo.'
        : 'Um analista está cuidando da sua conversa agora. O Nexo Assist volta quando ele devolver a conversa.'}
    </Notice>
  )
}

export function LimitNotice({ reason, onNew }: { reason: 'limit' | 'closed'; onNew: () => void }) {
  return (
    <Notice tone="info" icon={<MessageSquarePlus className="size-4 shrink-0" aria-hidden="true" />}>
      <span className="flex-1">
        {reason === 'limit'
          ? 'Você chegou ao limite de 30 mensagens desta conversa.'
          : 'Esta conversa foi encerrada.'}{' '}
        Seus chamados continuam salvos; comece uma nova conversa para continuar.
      </span>
      <button type="button" onClick={onNew} className={actionClass}>
        Nova conversa
      </button>
    </Notice>
  )
}
