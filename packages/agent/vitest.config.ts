import { configDefaults, defineProject } from 'vitest/config'

// Real-model evals (*.eval.test.ts) only run with RUN_LLM_EVALS=1 (`pnpm test:evals`), never in CI.
const evals = process.env.RUN_LLM_EVALS === '1'

export default defineProject({
  test: {
    name: 'agent',
    environment: 'node',
    include: evals ? ['src/**/*.eval.test.ts'] : ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, ...(evals ? [] : ['src/**/*.eval.test.ts'])],
    testTimeout: evals ? 120_000 : 10_000,
  },
})
