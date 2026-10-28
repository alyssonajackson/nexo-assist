# One-shot init container: replica set, Cognito pool/users, seed. Runs TypeScript with tsx.
# Online, the same image (or `pnpm init:local` from a laptop) runs once with MANAGED_INFRA=true.
FROM node:24-alpine
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

# Manifests first so the dependency layer is cached across code changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY services/tickets/package.json services/tickets/
COPY packages/shared/package.json packages/shared/
COPY scripts/package.json scripts/
RUN pnpm install --frozen-lockfile --filter "@nexo/scripts..."

COPY packages/shared packages/shared
COPY scripts scripts
USER node
CMD ["pnpm", "--filter", "@nexo/scripts", "init:local"]
