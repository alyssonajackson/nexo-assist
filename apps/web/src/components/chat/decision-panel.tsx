'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { Check, Cpu, ShieldCheck, X } from 'lucide-react'
import { ACTION_LABELS, CONFIDENCE, RULE_LABELS, type Decision } from '@nexo/shared'
import { decisionLabel, extractedRows, intentLabel } from '@/lib/chat/decision-view'
import { confidenceLevel, formatConfidence, formatMs, type ConfidenceLevel } from '@/lib/chat/format'

/**
 * "Por que o Nexo fez isso?" (PRD: the most important part). Everything comes from the Decision stored
 * with the message, so it works the same for a reply that just streamed and for last week's history.
 * Reading order: what it understood -> what it did -> how sure -> why -> evidence (tools) -> what the
 * system enforced on top of the model.
 */
export function DecisionPanel({ decision, id }: { decision: Decision; id: string }) {
  const rows = extractedRows(decision.extracted)
  // Opening the panel brings it into view (the chat would otherwise stay pinned to the bottom).
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' })
  }, [])
  return (
    <section
      ref={ref}
      id={id}
      aria-label="Detalhes da decisão"
      className="w-full scroll-mt-10 rounded-xl bg-surface-muted p-4 outline outline-1 -outline-offset-[.5px] outline-border"
    >
      <header className="flex items-center gap-2 border-b border-border pb-3">
        <h3 className="text-[13.5px] font-semibold text-ink">Como o Nexo Assist decidiu</h3>
        <span className="flex-1" />
        <SourceBadge decision={decision} />
      </header>

      <dl className="mt-1 divide-y divide-border">
        <Row label="Entendeu">
          <p className="font-semibold text-ink">{intentLabel(decision.intent)}</p>
          {rows.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {rows.map((r) => (
                <li
                  key={r.key}
                  className="max-w-full rounded-md bg-surface px-2 py-1 text-[12.5px] outline outline-1 -outline-offset-[.5px] outline-border"
                >
                  <span className="text-ink-muted">{r.label}: </span>
                  <span className="text-ink">{r.value}</span>
                </li>
              ))}
            </ul>
          )}
          {decision.missingFields && decision.missingFields.length > 0 && (
            <p className="mt-2 text-[12.5px] text-ink-muted">
              Faltando: <span className="text-ink">{decision.missingFields.join(', ')}</span>
            </p>
          )}
        </Row>

        <Row label="Ação">
          <p className="font-semibold text-ink">{ACTION_LABELS[decision.action]}</p>
        </Row>

        <Row label="Confiança">
          <ConfidenceMeter confidence={decision.confidence} />
        </Row>

        <Row label="Por quê">
          <p className="text-ink">{decision.reason}</p>
        </Row>

        {decision.toolsCalled.length > 0 && (
          <Row label="Ferramentas">
            <ol className="flex flex-col gap-1.5">
              {decision.toolsCalled.map((call, i) => (
                <li key={i} className="flex items-start gap-2">
                  {call.ok ? (
                    <Check className="mt-[3px] size-3.5 shrink-0 text-success-700" aria-label="ok" />
                  ) : (
                    <X className="mt-[3px] size-3.5 shrink-0 text-danger-700" aria-label="falhou" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-ink">{call.label}</span>
                    {call.summary && <span className="text-ink-muted"> · {call.summary}</span>}
                  </span>
                  <span className="shrink-0 text-[12px] text-ink-muted tabular-nums">
                    {formatMs(call.ms)}
                  </span>
                </li>
              ))}
            </ol>
          </Row>
        )}
      </dl>

      {decision.ruleOverrides.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {decision.ruleOverrides.map((o, i) => {
            const from = decisionLabel(o.from)
            const to = decisionLabel(o.to)
            return (
              <div
                key={i}
                className="rounded-lg bg-warning-bg/60 px-3 py-2.5 outline outline-1 -outline-offset-[.5px] outline-warning-500/30"
              >
                <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-warning-ink">
                  <ShieldCheck className="size-3.5" aria-hidden="true" />
                  Regra aplicada pelo sistema · {RULE_LABELS[o.rule]}
                </p>
                <p className="mt-1 text-[13.5px] text-ink">{o.why}</p>
                {(from || to) && (
                  <p className="mt-1 text-[12.5px] text-ink-soft">
                    {from && (
                      <>
                        O modelo escolheu <span className="line-through decoration-ink/40">{from}</span>
                      </>
                    )}
                    {from && to && ' → '}
                    {to && (
                      <>
                        o sistema aplicou <span className="font-semibold text-ink">{to}</span>
                      </>
                    )}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] gap-3 py-2.5 text-[13.5px]/[20px]">
      <dt className="pt-px text-[11px] font-semibold tracking-wide text-ink-muted uppercase">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

function SourceBadge({ decision }: { decision: Decision }) {
  const meta = [
    decision.latencyMs !== undefined ? formatMs(decision.latencyMs) : undefined,
    decision.usage?.inputTokens
      ? `${(decision.usage.inputTokens + decision.usage.outputTokens).toLocaleString('pt-BR')} tokens`
      : undefined,
  ].filter(Boolean)
  return (
    <span className="flex items-center gap-1.5 text-[12px] text-ink-muted">
      {decision.source === 'code' ? (
        <>
          <ShieldCheck className="size-3.5" aria-hidden="true" />
          Decidido pelo sistema, sem o modelo
        </>
      ) : (
        <>
          <Cpu className="size-3.5" aria-hidden="true" />
          {decision.model ?? 'Modelo'}
        </>
      )}
      {meta.length > 0 && <span>· {meta.join(' · ')}</span>}
    </span>
  )
}

const LEVEL: Record<ConfidenceLevel, { bar: string; text: string; label: string }> = {
  high: { bar: 'bg-success-500', text: 'text-success-700', label: 'alta' },
  medium: { bar: 'bg-warning-500', text: 'text-warning-700', label: 'intermediária: pergunta antes de agir' },
  low: { bar: 'bg-danger-500', text: 'text-danger-700', label: 'baixa: transfere para um analista' },
}

/** Bar + %, with the two policy thresholds marked on the track. */
export function ConfidenceMeter({ confidence }: { confidence: number }) {
  const level = LEVEL[confidenceLevel(confidence)]
  const pct = formatConfidence(confidence)
  return (
    <div>
      <div className="flex items-center gap-3">
        <div
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(confidence * 100)}
          aria-label="Confiança"
          className="relative h-1.5 flex-1 rounded-full bg-ink/10"
        >
          <div className={`h-full rounded-full ${level.bar}`} style={{ width: pct }} />
          {[CONFIDENCE.transferBelow, CONFIDENCE.clarifyBelow].map((t) => (
            <span
              key={t}
              className="absolute -top-1 h-3.5 w-px bg-ink/30"
              style={{ left: `${t * 100}%` }}
              aria-hidden="true"
            />
          ))}
        </div>
        <span className={`w-10 text-right font-semibold tabular-nums ${level.text}`}>{pct}</span>
      </div>
      <p className="mt-1.5 text-[12px] text-ink-muted">
        Confiança {level.label}. Abaixo de {CONFIDENCE.transferBelow * 100}% transfere; abaixo de{' '}
        {CONFIDENCE.clarifyBelow * 100}% pergunta antes de propor um chamado.
      </p>
    </div>
  )
}
