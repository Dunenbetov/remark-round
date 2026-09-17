FROM node:26-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/web ./apps/web

RUN pnpm install --frozen-lockfile --filter @remarkround/web
WORKDIR /app/apps/web
RUN pnpm build

FROM nginx:alpine
ARG GIT_SHA=dev
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist/web/browser /usr/share/nginx/html
# /version.txt — какая сборка фронта на сервере (API отдаёт свою в /health)
RUN echo "$GIT_SHA" > /usr/share/nginx/html/version.txt
EXPOSE 80
