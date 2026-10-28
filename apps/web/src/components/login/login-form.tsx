'use client'

import { useActionState, useState } from 'react'
import { ArrowRight, Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react'
import type { LoginState } from '@/lib/auth-types'

type LoginAction = (state: LoginState, formData: FormData) => Promise<LoginState>

const INPUT_BOX =
  'flex h-11 items-center gap-2.5 rounded-md bg-surface pr-2 pl-3.5 outline outline-1 -outline-offset-[.5px] outline-border-strong focus-within:outline-[1.5px] focus-within:outline-primary-600'

export function LoginForm({ action }: { action: LoginAction }) {
  const [state, formAction, pending] = useActionState(action, {})
  const [showPassword, setShowPassword] = useState(false)
  const [showHint, setShowHint] = useState(false)

  return (
    <form action={formAction} className="flex w-full flex-col gap-7">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-[40px]/[44px] tracking-[-0.8px] text-ink">Entrar</h1>
        <p className="text-[15.5px]/[23px] text-ink-muted">
          Use seu e-mail corporativo e a senha da rede Nexo.
        </p>
      </div>

      <div className="flex flex-col gap-[18px]">
        <div className="flex flex-col gap-2">
          <label htmlFor="email" className="text-[13.5px] font-medium text-ink">
            E-mail corporativo
          </label>
          <div className={`${INPUT_BOX} shadow-button`}>
            <Mail className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              defaultValue={state.email}
              placeholder="nome.sobrenome@nexo.com.br"
              className="min-w-0 flex-1 bg-transparent text-[14.5px] text-ink outline-none placeholder:text-ink-muted/70"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-[13.5px] font-medium text-ink">
              Senha
            </label>
            <button
              type="button"
              onClick={() => setShowHint((v) => !v)}
              className="text-[13.5px] font-medium text-primary-700 hover:underline"
            >
              Esqueci minha senha
            </button>
          </div>
          <div className={INPUT_BOX}>
            <Lock className="size-4 shrink-0 text-primary-700" aria-hidden="true" />
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              className="min-w-0 flex-1 bg-transparent text-[14.5px] text-ink outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              className="grid size-[30px] place-items-center rounded-sm text-ink-muted hover:bg-surface-muted"
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {showHint && <p className="text-[12.5px] text-ink-muted">Use a senha de demonstração do README.</p>}
        </div>

        <label className="flex w-fit items-center gap-[9px] pt-0.5 text-[13.5px] text-ink-soft">
          <input type="checkbox" name="remember" defaultChecked className="size-[18px] accent-primary-600" />
          Manter conectado neste computador
        </label>
      </div>

      {state.error && (
        <p role="alert" className="rounded-md bg-danger-50 px-3.5 py-2.5 text-[13.5px] text-danger-700">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary-600 text-[15.5px] font-semibold text-white shadow-cta hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-80"
      >
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Entrando…
          </>
        ) : (
          <>
            Entrar
            <ArrowRight className="size-4" aria-hidden="true" />
          </>
        )}
      </button>
    </form>
  )
}

export function LoginPanel({ action }: { action: LoginAction }) {
  return (
    <section className="flex min-h-screen flex-1 flex-col justify-between px-6 py-10 sm:px-14">
      <p className="flex justify-end gap-1.5 text-[13.5px]">
        <span className="text-ink-muted">Problema para entrar?</span>
        <span className="font-semibold text-primary-700">Ligue no ramal 4000</span>
      </p>
      <div className="mx-auto w-full max-w-[380px] py-8">
        <LoginForm action={action} />
      </div>
      <footer className="flex justify-between gap-4 text-[12.5px] text-ink-muted">
        <span>© 2026 Nexo · Service desk de TI</span>
        <span>Privacidade e uso de dados</span>
      </footer>
    </section>
  )
}
