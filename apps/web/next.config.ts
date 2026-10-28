import path from 'node:path'
import type { NextConfig } from 'next'

const config: NextConfig = {
  // Self-contained server for the Docker image.
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  // Workspace packages are shipped as TypeScript source.
  transpilePackages: ['@nexo/shared'],
}

export default config
