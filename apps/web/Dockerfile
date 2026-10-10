FROM node:24-alpine AS base

RUN corepack enable

WORKDIR /app


FROM base AS pruner

COPY . .

RUN pnpm dlx turbo prune @my-project/web --docker


FROM base AS installer

COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml

RUN pnpm install --frozen-lockfile


FROM installer AS builder

COPY --from=pruner /app/out/full/ .

ARG APP_VERSION=unknown

ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION

RUN pnpm turbo run build --filter=@my-project/web

RUN pnpm --filter=@my-project/web deploy --prod --legacy /prod/web

FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

ARG APP_VERSION=unknown

ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION

COPY --from=builder /prod/web ./web

EXPOSE 3000

CMD ["node", "apps/web/server.js"]