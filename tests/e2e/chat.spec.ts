import { expect, test, type Page } from '@playwright/test'
import { deleteTicketsCreatedSince, login, send, startFreshChat, userId, USERS, withMongo } from './helpers'

const VPN = 'Minha VPN não conecta, aparece o erro 809.'

/** Walks the VPN suggestion and "Só eu" to a pending draft. */
async function reachDraft(page: Page) {
  await page.getByRole('button', { name: VPN }).click()
  await expect(page.getByText('consultou a central de ajuda')).toBeVisible()
  await page.getByRole('group', { name: 'Respostas rápidas' }).getByRole('button', { name: 'Só eu' }).click()
  await expect(page.getByText('Aguardando confirmação')).toBeVisible()
}

test.describe('employee chat (ana)', () => {
  const suiteStart = new Date()
  // Tickets created by one test would make the duplicate rule fire in the next one.
  test.beforeEach(() => deleteTicketsCreatedSince(USERS.ana, suiteStart))
  test.afterAll(() => deleteTicketsCreatedSince(USERS.ana, suiteStart))

  test('empty state', async ({ page }) => {
    await startFreshChat(page)
    await expect(page.getByRole('heading', { name: /Olá, Ana/ })).toBeVisible()
    await expect(page.getByRole('list').getByRole('button')).toHaveCount(3)
  })

  test('new ticket: draft, decision panel, confirm, reload', async ({ page }) => {
    await startFreshChat(page)
    await page.getByRole('button', { name: VPN }).click()
    await expect(page.getByText('consultou a central de ajuda')).toBeVisible()
    const replies = page.getByRole('group', { name: 'Respostas rápidas' })
    await replies.getByRole('button', { name: 'Só eu' }).click()

    await expect(page.getByText('Aguardando confirmação')).toBeVisible()
    await expect(page.getByText('Rede e VPN').first()).toBeVisible()
    await expect(page.getByText('Alta', { exact: true }).first()).toBeVisible()
    await expect(page.getByText(/resposta até/)).toBeVisible()
    await expect(replies.getByRole('button', { name: 'Só eu' })).toHaveAttribute('aria-pressed', 'true')

    const message = page.getByRole('article', { name: 'Mensagem do Nexo Assist' }).last()
    await message.getByRole('button', { name: /Ver decisão/ }).click()
    const panel = message.getByRole('region', { name: 'Detalhes da decisão' })
    await expect(panel).toBeVisible()
    await expect(panel.getByText('Abrir chamado')).toBeVisible()
    await expect(panel.getByText('Montou um rascunho de chamado')).toBeVisible()
    await expect(panel.getByRole('meter')).toHaveAttribute('aria-valuenow', /^\d+$/)

    await page.getByRole('button', { name: 'Confirmar' }).click()
    await expect(page.getByText(/Registrado · INC-/)).toBeVisible()
    await expect(page.getByText(/Pronto! Chamado INC-/)).toBeVisible()
    await expect(page.getByText('2/30 mensagens nesta sessão')).toBeVisible()

    await page.reload()
    await expect(page.getByText(/Registrado · INC-/)).toBeVisible()
    await expect(page.getByText(/Pronto! Chamado INC-/)).toBeVisible()
    await expect(page.getByText(VPN)).toBeVisible()
  })

  test('Ctrl/Cmd+Enter confirms the pending draft', async ({ page }) => {
    await startFreshChat(page)
    await reachDraft(page)
    await page.keyboard.press('ControlOrMeta+Enter')
    await expect(page.getByText(/Registrado · INC-/)).toBeVisible()
  })

  test('cancel and edit', async ({ page }) => {
    await startFreshChat(page)
    await reachDraft(page)
    await page.getByRole('button', { name: 'Editar' }).click()
    await expect(page.locator('#chat-input')).toBeFocused()
    await expect(page.getByText(/Editando o rascunho/)).toBeVisible()
    await page.getByRole('button', { name: 'Cancelar' }).click()
    await expect(page.getByText('Cancelado', { exact: true })).toBeVisible()
  })

  test('lookup: list, pick an overdue ticket', async ({ page }) => {
    await startFreshChat(page)
    await send(page, 'Qual o status dos meus chamados?')
    const list = page.getByRole('radiogroup', { name: 'Seus chamados' })
    await expect(list).toBeVisible()
    await list.getByRole('radio', { name: /INC-20311/ }).click()
    await expect(page.getByText(/^INC-20311 · /)).toBeVisible()
    await expect(page.getByText('prazo vencido').first()).toBeVisible()
  })

  test('error state and retry', async ({ page }) => {
    await startFreshChat(page)
    await page.route('**/api/chat', (route) => route.abort())
    await send(page, 'Olá')
    await expect(page.getByRole('alert').getByText(/Não foi possível falar com o servidor/)).toBeVisible()
    await page.unroute('**/api/chat')
    await page.getByRole('button', { name: 'Tentar novamente' }).click()
    await expect(page.getByText(/Posso tirar dúvidas de TI/)).toBeVisible()
  })

  test('limit of 30 messages', async ({ page }) => {
    await startFreshChat(page)
    await send(page, 'Olá')
    await expect(page.getByText(/Posso tirar dúvidas de TI/)).toBeVisible()

    await withMongo(async (client) => {
      const result = await client
        .db(process.env.ASSIST_DB ?? 'assist')
        .collection('conversations')
        .updateOne(
          { employeeId: await userId(client, USERS.ana), state: 'agent' },
          { $set: { employeeMessageCount: 30 } },
          { sort: { lastMessageAt: -1 } },
        )
      expect(result.modifiedCount).toBe(1)
    })

    await page.reload()
    const notice = page.getByRole('status').filter({ hasText: 'Você chegou ao limite de 30 mensagens' })
    await expect(notice).toBeVisible()
    await expect(page.locator('#chat-input')).toBeDisabled()
    await notice.getByRole('button', { name: 'Nova conversa' }).click()
    await expect(page.getByText('0/30 mensagens nesta sessão')).toBeVisible()
    await expect(page.locator('#chat-input')).toBeEnabled()
  })
})

test('handoff: carla sees the conversation waiting for an analyst', async ({ page }) => {
  await login(page, USERS.carla)
  await expect(page).toHaveURL(/\/atendimento/)
  await expect(page.getByRole('banner').getByText('Aguardando analista')).toBeVisible()
  await expect(page.getByText(/transferida para um analista/)).toBeVisible()
})
