# syntax=docker/dockerfile:1

# Skeleton image for the Blog Publisher Service. HTTP routes and the heavy
# dependencies (sharp, octokit, ...) land in later tasks; this only needs to
# build and start the health-check server.

# Keep the Node.js version in sync with .mise.toml.
FROM node:26.1.0-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml .npmrc ./
# @fohte scoped packages are pulled from GitHub Packages, which needs a token
# with the `read:packages` scope:
#   docker build --secret id=node_auth_token,env=NODE_AUTH_TOKEN .
RUN --mount=type=secret,id=node_auth_token,env=NODE_AUTH_TOKEN \
    pnpm install --frozen-lockfile

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["pnpm", "start"]
