import { confirmDraft } from '@/server/assist/commit'
import { apiSession, ndjson } from '@/server/api'

/** The Confirmar button. The only path that writes a ticket. Streams retry status while the system is flaky. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await apiSession('employee')
  if (session instanceof Response) return session
  const { id } = await ctx.params
  return ndjson((emit) => confirmDraft(session, id, emit))
}
