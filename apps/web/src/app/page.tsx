import { redirect } from 'next/navigation'
import { HOME_BY_ROLE, requireSession } from '@/server/session'

export default async function Home() {
  const { user } = await requireSession()
  redirect(HOME_BY_ROLE[user.role])
}
