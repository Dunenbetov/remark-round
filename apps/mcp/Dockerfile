FROM node:24-alpine
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml .npmrc ./
COPY apps/mcp ./apps/mcp
# Prompt `uat-triage` отдаёт тот же Skill, что ноды графа
COPY skills ./skills

RUN pnpm install --filter @remarkround/mcp
RUN pnpm --filter @remarkround/mcp build

WORKDIR /app/apps/mcp
ENV NODE_ENV=production
ENV MCP_TRANSPORT=http
ENV MCP_PORT=3002
EXPOSE 3002
CMD ["node", "dist/main.js"]
