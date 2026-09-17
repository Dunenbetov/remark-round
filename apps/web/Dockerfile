FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/web ./apps/web

RUN pnpm install --frozen-lockfile --filter @remarkround/web
WORKDIR /app/apps/web
RUN pnpm build

FROM nginx:alpine
ARG GIT_SHA=dev
# Конфиг — шаблон: entrypoint образа рендерит /etc/nginx/templates/*.template → /etc/nginx/conf.d/ (envsubst) при
# каждом старте контейнера. Подставляются только имена из NGINX_ENVSUBST_FILTER — $host, $uri и прочие переменные
# nginx остаются как есть. NGINX_ENTRYPOINT_LOCAL_RESOLVERS включает 15-local-resolvers.envsh (nameserver контейнера).
# Дефолты — для docker compose: api по имени сервиса, X-Forwarded-For от Caddy из docker-подсетей;
# Railway переопределяет API_UPSTREAM и REAL_IP_FROM в Variables (docs/PROD-RAILWAY.md)
ENV NGINX_ENVSUBST_FILTER='^(API_UPSTREAM|DNS_RESOLVER|LISTEN_IPV6)$' \
    NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1 \
    API_UPSTREAM=api:3000 \
    DNS_RESOLVER= \
    REAL_IP_FROM='10.0.0.0/8 172.16.0.0/12 192.168.0.0/16'
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY apps/web/docker-entrypoint.d/16-rr-proxy-env.envsh /docker-entrypoint.d/16-rr-proxy-env.envsh
RUN chmod +x /docker-entrypoint.d/16-rr-proxy-env.envsh
COPY --from=build /app/apps/web/dist/web/browser /usr/share/nginx/html
# /version.txt — какая сборка фронта на сервере (API отдаёт свою в /health)
RUN echo "$GIT_SHA" > /usr/share/nginx/html/version.txt
EXPOSE 80
