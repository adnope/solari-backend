FROM node:22-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS dev
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 5050
CMD ["npm", "run", "dev"]

FROM dev AS migrate
CMD ["npm", "run", "db:migrate"]

FROM base AS prod-deps
ENV npm_config_build_from_source=true
RUN apt-get update \
  && apt-get install -y --no-install-recommends g++ make python3 \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

FROM base AS build
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM base AS prod
ENV NODE_ENV=production
COPY package*.json ./
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 5050
CMD ["npm", "start"]
