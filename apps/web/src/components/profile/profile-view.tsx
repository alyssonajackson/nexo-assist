import { KeyRound, Lock, Mail, RotateCcw } from 'lucide-react'

const CARD =
  'overflow-hidden rounded-xl bg-surface shadow-card outline outline-1 -outline-offset-[.5px] outline-border-card'

export function ProfileView({ name, email }: { name: string; email: string }) {
  return (
    <div className="mx-auto flex w-full max-w-[600px] flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold tracking-[-0.4px] text-ink">Meu perfil</h1>
        <p className="text-[14.5px] text-ink-muted">Seus dados de acesso ao service desk de TI.</p>
      </header>

      <section className={CARD}>
        <div className="flex items-center gap-4 border-b border-border px-6 py-5">
          <span className="w-40 shrink-0 text-[13.5px] text-ink-muted">Nome</span>
          <span className="text-[14.5px] font-medium text-ink">{name}</span>
        </div>
        <div className="flex items-center gap-4 px-6 py-5">
          <span className="w-40 shrink-0 text-[13.5px] text-ink-muted">E-mail corporativo</span>
          <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-ink">{email}</span>
          <span className="flex shrink-0 items-center gap-[5px] text-[12.5px] text-ink-muted">
            <Lock className="size-3.5" aria-hidden="true" />
            Gerenciado pela TI
          </span>
        </div>
      </section>

      <section className={CARD}>
        <div className="flex items-center gap-4 p-6">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-muted">
            <KeyRound className="size-4 text-ink-muted" aria-hidden="true" />
          </span>
          <div className="flex-1">
            <p className="text-[14.5px] font-semibold text-ink">Senha</p>
            <p className="text-[13.5px] text-ink-muted">Gerenciada no Cognito</p>
          </div>
          <button
            type="button"
            disabled
            title="Indisponível na demonstração"
            className="flex h-9 cursor-not-allowed items-center gap-[7px] rounded-md pr-3.5 pl-3 text-[13.5px] font-medium text-ink-soft opacity-60 outline outline-1 -outline-offset-[.5px] outline-border-strong"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Redefinir senha
          </button>
        </div>
        <div className="flex items-center gap-2 border-t border-border bg-surface-muted px-6 py-3 text-[13px] text-ink-muted">
          <Mail className="size-3.5 shrink-0" aria-hidden="true" />
          Enviaremos um link de redefinição para {email}.
        </div>
      </section>
    </div>
  )
}
