import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3100'

// Browser e2e against the docker compose stack (mongo, Floci, tickets). The web app runs from
// `next dev` on :3100 with a scripted model (LLM_MODEL=demo), so no LLM is called.
export default defineConfig({
  testDir: './e2e',
  // The tests share the seeded users' data: one at a time, in file order.
  workers: 1,
  fullyParallel: false,
  // One retry absorbs the tickets service's simulated outages (FLAKY_ENABLED), which are random.
  retries: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL,
    trace: 'on-first-retry',
    viewport: { width: 1440, height: 900 },
    locale: 'pt-BR',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'pnpm --filter @nexo/web exec next dev --port 3100',
    cwd: '..',
    url: 'http://localhost:3100/login',
    reuseExistingServer: true,
    timeout: 180_000,
    // Own build dir: next dev refuses to start while another dev server uses the same one.
    env: { LLM_MODEL: 'demo', NEXT_DIST_DIR: '.next-e2e' },
  },
})
