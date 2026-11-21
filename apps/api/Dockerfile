FROM node:24-alpine AS build
RUN npm install -g pnpm@12.16.1
ENV PNPM_HOME=/pnpm
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @flash-sale/api...
COPY apps/api apps/api
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @flash-sale/api build \
  && pnpm --filter @flash-sale/api deploy --prod /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
