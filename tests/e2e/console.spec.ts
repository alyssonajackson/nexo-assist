import { expect, test, type Page } from '@playwright/test'
import { login, send, USERS } from './helpers'

/** Opens a second browser session (a different signed-in user) next to the default one. */
async function openAs(
  browser: import('@playwright/test').Browser,
  email: string,
  path: string,
): Promise<Page> {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: { width: 1440, height: 900 },
    locale: 'pt-BR',
  })
  const page = await context.newPage()
  await login(page, email)
  // The sign-in redirects to the user's home: wait for it before going elsewhere.
  await expect(page).not.toHaveURL(/\/login/)
  await page.goto(path)
  return page
}

test('handoff: Carla waits, Rafael takes over and replies, gives back, takes over again and closes', async ({
  browser,
}) => {
  // Carla was transferred by the seed (waiting_analyst, REQ-10501).
  const carla = await openAs(browser, USERS.carla, '/atendimento')
  await expect(carla.getByRole('banner').getByText('Aguardando analista')).toBeVisible()

  const rafael = await openAs(browser, USERS.rafael, '/console')
  const input = rafael.getByLabel('Mensagem para o colaborador')

  // Waiting: summary, the waiting bar and a disabled input.
  await rafael.getByRole('button', { name: /Carla Mendes/ }).click()
  await expect(rafael.getByRole('region', { name: 'Resumo do caso' })).toBeVisible()
  await expect(rafael.getByText('Carla espera um atendente')).toBeVisible()
  await expect(input).toBeDisabled()
  await expect(input).toHaveAttribute('placeholder', 'Assuma o atendimento para responder')
  // The side panel shows the ticket of the conversation.
  await expect(rafael.getByRole('complementary', { name: 'Chamados do colaborador' })).toContainText(
    'REQ-10501',
  )

  // Take over, reply.
  await rafael.getByRole('button', { name: 'Assumir atendimento' }).click()
  await expect(rafael.getByText('Rafael Lima assumiu · agent pausado')).toBeVisible()
  await expect(rafael.getByRole('button', { name: 'Encerrar atendimento' })).toBeVisible()
  await expect(input).toBeEnabled()
  await input.fill('Oi, Carla! Aqui é o Rafael, já liberei o acesso ao SAP.')
  await input.press('Enter')
  await expect(rafael.getByText('Oi, Carla! Aqui é o Rafael, já liberei o acesso ao SAP.')).toBeVisible()
  // The tickets service records the take over on the ticket (through the handoff-events queue).
  await expect(rafael.getByText('Assumido por Rafael Lima')).toBeVisible({ timeout: 30_000 })

  // Carla sees it (polling), with the analyst's name and team.
  await expect(carla.getByText('Oi, Carla! Aqui é o Rafael, já liberei o acesso ao SAP.')).toBeVisible({
    timeout: 20_000,
  })
  await expect(carla.getByText('Rafael Lima', { exact: true }).first()).toBeVisible()
  await expect(carla.getByRole('banner').getByText('Com um analista')).toBeVisible()

  // Give back: the agent answers again.
  await rafael.getByRole('button', { name: 'Devolver ao agent' }).click()
  await expect(rafael.getByText('Rafael Lima devolveu a conversa ao agent')).toBeVisible()
  await expect(carla.getByRole('banner').getByText('Assistente online')).toBeVisible({ timeout: 20_000 })
  await send(carla, 'Bom dia, obrigada!')
  await expect(carla.getByRole('article', { name: 'Mensagem do Nexo Assist' }).last()).toBeVisible()

  // She asks for an analyst again; Rafael takes over and closes.
  await send(carla, 'Quero falar com um analista.')
  await expect(carla.getByRole('banner').getByText('Aguardando analista')).toBeVisible()
  await rafael.getByRole('tab', { name: /Para você/ }).click()
  await rafael.getByRole('button', { name: /Carla Mendes/ }).click()
  await rafael.getByRole('button', { name: 'Assumir atendimento' }).click()
  await rafael.getByRole('button', { name: 'Encerrar atendimento' }).click()
  await expect(rafael.getByText('Atendimento encerrado por Rafael Lima')).toBeVisible()
  await expect(rafael.getByLabel('Mensagem para o colaborador')).toBeDisabled()

  // Carla: closed, "Nova conversa".
  await expect(carla.getByText('Esta conversa foi encerrada.')).toBeVisible({ timeout: 20_000 })
  await carla.getByRole('button', { name: 'Nova conversa' }).first().click()
  await expect(carla.getByText('0/30 mensagens nesta sessão')).toBeVisible()
})

test('an employee cannot open the console', async ({ page }) => {
  await login(page, USERS.ana)
  await expect(page).toHaveURL(/\/atendimento/)
  await page.goto('/console')
  await expect(page).toHaveURL(/\/atendimento/)
})
