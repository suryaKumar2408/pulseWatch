# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Build the static frontend
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --frozen-lockfile

COPY . .
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Serve with nginx
# ─────────────────────────────────────────────────────────────────────────────
FROM nginx:alpine AS production

# Remove default nginx config and install wget for HEALTHCHECK
RUN rm /etc/nginx/conf.d/default.conf && \
    apk add --no-cache wget

# Custom nginx config — SPA routing + API proxy
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
