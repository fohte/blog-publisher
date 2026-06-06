import { readFile } from 'node:fs/promises'

export interface OctoStsTokenCache {
  getToken(): Promise<string>
  // Drops the cached token. When `token` is given, drops the cache only if it
  // currently holds that exact value — this prevents one concurrent 401 retry
  // from invalidating a fresh token a sibling request has already rotated.
  invalidate(token?: string): void
}

export interface OctoStsConfig {
  url: string
  scope: string
  identity: string
  saTokenPath: string
  safetyMarginMs?: number
}

export interface OctoStsDeps {
  fetch?: typeof fetch
  readFile?: (path: string) => Promise<string>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

interface ExchangeResponse {
  token: string
  expires_at: string
}

const DEFAULT_SAFETY_MARGIN_MS = 5 * 60 * 1000
const RETRY_BACKOFF_MS = 500
const EXCHANGE_TIMEOUT_MS = 10_000

export class OctoStsAuthError extends Error {
  readonly status: number | undefined
  readonly body: string | undefined
  constructor(message: string, status?: number, body?: string) {
    super(message)
    this.name = 'OctoStsAuthError'
    this.status = status
    this.body = body
  }
}

interface CachedToken {
  token: string
  expiresAtMs: number
}

export class OctoStsTokenCacheImpl implements OctoStsTokenCache {
  private readonly config: Omit<OctoStsConfig, 'safetyMarginMs'> & {
    safetyMarginMs: number
  }
  private readonly fetchImpl: typeof fetch
  private readonly readFileImpl: (path: string) => Promise<string>
  private readonly nowImpl: () => number
  private readonly sleepImpl: (ms: number) => Promise<void>

  private cached: CachedToken | null = null
  private inFlight: Promise<string> | null = null
  // Bumped on invalidate() so an in-flight exchange that resolves after the
  // invalidation does not silently repopulate the cache with a stale token.
  private generation = 0

  constructor(config: OctoStsConfig, deps: OctoStsDeps = {}) {
    this.config = {
      ...config,
      safetyMarginMs: config.safetyMarginMs ?? DEFAULT_SAFETY_MARGIN_MS,
    }
    this.fetchImpl = deps.fetch ?? globalThis.fetch.bind(globalThis)
    this.readFileImpl =
      deps.readFile ?? ((path: string) => readFile(path, 'utf-8'))
    this.nowImpl = deps.now ?? (() => Date.now())
    this.sleepImpl =
      deps.sleep ??
      ((ms: number) =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, ms)
        }))
  }

  invalidate(token?: string): void {
    if (token !== undefined && this.cached?.token !== token) return
    this.cached = null
    this.inFlight = null
    this.generation += 1
  }

  async getToken(): Promise<string> {
    const now = this.nowImpl()
    if (
      this.cached !== null &&
      this.cached.expiresAtMs - now > this.config.safetyMarginMs
    ) {
      return this.cached.token
    }
    if (this.inFlight !== null) {
      return this.inFlight
    }
    const gen = this.generation
    const promise = this.exchangeWithRetry()
      .then((entry): string | Promise<string> => {
        if (this.generation !== gen) {
          // Invalidated mid-flight: the caller has already declared this
          // token stale, so re-exchange instead of handing it back.
          return this.getToken()
        }
        this.cached = entry
        return entry.token
      })
      .finally(() => {
        if (this.generation === gen) {
          this.inFlight = null
        }
      })
    this.inFlight = promise
    return promise
  }

  private async exchangeWithRetry(): Promise<CachedToken> {
    try {
      return await this.exchange()
    } catch (err) {
      if (err instanceof OctoStsAuthError) {
        const status = err.status
        if (status !== undefined && status >= 400 && status < 500) {
          throw err
        }
      }
      console.warn('[octo-sts] exchange failed; retrying once', {
        error: err instanceof Error ? err.message : String(err),
        status: err instanceof OctoStsAuthError ? err.status : undefined,
      })
      await this.sleepImpl(RETRY_BACKOFF_MS)
      return this.exchange()
    }
  }

  private async exchange(): Promise<CachedToken> {
    const saToken = (await this.readFileImpl(this.config.saTokenPath)).trim()
    if (saToken === '') {
      // Status 400 marks this as a client-config issue so exchangeWithRetry
      // does not retry — an empty token file is never transient.
      throw new OctoStsAuthError(
        `octo-sts exchange aborted: SA token at ${this.config.saTokenPath} is empty`,
        400,
      )
    }
    const url = new URL('/sts/exchange', this.config.url)
    url.searchParams.set('scope', this.config.scope)
    url.searchParams.set('identity', this.config.identity)

    let res: Response
    try {
      res = await this.fetchImpl(url.toString(), {
        method: 'GET',
        headers: {
          authorization: `Bearer ${saToken}`,
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
      })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      throw new OctoStsAuthError(`octo-sts exchange network error: ${message}`)
    }

    if (!res.ok) {
      const body = await safeReadText(res)
      throw new OctoStsAuthError(
        `octo-sts exchange failed: HTTP ${String(res.status)}`,
        res.status,
        body,
      )
    }

    const json: unknown = await res.json()
    if (!isExchangeResponse(json)) {
      throw new OctoStsAuthError('octo-sts exchange returned malformed body')
    }
    const expiresAtMs = Date.parse(json.expires_at)
    if (Number.isNaN(expiresAtMs)) {
      throw new OctoStsAuthError(
        `octo-sts exchange returned invalid expires_at: ${json.expires_at}`,
      )
    }
    return { token: json.token, expiresAtMs }
  }
}

function isExchangeResponse(value: unknown): value is ExchangeResponse {
  if (typeof value !== 'object' || value === null) return false
  return (
    'token' in value &&
    typeof value.token === 'string' &&
    'expires_at' in value &&
    typeof value.expires_at === 'string'
  )
}

async function safeReadText(res: Response): Promise<string | undefined> {
  try {
    return await res.text()
  } catch {
    return undefined
  }
}
