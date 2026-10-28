import {
  isOpenStatus,
  REOPEN_WINDOW_DAYS,
  slaStatus,
  TicketsHttpError,
  type KbArticle,
  type Ticket,
  type TicketView,
} from '@nexo/shared'
import type { AgentTickets } from '../context'

const HOUR = 3_600_000
const DAY = 24 * HOUR

type Ago = { days?: number; hours?: number }
const ago = (now: Date, a: Ago) => new Date(now.getTime() - (a.days ?? 0) * DAY - (a.hours ?? 0) * HOUR)

type Fixture = Omit<Ticket, 'createdAt' | 'updatedAt' | 'lastSupportUpdateAt' | 'resolvedAt' | 'timeline'> & {
  createdAgo: Ago
  lastSupportUpdateAgo?: Ago
  resolvedAgo?: Ago
}

/** A small slice of the seed (scripts/src/seed/data.ts): Ana's tickets plus one of Bruno's. */
const FIXTURES: Fixture[] = [
  {
    id: 'INC-20311',
    type: 'INC',
    category: 'hardware',
    title: 'Notebook lento após atualização do Windows',
    description: 'Desde a última atualização do Windows o notebook ficou muito lento para abrir o Excel.',
    priority: 'medium',
    affected: 'self',
    status: 'awaiting_analyst',
    requesterId: 'u-ana',
    requesterName: 'Ana Souza',
    createdAgo: { days: 9 },
    lastSupportUpdateAgo: { days: 6 },
  },
  {
    id: 'INC-20298',
    type: 'INC',
    category: 'access',
    title: 'Acesso à pasta Financeiro no SharePoint',
    description: 'Perdi o acesso à pasta Financeiro no SharePoint e não consigo abrir os relatórios mensais.',
    priority: 'medium',
    affected: 'self',
    status: 'in_progress',
    requesterId: 'u-ana',
    requesterName: 'Ana Souza',
    createdAgo: { days: 3 },
    lastSupportUpdateAgo: { hours: 3 },
  },
  {
    id: 'INC-20150',
    type: 'INC',
    category: 'access',
    title: 'Senha do SAP bloqueada',
    description: 'Errei a senha do SAP algumas vezes e minha conta foi bloqueada.',
    priority: 'medium',
    affected: 'self',
    status: 'resolved',
    requesterId: 'u-ana',
    requesterName: 'Ana Souza',
    createdAgo: { days: 6 },
    lastSupportUpdateAgo: { days: 4 },
    resolvedAgo: { days: 4 },
  },
  {
    id: 'INC-19877',
    type: 'INC',
    category: 'email',
    title: 'Outlook não sincroniza no celular',
    description: 'O Outlook do meu celular parou de receber e-mails novos.',
    priority: 'medium',
    affected: 'self',
    status: 'resolved',
    requesterId: 'u-ana',
    requesterName: 'Ana Souza',
    createdAgo: { days: 28 },
    resolvedAgo: { days: 24 },
  },
  {
    id: 'INC-20365',
    type: 'INC',
    category: 'network_vpn',
    title: 'VPN desconecta a cada 10 minutos',
    description: 'A VPN cai a cada 10 minutos quando trabalho de casa.',
    priority: 'high',
    affected: 'self',
    status: 'in_progress',
    requesterId: 'u-bruno',
    requesterName: 'Bruno Tavares',
    createdAgo: { days: 1 },
    lastSupportUpdateAgo: { hours: 2 },
  },
]

export const KB_FIXTURES: KbArticle[] = [
  {
    id: 'KB-001',
    title: 'VPN com erro 809',
    body: 'Reinstale o cliente de VPN pelo portal de softwares e reinicie o computador. Vale apenas para Windows 10; no Windows 11, abra um chamado.',
    category: 'network_vpn',
    tags: ['vpn', 'erro 809', 'conexao'],
  },
  {
    id: 'KB-007',
    title: 'Configurar uma segunda tela',
    body: 'Conecte o monitor ao notebook por HDMI ou USB-C. No Windows, pressione Windows + P e escolha "Estender".',
    category: 'hardware',
    tags: ['monitor', 'segunda tela', 'hdmi'],
  },
  {
    id: 'KB-003',
    title: 'Como redefinir a senha da rede',
    body: 'Acesse o portal de autoatendimento de senhas, informe seu e-mail corporativo e siga as instruções.',
    category: 'access',
    tags: ['senha', 'redefinir', 'bloqueio'],
  },
]

const STOPWORDS = new Set([
  'para',
  'como',
  'mais',
  'esta',
  'esse',
  'essa',
  'isso',
  'meus',
  'minha',
  'desde',
  'quando',
  'consegue',
  'consigo',
])

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w))

const overlap = (a: string, b: string) => {
  const set = new Set(words(b))
  return words(a).filter((w) => set.has(w)).length
}

/**
 * In-memory stand-in for the tickets service, with the same privacy rule: a user only sees their own
 * tickets, and another user's ticket is "not found". Text matching is a crude word overlap.
 */
export function createFakeTickets(userId: string, now: Date): AgentTickets & { all: TicketView[] } {
  const all: TicketView[] = FIXTURES.map(({ createdAgo, lastSupportUpdateAgo, resolvedAgo, ...f }) => {
    const ticket: Ticket = {
      ...f,
      createdAt: ago(now, createdAgo),
      updatedAt: ago(now, lastSupportUpdateAgo ?? createdAgo),
      ...(lastSupportUpdateAgo ? { lastSupportUpdateAt: ago(now, lastSupportUpdateAgo) } : {}),
      ...(resolvedAgo ? { resolvedAt: ago(now, resolvedAgo) } : {}),
      timeline: [{ key: `seed-${f.id}`, kind: 'created', at: ago(now, createdAgo), by: f.requesterId }],
    }
    return { ...ticket, sla: slaStatus(ticket, now) }
  })
  const mine = () => all.filter((t) => t.requesterId === userId)

  return {
    all,
    async listTickets(query = {}) {
      return mine().filter(
        (t) =>
          (query.scope !== 'open' || isOpenStatus(t.status)) &&
          (!query.q || overlap(query.q, `${t.title} ${t.description}`) > 0),
      )
    },
    async getTicket(id) {
      const t = mine().find((x) => x.id === id)
      if (!t) throw new TicketsHttpError(404, 'not_found', `Chamado ${id} não encontrado.`)
      return t
    },
    async findDuplicates(text) {
      const since = now.getTime() - REOPEN_WINDOW_DAYS * DAY
      return mine()
        .filter(
          (t) =>
            isOpenStatus(t.status) || (t.status === 'resolved' && (t.resolvedAt?.getTime() ?? 0) >= since),
        )
        .map((ticket) => ({ ticket, score: overlap(text, `${ticket.title} ${ticket.description}`) }))
        .filter((c) => c.score >= 2)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
    },
    async searchKb(q) {
      return KB_FIXTURES.map((a) => ({ ...a, score: overlap(q, `${a.title} ${a.body} ${a.tags.join(' ')}`) }))
        .filter((a) => a.score > 0)
        .sort((a, b) => b.score - a.score)
    },
  }
}
