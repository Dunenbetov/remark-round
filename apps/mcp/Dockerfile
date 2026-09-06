FROM node:24-alpine
ENV COREPACK_HOME=/usr/local/share/corepack
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate && mkdir -p /app && chown node:node /app
USER node
WORKDIR /app

COPY --chown=node:node package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY --chown=node:node apps/mcp ./apps/mcp
# Prompt `uat-triage` отдаёт тот же Skill, что ноды графа
COPY --chown=node:node skills ./skills

RUN pnpm install --frozen-lockfile --filter @remarkround/mcp
RUN pnpm --filter @remarkround/mcp build

WORKDIR /app/apps/mcp
ENV NODE_ENV=production
ENV MCP_TRANSPORT=http
ENV MCP_PORT=3002
EXPOSE 3002
CMD ["node", "dist/main.js"]
