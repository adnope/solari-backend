FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

FROM base AS release
USER bun

COPY --from=install --chown=bun:bun /app/node_modules ./node_modules

COPY --chown=bun:bun src ./src
COPY --chown=bun:bun package.json ./

EXPOSE 5050

CMD ["bun", "run", "src/main.ts"]
