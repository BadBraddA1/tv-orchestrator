FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV TV_LIBRARY=/media/tv
ENV DOWNLOADS=/media/downloads
ENV PORT=3080

EXPOSE 3080
VOLUME ["/data", "/media/tv", "/media/downloads"]

CMD ["node", "dist/index.js"]
