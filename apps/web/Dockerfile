FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml .npmrc ./
COPY docs/ui/tokens.css ./docs/ui/tokens.css
COPY apps/web ./apps/web

RUN pnpm install
WORKDIR /app/apps/web
RUN pnpm build

FROM nginx:alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist/web/browser /usr/share/nginx/html
EXPOSE 80
