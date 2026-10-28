'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowUp, Bot, CircleAlert, Hand, Headset, PanelRight, ShieldCheck } from 'lucide-react'
import type { ConsoleConversationResponse } from '@nexo/shared'
import { formatTime } from '@/lib/chat/format'
import { statePill, type StatusTone } from '@/lib/console/list'
import { Avatar } from '../shell/avatar'
import {
  ConsoleAgentBubble,
  ConsoleAnalystBubble,
  ConsoleEmployeeBubble,
  SystemDivider,
} from './console-bubbles'
import { TransferSummary } from './transfer-summary'

const PILL: Record<StatusTone, string> = {
  warning: 'bg-warning-bg text-warning-ink',
  info: 'bg-primary-50 text-primary-700',
  success: 'bg-success-50 text-success-700',
  danger: 'bg-danger-50 text-danger-700',
  neutral: 'bg-surface-muted text-ink-muted',
}

const outlined =
  'flex h-10 whitespace-nowrap items-center gap-2 rounded-lg bg-surface px-3.5 text-[14px] font-medium text-ink shadow-button outline outline-1 -outline-offset-[.5px] outline-border-strong hover:bg-surface-muted disabled:opacity-50'

type Props = {
  data: ConsoleConversationResponse | null
  /** A conversation is selected and its history is still loading. */
  loading: boolean
  analystId: string
  busy: boolean
  error: string | undefined
  panelOpen: boolean
  onTogglePanel: () => void
  onTakeOver: () => void
  onGiveBack: () => void
  onClose: () => void
  onReply: (text: string) => Promise<boolean>
}

/** Middle pane of screens 4 and 5: header, summary, history, and the bottom bar for the current state. */
export function ConversationPane({
  data,
  loading,
  analystId,
  busy,
  error,
  panelOpen,
  onTogglePanel,
  onTakeOver,
  onGiveBack,
  onClose,
  onReply,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const count = data?.messages.length ?? 0
  const lastId = data?.messages.at(-1)?.id
  // Stay at the bottom when a new message arrives (polling), like a chat.
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [count, lastId, data?.conversation.id])

  if (!data) {
    return (
      <section className="grid min-w-0 flex-1 place-items-center bg-surface-canvas text-[14px] text-ink-muted">
        {loading ? 'Carregando conversa…' : 'Selecione uma conversa'}
      </section>
    )
  }

  const { conversation: c, employee, messages, authors, tickets } = data
  const ticketsById = Object.fromEntries(tickets.map((t) => [t.id, t]))
  const pill = statePill(data, analystId)
  const mine = c.state === 'analyst' && c.assignedAnalystId === analystId
  const firstName = employee.name.split(' ')[0] ?? employee.name

  return (
    <section
      className="flex min-w-0 flex-1 flex-col bg-surface-canvas"
      aria-label={`Conversa com ${employee.name}`}
    >
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface px-5">
        <Avatar name={employee.name} online={c.state !== 'closed'} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[16px] font-semibold text-ink">{employee.name}</h2>
          <p className="truncate text-[13px] text-ink-muted">
            {[employee.department, data.currentTicketId].filter(Boolean).join(' · ')}
          </p>
        </div>
        {mine ? (
          <>
            <button onClick={onGiveBack} disabled={busy} className={outlined}>
              <Bot className="size-4 text-ink-muted" aria-hidden="true" />
              Devolver ao agent
            </button>
            <button
              onClick={onClose}
              disabled={busy}
              className="flex h-10 items-center gap-2 rounded-lg bg-danger-50 px-3.5 text-[14px] font-medium text-danger-700 hover:bg-danger-500/20 disabled:opacity-50"
            >
              <ShieldCheck className="size-4" aria-hidden="true" />
              Encerrar atendimento
            </button>
          </>
        ) : (
          <span
            className={`flex h-[34px] items-center gap-2 rounded-pill px-3.5 text-[13px] font-semibold ${PILL[pill.tone]}`}
          >
            <Headset className="size-3.5" aria-hidden="true" />
            {pill.text}
          </span>
        )}
        <button
          onClick={onTogglePanel}
          aria-label={panelOpen ? 'Ocultar chamados' : 'Mostrar chamados'}
          aria-pressed={panelOpen}
          className="rounded-md p-2 text-ink-muted hover:bg-surface-muted"
        >
          <PanelRight className="size-[18px]" />
        </button>
      </header>

      {c.transfer && <TransferSummary transfer={c.transfer} />}

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[900px] flex-col gap-4 px-6 py-6">
          {messages.length === 0 && (
            <p className="text-center text-[13px] text-ink-muted">Sem mensagens ainda.</p>
          )}
          {messages.map((m) => {
            switch (m.role) {
              case 'employee':
                return <ConsoleEmployeeBubble key={m.id} message={m} />
              case 'agent':
                return <ConsoleAgentBubble key={m.id} message={m} tickets={ticketsById} />
              case 'analyst':
                return (
                  <ConsoleAnalystBubble
                    key={m.id}
                    message={m}
                    author={m.authorId ? authors[m.authorId] : undefined}
                  />
                )
              case 'system':
                return <SystemDivider key={m.id} text={m.text} />
            }
          })}
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="mx-5 mb-2 flex items-center gap-2 rounded-lg bg-danger-50 px-3.5 py-2 text-[13px] text-danger-700"
        >
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      <footer className="shrink-0 border-t border-border bg-surface px-5 py-3">
        {c.state === 'waiting_analyst' && (
          <div className="mb-3 flex items-center gap-3">
            <span className="grid size-[38px] shrink-0 place-items-center rounded-full bg-warning-bg text-warning-ink">
              <Hand className="size-[18px]" aria-hidden="true" />
            </span>
            <div className="flex-1">
              <p className="text-[15px] font-semibold whitespace-nowrap text-ink">
                {firstName} espera um atendente
              </p>
              <p className="text-[13px] whitespace-nowrap text-ink-muted">
                Agent pausado{data.waitingUntil ? ` · até ${formatTime(data.waitingUntil)}` : ''}
              </p>
            </div>
            <button onClick={onGiveBack} disabled={busy} className={outlined}>
              <Bot className="size-4 text-ink-muted" aria-hidden="true" />
              Devolver ao agent
            </button>
            <button
              onClick={onTakeOver}
              disabled={busy}
              className="flex h-10 items-center gap-2 rounded-lg bg-primary-600 whitespace-nowrap px-4 text-[14px] font-semibold text-white shadow-cta hover:bg-primary-700 disabled:opacity-50"
            >
              <Headset className="size-4" aria-hidden="true" />
              Assumir atendimento
            </button>
          </div>
        )}
        <ReplyBox enabled={mine} hint={hintFor(c.state, mine)} onSend={onReply} key={c.id} />
      </footer>
    </section>
  )
}

function hintFor(state: ConsoleConversationResponse['conversation']['state'], mine: boolean): string {
  if (mine) return 'Escreva para o colaborador'
  switch (state) {
    case 'waiting_analyst':
      return 'Assuma o atendimento para responder'
    case 'analyst':
      return 'Esta conversa está com outro analista'
    case 'agent':
      return 'O agent está atendendo esta conversa'
    case 'closed':
      return 'Conversa encerrada'
  }
}

/** Enter sends, Shift+Enter adds a line. Disabled unless the conversation is assigned to this analyst. */
function ReplyBox({
  enabled,
  hint,
  onSend,
}: {
  enabled: boolean
  hint: string
  onSend: (text: string) => Promise<boolean>
}) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const canSend = enabled && !sending && text.trim().length > 0
  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!canSend) return
    setSending(true)
    const ok = await onSend(text.trim())
    setSending(false)
    if (ok) setText('')
  }
  return (
    <form onSubmit={submit} className="flex items-center gap-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void submit()
          }
        }}
        disabled={!enabled}
        rows={1}
        aria-label="Mensagem para o colaborador"
        placeholder={hint}
        className="max-h-32 min-h-11 flex-1 resize-none rounded-lg bg-surface-muted px-4 py-3 text-[14.5px] text-ink outline-none placeholder:text-ink-muted focus:ring-2 focus:ring-primary-500/40 disabled:cursor-not-allowed"
      />
      {enabled && (
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Enviar"
          className="grid size-11 place-items-center rounded-full bg-primary-600 text-white shadow-cta hover:bg-primary-700 disabled:opacity-50"
        >
          <ArrowUp className="size-5" />
        </button>
      )}
    </form>
  )
}
