import { NexoLogo } from '../brand/nexo-logo'

const STATS = [
  { value: '8 s', label: 'primeira resposta, em média', live: false },
  { value: '72%', label: 'resolvidos sem fila', live: false },
  { value: '6', label: 'analistas online agora', live: true },
]

function ConversationPreview() {
  return (
    <div className="flex w-full max-w-[500px] flex-col gap-2.5 rounded-xl bg-white/[0.04] p-[18px] outline outline-1 -outline-offset-[.5px] outline-white/[0.08]">
      <div className="flex justify-end">
        <p className="rounded-[12px_12px_4px_12px] bg-white px-3.5 py-[9px] text-[13.5px] text-ink">
          Meu notebook não conecta na VPN. Erro 809.
        </p>
      </div>
      <div className="flex flex-col items-start gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
          <span className="font-semibold text-white/80">Nexo Assist</span>
          <span className="text-white/45">consultou seus chamados · criou um chamado</span>
        </div>
        <p className="max-w-[380px] rounded-[4px_12px_12px_12px] bg-white/[0.08] px-3.5 py-2.5 text-[13.5px]/[20px] text-white">
          Pronto: abri o chamado com prioridade alta. Um analista fala com você em até 4 h úteis.
        </p>
        <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-[7px] text-[12.5px]">
          <span className="size-[7px] rounded-full bg-warning-500" />
          <span className="font-semibold text-ink">INC-20517</span>
          <span className="text-ink-muted">Rede e VPN · Alta · em até 4 h</span>
        </div>
      </div>
    </div>
  )
}

export function LoginShowcase() {
  return (
    <aside className="hidden h-full w-[800px] shrink-0 flex-col justify-between overflow-hidden bg-navy-900 px-16 pt-10 pb-12 lg:flex">
      <NexoLogo variant="light" className="[&_span]:text-[17px]" />
      <div className="flex flex-col gap-9">
        <div className="flex flex-col gap-[18px]">
          <p className="text-[13.5px] font-medium text-white/55">Service desk de TI da Nexo</p>
          <h1 className="font-serif text-[54px]/[56px] font-normal tracking-[-1.2px] text-white">
            Seu problema de TI, resolvido em uma conversa.
          </h1>
          <p className="max-w-[520px] text-base/[25px] text-white/65">
            Descreva o que está acontecendo. O assistente consulta seus chamados, busca na central de ajuda e
            chama um analista quando precisa.
          </p>
        </div>
        <div className="pl-24">
          <ConversationPreview />
        </div>
      </div>
      <dl className="flex w-full max-w-[672px] border-t border-white/10 pt-6">
        {STATS.map((stat, i) => (
          <div
            key={stat.label}
            className={`flex flex-1 flex-col gap-1.5 ${i > 0 ? 'border-l border-white/10 pl-6' : ''}`}
          >
            <dd className="order-first flex items-center gap-2 font-serif text-[34px] tracking-[-0.6px] text-white">
              {stat.value}
              {stat.live && <span className="size-2 rounded-full bg-success-500" />}
            </dd>
            <dt className="text-[13.5px] text-white/55">{stat.label}</dt>
          </div>
        ))}
      </dl>
    </aside>
  )
}
