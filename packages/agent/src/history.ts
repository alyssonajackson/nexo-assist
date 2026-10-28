import type { Message } from '@nexo/shared'

export type ModelMessage = { role: 'user'; content: string } | { role: 'assistant'; content: string }

/** How many past messages the agent sees. assist.messages is the source of truth, not Mastra memory. */
export const HISTORY_LIMIT = 20

/**
 * Maps the stored conversation to model messages. Analysts and system notes are labelled so the agent
 * knows who said what (e.g. after an analyst gives the conversation back). Cards are summarized as
 * text, so ticket numbers and draft ids stay in context.
 */
export function toModelMessages(history: Message[], text: string): ModelMessage[] {
  const out: ModelMessage[] = []
  const push = (role: ModelMessage['role'], content: string) => {
    const last = out.at(-1)
    if (last?.role === role) last.content += `\n\n${content}`
    else out.push(role === 'user' ? { role, content } : { role, content })
  }
  for (const m of history.slice(-HISTORY_LIMIT)) {
    if (m.role === 'employee') push('user', m.text)
    else if (m.role === 'analyst') push('assistant', `[Analista] ${m.text}`)
    else if (m.role === 'system') push('assistant', `[Sistema] ${m.text}`)
    else push('assistant', m.text + describeParts(m))
  }
  push('user', text)
  // Providers expect the conversation to start with the user.
  while (out[0]?.role === 'assistant') out.shift()
  return out
}

function describeParts(m: Message): string {
  const notes = m.parts.flatMap((p) => {
    if (p.type === 'ticket_list') return [`chamados mostrados: ${p.ticketIds.join(', ')}`]
    if (p.type === 'ticket') return [`chamado mostrado: ${p.ticketId}`]
    if (p.type === 'draft') return [`rascunho ${p.draftId} mostrado para confirmação`]
    return []
  })
  return notes.length ? `\n(${notes.join('; ')})` : ''
}
