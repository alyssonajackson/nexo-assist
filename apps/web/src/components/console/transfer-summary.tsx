import { Headset } from 'lucide-react'
import type { Transfer } from '@nexo/shared'
import { formatTime } from '@/lib/chat/format'

const REASONS: Record<Transfer['reason'], string> = {
  employee_request: 'O colaborador pediu um analista',
  critical: 'Caso crítico',
  overdue: 'Chamado com prazo vencido',
  low_confidence: 'O agent teve baixa confiança',
}

/** The PRD requires the transfer to carry a case summary: shown up front, so the analyst needs no scrolling. */
export function TransferSummary({ transfer }: { transfer: Transfer }) {
  return (
    <section
      aria-label="Resumo do caso"
      className="mx-6 mt-4 shrink-0 rounded-xl bg-warning-bg/60 px-4 py-3 outline outline-1 -outline-offset-[.5px] outline-warning-500/30"
    >
      <h2 className="flex items-center gap-2 text-[12.5px] font-semibold text-warning-ink">
        <Headset className="size-3.5" aria-hidden="true" />
        Resumo do caso · {REASONS[transfer.reason]} · {formatTime(transfer.at)}
      </h2>
      <p className="mt-1 text-[14px]/[21px] whitespace-pre-line text-ink">{transfer.summary}</p>
    </section>
  )
}
