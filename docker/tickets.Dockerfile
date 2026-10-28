# Tickets service (Hono). Runs the TypeScript source with tsx instead of a bundle: one long-running
# process, so tsx's start-up transpile (well under a second) is paid once; no build step or bundler
# config to maintain, and stack traces point at the real files. See docs/deploy.md.
FROM node:24-alpine AS deps
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY services/tickets/package.json services/tickets/
COPY packages/shared/package.json packages/shared/
COPY scripts/package.json scripts/
RUN pnpm install --frozen-lockfile --prod --filter "@nexo/tickets..."

# Runtime: the installed node_modules and the sources only (no pnpm, no package store).
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=deps /repo ./
COPY packages/shared packages/shared
COPY services/tickets services/tickets
USER node
EXPOSE 4000
WORKDIR /repo/services/tickets
# For plain Docker hosts and compose; Railway/Render/Fly use their own health check on GET /health.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.TICKETS_PORT||process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/main.ts"]
