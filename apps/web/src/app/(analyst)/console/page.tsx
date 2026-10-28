import type { Metadata } from 'next'
import { ConsoleView } from '@/components/console/console-view'
import { signOut } from '@/server/actions/auth'
import { requireSession } from '@/server/session'

export const metadata: Metadata = { title: 'Conversas · Nexo Assist' }

/** Analyst console (screens 4 and 5). Data arrives by polling /api/console/*. */
export default async function ConsolePage() {
  const { profile } = await requireSession('analyst')
  return <ConsoleView profile={profile} signOutAction={signOut} />
}
