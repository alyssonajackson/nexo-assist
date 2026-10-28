import type { Metadata } from 'next'
import { signOut } from '@/server/actions/auth'
import { requireSession } from '@/server/session'

export const metadata: Metadata = { title: 'Conversas · Nexo Assist' }

// The analyst console arrives in milestone 6; this page proves the analyst session and role routing.
export default async function ConsolePage() {
  const { profile } = await requireSession('analyst')
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface-muted">
      <p className="text-ink">
        {profile.name} · {profile.team ?? 'Suporte'}
      </p>
      <p className="text-ink-muted">O console do analista chega em breve.</p>
      <form action={signOut}>
        <button className="rounded-lg border border-border px-4 py-2 text-sm">Sair</button>
      </form>
    </main>
  )
}
