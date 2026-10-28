'use client'

import { useState } from 'react'
import { LogOut, MessageCircle } from 'lucide-react'
import type { SessionProfile } from '@/lib/auth-types'
import { Avatar } from '../shell/avatar'
import { NexoLogo } from '../brand/nexo-logo'
import { ConversationList } from './conversation-list'
import { ConversationPane } from './conversation-pane'
import { TicketsPanel } from './tickets-panel'
import { useConsole } from './use-console'

/** The analyst console (screens 4 and 5): rail, conversation list, conversation, employee's tickets. */
export function ConsoleView({
  profile,
  signOutAction,
}: {
  profile: SessionProfile
  signOutAction: () => Promise<void>
}) {
  const console_ = useConsole()
  const [panelOpen, setPanelOpen] = useState(true)
  const { list, detail } = console_
  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <nav
        aria-label="Principal"
        className="flex w-16 shrink-0 flex-col items-center gap-1.5 border-r border-border bg-surface-muted py-4"
      >
        <NexoLogo withWordmark={false} className="mb-1" />
        <span
          className="relative mt-2 grid size-10 place-items-center rounded-xl bg-surface shadow-button"
          aria-current="page"
        >
          <MessageCircle className="size-[19px] text-ink" aria-label="Conversas" />
          {list && list.counts.waiting > 0 && (
            <span className="absolute top-1 left-6 grid h-4 min-w-4 place-items-center rounded-pill bg-primary-600 px-1 text-[10px] font-bold text-white outline outline-2 outline-surface-muted">
              {list.counts.waiting}
            </span>
          )}
        </span>
        <span className="flex-1" />
        <form action={signOutAction}>
          <button
            type="submit"
            title="Sair"
            aria-label="Sair"
            className="mb-2 rounded-md p-2 text-ink-muted hover:bg-surface"
          >
            <LogOut className="size-4" />
          </button>
        </form>
        <span title={`${profile.name} · ${profile.team ?? 'Suporte'}`}>
          <Avatar name={profile.name} size="sm" online />
        </span>
      </nav>

      <ConversationList
        items={list?.items}
        counts={list?.counts}
        filter={console_.filter}
        onFilter={console_.setFilter}
        query={console_.query}
        onQuery={console_.setQuery}
        selectedId={console_.selectedId}
        onSelect={console_.select}
        analystId={profile.userId}
      />

      <ConversationPane
        data={detail}
        loading={console_.selectedId !== undefined}
        analystId={profile.userId}
        busy={console_.busy}
        error={console_.error}
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen((o) => !o)}
        onTakeOver={console_.takeOver}
        onGiveBack={console_.giveBack}
        onClose={console_.close}
        onReply={console_.reply}
      />

      {panelOpen && detail && (
        <TicketsPanel
          employeeName={detail.employee.name}
          tickets={detail.tickets}
          currentTicketId={detail.currentTicketId}
          unavailable={detail.ticketsUnavailable}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </div>
  )
}
