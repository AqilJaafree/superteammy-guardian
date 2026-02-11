# Pin to a specific version. Run: docker pull node:20-alpine && docker inspect --format='{{index .RepoDigests 0}}' node:20-alpine
# to get the current digest and append @sha256:... to this line.
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ ./src/

RUN mkdir -p /app/data && \
    addgroup -S botgroup && \
    adduser -S botuser -G botgroup && \
    chown -R botuser:botgroup /app/data

VOLUME /app/data

ENV NODE_ENV=production
ENV DB_PATH=/app/data/bot.sqlite

USER botuser

CMD ["node", "src/bot.js"]
