import { expect, test } from '@playwright/test'
import { login, USERS } from './helpers'

test.describe('auth', () => {
  test('wrong password shows the error', async ({ page }) => {
    await login(page, USERS.ana, 'senha-errada')
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test('employee lands on /atendimento and cannot open /console', async ({ page }) => {
    await login(page, USERS.ana)
    await expect(page).toHaveURL(/\/atendimento/)
    await page.goto('/console')
    await expect(page).toHaveURL(/\/atendimento/)
  })

  test('analyst lands on /console and cannot open /atendimento', async ({ page }) => {
    await login(page, USERS.rafael)
    await expect(page).toHaveURL(/\/console/)
    await page.goto('/atendimento')
    await expect(page).toHaveURL(/\/console/)
  })

  test('logout returns to /login and protects /atendimento', async ({ page }) => {
    await login(page, USERS.ana)
    await expect(page).toHaveURL(/\/atendimento/)
    await page.getByRole('button', { name: 'Sair' }).click()
    await expect(page).toHaveURL(/\/login/)
    await page.goto('/atendimento')
    await expect(page).toHaveURL(/\/login/)
  })

  test('an expired access token is refreshed silently', async ({ page, context }) => {
    await login(page, USERS.ana)
    await expect(page).toHaveURL(/\/atendimento/)
    const cookies = await context.cookies()
    expect(cookies.some((c) => c.name === 'nx_access')).toBe(true)
    await context.clearCookies({ name: 'nx_access' })
    await page.reload()
    await expect(page).toHaveURL(/\/atendimento/)
    await expect(page.locator('#chat-input')).toBeVisible()
    expect((await context.cookies()).some((c) => c.name === 'nx_access')).toBe(true)
  })
})
