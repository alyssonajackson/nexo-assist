import type { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronRight, LogOut, MessageSquare, User } from 'lucide-react'
import type { SessionProfile } from '@/lib/auth-types'
import { NexoLogo } from '../brand/nexo-logo'
import { Avatar } from './avatar'

type NavKey = 'atendimento' | 'perfil'

const NAV_ITEMS = [
  { key: 'atendimento', label: 'Atendimento', href: '/atendimento', Icon: MessageSquare },
  { key: 'perfil', label: 'Meu perfil', href: '/perfil', Icon: User },
] as const

type EmployeeShellProps = {
  profile: Pick<SessionProfile, 'name' | 'email'>
  active: NavKey
  breadcrumb: string
  headerRight?: ReactNode
  signOutAction: () => Promise<void>
  children: ReactNode
}

export function EmployeeShell({
  profile,
  active,
  breadcrumb,
  headerRight,
  signOutAction,
  children,
}: EmployeeShellProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <aside className="flex w-[231px] shrink-0 flex-col border-r border-border px-3.5 pt-5 pb-3.5">
        <NexoLogo className="px-2" />
        <nav className="mt-[22px] flex flex-col gap-0.5">
          {NAV_ITEMS.map(({ key, label, href, Icon }) => (
            <Link
              key={key}
              href={href}
              aria-current={key === active ? 'page' : undefined}
              className={`flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] ${
                key === active
                  ? 'bg-primary-50 font-semibold text-primary-700'
                  : 'font-medium text-ink-soft hover:bg-surface-muted'
              }`}
            >
              <Icon
                className={`size-4 ${key === active ? 'text-primary-700' : 'text-ink-muted'}`}
                aria-hidden="true"
              />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-2.5 border-t border-border px-2 pt-3.5 pb-1">
          <Avatar name={profile.name} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-semibold text-ink">{profile.name}</p>
            <p className="truncate text-[11.5px] text-ink-muted">{profile.email}</p>
          </div>
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            className="flex h-[34px] w-full items-center gap-2.5 rounded-md px-2.5 text-[13.5px] font-medium text-ink-soft hover:bg-surface-muted"
          >
            <LogOut className="size-4 text-ink-muted" aria-hidden="true" />
            Sair
          </button>
        </form>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-4 border-b border-border px-8">
          <div className="flex flex-1 items-center gap-2 text-[13.5px]">
            <span className="text-ink-muted">Service desk de TI</span>
            <ChevronRight className="size-3.5 text-ink-muted" aria-hidden="true" />
            <span className="font-semibold text-ink">{breadcrumb}</span>
          </div>
          {headerRight}
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
