import type { Metadata } from 'next'
import { ChatHeaderRight } from '@/components/chat/chat-header'
import { ChatProvider } from '@/components/chat/chat-provider'
import { ChatView } from '@/components/chat/chat-view'
import { EmployeeShell } from '@/components/shell/employee-shell'
import { signOut } from '@/server/actions/auth'
import { latestOpenConversation } from '@/server/assist/conversations'
import { employeeConversationView } from '@/server/assist/view'
import { requireSession } from '@/server/session'

export const metadata: Metadata = { title: 'Atendimento · Nexo Assist' }

/** "Voltar outro dia e continuar de onde parei": the open conversation is rendered from the server. */
export default async function ChatPage() {
  const session = await requireSession('employee')
  const open = await latestOpenConversation(session.user.userId)
  const initial = open ? await employeeConversationView(session, open.id) : null
  const firstName = session.profile.name.split(' ')[0] ?? session.profile.name
  return (
    <ChatProvider initial={initial} firstName={firstName}>
      <EmployeeShell
        profile={session.profile}
        active="atendimento"
        breadcrumb="Atendimento"
        headerRight={<ChatHeaderRight />}
        signOutAction={signOut}
      >
        <ChatView />
      </EmployeeShell>
    </ChatProvider>
  )
}
