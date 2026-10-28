import { cancelDraft } from '@/server/assist/commit'
import { apiSession, errorEvent } from '@/server/api'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await apiSession('employee')
  if (session instanceof Response) return session
  const { id } = await ctx.params
  try {
    return Response.json({ draft: await cancelDraft(session, id) })
  } catch (err) {
    const e = errorEvent(err)
    return Response.json(e, { status: e.error === 'not_found' ? 404 : e.error === 'internal' ? 500 : 409 })
  }
}
