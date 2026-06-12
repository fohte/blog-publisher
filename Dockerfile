# syntax=docker/dockerfile:1

# Keep the Node.js version in sync with .mise.toml.
FROM node:26.2.0-slim AS base
# Node.js 25+ no longer bundles Corepack: https://github.com/nodejs/corepack
RUN npm install -g corepack@0.35.0 && npm cache clean --force && corepack enable
# sharp ships prebuilt libvips for linux/amd64 + linux/arm64; the slim base needs only
# the runtime libstdc++ which it already has. Install build essentials only if a
# source build becomes necessary on an unsupported arch.
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json tsconfig.json ./
COPY --chown=node:node src ./src
USER node
EXPOSE 3000
CMD ["./node_modules/.bin/tsx", "src/index.ts"]
