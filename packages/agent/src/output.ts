import { z } from 'zod'
import { Action, Extracted, Intent, type ModelDecision } from '@nexo/shared'

/**
 * What the model must return at the end of each turn (native structured output). Field order matters:
 * intent, action, confidence and reason stream before `reply`, so the UI can draw the decision above
 * the reply while it is still being written. Kept lenient (no max lengths) so a long list does not fail
 * the whole turn; `toModelDecision` normalizes it.
 */
export const AgentOutput = z.object({
  intent: Intent,
  extracted: Extracted,
  // The model can never commit a draft; only the Confirmar button does.
  action: Action.exclude(['commit_draft']),
  confidence: z.number().describe('0 a 1: o quanto você tem certeza de que entendeu o pedido'),
  reason: z.string().describe('PT-BR, 1-2 frases explicando por que escolheu esta ação'),
  missingFields: z.array(z.string()).optional().describe('Campos obrigatórios que faltam, em PT-BR'),
  quickReplies: z.array(z.string()).optional().describe('Até 4 respostas rápidas'),
  reply: z.string().describe('Resposta ao funcionário, em PT-BR'),
})
export type AgentOutput = z.infer<typeof AgentOutput>

export function toModelDecision(out: AgentOutput): { decision: ModelDecision; reply: string } {
  const { reply, quickReplies, missingFields, ...rest } = out
  const replies = quickReplies
    ?.map((q) => q.trim())
    .filter(Boolean)
    .slice(0, 4)
  return {
    reply: reply.trim(),
    decision: {
      ...rest,
      confidence: Math.min(1, Math.max(0, rest.confidence)),
      ...(replies?.length ? { quickReplies: replies } : {}),
      ...(missingFields?.length ? { missingFields } : {}),
    },
  }
}

/**
 * Small models sometimes write a JS object literal instead of JSON (unquoted keys, `undefined`).
 * Before giving up on the turn, try that one repair; the result is still validated by the schema.
 */
export function repairOutput(raw: string): AgentOutput | null {
  const text = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
  const json = text
    .replace(/\bundefined\b/g, 'null')
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
  try {
    const parsed = AgentOutput.safeParse(dropNulls(JSON.parse(json)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function dropNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(dropNulls)
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v)
        .filter(([, x]) => x !== null)
        .map(([k, x]) => [k, dropNulls(x)]),
    )
  }
  return v
}
