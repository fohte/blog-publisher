import {
  type EnvSource,
  EnvValidationError,
  optionalInt,
  optionalString,
  parseEnv,
  requireString,
} from '@fohte/service-kit/env'
import { err, ok, type Result } from 'neverthrow'

export interface Config {
  port: number
  bearerToken: string
  notesPathPrefix: string
  liveSync: {
    couchUrl: string
    username: string
    password: string
    database: string
    passphrase?: string
  }
  github: {
    owner: string
    repo: string
    defaultBranch: string
  }
  octoSts: {
    url: string
    scope: string
    identity: string
    saTokenPath: string
  }
  r2: {
    bucket: string
    publicBaseUrl: string
    accountId: string
    accessKeyId: string
    secretAccessKey: string
    variantWidths: number[]
  }
}

function parseVariantWidths(raw: string): Result<number[], string> {
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
  if (parts.length === 0) {
    return err('IMAGE_VARIANT_WIDTHS must be a non-empty comma list')
  }
  const widths: number[] = []
  for (const p of parts) {
    const n = Number.parseInt(p, 10)
    if (Number.isNaN(n) || n <= 0) {
      return err(`IMAGE_VARIANT_WIDTHS must contain positive integers: ${p}`)
    }
    widths.push(n)
  }
  return ok(widths)
}

export function loadConfig(
  env: EnvSource = process.env,
): Result<Config, EnvValidationError> {
  return parseEnv({
    port: optionalInt(env, 'PORT', 3000),
    bearerToken: requireString(env, 'BEARER_TOKEN'),
    notesPathPrefix: optionalString(env, 'NOTES_PATH_PREFIX', 'notes/blogs/'),
    couchUrl: requireString(env, 'COUCHDB_URL'),
    couchUsername: requireString(env, 'COUCHDB_USERNAME'),
    couchPassword: requireString(env, 'COUCHDB_PASSWORD'),
    couchDatabase: requireString(env, 'COUCHDB_DATABASE'),
    livesyncPassphrase: optionalString(env, 'LIVESYNC_PASSPHRASE'),
    githubOwner: requireString(env, 'GITHUB_OWNER'),
    githubRepo: requireString(env, 'GITHUB_REPO'),
    githubDefaultBranch: optionalString(env, 'GITHUB_DEFAULT_BRANCH', 'master'),
    octoStsUrl: requireString(env, 'OCTO_STS_URL'),
    octoStsScope: requireString(env, 'OCTO_STS_SCOPE'),
    octoStsIdentity: requireString(env, 'OCTO_STS_IDENTITY'),
    octoStsSaTokenPath: optionalString(
      env,
      'OCTO_STS_SA_TOKEN_PATH',
      '/var/run/secrets/tokens/octo-sts-token',
    ),
    r2Bucket: requireString(env, 'R2_BUCKET'),
    r2PublicBaseUrl: requireString(env, 'R2_PUBLIC_BASE_URL'),
    r2AccountId: requireString(env, 'R2_ACCOUNT_ID'),
    r2AccessKeyId: requireString(env, 'R2_ACCESS_KEY_ID'),
    r2SecretAccessKey: requireString(env, 'R2_SECRET_ACCESS_KEY'),
    r2VariantWidths: optionalString(
      env,
      'IMAGE_VARIANT_WIDTHS',
      '640,1280,1920',
    ).andThen(parseVariantWidths),
  }).map((f) => ({
    port: f.port,
    bearerToken: f.bearerToken,
    notesPathPrefix: f.notesPathPrefix,
    liveSync: {
      couchUrl: f.couchUrl,
      username: f.couchUsername,
      password: f.couchPassword,
      database: f.couchDatabase,
      ...(f.livesyncPassphrase !== undefined
        ? { passphrase: f.livesyncPassphrase }
        : {}),
    },
    github: {
      owner: f.githubOwner,
      repo: f.githubRepo,
      defaultBranch: f.githubDefaultBranch,
    },
    octoSts: {
      url: f.octoStsUrl,
      scope: f.octoStsScope,
      identity: f.octoStsIdentity,
      saTokenPath: f.octoStsSaTokenPath,
    },
    r2: {
      bucket: f.r2Bucket,
      publicBaseUrl: f.r2PublicBaseUrl,
      accountId: f.r2AccountId,
      accessKeyId: f.r2AccessKeyId,
      secretAccessKey: f.r2SecretAccessKey,
      variantWidths: f.r2VariantWidths,
    },
  }))
}
