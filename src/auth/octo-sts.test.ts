import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  OctoStsAuthError,
  type OctoStsConfig,
  type OctoStsDeps,
  OctoStsTokenCacheImpl,
} from '@/auth/octo-sts'

const BASE_CONFIG: OctoStsConfig = {
  url: 'https://octo-sts.fohte.net',
  scope: 'fohte/fohte.net',
  identity: 'fohte.net-blog-publisher',
  saTokenPath: '/var/run/secrets/tokens/octo-sts-token',
  safetyMarginMs: 5 * 60 * 1000,
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makeDeps(overrides: Partial<OctoStsDeps> = {}): {
  deps: OctoStsDeps
  fetchMock: ReturnType<typeof vi.fn>
  readFileMock: ReturnType<typeof vi.fn>
  sleepMock: ReturnType<typeof vi.fn>
  setNow: (ms: number) => void
} {
  let now = 1_700_000_000_000
  const fetchMock = vi.fn()
  const readFileMock = vi.fn(async () => 'sa-token')
  const sleepMock = vi.fn(async () => {})
  return {
    deps: {
      fetch: fetchMock,
      readFile: readFileMock,
      now: () => now,
      sleep: sleepMock,
      ...overrides,
    },
    fetchMock,
    readFileMock,
    sleepMock,
    setNow: (ms) => {
      now = ms
    },
  }
}

describe('OctoStsTokenCacheImpl.getToken', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exchanges SA token for installation token and caches result', async () => {
    const { deps, fetchMock, readFileMock } = makeDeps()
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        token: 'gh-token',
        expires_at: new Date(1_700_000_000_000 + 60 * 60 * 1000).toISOString(),
      }),
    )
    const cache = new OctoStsTokenCacheImpl(BASE_CONFIG, deps)
    expect(await cache.getToken()).toBe('gh-token')
    expect(await cache.getToken()).toBe('gh-token')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(readFileMock).toHaveBeenCalledTimes(1)
    const call = fetchMock.mock.calls[0]
    const url = call?.[0] as string
    const init = call?.[1] as RequestInit
    expect(url).toBe(
      'https://octo-sts.fohte.net/sts/exchange?scope=fohte%2Ffohte.net&identity=fohte.net-blog-publisher',
    )
    const headers = init.headers as Record<string, string>
    expect(headers['authorization']).toBe('Bearer sa-token')
  })

  it('re-exchanges once within safetyMargin of expiry', async () => {
    const startMs = 1_700_000_000_000
    const { deps, fetchMock, setNow } = makeDeps()
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          token: 'tok-a',
          expires_at: new Date(startMs + 10 * 60 * 1000).toISOString(),
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          token: 'tok-b',
          expires_at: new Date(startMs + 70 * 60 * 1000).toISOString(),
        }),
      )
    const cache = new OctoStsTokenCacheImpl(BASE_CONFIG, deps)
    expect(await cache.getToken()).toBe('tok-a')
    // Advance to within the 5-minute safety margin.
    setNow(startMs + 6 * 60 * 1000)
    expect(await cache.getToken()).toBe('tok-b')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('dedupes concurrent getToken calls to a single exchange', async () => {
    const { deps, fetchMock } = makeDeps()
    let resolve: (r: Response) => void = () => {}
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((res) => {
        resolve = res
      }),
    )
    const cache = new OctoStsTokenCacheImpl(BASE_CONFIG, deps)
    const p1 = cache.getToken()
    const p2 = cache.getToken()
    const p3 = cache.getToken()
    resolve(
      jsonResponse(200, {
        token: 'shared',
        expires_at: new Date(1_700_000_000_000 + 3_600_000).toISOString(),
      }),
    )
    expect(await Promise.all([p1, p2, p3])).toEqual([
      'shared',
      'shared',
      'shared',
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws immediately on 4xx without retry', async () => {
    const { deps, fetchMock, sleepMock } = makeDeps()
    fetchMock.mockResolvedValueOnce(
      jsonResponse(403, { error: 'no trust policy' }),
    )
    const cache = new OctoStsTokenCacheImpl(BASE_CONFIG, deps)
    await expect(cache.getToken()).rejects.toBeInstanceOf(OctoStsAuthError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sleepMock).not.toHaveBeenCalled()
  })

  it('retries once on 5xx then succeeds', async () => {
    const { deps, fetchMock, sleepMock } = makeDeps()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(502, { error: 'bad gateway' }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          token: 'after-retry',
          expires_at: new Date(
            1_700_000_000_000 + 60 * 60 * 1000,
          ).toISOString(),
        }),
      )
    const cache = new OctoStsTokenCacheImpl(BASE_CONFIG, deps)
    expect(await cache.getToken()).toBe('after-retry')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sleepMock).toHaveBeenCalledTimes(1)
  })

  it('retries once on network error then succeeds', async () => {
    const { deps, fetchMock, sleepMock } = makeDeps()
    fetchMock
      .mockRejectedValueOnce(new Error('socket hangup'))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          token: 'after-net-retry',
          expires_at: new Date(
            1_700_000_000_000 + 60 * 60 * 1000,
          ).toISOString(),
        }),
      )
    const cache = new OctoStsTokenCacheImpl(BASE_CONFIG, deps)
    expect(await cache.getToken()).toBe('after-net-retry')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sleepMock).toHaveBeenCalledTimes(1)
  })

  it('invalidate() forces a fresh exchange on next getToken', async () => {
    const { deps, fetchMock } = makeDeps()
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          token: 'first',
          expires_at: new Date(
            1_700_000_000_000 + 60 * 60 * 1000,
          ).toISOString(),
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          token: 'second',
          expires_at: new Date(
            1_700_000_000_000 + 60 * 60 * 1000,
          ).toISOString(),
        }),
      )
    const cache = new OctoStsTokenCacheImpl(BASE_CONFIG, deps)
    expect(await cache.getToken()).toBe('first')
    cache.invalidate()
    expect(await cache.getToken()).toBe('second')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reads SA token from configured path on every exchange', async () => {
    const { deps, fetchMock, readFileMock } = makeDeps()
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          token: 'a',
          expires_at: new Date(
            1_700_000_000_000 + 60 * 60 * 1000,
          ).toISOString(),
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          token: 'b',
          expires_at: new Date(
            1_700_000_000_000 + 60 * 60 * 1000,
          ).toISOString(),
        }),
      )
    const cache = new OctoStsTokenCacheImpl(BASE_CONFIG, deps)
    await cache.getToken()
    cache.invalidate()
    await cache.getToken()
    expect(readFileMock).toHaveBeenCalledTimes(2)
    expect(readFileMock).toHaveBeenCalledWith(BASE_CONFIG.saTokenPath)
  })

  it('invalidate(token) is a no-op when the cached token differs', async () => {
    const { deps, fetchMock } = makeDeps()
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        token: 'current',
        expires_at: new Date(1_700_000_000_000 + 60 * 60 * 1000).toISOString(),
      }),
    )
    const cache = new OctoStsTokenCacheImpl(BASE_CONFIG, deps)
    await cache.getToken()
    cache.invalidate('stale-from-sibling')
    expect(await cache.getToken()).toBe('current')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('drops in-flight exchange results when invalidate() races them', async () => {
    const { deps, fetchMock } = makeDeps()
    let resolve: (r: Response) => void = () => {}
    fetchMock
      .mockReturnValueOnce(
        new Promise<Response>((res) => {
          resolve = res
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          token: 'after-invalidate',
          expires_at: new Date(
            1_700_000_000_000 + 60 * 60 * 1000,
          ).toISOString(),
        }),
      )
    const cache = new OctoStsTokenCacheImpl(BASE_CONFIG, deps)
    const p = cache.getToken()
    // Invalidate while exchange #1 is still in flight.
    cache.invalidate()
    resolve(
      jsonResponse(200, {
        token: 'stale-result',
        expires_at: new Date(1_700_000_000_000 + 60 * 60 * 1000).toISOString(),
      }),
    )
    await p
    // Cache must not have been populated by the in-flight result.
    expect(await cache.getToken()).toBe('after-invalidate')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
