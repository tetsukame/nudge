# syntax=docker/dockerfile:1.7

# ----------------------------------------------------------------------------
# Stage 1: builder
# Install all deps + run Next.js production build
# ----------------------------------------------------------------------------
FROM node:26-alpine AS builder

# Enable pnpm via corepack
RUN corepack enable

WORKDIR /app

# Cache dependency layer
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm build

# ----------------------------------------------------------------------------
# Stage 2: runner
# Production deps only (includes tsx, pg-format) + Next.js build artifacts +
# source for tsx (worker / migrate / scripts run TypeScript directly)
# ----------------------------------------------------------------------------
FROM node:26-alpine AS runner

RUN corepack enable

WORKDIR /app

ENV NODE_ENV=production

# Install production deps (tsx is in deps so worker/migrate/scripts run with it)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Next.js build outputs
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next.config.mjs ./

# Source files needed at runtime by tsx (worker / migrate / scripts) and Next.js
COPY src ./src
COPY app ./app
COPY middleware.ts ./middleware.ts

# SQL migrations
COPY migrations ./migrations

EXPOSE 3000

CMD ["pnpm", "start"]
