# SandFest backend — node:http server with optional Postgres storage.
# Listens on $PORT (8788 by default). Health: /health. Readiness: /ready.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    SANDFEST_ENV=production \
    SANDFEST_API_PORT=8788
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY scripts ./scripts
COPY lib ./lib
# Seed config + data live alongside; production deployments should mount
# durable storage at /app/data and set SANDFEST_DATABASE_URL once Postgres
# is wired up.
COPY data ./data
EXPOSE 8788
CMD ["node", "scripts/admin-api-server.mjs"]
