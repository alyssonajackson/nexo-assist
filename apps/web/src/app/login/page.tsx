import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { LoginShowcase } from '@/components/login/login-showcase'
import { LoginPanel } from '@/components/login/login-form'
import { signIn } from '@/server/actions/auth'
import { getSession, HOME_BY_ROLE } from '@/server/session'

export const metadata: Metadata = { title: 'Entrar · Nexo Assist' }

export default async function LoginPage() {
  const session = await getSession()
  if (session) redirect(HOME_BY_ROLE[session.user.role])
  return (
    <main className="grid min-h-screen lg:grid-cols-[1111fr_889fr]">
      <LoginShowcase />
      <LoginPanel action={signIn} />
    </main>
  )
}
