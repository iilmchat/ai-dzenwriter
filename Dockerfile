# syntax=docker/dockerfile:1.7

# Образы api и web собираются из одного монорепозитория. Зависимости ставятся
# один раз по lock-файлу, а итоговые образы содержат только нужное для запуска.
FROM node:25-alpine AS base
RUN npm install --global pnpm@12.11.2
ENV CI=true
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter "@dzenwriter/api..." --filter "@dzenwriter/web..." build
RUN pnpm --config.inject-workspace-packages=true --filter @dzenwriter/api deploy --prod /out/api

FROM node:25-alpine AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/api ./
COPY --from=build --chown=node:node /app/config ./config
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]

FROM nginxinc/nginx-unprivileged:1.27-alpine AS web
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
