import {
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TicketsHttpError,
  TicketsUnavailableError,
  type TicketView,
  type ToolName,
} from '@nexo/shared'
import type { TurnContext } from '../context'

/** What a tool returns to the model when it could not do its job. The model explains it; it never retries blindly. */
export type ToolRefusal = { ok: false; error: string; message: string; details?: unknown }

export const refuse = (error: string, message: string, details?: unknown): ToolRefusal => ({
  ok: false,
  error,
  message,
  ...(details === undefined ? {} : { details }),
})

/**
 * Runs a tool body through the turn recorder. Ticket-system outages (after the client's retries) and
 * HTTP errors become refusals the model can explain, instead of crashing the turn.
 */
export async function runTool<T extends { ok: true }>(
  turn: TurnContext,
  tool: ToolName,
  run: () => Promise<T | ToolRefusal>,
  summarize: (result: T) => string,
): Promise<T | ToolRefusal> {
  try {
    return await turn.recorder.record(
      tool,
      async () => {
        const result = await run()
        if (isRefusal(result)) throw new RefusedError(result)
        return result
      },
      summarize,
    )
  } catch (err) {
    if (err instanceof RefusedError) return err.refusal
    if (err instanceof TicketsUnavailableError) {
      return refuse(
        'tickets_unavailable',
        'Sistema de chamados indisponível no momento, mesmo depois de tentar novamente.',
      )
    }
    if (err instanceof TicketsHttpError) return refuse(err.code, err.message)
    throw err
  }
}

const isRefusal = (v: { ok: boolean }): v is ToolRefusal => !v.ok

/** Lets a refusal be recorded as a failed call (ok: false) while still reaching the model as data. */
class RefusedError extends Error {
  constructor(readonly refusal: ToolRefusal) {
    super(refusal.message)
  }
}

const fmt = (d: Date | null | undefined) => (d ? d.toISOString() : null)

/** Compact, PT-BR view of a ticket for the model. SLA fields are computed by the tickets service. */
export function ticketForModel(t: TicketView) {
  const last = t.timeline.at(-1)
  return {
    id: t.id,
    tipo: t.type,
    titulo: t.title,
    categoria: CATEGORY_LABELS[t.category],
    prioridade: PRIORITY_LABELS[t.priority],
    status: STATUS_LABELS[t.status],
    abertoEm: fmt(t.createdAt),
    atualizadoEm: fmt(t.updatedAt),
    prazoSla: fmt(t.sla.dueAt),
    atrasado: t.sla.overdue,
    podeReabrir: t.sla.reopenable,
    resolvidoEm: fmt(t.resolvedAt),
    ultimaAtualizacao: last?.note ?? null,
  }
}
