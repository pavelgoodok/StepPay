# Сборка из корня репозитория: docker build -f apps/api/Dockerfile .
FROM node:22-slim
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/engine packages/engine
COPY apps/api apps/api
RUN pnpm install --frozen-lockfile --filter @steppay/api...
ENV NODE_ENV=production
EXPOSE 4000
CMD ["pnpm", "--filter", "@steppay/api", "start"]
