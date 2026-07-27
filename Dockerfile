# syntax=docker/dockerfile:1

# Keep the Node.js version in sync with .mise.toml.
<<<<<<< before updating
FROM node:26.2.0-slim AS base
||||||| last update
=======
FROM node:24.18.0-slim AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
>>>>>>> after updating
# Node.js 25+ no longer bundles Corepack: https://github.com/nodejs/corepack
RUN npm install -g corepack@0.35.0 && npm cache clean --force && corepack enable
<<<<<<< before updating
# sharp ships prebuilt libvips for linux/amd64 + linux/arm64; the slim base needs only
# the runtime libstdc++ which it already has. Install build essentials only if a
# source build becomes necessary on an unsupported arch.
WORKDIR /app
||||||| last update
=======
>>>>>>> after updating

FROM base AS deps
<<<<<<< before updating
# pnpm-workspace.yaml holds `allowBuilds`; without it install fails with
# ERR_PNPM_IGNORED_BUILDS on sharp/esbuild/unrs-resolver.
||||||| last update
=======
>>>>>>> after updating
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
<<<<<<< before updating
RUN pnpm install --frozen-lockfile
||||||| last update
=======
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
>>>>>>> after updating

<<<<<<< before updating
||||||| last update
=======
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
>>>>>>> after updating
FROM base AS runtime
ENV NODE_ENV=production
<<<<<<< before updating
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json tsconfig.json otel-register.mjs ./
COPY --chown=node:node src ./src
||||||| last update
=======
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod
COPY --from=builder /app/dist ./dist
COPY otel-register.mjs ./
>>>>>>> after updating
USER node
<<<<<<< before updating
EXPOSE 3000
CMD ["./node_modules/.bin/tsx", "--import", "./otel-register.mjs", "src/index.ts"]
||||||| last update
=======
EXPOSE 8080
CMD ["node", "--import", "./otel-register.mjs", "dist/index.js"]
>>>>>>> after updating
