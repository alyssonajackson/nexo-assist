import type { Metadata } from 'next'
import { ProfileView } from '@/components/profile/profile-view'
import { EmployeeShell } from '@/components/shell/employee-shell'
import { signOut } from '@/server/actions/auth'
import { requireSession } from '@/server/session'

export const metadata: Metadata = { title: 'Meu perfil · Nexo Assist' }

export default async function ProfilePage() {
  const { profile } = await requireSession('employee')
  return (
    <EmployeeShell profile={profile} active="perfil" breadcrumb="Meu perfil" signOutAction={signOut}>
      <ProfileView name={profile.name} email={profile.email} />
    </EmployeeShell>
  )
}
