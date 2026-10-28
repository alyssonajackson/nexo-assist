import path from 'node:path'
import type { NextConfig } from 'next'

// Dev loop (`pnpm dev`): read the repo-root .env. In Docker the variables come from compose instead.
try {
  process.loadEnvFile(path.join(import.meta.dirname, '../../.env'))
} catch {
  // no .env: fine in containers and CI
}

const config: NextConfig = {
  // Self-contained server for the Docker image.
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  // Workspace packages are shipped as TypeScript source.
  transpilePackages: ['@nexo/shared', '@nexo/agent'],
  // Mastra is a Node library with its own dynamic imports: load it from node_modules, do not bundle it.
  serverExternalPackages: ['@mastra/core'],
  // Keep dev screenshots identical to production and the repo free of generated agent files.
  devIndicators: false,
  agentRules: false,
}

export default config
