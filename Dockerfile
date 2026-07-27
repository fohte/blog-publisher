# syntax=docker/dockerfile:1

# Keep the Node.js version in sync with .mise.toml.
FROM node:26.2.0-slim AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Node.js 25+ no longer bundles Corepack: https://github.com/nodejs/corepack
RUN npm install -g corepack@0.35.0 && npm cache clean --force && corepack enable
# sharp ships prebuilt libvips for linux/amd64 + linux/arm64; the slim base needs only
# the runtime libstdc++ which it already has. Install build essentials only if a
# source build becomes necessary on an unsupported arch.

FROM base AS deps
# pnpm-workspace.yaml holds `allowBuilds`; without it install fails with
# ERR_PNPM_IGNORED_BUILDS on sharp/esbuild/unrs-resolver.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Local development stage. Bind-mount the repo over /app (e.g. from
# docker compose, with an anonymous volume on /app/node_modules to keep
# this image's install instead of the host's) for live-reload without
# rebuilding the image.
FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
CMD ["pnpm", "dev"]

FROM deps AS builder
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN pnpm run build

# Built fresh from `base`, not `builder`, so the runtime image doesn't inherit
# dev dependencies or source files left over from the build stage.
FROM base AS runtime
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod
COPY --from=builder /app/dist ./dist
COPY otel-register.mjs ./
USER node
EXPOSE 3000
CMD ["node", "--import", "./otel-register.mjs", "dist/index.js"]
