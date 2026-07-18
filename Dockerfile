FROM node:20-alpine

RUN apk add --no-cache \
  redis \
  bash \
  curl \
  wget \
  ca-certificates \
  && rm -rf /var/cache/apk/*

WORKDIR /app
COPY engine/package.json ./
RUN npm install --only=production && npm cache clean --force

COPY engine/server.js engine/proxy-pool.js engine/anti-detect.js ./
COPY config/users.json ./config/users.json
COPY scripts/healthcheck.sh /healthcheck.sh
COPY fly-entrypoint.sh /entrypoint.sh

RUN chmod +x /healthcheck.sh /entrypoint.sh

RUN wget -q -O /usr/local/bin/scylla \
  https://github.com/MikeChongCan/scylla/releases/download/1.2.0/scylla-linux-amd64 && \
  chmod +x /usr/local/bin/scylla

EXPOSE 3128 8899 8081

HEALTHCHECK --interval=30s --timeout=10s --retries=3 CMD /healthcheck.sh

ENTRYPOINT ["/entrypoint.sh"]
