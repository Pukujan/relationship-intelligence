# Komodo deploys this image on merge. The adapter serves the API and the built
# console at /console, and proxies /api/* to the copilot server running beside
# it on loopback; all keys arrive via the environment at runtime.
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.14.0 --activate
COPY pnpm-lock.yaml package.json ./
COPY console/pnpm-lock.yaml console/package.json console/
COPY app/pnpm-lock.yaml app/package.json app/
RUN pnpm install --dir console --frozen-lockfile --config.strict-dep-builds=false
COPY console/ console/
RUN pnpm --dir console build

FROM node:24-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.14.0 --activate
COPY pnpm-lock.yaml package.json ./
COPY app/pnpm-lock.yaml app/package.json app/
RUN pnpm install --dir app --frozen-lockfile --config.strict-dep-builds=false
COPY app/ app/
COPY --from=build /app/console/dist console/dist
# The copilot server (console/server) answers /api/* behind the adapter's
# signed-in proxy. It needs the console's runtime packages and one shared
# schema file; Node runs its TypeScript directly.
COPY console/pnpm-lock.yaml console/package.json console/
RUN pnpm install --dir console --prod --frozen-lockfile --config.strict-dep-builds=false
COPY console/server/ console/server/
COPY console/src/data/sessionTypes.ts console/src/data/sessionTypes.ts
COPY deploy/start.sh deploy/start.sh
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
CMD ["sh", "deploy/start.sh"]
