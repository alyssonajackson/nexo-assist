import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Draft } from '@nexo/shared'
import type { Session } from '../session'

// commit.ts talks to Mongo, SQS and the tickets service; only the guard is under test here.
vi.mock('server-only', () => ({}))
vi.mock('../queues', () => ({ queues: vi.fn() }))
vi.mock('./chat', () => ({ actorOf: vi.fn() }))
vi.mock('./conversations', () => ({ addRelatedTickets: vi.fn(), getConversation: vi.fn() }))
vi.mock('./drafts', () => ({ getDraft: vi.fn(), moveDraft: vi.fn() }))
vi.mock('./handoff', () => ({ transferToAnalyst: vi.fn() }))
vi.mock('./messages', () => ({ appendMessage: vi.fn() }))
vi.mock('./runtime', () => ({ ticketsAs: vi.fn() }))

const { commitDraft, DraftError } = await import('./commit')
const { ticketsAs } = await import('./runtime')
const { queues } = await import('../queues')

const session: Session = {
  user: { userId: 'u-ana', username: 'ana.souza@nexo.com.br', role: 'employee' },
  profile: {
    userId: 'u-ana',
    name: 'Ana Souza',
    email: 'ana.souza@nexo.com.br',
    role: 'employee',
    department: 'Financeiro',
  },
  accessToken: 'token',
}

const draft = (status: Draft['status']): Draft => ({
  id: 'D-381',
  conversationId: 'c1',
  employeeId: 'u-ana',
  kind: 'create',
  status,
  createdAt: new Date(),
  fields: {
    type: 'INC',
    category: 'software',
    title: 'Sistema fora',
    description: 'Caiu de manhã',
    priority: 'medium',
    affected: 'self',
  },
})

describe('commitDraft', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(['pending', 'cancelled', 'committed', 'pending_registration', 'failed'] as const)(
    'refuses a %s draft without touching the tickets service or the queue',
    async (status) => {
      const emit = vi.fn()
      const err = await commitDraft(session, draft(status), emit).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(DraftError)
      expect(err).toMatchObject({ code: 'not_confirmed' })
      expect(ticketsAs).not.toHaveBeenCalled()
      expect(queues).not.toHaveBeenCalled()
      expect(emit).not.toHaveBeenCalled()
    },
  )
})
