# Build: everything. Runtime: the server package with production deps,
# the built shared package and the built client. See deploy/README.md.
# node:22-slim is not pinned by digest on purpose: every push to main rebuilds,
# so Node security fixes arrive without a manual bump. Builds are therefore not
# bit-for-bit reproducible; pin a digest here if that ever matters more.
FROM node:22-slim AS build
WORKDIR /src
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
# corepack installs the pnpm version named by "packageManager" in package.json.
RUN corepack enable
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
# --ignore-scripts: shared's "prepare" runs tsc, but the sources are copied
# later; the build step below compiles everything.
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY shared shared
COPY server server
COPY client client
RUN pnpm run build && pnpm --filter @town-zero/client build
# A self-contained server folder: its dist, production node_modules and the
# workspace package @town-zero/shared copied in (not linked).
RUN pnpm --filter @town-zero/server deploy --prod --legacy /out

FROM node:22-slim
ENV NODE_ENV=production PORT=2567 STATIC_DIR=/app/client STATIC_PORT=2568
WORKDIR /app
COPY --from=build /out /app/server
COPY --from=build /src/client/dist /app/client
USER node
EXPOSE 2567 2568
CMD ["node", "server/dist/index.js"]
