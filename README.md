# blog-publisher

HTTP service that turns Obsidian (LiveSync) notes into pull requests on `fohte/fohte.net`. Driven through Slack slash commands handled by a separate slack-bot.

```
Obsidian (mobile / desktop) ──LiveSync──▶ CouchDB ─┐
                                                   │
Slack (slash command) ──▶ slack-bot ──HTTPS──▶ blog-publisher
                                                   │
                                                   ├──▶ GitHub App (fohte/fohte.net)
                                                   └──▶ Cloudflare R2 (image bucket)
```

The service reads notes straight out of CouchDB (the LiveSync sync target), uploads referenced images to R2 as webp variants, commits the transformed MDX to a branch on `fohte/fohte.net`, and opens a pull request. All endpoints are bearer-token protected and assume private-network access.

For deployment-time setup (LiveSync settings, GitHub App permissions, Slack App slash commands, the full env key list, secret split, manual smoke checks) see [`docs/operations.md`](./docs/operations.md).

## Develop

```sh
pnpm install
pnpm dev      # tsx watch src/index.ts
pnpm test     # type-check + unit tests
pnpm lint
```

Copy `.env.example` and fill in the values before running `pnpm dev`.

## Test

```sh
pnpm test:unit      # no external dependencies
pnpm e2e:up         # docker compose up -d --wait (CouchDB + MinIO)
pnpm test:e2e
pnpm e2e:down
```

The E2E suite drives the real Hono router against CouchDB + MinIO and stubs GitHub at the Octokit boundary. Scenarios live in [`test/e2e/publish-flow.test.ts`](./test/e2e/publish-flow.test.ts).
