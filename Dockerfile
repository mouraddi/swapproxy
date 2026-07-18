FROM node:20-alpine

RUN apk add --no-cache redis bash curl ca-certificates && rm -rf /var/cache/apk/*

WORKDIR /app
COPY engine/package.json ./
RUN npm install --only=production && npm cache clean --force

COPY engine/server.js engine/proxy-pool.js engine/anti-detect.js ./
COPY config/users.json ./config/users.json
COPY scripts/healthcheck.sh /healthcheck.sh
COPY fly-entrypoint.sh /entrypoint.sh

RUN chmod +x /healthcheck.sh /entrypoint.sh

EXPOSE 3128

HEALTHCHECK --interval=30s --timeout=10s --retries=3 CMD /healthcheck.sh

ENTRYPOINT ["/entrypoint.sh"]
