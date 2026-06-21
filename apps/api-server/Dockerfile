FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api-server/package.json ./apps/api-server/
COPY packages/shared/package.json ./packages/shared/
COPY turbo.json ./

RUN npm ci --workspace=@lantern/api-server --workspace=@lantern/shared --include-workspace-root

COPY packages/shared ./packages/shared
COPY apps/api-server ./apps/api-server

RUN npm run build --workspace=@lantern/shared
RUN npm run build --workspace=@lantern/api-server

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY package.json package-lock.json ./
COPY apps/api-server/package.json ./apps/api-server/
COPY packages/shared/package.json ./packages/shared/

RUN npm ci --workspace=@lantern/api-server --workspace=@lantern/shared --include-workspace-root --omit=dev

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/api-server/dist ./apps/api-server/dist

USER appuser

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health || exit 1

CMD ["node", "apps/api-server/dist/server.js"]
