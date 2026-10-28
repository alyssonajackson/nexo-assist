import { defineConfig } from 'vitest/config'

// Integration tests run against the docker compose stack (`docker compose up -d`).
// Kept out of the root `pnpm test`, which must run without Docker.
export default defineConfig({
  test: {
    name: 'integration',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globalSetup: ['src/global-setup.ts'],
    // Tests share the running stack (queues, the init container), so run files one at a time.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
