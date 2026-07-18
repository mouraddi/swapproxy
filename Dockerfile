# ===== Stage 1: Node.js engine dependencies =====
FROM node:20-alpine AS deps

RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY engine/package.json engine/package-lock.json* ./
RUN npm ci --only=production && npm cache clean --force

# ===== Stage 2: Runtime =====
FROM node:20-alpine

RUN apk add --no-cache \
  redis \
  bash \
  curl \
  wget \
  # Playwright dependencies
  chromium \
  nss \
  freetype \
  freetype-dev \
  harfbuzz \
  ca-certificates \
  ttf-freefont \
  && rm -rf /var/cache/apk/*

# Install Playwright system deps
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install -g playwright && \
  playwright install-deps chromium 2>/dev/null || true

# Copy Node.js app
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY engine/server.js engine/proxy-pool.js engine/anti-detect.js ./
COPY config/users.json /app/config/users.json
COPY scripts/healthcheck.sh /healthcheck.sh

RUN chmod +x /healthcheck.sh

# Install Scylla
RUN wget -q -O /usr/local/bin/scylla \
  https://github.com/imwildcat/scylla/releases/latest/download/scylla-linux-amd64 && \
  chmod +x /usr/local/bin/scylla

# Expose ports: proxy, scylla API, scylla dashboard
EXPOSE 3128 8899 8081

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD /healthcheck.sh

COPY fly-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
