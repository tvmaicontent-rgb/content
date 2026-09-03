# ── Stage 1: build ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN npm run build

# ── Stage 2: production ─────────────────────────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

# Only runtime dependencies (express, bcryptjs, jsonwebtoken, archiver, dotenv…)
COPY package*.json ./
RUN npm ci --omit=dev

# Compiled frontend + bundled server
COPY --from=builder /app/dist ./dist

# JSON fallback snapshots read at runtime by server.cjs via fs.readFileSync
COPY --from=builder /app/src/data ./src/data

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/server.cjs"]
