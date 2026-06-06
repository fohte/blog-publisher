# Operations

Operational handbook for deploying and running the Blog Publisher Service. This document covers the prerequisites that live outside this repository (Obsidian LiveSync, GitHub App, Slack App) plus the configuration template that the service consumes. For an architectural overview and local development / test commands, see the [README](../README.md).

This repo only ships the Dockerfile and the configuration contract; how the container is scheduled is up to the operator.

## LiveSync (CouchDB) prerequisites

The Service reads the vault directly from CouchDB through Obsidian LiveSync's on-disk schema. For the reader to be able to find and decrypt notes, the following vault settings MUST hold:

| Setting               | Required value | Why                                                                                              |
| --------------------- | -------------- | ------------------------------------------------------------------------------------------------ |
| Path Obfuscation      | **disabled**   | Paths are stored as `f:<hash>` when enabled, making the `notes/blogs/` prefix filter impossible. |
| Property Encryption   | **disabled**   | Encrypts metadata fields the Service relies on (`path`, `mtime`, `children`).                    |
| End-to-End Encryption | enabled OK     | Chunk-level encryption is supported through `LIVESYNC_PASSPHRASE`.                               |

The Service fails fast at startup if Path Obfuscation or Property Encryption is enabled — see `src/adapters/livesync.ts` (`init()`).

CouchDB must be reachable from the Service over plain HTTP within the private network. The configured user needs read access to the vault database.

## GitHub App setup

Create a dedicated GitHub App so the Service can authenticate per-installation. The Service never holds the App Private Key directly: it exchanges an OIDC token at `octo-sts.fohte.net` for a short-lived (1 h) installation token.

1. **App permissions** — Repository permissions only:
   - Contents: **Write** (blob / tree / commit / ref operations)
   - Pull requests: **Write** (open / label / close)
   - Metadata: **Read** (auto-granted)
2. **Installation target**: install the App on `fohte/fohte.net` **only**. Do not install at the organization level.
3. **Webhooks**: disabled. The Service polls CI state via the REST API.
4. The App Private Key is held by the octo-sts deployment, not by this Service. The trust policy at `fohte/.github/.github/chainguard/fohte.net-blog-publisher.sts.yaml` decides which identity may exchange for the `fohte/fohte.net` scope.

Initial rollout can point at a fork or a `test/blog-publish-dry` branch for dry-runs by overriding `GITHUB_REPO` and `GITHUB_DEFAULT_BRANCH` (and the matching octo-sts trust policy scope).

## octo-sts setup

The deployment must keep a valid OIDC token (audience `octo-sts.fohte.net`, subject matching the trust policy identity) at the path given by `OCTO_STS_SA_TOKEN_PATH`. The Service re-reads the file on every exchange, so an out-of-band rotation that overwrites the file in place is enough — no restart required.

The installation token is cached in memory with a 5-minute safety margin; concurrent requests share a single in-flight exchange. On a 401 from GitHub (clock skew etc.) the client invalidates the cache and retries the request once.

## Slack App setup

The blog publisher rides on top of the shared slack-bot core (separate repo). The core handles `x-slack-signature` HMAC-SHA256 verification and forwards already-verified interaction payloads to the blog plugin — **this Service never sees raw Slack requests**.

1. Register three slash commands on the Slack App that the slack-bot deployment serves:
   - `/blog-post` — start a publish flow (Static Select of recent notes).
   - `/blog-status` — list open / recently closed PRs.
   - `/blog-cancel` — close a PR by number.
2. Subscribe `interactivity` so block actions reach the same Request URL as the slash commands.
3. Workspace install is the first authorization gate; the second gate is the `allowedSlackUserIds` list configured on the slack-bot plugin. Users not on the list receive an ephemeral "not authorized" reply.
4. The Slack Signing Secret and Bot Token belong to the slack-bot core deployment, **not** to this Service.

## Configuration template

`.env.example` at the repo root mirrors the variables the Service reads through `src/config.ts`. Operators should split them between non-secret config and a secret store as follows.

### Non-secret config

| Key                      | Notes                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `PORT`                   | Defaults to `3000`.                                                                     |
| `NOTES_PATH_PREFIX`      | Vault subtree, e.g. `notes/blogs/`.                                                     |
| `COUCHDB_URL`            | Private-network URL (no auth in URL).                                                   |
| `COUCHDB_DATABASE`       | Vault database name.                                                                    |
| `GITHUB_OWNER`           | `fohte`.                                                                                |
| `GITHUB_REPO`            | `fohte.net`.                                                                            |
| `GITHUB_DEFAULT_BRANCH`  | `master`.                                                                               |
| `OCTO_STS_URL`           | `https://octo-sts.fohte.net`.                                                           |
| `OCTO_STS_SCOPE`         | Target repo, e.g. `fohte/fohte.net`.                                                    |
| `OCTO_STS_IDENTITY`      | Trust policy identity (matches `fohte/.github/.github/chainguard/<identity>.sts.yaml`). |
| `OCTO_STS_SA_TOKEN_PATH` | Projected SA token path. Default `/var/run/secrets/tokens/octo-sts-token`.              |
| `R2_BUCKET`              | Cloudflare R2 bucket name.                                                              |
| `R2_PUBLIC_BASE_URL`     | CDN URL exposed in published MDX.                                                       |
| `R2_ACCOUNT_ID`          | Cloudflare account id (used in endpoint).                                               |
| `IMAGE_VARIANT_WIDTHS`   | Comma list, e.g. `640,1280,1920`.                                                       |

### Secrets

| Key                    | Source                                       |
| ---------------------- | -------------------------------------------- |
| `BEARER_TOKEN`         | Shared with the slack-bot side (same value). |
| `COUCHDB_USERNAME`     | CouchDB account used by the Service.         |
| `COUCHDB_PASSWORD`     | Paired with `COUCHDB_USERNAME`.              |
| `LIVESYNC_PASSPHRASE`  | LiveSync E2EE passphrase.                    |
| `R2_ACCESS_KEY_ID`     | R2 API token (read + write on the bucket).   |
| `R2_SECRET_ACCESS_KEY` | Paired with `R2_ACCESS_KEY_ID`.              |

Rotation: `BEARER_TOKEN` requires updating the secret on both the Service side and the slack-bot side at the same time.

## Manual smoke checks

The following user-driven scenarios are out of scope for automated tests but should be re-run after any deploy-time configuration change:

- **plugin ↔ Service contract**: call the deployed Service from the slack-bot plugin in a staging workspace; verify `BlogServiceClient` decodes responses through the contract Zod schemas.
- **Bearer token mismatch**: temporarily flip the plugin secret and confirm the plugin renders a "re-authenticate" hint on the 401.
- **Mobile flow**: from the Obsidian iOS / Android app, edit a note under `notes/blogs/`, then in the Slack mobile app run `/blog-post` → Static Select → Plan → Apply, and verify the PR URL follow-up renders.
- **`response_url` expiry**: leave a CI polling task running past the 30-minute response_url window and confirm the bot falls back to `chat.update` via the Bot Token path.
