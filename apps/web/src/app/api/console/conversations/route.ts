import { ConsoleFilter } from '@nexo/shared'
import { apiSession } from '@/server/api'
import { listConsole } from '@/server/assist/console'

/** The analyst's conversation list: ?filter=all|waiting|agent|mine&q=search. Employees get 403. */
export async function GET(req: Request) {
  const session = await apiSession('analyst')
  if (session instanceof Response) return session
  const params = new URL(req.url).searchParams
  const filter = ConsoleFilter.catch('all').parse(params.get('filter') ?? 'all')
  return Response.json(await listConsole(session.user.userId, filter, params.get('q') ?? ''))
}
