FROM node:20-alpine

RUN apk add --no-cache redis bash curl && rm -rf /var/cache/apk/*

WORKDIR /app
COPY engine/package.json ./engine/package.json
RUN cd engine && npm install --only=production && npm cache clean --force

COPY web/package.json ./web/package.json
RUN cd web && npm install --only=production && npm cache clean --force

COPY engine/server.js engine/proxy-pool.js engine/anti-detect.js ./engine/
COPY web/server.js ./web/
COPY web/public ./web/public
COPY config/users.json ./config/users.json
COPY fly-entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh

EXPOSE 8080 3128

ENTRYPOINT ["/entrypoint.sh"]
