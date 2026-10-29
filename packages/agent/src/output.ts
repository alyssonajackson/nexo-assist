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

/**
 * How the model must write AgentOutput, in place of Mastra's default (the full JSON schema dump, ~500
 * tokens on every call). The enums are already listed in the system prompt. "Texto normal, sem chamar
 * ferramenta": gpt-oss on Groq otherwise tries to call a tool named "JSON" for its final answer.
 */
export const OUTPUT_INSTRUCTIONS = `Formato da resposta final: quando terminar de usar as ferramentas, escreva uma mensagem de texto normal (sem chamar ferramenta) contendo só um objeto JSON, sem markdown, com os campos nesta ordem: intent, extracted (objeto com ticketId, title, description, type, category, affected, sameDayCommitment, hasWorkaround, priority, kbArticleIds; omita os que não souber), action, confidence, reason, missingFields (opcional), quickReplies (opcional), reply.`

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
 * Small models sometimes write a JS object literal instead of JSON (unquoted keys, `undefined`), or an
 * extracted field outside its enum (gpt-oss: `"category": ""`). Before giving up on the turn, try that
 * one repair: quote the keys and drop the invalid extracted fields (all optional). The result is still
 * validated by the schema, so intent, action and reply must be right.
 */
export function repairOutput(raw: string): AgentOutput | null {
  const text = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
  const json = text
    .replace(/\bundefined\b/g, 'null')
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
  try {
    const parsed = AgentOutput.safeParse(dropInvalidExtracted(dropNulls(JSON.parse(json))))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function dropInvalidExtracted(v: unknown): unknown {
  if (!v || typeof v !== 'object' || !('extracted' in v)) return v
  const { extracted } = v
  if (!extracted || typeof extracted !== 'object') return { ...v, extracted: {} }
  const shape: Record<string, z.ZodType> = Extracted.shape
  const valid = Object.entries(extracted).filter(([k, x]) => shape[k]?.safeParse(x).success)
  return { ...v, extracted: Object.fromEntries(valid) }
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
