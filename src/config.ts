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

class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

function req(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key]
  if (v === undefined || v === '') {
    throw new ConfigError(`required environment variable is missing: ${key}`)
  }
  return v
}

function opt(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const v = env[key]
  return v === undefined || v === '' ? undefined : v
}

function parseWidths(raw: string): number[] {
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
  if (parts.length === 0) {
    throw new ConfigError('IMAGE_VARIANT_WIDTHS must be a non-empty comma list')
  }
  const out: number[] = []
  for (const p of parts) {
    const n = Number.parseInt(p, 10)
    if (Number.isNaN(n) || n <= 0) {
      throw new ConfigError(
        `IMAGE_VARIANT_WIDTHS must contain positive integers: ${p}`,
      )
    }
    out.push(n)
  }
  return out
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const portRaw = env['PORT']
  const port =
    portRaw === undefined || portRaw === ''
      ? 3000
      : Number.parseInt(portRaw, 10)
  if (Number.isNaN(port)) {
    throw new ConfigError(`PORT must be an integer: ${portRaw ?? ''}`)
  }
  return {
    port,
    bearerToken: req(env, 'BEARER_TOKEN'),
    notesPathPrefix: opt(env, 'NOTES_PATH_PREFIX') ?? 'notes/blogs/',
    liveSync: (() => {
      const passphrase = opt(env, 'LIVESYNC_PASSPHRASE')
      return {
        couchUrl: req(env, 'COUCHDB_URL'),
        username: req(env, 'COUCHDB_USERNAME'),
        password: req(env, 'COUCHDB_PASSWORD'),
        database: req(env, 'COUCHDB_DATABASE'),
        ...(passphrase !== undefined ? { passphrase } : {}),
      }
    })(),
    github: {
      owner: req(env, 'GITHUB_OWNER'),
      repo: req(env, 'GITHUB_REPO'),
      defaultBranch: opt(env, 'GITHUB_DEFAULT_BRANCH') ?? 'master',
    },
    octoSts: {
      url: req(env, 'OCTO_STS_URL'),
      scope: req(env, 'OCTO_STS_SCOPE'),
      identity: opt(env, 'OCTO_STS_IDENTITY') ?? 'fohte.net-blog-publisher',
      saTokenPath:
        opt(env, 'OCTO_STS_SA_TOKEN_PATH') ??
        '/var/run/secrets/tokens/octo-sts-token',
    },
    r2: {
      bucket: req(env, 'R2_BUCKET'),
      publicBaseUrl: req(env, 'R2_PUBLIC_BASE_URL'),
      accountId: req(env, 'R2_ACCOUNT_ID'),
      accessKeyId: req(env, 'R2_ACCESS_KEY_ID'),
      secretAccessKey: req(env, 'R2_SECRET_ACCESS_KEY'),
      variantWidths: parseWidths(
        env['IMAGE_VARIANT_WIDTHS'] ?? '640,1280,1920',
      ),
    },
  }
}
