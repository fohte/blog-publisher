// Must load before any instrumented module is imported below, so it cannot
// sit in the sorted # import group.
// eslint-disable-next-line simple-import-sort/imports -- must stay first
import { observability } from '#bootstrap'

<<<<<<< before updating
import { S3Client } from '@aws-sdk/client-s3'
import { serve } from '@hono/node-server'
import { createOctoStsTokenCache } from '@fohte/service-kit/octo-sts'
import { createShutdownHandler } from '@fohte/service-kit/shutdown'
||||||| last update
export const greet = (name: string): string => {
  return `Hello, ${name}!`
=======
import { err, ok, type Result } from 'neverthrow'
>>>>>>> after updating

<<<<<<< before updating
import { GitHubClient } from '#adapters/github-client'
import { ImageProcessor } from '#adapters/image-processor'
import { LiveSyncAdapter } from '#adapters/livesync'
import { createApp } from '#app'
import { loadConfig } from '#config'
import { logger } from '#logger'

async function main(): Promise<void> {
  const configResult = loadConfig()
  if (configResult.isErr()) {
    logger.fatal(
      { issues: configResult.error.issues },
      'invalid environment configuration',
    )
    process.exit(1)
  }
  const config = configResult.value

  const liveSync = new LiveSyncAdapter()
  await liveSync.init({
    couchUrl: config.liveSync.couchUrl,
    username: config.liveSync.username,
    password: config.liveSync.password,
    database: config.liveSync.database,
    ...(config.liveSync.passphrase !== undefined
      ? { passphrase: config.liveSync.passphrase }
      : {}),
  })

  const tokenCache = createOctoStsTokenCache({
    url: config.octoSts.url,
    scope: config.octoSts.scope,
    identity: config.octoSts.identity,
    saTokenPath: config.octoSts.saTokenPath,
  })

  const github = new GitHubClient(
    {
      owner: config.github.owner,
      repo: config.github.repo,
      defaultBranch: config.github.defaultBranch,
    },
    { tokenCache },
  )

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.r2.accessKeyId,
      secretAccessKey: config.r2.secretAccessKey,
    },
  })

  const imageProcessor = new ImageProcessor({
    bucket: config.r2.bucket,
    publicBaseUrl: config.r2.publicBaseUrl,
    variantWidths: config.r2.variantWidths,
    s3,
  })

  const app = createApp({
    bearerToken: config.bearerToken,
    notesPathPrefix: config.notesPathPrefix,
    liveSync,
    github,
    apply: {
      imageProcessor,
      // Vault attachments resolve through LiveSync chunks in a follow-up;
      // until then images referenced by notes are not uploaded.
      readImage: () => Promise.resolve(null),
      defaultBranch: config.github.defaultBranch,
    },
  })

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info({ port: info.port }, 'server listening')
  })

  server.on('error', (err: unknown) => {
    logger.fatal(
      {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      'server failed to start',
    )
    process.exit(1)
  })

  createShutdownHandler(
    [
      {
        name: 'http-server',
        run: () =>
          new Promise<void>((resolve) => {
            server.close(() => {
              resolve()
            })
          }),
      },
      {
        name: 'observability',
        run: () => observability?.shutdown() ?? Promise.resolve(),
      },
    ],
    { logger },
  )
||||||| last update
export const greet = (name: string): string => {
  return `Hello, ${name}!`
=======
export const greet = (name: string): Result<string, Error> => {
  if (!name) return err(new Error('name must not be empty'))
  return ok(`Hello, ${name}!`)
>>>>>>> after updating
}

main().catch((err: unknown) => {
  logger.fatal(
    {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    },
    'fatal startup error',
  )
  process.exit(1)
})
