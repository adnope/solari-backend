FROM oven/bun:alpine AS base

RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package.json bun.lock /app/
RUN bun install

COPY . .

EXPOSE 5050

FROM base AS dev
CMD ["bun", "dev"]

FROM base AS prod
CMD ["bun", "start"]
