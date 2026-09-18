FROM node:24-alpine
# Кеш corepack общий, чтобы pnpm был доступен и пользователю node (entrypoint зовёт pnpm для миграций и seed)
ENV COREPACK_HOME=/usr/local/share/corepack
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate && mkdir -p /app && chown node:node /app
# rclone — суточная копия файлов хранилища в Backblaze B2 (src/offsite, задача A3); ставится до USER node: apk нужен root
RUN apk add --no-cache rclone ca-certificates
USER node
WORKDIR /app

COPY --chown=node:node package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY --chown=node:node packages/db ./packages/db
COPY --chown=node:node apps/api ./apps/api
# Skill курса подмешивается в ноды графа (docs/GRAPH.md); из fixtures seed'у нужны только ТЗ, протокол и кадры (D-3) —
# журналы, evals и README в образ не кладём
COPY --chown=node:node skills ./skills
COPY --chown=node:node fixtures/spec ./fixtures/spec
COPY --chown=node:node fixtures/protocol ./fixtures/protocol
COPY --chown=node:node fixtures/screenshots ./fixtures/screenshots

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @remarkround/db generate
RUN pnpm --filter @remarkround/db build
RUN pnpm --filter @remarkround/api build
# Каталог кадров и документов: в демо — bind-mount ./apps/api/storage, в проде — том api-storage (docs/PROD.md)
RUN mkdir -p /app/apps/api/storage

WORKDIR /app/apps/api
# Версия сборки (аудит: «какая версия на сервере»): CI передаёт короткий SHA, локальная сборка — dev; отдаётся в /health
ARG GIT_SHA=dev
ENV APP_VERSION=$GIT_SHA
ENV NODE_ENV=production
EXPOSE 3000
# migrate deploy → seed (SEED_ON_START, не в production) → сервер: `docker compose up` на чистой машине даёт рабочий стенд
ENTRYPOINT ["sh", "/app/apps/api/docker-entrypoint.sh"]
