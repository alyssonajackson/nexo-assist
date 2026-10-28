import { KeyRound, ListChecks, Wifi } from 'lucide-react'

const SUGGESTIONS = [
  { text: 'Minha VPN não conecta, aparece o erro 809.', Icon: Wifi },
  { text: 'Qual o status dos meus chamados?', Icon: ListChecks },
  { text: 'Preciso de acesso à pasta do Financeiro no SharePoint.', Icon: KeyRound },
] as const

/** New conversation: greeting and three starting points. */
export function EmptyState({ firstName, onPick }: { firstName: string; onPick: (text: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-6 py-10 text-center">
      <div>
        <h2 className="text-[22px] font-semibold text-ink">Olá, {firstName}. Como posso ajudar?</h2>
        <p className="mx-auto mt-2 max-w-[460px] text-[14.5px]/[22px] text-ink-soft">
          Sou o Nexo Assist, o assistente do service desk de TI. Tiro dúvidas com a central de ajuda, abro e
          acompanho seus chamados e, se precisar, chamo um analista.
        </p>
      </div>
      <ul className="grid w-full grid-cols-3 gap-3">
        {SUGGESTIONS.map(({ text, Icon }) => (
          <li key={text}>
            <button
              type="button"
              onClick={() => onPick(text)}
              className="flex h-full w-full flex-col items-start gap-2.5 rounded-xl bg-surface p-4 text-left text-[13.5px]/[20px] text-ink shadow-card outline outline-1 -outline-offset-[.5px] outline-border-card hover:outline-primary-500"
            >
              <Icon className="size-4 text-primary-600" aria-hidden="true" />
              {text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
