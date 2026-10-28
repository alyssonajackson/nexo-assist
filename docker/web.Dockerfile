# Next.js app (employee chat, analyst console, agent). Multi-stage: build, then a slim standalone runtime.
FROM node:24-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY services/tickets/package.json services/tickets/
COPY packages/shared/package.json packages/shared/
COPY packages/agent/package.json packages/agent/
COPY scripts/package.json scripts/
RUN pnpm install --frozen-lockfile --filter "@nexo/web..."

COPY packages packages
COPY apps/web apps/web
RUN pnpm --filter @nexo/web build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
# No secrets are baked in: everything comes from the environment at runtime.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
