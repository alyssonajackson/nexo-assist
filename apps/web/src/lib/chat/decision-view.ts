import {
  ACTION_LABELS,
  AFFECTED_LABELS,
  CATEGORY_LABELS,
  INTENT_LABELS,
  PRIORITY_LABELS,
  type Action,
  type Extracted,
  type Intent,
} from '@nexo/shared'

const TYPE_LABELS = { INC: 'Incidente (INC)', REQ: 'Requisição (REQ)' } as const
const yesNo = (v: boolean) => (v ? 'Sim' : 'Não')

/** How the decision panel shows each extracted field: label and value formatter. Order = display order. */
const FIELDS: {
  [K in keyof Extracted]-?: [label: string, format: (v: NonNullable<Extracted[K]>) => string]
} = {
  ticketId: ['Chamado', String],
  title: ['Título', String],
  type: ['Tipo', (v) => TYPE_LABELS[v]],
  category: ['Categoria', (v) => CATEGORY_LABELS[v]],
  priority: ['Prioridade', (v) => PRIORITY_LABELS[v]],
  affected: ['Afetados', (v) => AFFECTED_LABELS[v]],
  sameDayCommitment: ['Compromisso hoje', yesNo],
  hasWorkaround: ['Tem alternativa', yesNo],
  kbArticleIds: ['Artigos da central', (v) => v.join(', ')],
  description: ['Descrição', String],
}

export type FieldRow = { key: keyof Extracted; label: string; value: string }

/** Extracted fields as readable PT-BR rows; fields the agent did not fill are left out. */
export function extractedRows(extracted: Extracted): FieldRow[] {
  return (Object.keys(FIELDS) as (keyof Extracted)[]).flatMap((key) => {
    const v = extracted[key]
    if (v === undefined) return []
    const [label, format] = FIELDS[key] as [string, (v: unknown) => string]
    const value = format(v)
    return value === '' ? [] : [{ key, label, value }]
  })
}

/** Rule overrides store raw action/intent names; show their labels when they are known. */
export function decisionLabel(name: string | undefined): string | undefined {
  if (!name) return undefined
  if (name in ACTION_LABELS) return ACTION_LABELS[name as Action]
  if (name in INTENT_LABELS) return INTENT_LABELS[name as Intent]
  return name
}

export const intentLabel = (intent: string | undefined): string | undefined =>
  intent && intent in INTENT_LABELS ? INTENT_LABELS[intent as Intent] : intent
