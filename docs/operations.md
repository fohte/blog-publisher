# Operations

Operational handbook for deploying and running the Blog Publisher Service.
This document covers the prerequisites that live outside this repository
(Obsidian LiveSync, GitHub App, Slack App) plus the configuration template
that the service consumes.

This repo only ships the Dockerfile and the configuration contract; how
the container is scheduled is up to the operator.

## System overview

```
Obsidian (mobile / desktop) ──LiveSync──▶ CouchDB ─┐
                                                   │
Slack (slash command) ──▶ slack-bot ──HTTPS──▶ Blog Publisher Service
                                                   │
                                                   ├──▶ GitHub App (fohte/fohte.net)
                                                   └──▶ Cloudflare R2 (image bucket)
```

The Service exposes an HTTP API intended for private-network access only
(no internet exposure). Every endpoint is guarded by
`Authorization: Bearer <token>`; the slack-bot plugin and the Service
share the same token.

## LiveSync (CouchDB) prerequisites

The Service reads the vault directly from CouchDB through Obsidian
LiveSync's on-disk schema. For the reader to be able to find and decrypt
notes, the following vault settings MUST hold:

| Setting               | Required value | Why                                                                                              |
| --------------------- | -------------- | ------------------------------------------------------------------------------------------------ |
| Path Obfuscation      | **disabled**   | Paths are stored as `f:<hash>` when enabled, making the `notes/blogs/` prefix filter impossible. |
| Property Encryption   | **disabled**   | Encrypts metadata fields the Service relies on (`path`, `mtime`, `children`).                    |
| End-to-End Encryption | enabled OK     | Chunk-level encryption is supported through `LIVESYNC_PASSPHRASE`.                               |

The Service fails fast at startup if Path Obfuscation or Property
Encryption is enabled — see `src/adapters/livesync.ts` (`init()`).

CouchDB must be reachable from the Service over plain HTTP within the
private network. The configured user needs read access to the vault
database.

## GitHub App setup

Create a dedicated GitHub App (not a personal access token) so the
Service can authenticate per-installation with rotating credentials.

1. **App permissions** — Repository permissions only:
   - Contents: **Write** (blob / tree / commit / ref operations)
   - Pull requests: **Write** (open / label / close)
   - Metadata: **Read** (auto-granted)
2. **Installation target**: install the App on `fohte/fohte.net` **only**.
   Do not install at the organization level.
3. **Webhooks**: disabled. The Service polls CI state via the REST API.
4. After install, capture App ID, Installation ID, and the private key
   (PEM). The first two are non-secret; the private key must be stored
   alongside the other secrets below.

Initial rollout can point at a fork or a `test/blog-publish-dry` branch
for dry-runs by overriding `GITHUB_REPO` and `GITHUB_DEFAULT_BRANCH`.

## Slack App setup

The blog publisher rides on top of the shared slack-bot core (separate
repo). The core handles `x-slack-signature` HMAC-SHA256 verification and
forwards already-verified interaction payloads to the blog plugin —
**this Service never sees raw Slack requests**.

1. Register three slash commands on the Slack App that the slack-bot
   deployment serves:
   - `/blog-post` — start a publish flow (Static Select of recent notes).
   - `/blog-status` — list open / recently closed PRs.
   - `/blog-cancel` — close a PR by number.
2. Subscribe `interactivity` so block actions reach the same Request URL
   as the slash commands.
3. Workspace install is the first authorization gate; the second gate is
   the `allowedSlackUserIds` list configured on the slack-bot plugin.
   Users not on the list receive an ephemeral "not authorized" reply.
4. The Slack Signing Secret and Bot Token belong to the slack-bot core
   deployment, **not** to this Service.

## Configuration template

`.env.example` at the repo root mirrors the variables the Service reads
through `src/config.ts`. Operators should split them between non-secret
config and a secret store as follows.

### Non-secret config

| Key                          | Notes                                     |
| ---------------------------- | ----------------------------------------- |
| `PORT`                       | Defaults to `3000`.                       |
| `NOTES_PATH_PREFIX`          | Vault subtree, e.g. `notes/blogs/`.       |
| `COUCHDB_URL`                | Private-network URL (no auth in URL).     |
| `COUCHDB_DATABASE`           | Vault database name.                      |
| `GITHUB_APP_ID`              | Non-secret identifier.                    |
| `GITHUB_APP_INSTALLATION_ID` | Non-secret installation id.               |
| `GITHUB_OWNER`               | `fohte`.                                  |
| `GITHUB_REPO`                | `fohte.net`.                              |
| `GITHUB_DEFAULT_BRANCH`      | `master`.                                 |
| `R2_BUCKET`                  | Cloudflare R2 bucket name.                |
| `R2_PUBLIC_BASE_URL`         | CDN URL exposed in published MDX.         |
| `R2_ACCOUNT_ID`              | Cloudflare account id (used in endpoint). |
| `IMAGE_VARIANT_WIDTHS`       | Comma list, e.g. `640,1280,1920`.         |

### Secrets

| Key                      | Source                                       |
| ------------------------ | -------------------------------------------- |
| `BEARER_TOKEN`           | Shared with the slack-bot side (same value). |
| `COUCHDB_USERNAME`       | CouchDB account used by the Service.         |
| `COUCHDB_PASSWORD`       | Paired with `COUCHDB_USERNAME`.              |
| `LIVESYNC_PASSPHRASE`    | LiveSync E2EE passphrase.                    |
| `GITHUB_APP_PRIVATE_KEY` | PEM contents (newline-preserved).            |
| `R2_ACCESS_KEY_ID`       | R2 API token (read + write on the bucket).   |
| `R2_SECRET_ACCESS_KEY`   | Paired with `R2_ACCESS_KEY_ID`.              |

Rotation: `BEARER_TOKEN` requires updating the secret on both the
Service side and the slack-bot side at the same time.

## Local E2E stack

`docker-compose.e2e.yml` brings up a CouchDB + MinIO pair the
`pnpm test:e2e` suite drives end-to-end against the real adapter
boundaries. See `test/e2e/publish-flow.test.ts` for the scenarios
exercised. GitHub is stubbed at the Octokit layer; CouchDB and MinIO
run as real services so the LiveSyncAdapter and ImageProcessor execute
their production code paths.

```sh
pnpm e2e:up     # docker compose up -d --wait
pnpm test:e2e
pnpm e2e:down   # docker compose down -v
```

## Manual smoke checks

The following user-driven scenarios are out of scope for automated
tests but should be re-run after any deploy-time configuration change:

- **plugin ↔ Service contract**: call the deployed Service from the
  slack-bot plugin in a staging workspace; verify `BlogServiceClient`
  decodes responses through the contract Zod schemas.
- **Bearer token mismatch**: temporarily flip the plugin secret and
  confirm the plugin renders a "re-authenticate" hint on the 401.
- **Mobile flow**: from the Obsidian iOS / Android app, edit a note
  under `notes/blogs/`, then in the Slack mobile app run
  `/blog-post` → Static Select → Plan → Apply, and verify the PR URL
  follow-up renders.
- **`response_url` expiry**: leave a CI polling task running past the
  30-minute response_url window and confirm the bot falls back to
  `chat.update` via the Bot Token path.
