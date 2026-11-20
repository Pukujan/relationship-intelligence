# Komodo deploys this image on merge. Single process: adapter serves API +
# built console at /console; all keys arrive via the environment at runtime.
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.14.0 --activate
COPY pnpm-lock.yaml package.json ./
COPY console/pnpm-lock.yaml console/package.json console/
COPY app/pnpm-lock.yaml app/package.json app/
RUN pnpm install --dir console --frozen-lockfile
COPY console/ console/
RUN pnpm --dir console build

FROM node:24-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.14.0 --activate
COPY pnpm-lock.yaml package.json ./
COPY app/pnpm-lock.yaml app/package.json app/
RUN pnpm install --dir app --frozen-lockfile
COPY app/ app/
COPY --from=build /app/console/dist console/dist
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
CMD ["node", "--env-file-if-exists=app/.env", "--experimental-strip-types", "app/server/dev.ts"]
