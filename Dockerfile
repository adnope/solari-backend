FROM oven/bun:alpine AS base
RUN apk add --no-cache ffmpeg
WORKDIR /app

FROM base AS dev
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
EXPOSE 5050
CMD ["bun", "dev"]

FROM base AS prod
ENV NODE_ENV=production
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --chown=bun:bun . .
USER bun
EXPOSE 5050
CMD ["bun", "start"]
