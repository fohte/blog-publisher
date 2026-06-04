import { readFile } from 'node:fs/promises'

import { S3Client } from '@aws-sdk/client-s3'
import { serve } from '@hono/node-server'

import { GitHubClient } from '@/adapters/github-client'
import { ImageProcessor } from '@/adapters/image-processor'
import { LiveSyncAdapter } from '@/adapters/livesync'
import { createApp } from '@/app'
import { loadConfig } from '@/config'

async function main(): Promise<void> {
  const config = loadConfig()

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

  const github = new GitHubClient({
    appId: config.github.appId,
    privateKey: config.github.privateKey,
    installationId: config.github.installationId,
    owner: config.github.owner,
    repo: config.github.repo,
    defaultBranch: config.github.defaultBranch,
  })

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
      readImage: async (sourcePath) => {
        try {
          const buffer = await readFile(sourcePath)
          return { sourcePath, buffer }
        } catch {
          return null
        }
      },
      defaultBranch: config.github.defaultBranch,
    },
  })

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`Listening on http://localhost:${String(info.port)}`)
  })

  server.on('error', (err) => {
    console.error('Server failed to start:', err)
    process.exit(1)
  })

  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down')
    server.close(() => {
      process.exit(0)
    })
  })
}

main().catch((err: unknown) => {
  console.error('Fatal startup error:', err)
  process.exit(1)
})
