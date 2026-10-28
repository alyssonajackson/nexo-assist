import { execFileSync } from 'node:child_process'
import path from 'node:path'

/** Regenerates the seed data relative to now. Skipped with E2E_SEED_RESET=0. */
export function resetSeed(): void {
  if (process.env.E2E_SEED_RESET === '0') return
  execFileSync(
    'docker',
    ['compose', 'run', '--rm', 'init', 'pnpm', '--filter', '@nexo/scripts', 'seed:reset'],
    {
      cwd: path.join(import.meta.dirname, '../..'),
      stdio: 'inherit',
    },
  )
}
