# ---- Build Stage ----
FROM node:18-alpine AS builder

RUN npm install -g pnpm

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-workspace.yaml turbo.json ./

# Copy package manifests
COPY apps/web/package.json apps/web/
COPY packages/streaming/package.json packages/streaming/

# Install dependencies
RUN pnpm install --frozen-lockfile || pnpm install

# Copy source code
COPY packages/streaming/ packages/streaming/
COPY apps/web/ apps/web/

# Build args for Next.js public env vars (needed at build time)
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ARG NEXT_PUBLIC_WS_URL=ws://localhost:3001
ARG NEXT_PUBLIC_CIRCLE_APP_ID=

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_CIRCLE_APP_ID=$NEXT_PUBLIC_CIRCLE_APP_ID

# Build Next.js
RUN cd apps/web && pnpm build

# ---- Production Stage ----
FROM node:18-alpine

WORKDIR /app

# Copy built output
COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/apps/web/package.json ./apps/web/
COPY --from=builder /app/apps/web/next.config.js ./apps/web/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node_modules/.bin/next", "start", "apps/web", "-p", "3000"]
