import { createConversation, latestOpenConversation } from '@/server/assist/conversations'
import { apiSession } from '@/server/api'

/** The employee's current conversation (latest not closed), or null: "continuar de onde parei". */
export async function GET() {
  const session = await apiSession('employee')
  if (session instanceof Response) return session
  return Response.json({ conversation: await latestOpenConversation(session.user.userId) })
}

/** "Nova conversa" (e.g. after reaching 30 messages). */
export async function POST() {
  const session = await apiSession('employee')
  if (session instanceof Response) return session
  return Response.json({ conversation: await createConversation(session.user.userId) }, { status: 201 })
}
