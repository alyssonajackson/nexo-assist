import { serve } from '@hono/node-server'
import { Hono } from 'hono'

const app = new Hono()
app.get('/health', (c) => c.json({ ok: true, service: 'tickets' }))

const port = Number(process.env.TICKETS_PORT ?? 4000)
serve({ fetch: app.fetch, port }, () => console.log(`tickets: listening on :${port}`))
