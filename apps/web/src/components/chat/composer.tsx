'use client'

import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowUp, X } from 'lucide-react'
import { MAX_EMPLOYEE_MESSAGES } from '@nexo/shared'

type ComposerProps = {
  disabled: boolean
  /** Why the input is disabled, shown as the placeholder. */
  disabledHint?: string
  count: number
  editingDraftId?: string
  onStopEditing: () => void
  onSend: (text: string) => void
  inputRef: React.RefObject<HTMLTextAreaElement | null>
}

/** Enter sends, Shift+Enter adds a line, ⌘↵ is left for the draft's Confirmar. */
export function Composer({
  disabled,
  disabledHint,
  count,
  editingDraftId,
  onStopEditing,
  onSend,
  inputRef,
}: ComposerProps) {
  const [text, setText] = useState('')
  const canSend = !disabled && text.trim().length > 0

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!canSend) return
    onSend(text.trim())
    setText('')
    onStopEditing()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  const placeholder = disabled
    ? (disabledHint ?? 'Aguarde…')
    : editingDraftId
      ? 'Diga o que mudar no rascunho (ex.: a prioridade, quem é afetado)…'
      : 'Escreva para o Nexo...'

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      {editingDraftId && (
        <div className="flex items-center gap-2 text-[12.5px] text-primary-700">
          Editando o rascunho {editingDraftId}: descreva a mudança e o Nexo Assist propõe de novo.
          <button
            type="button"
            onClick={onStopEditing}
            className="rounded-sm p-0.5 hover:bg-primary-50"
            aria-label="Parar de editar"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="flex min-h-12 items-end gap-2 rounded-lg bg-surface py-1.5 pr-1.5 pl-4 outline outline-1 -outline-offset-[.5px] outline-border-strong focus-within:outline-2 focus-within:outline-primary-500">
        <label htmlFor="chat-input" className="sr-only">
          Mensagem para o Nexo Assist
        </label>
        <textarea
          id="chat-input"
          ref={inputRef}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          maxLength={2000}
          className="field-sizing-content max-h-40 min-h-9 flex-1 resize-none bg-transparent py-[7px] text-[14.5px]/[22px] text-ink outline-none placeholder:text-ink-muted disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          disabled={!canSend}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-sm bg-primary-600 px-3 text-[13.5px] font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
        >
          <ArrowUp className="size-4" aria-hidden="true" />
          Enviar
        </button>
      </div>
      <p className="text-right text-[12.5px] text-ink-muted" aria-live="polite">
        {count}/{MAX_EMPLOYEE_MESSAGES} mensagens nesta sessão
      </p>
    </form>
  )
}
