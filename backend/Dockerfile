# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Install dependencies
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS deps

WORKDIR /app

# Copy manifests first to leverage Docker layer caching
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies (including dev, for prisma generate)
RUN npm ci --frozen-lockfile

# Generate Prisma client
RUN npx prisma generate

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Production image
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS production

# Install openssl (required by Prisma query engine at runtime) and wget (used by HEALTHCHECK)
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends openssl wget && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -g 1001 nodejs && \
    useradd -u 1001 -g nodejs -s /bin/sh -M pulsewatch

WORKDIR /app

# Copy built node_modules and generated Prisma client from deps stage
COPY --from=deps --chown=pulsewatch:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=pulsewatch:nodejs /app/prisma ./prisma

# Copy source code
COPY --chown=pulsewatch:nodejs src ./src
COPY --chown=pulsewatch:nodejs package*.json ./

# Switch to non-root user
USER pulsewatch

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

# Apply pending migrations and start the server
CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]
