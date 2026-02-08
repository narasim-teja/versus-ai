# ---- Build Stage ----
FROM node:18 AS builder

# Install bun and pnpm
RUN curl -fsSL https://bun.sh/install | bash && \
    npm install -g pnpm
ENV PATH="/root/.bun/bin:$PATH"

WORKDIR /app

# Copy workspace root files + lockfile
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./

# Copy package manifests for dependency resolution
COPY apps/server/package.json apps/server/
COPY packages/streaming/package.json packages/streaming/

# Install dependencies using pnpm (understands workspace:* protocol)
RUN pnpm install --frozen-lockfile || pnpm install

# Copy source code
COPY packages/streaming/ packages/streaming/
COPY apps/server/ apps/server/

# Build the server with bun
RUN cd apps/server && bun run build

# ---- Production Stage ----
FROM oven/bun:1-slim

# Install FFmpeg and curl for video processing and health checks
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built output and dependencies from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/server/package.json ./apps/server/
COPY --from=builder /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=builder /app/packages/streaming ./packages/streaming
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./

# Copy drizzle migrations (needed for db:migrate)
COPY --from=builder /app/apps/server/src/db/migrations ./apps/server/src/db/migrations
COPY --from=builder /app/apps/server/drizzle.config.ts ./apps/server/drizzle.config.ts

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

CMD ["bun", "run", "apps/server/dist/index.js"]
