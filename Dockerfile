FROM node:22-bookworm-slim
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/wolf/package.json apps/wolf/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

COPY apps/wolf apps/wolf
COPY packages/shared packages/shared
RUN pnpm --filter wolf build

ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app/apps/wolf
EXPOSE 8080
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0"]
