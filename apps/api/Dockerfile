FROM node:24-alpine
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml .npmrc ./
COPY packages/db ./packages/db
COPY apps/api ./apps/api
# Skill курса подмешивается в ноды графа (docs/GRAPH.md); fixtures нужны seed'у (ТЗ, протокол, кадры)
COPY skills ./skills
COPY fixtures ./fixtures

RUN pnpm install
RUN pnpm --filter @remarkround/db generate
RUN pnpm --filter @remarkround/db build
RUN pnpm --filter @remarkround/api build

WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 3000
# migrate deploy → seed (SEED_ON_START) → сервер: `docker compose up` на чистой машине даёт рабочий стенд
ENTRYPOINT ["sh", "/app/apps/api/docker-entrypoint.sh"]
