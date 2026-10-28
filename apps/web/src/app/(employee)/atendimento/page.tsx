import type { Metadata } from 'next'
import { EmployeeShell } from '@/components/shell/employee-shell'
import { signOut } from '@/server/actions/auth'
import { requireSession } from '@/server/session'

export const metadata: Metadata = { title: 'Atendimento · Nexo Assist' }

// The chat arrives in milestone 5; this page proves the employee session and layout.
export default async function ChatPage() {
  const { profile } = await requireSession('employee')
  return (
    <EmployeeShell profile={profile} active="atendimento" breadcrumb="Atendimento" signOutAction={signOut}>
      <div className="flex h-full items-center justify-center text-ink-muted">
        Olá, {profile.name.split(' ')[0]}. O chat com o Nexo Assist chega em breve.
      </div>
    </EmployeeShell>
  )
}
