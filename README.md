# blog-publisher

HTTP service that turns Obsidian (LiveSync) notes into pull requests on
`fohte/fohte.net`. Driven through Slack slash commands handled by a
separate slack-bot.

## Architecture

```
Obsidian (mobile / desktop) ──LiveSync──▶ CouchDB ─┐
                                                   │
Slack (slash command) ──▶ slack-bot ──HTTPS──▶ blog-publisher
                                                   │
                                                   ├──▶ GitHub App (fohte/fohte.net)
                                                   └──▶ Cloudflare R2 (image bucket)
```

The service reads notes straight out of CouchDB (the LiveSync sync
target), uploads referenced images to R2 as webp variants, commits the
transformed MDX to a branch on `fohte/fohte.net`, and opens a pull
request. All endpoints are bearer-token protected and assume
private-network access.

## Configuration

Copy `.env.example` and fill in the values. The full key list — including
which keys are secret and which are not — is in
[`docs/operations.md`](./docs/operations.md#configuration-template).

| Key                                                                                                | Purpose                                       |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `BEARER_TOKEN`                                                                                     | Shared with the slack-bot side                |
| `COUCHDB_URL` / `COUCHDB_USERNAME` / `COUCHDB_PASSWORD` / `COUCHDB_DATABASE`                       | LiveSync vault                                |
| `LIVESYNC_PASSPHRASE`                                                                              | LiveSync E2EE passphrase                      |
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` / `GITHUB_APP_INSTALLATION_ID`                          | GitHub App for `fohte/fohte.net`              |
| `R2_BUCKET` / `R2_PUBLIC_BASE_URL` / `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Image upload target                           |
| `IMAGE_VARIANT_WIDTHS`                                                                             | webp variant widths (default `640,1280,1920`) |

LiveSync MUST have **Path Obfuscation** and **Property Encryption**
disabled; the service fails fast at startup otherwise. End-to-End
Encryption is supported through `LIVESYNC_PASSPHRASE`.

## Develop

```sh
pnpm install
pnpm dev      # tsx watch src/index.ts
pnpm test     # type-check + unit tests
pnpm lint
```

## Test

```sh
pnpm test:unit      # no external dependencies
pnpm e2e:up         # docker compose up -d --wait (CouchDB + MinIO)
pnpm test:e2e
pnpm e2e:down
```

The E2E suite drives the real Hono router against CouchDB + MinIO and
stubs GitHub at the Octokit boundary. Scenarios live in
[`test/e2e/publish-flow.test.ts`](./test/e2e/publish-flow.test.ts).

## Deploy

Build with the provided `Dockerfile`; how the container is scheduled is
up to the operator. Deployment-time prerequisites (LiveSync settings,
GitHub App permissions, Slack App slash commands, the secret split, and
manual smoke checks) are documented in
[`docs/operations.md`](./docs/operations.md).
