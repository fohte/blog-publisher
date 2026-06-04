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
    appId: string
    privateKey: string
    installationId: number
    owner: string
    repo: string
    defaultBranch: string
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

function reqInt(env: NodeJS.ProcessEnv, key: string): number {
  const raw = req(env, key)
  const n = Number.parseInt(raw, 10)
  if (Number.isNaN(n)) {
    throw new ConfigError(
      `environment variable ${key} must be an integer: ${raw}`,
    )
  }
  return n
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
    notesPathPrefix: env['NOTES_PATH_PREFIX'] ?? 'notes/blogs/',
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
      appId: req(env, 'GITHUB_APP_ID'),
      privateKey: req(env, 'GITHUB_APP_PRIVATE_KEY'),
      installationId: reqInt(env, 'GITHUB_APP_INSTALLATION_ID'),
      owner: req(env, 'GITHUB_OWNER'),
      repo: req(env, 'GITHUB_REPO'),
      defaultBranch: env['GITHUB_DEFAULT_BRANCH'] ?? 'master',
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
