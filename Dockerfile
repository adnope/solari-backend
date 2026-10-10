FROM oven/bun:1.4.3-alpine AS base
RUN apk add --no-cache ffmpeg
WORKDIR /app

FROM base AS dev
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
EXPOSE 5050
CMD ["bun", "dev"]

FROM base AS prod-deps
ENV NODE_ENV=production
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM base AS prod
ENV NODE_ENV=production
COPY package.json bun.lock ./
COPY --from=prod-deps --chown=bun:bun /app/node_modules ./node_modules
COPY --chown=bun:bun . .
USER bun
EXPOSE 5050
CMD ["bun", "start"]

FROM prod AS migrate
CMD ["bun", "run", "db:migrate"]
