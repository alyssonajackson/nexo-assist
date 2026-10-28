# Tickets service (Hono). Runs TypeScript with tsx; small enough not to need a bundling step.
FROM node:24-alpine
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NODE_ENV=production
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY services/tickets/package.json services/tickets/
COPY packages/shared/package.json packages/shared/
COPY scripts/package.json scripts/
RUN pnpm install --frozen-lockfile --prod --filter "@nexo/tickets..."

COPY packages/shared packages/shared
COPY services/tickets services/tickets
USER node
EXPOSE 4000
WORKDIR /repo/services/tickets
CMD ["node", "--import", "tsx", "src/main.ts"]
