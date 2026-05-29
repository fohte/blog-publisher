# syntax=docker/dockerfile:1

# Keep the Node.js version in sync with .mise.toml.
FROM node:26.2.0-slim AS base
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
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json tsconfig.json ./
COPY --chown=node:node src ./src
USER node
EXPOSE 3000
CMD ["./node_modules/.bin/tsx", "src/index.ts"]
