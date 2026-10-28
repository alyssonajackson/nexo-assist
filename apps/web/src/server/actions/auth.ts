'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { isInvalidCredentialsError } from '@nexo/shared'
import type { LoginState } from '@/lib/auth-types'
import { authProvider } from '../auth-provider'
import { clearSessionCookies, writeSessionCookies } from '../cookies'
import { env } from '../env'
import { HOME_BY_ROLE } from '../session'

const LoginForm = z.object({
  email: z.email('Informe um e-mail válido.').transform((e) => e.trim().toLowerCase()),
  password: z.string().min(1, 'Informe a senha.'),
  remember: z.literal('on').optional(),
})

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginForm.safeParse(Object.fromEntries(formData))
  const email = String(formData.get('email') ?? '')
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.', email }

  let home: string
  try {
    const auth = await authProvider()
    const tokens = await auth.signIn(parsed.data.email, parsed.data.password)
    const user = await auth.verify(tokens.accessToken)
    writeSessionCookies(await cookies(), tokens, {
      username: parsed.data.email,
      remember: parsed.data.remember === 'on',
      secure: env.secureCookies,
    })
    home = HOME_BY_ROLE[user.role]
  } catch (err) {
    if (isInvalidCredentialsError(err)) return { error: 'E-mail ou senha inválidos.', email }
    console.error('login failed', err)
    return { error: 'Não foi possível entrar agora. Tente novamente em instantes.', email }
  }
  // redirect() throws, so it stays outside the try/catch.
  redirect(home)
}

export async function signOut(): Promise<void> {
  clearSessionCookies(await cookies())
  redirect('/login')
}
