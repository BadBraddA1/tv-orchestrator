FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates curl git \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin \
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
ENV HOST_PROJECT_DIR=/host/project
ENV PORT=3080

EXPOSE 3080
VOLUME ["/data", "/media/tv", "/media/downloads"]

CMD ["node", "dist/index.js"]
