import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createOctoStsAuthStrategy,
  GitHubClient,
} from '@/adapters/github-client'
import type { OctoStsTokenCache } from '@/auth/octo-sts'

interface RecordedCall {
  route: string
  params: Record<string, unknown>
}

interface OctokitMock {
  request: (
    route: string,
    params?: Record<string, unknown>,
  ) => Promise<{ data: unknown; status?: number }>
}

function makeOctokitMock(
  handlers: Record<string, (params: Record<string, unknown>) => unknown>,
): {
  octokit: OctokitMock
  calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []
  const request = vi.fn(
    async (route: string, params?: Record<string, unknown>) => {
      const p = params ?? {}
      calls.push({ route, params: p })
      const handler = handlers[route]
      if (handler === undefined) {
        const err = Object.assign(new Error('not mocked: ' + route), {
          status: 500,
        })
        throw err
      }
      const data = handler(p)
      return { data, status: 200 }
    },
  )
  return { octokit: { request }, calls }
}

const baseConfig = {
  owner: 'fohte',
  repo: 'fohte.net',
  defaultBranch: 'master',
}

describe('GitHubClient.commitFiles', () => {
  it('runs blob → tree → commit → updateRef in order', async () => {
    const { octokit, calls } = makeOctokitMock({
      'GET /repos/{owner}/{repo}/git/refs/heads/{branch}': () => ({
        ref: 'refs/heads/x',
        object: { sha: 'BASESHA', type: 'commit' },
      }),
      'GET /repos/{owner}/{repo}/git/commits/{sha}': () => ({
        tree: { sha: 'BASETREE' },
      }),
      'POST /repos/{owner}/{repo}/git/blobs': () => ({ sha: 'BLOB' }),
      'POST /repos/{owner}/{repo}/git/trees': () => ({ sha: 'TREE' }),
      'POST /repos/{owner}/{repo}/git/commits': () => ({ sha: 'COMMIT' }),
      'PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}': () => ({
        object: { sha: 'COMMIT' },
      }),
    })
    const client = new GitHubClient(baseConfig, { octokit })
    const result = await client.commitFiles(
      'blog/abc',
      [
        { path: 'a.mdx', content: 'A', encoding: 'utf-8' },
        { path: 'b.mdx', content: 'B', encoding: 'utf-8' },
      ],
      'commit msg',
    )
    expect(result.sha).toBe('COMMIT')
    const order = calls.map((c) => c.route)
    expect(order).toEqual([
      'GET /repos/{owner}/{repo}/git/refs/heads/{branch}',
      'GET /repos/{owner}/{repo}/git/commits/{sha}',
      'POST /repos/{owner}/{repo}/git/blobs',
      'POST /repos/{owner}/{repo}/git/blobs',
      'POST /repos/{owner}/{repo}/git/trees',
      'POST /repos/{owner}/{repo}/git/commits',
      'PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}',
    ])
    const treeCall = calls.find((c) => c.route.endsWith('/git/trees'))
    expect(treeCall?.params['base_tree']).toBe('BASETREE')
  })
})

describe('GitHubClient.createPullRequest', () => {
  it('creates PR with master base and applies blog-publish label', async () => {
    const { octokit, calls } = makeOctokitMock({
      'POST /repos/{owner}/{repo}/pulls': () => ({
        number: 42,
        html_url: 'https://github.com/fohte/fohte.net/pull/42',
        state: 'open',
        title: 't',
        created_at: '2025-01-02T00:00:00Z',
        merged_at: null,
        head: { ref: 'blog/abc', sha: 'X' },
      }),
      'POST /repos/{owner}/{repo}/issues/{issue_number}/labels': () => [
        { name: 'blog-publish' },
      ],
    })
    const client = new GitHubClient(baseConfig, { octokit })
    const pr = await client.createPullRequest('blog/abc', 't', 'b')
    expect(pr.number).toBe(42)
    const created = calls.find(
      (c) => c.route === 'POST /repos/{owner}/{repo}/pulls',
    )
    expect(created?.params['base']).toBe('master')
    const labeled = calls.find((c) => c.route.endsWith('/labels'))
    expect(labeled?.params['labels']).toEqual(['blog-publish'])
  })
})

describe('GitHubClient.existsOnFohteNet', () => {
  it('returns true on 200', async () => {
    const { octokit } = makeOctokitMock({
      'GET /repos/{owner}/{repo}/contents/{path}': () => ({ name: 'x.mdx' }),
    })
    const client = new GitHubClient(baseConfig, { octokit })
    expect(await client.existsOnFohteNet('2025-01-01-x.mdx')).toBe(true)
  })

  it('returns false on 404', async () => {
    const { octokit } = makeOctokitMock({
      'GET /repos/{owner}/{repo}/contents/{path}': () => {
        const err = Object.assign(new Error('not found'), { status: 404 })
        throw err
      },
    })
    const client = new GitHubClient(baseConfig, { octokit })
    expect(await client.existsOnFohteNet('missing.mdx')).toBe(false)
  })
})

describe('GitHubClient.resolveCiStatus', () => {
  const pr = {
    number: 42,
    html_url: 'https://github.com/fohte/fohte.net/pull/42',
    state: 'open' as const,
    title: 't',
    created_at: '2025-01-02T00:00:00Z',
    merged_at: null,
    head: { ref: 'blog/abc', sha: 'SHA' },
  }

  it('normalizes all-success to success state', async () => {
    const { octokit } = makeOctokitMock({
      'GET /repos/{owner}/{repo}/pulls/{pull_number}': () => pr,
      'GET /repos/{owner}/{repo}/commits/{ref}/check-runs': () => ({
        total_count: 2,
        check_runs: [
          { name: 'test', status: 'completed', conclusion: 'success' },
          { name: 'deploy', status: 'completed', conclusion: 'skipped' },
        ],
      }),
      'GET /repos/{owner}/{repo}/deployments': () => [],
    })
    const client = new GitHubClient(baseConfig, { octokit })
    const ci = await client.resolveCiStatus(42)
    expect(ci.state).toBe('success')
    expect(ci.failedChecks).toEqual([])
  })

  it('reports failure with failedChecks', async () => {
    const { octokit } = makeOctokitMock({
      'GET /repos/{owner}/{repo}/pulls/{pull_number}': () => pr,
      'GET /repos/{owner}/{repo}/commits/{ref}/check-runs': () => ({
        total_count: 2,
        check_runs: [
          { name: 'test', status: 'completed', conclusion: 'failure' },
          { name: 'deploy', status: 'completed', conclusion: 'success' },
        ],
      }),
      'GET /repos/{owner}/{repo}/deployments': () => [],
    })
    const client = new GitHubClient(baseConfig, { octokit })
    const ci = await client.resolveCiStatus(42)
    expect(ci.state).toBe('failure')
    expect(ci.failedChecks).toEqual(['test'])
  })

  it('reports pending while a check is in progress', async () => {
    const { octokit } = makeOctokitMock({
      'GET /repos/{owner}/{repo}/pulls/{pull_number}': () => pr,
      'GET /repos/{owner}/{repo}/commits/{ref}/check-runs': () => ({
        total_count: 1,
        check_runs: [{ name: 'test', status: 'in_progress' }],
      }),
      'GET /repos/{owner}/{repo}/deployments': () => [],
    })
    const client = new GitHubClient(baseConfig, { octokit })
    const ci = await client.resolveCiStatus(42)
    expect(ci.state).toBe('pending')
  })

  it('extracts preview URL from latest Preview deployment', async () => {
    const { octokit } = makeOctokitMock({
      'GET /repos/{owner}/{repo}/pulls/{pull_number}': () => pr,
      'GET /repos/{owner}/{repo}/commits/{ref}/check-runs': () => ({
        total_count: 1,
        check_runs: [
          { name: 'test', status: 'completed', conclusion: 'success' },
        ],
      }),
      'GET /repos/{owner}/{repo}/deployments': () => [
        { id: 99, ref: 'blog/abc', environment: 'Preview' },
      ],
      'GET /repos/{owner}/{repo}/deployments/{deployment_id}/statuses': () => [
        { state: 'success', environment_url: 'https://preview.example.com' },
      ],
    })
    const client = new GitHubClient(baseConfig, { octokit })
    const ci = await client.resolveCiStatus(42)
    expect(ci.previewUrl).toBe('https://preview.example.com')
  })
})

describe('createOctoStsAuthStrategy', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function makeCache(tokens: string[]): OctoStsTokenCache & {
    invalidated: string[]
  } {
    const stream = [...tokens]
    const invalidated: string[] = []
    return {
      getToken: vi.fn(async () => {
        const t = stream.shift()
        if (t === undefined) throw new Error('no more tokens')
        return t
      }),
      invalidate: vi.fn((token?: string) => {
        invalidated.push(token ?? '<none>')
      }),
      invalidated,
    }
  }

  it('injects token as authorization header on every request', async () => {
    const cache = makeCache(['tok-1'])
    const { hook } = createOctoStsAuthStrategy(cache)()
    const request = vi.fn(async () => ({ data: 'ok' }))
    await hook(request, 'GET /x', { foo: 1, headers: { 'x-y': 'z' } })
    expect(request).toHaveBeenCalledWith('GET /x', {
      foo: 1,
      headers: { 'x-y': 'z', authorization: 'token tok-1' },
    })
  })

  it('on 401 invalidates cache and retries once with a fresh token', async () => {
    const cache = makeCache(['stale', 'fresh'])
    const { hook } = createOctoStsAuthStrategy(cache)()
    let calls = 0
    const request = vi.fn(
      async (_route: string, params: Record<string, unknown>) => {
        calls += 1
        if (calls === 1) {
          const err = Object.assign(new Error('unauthorized'), { status: 401 })
          throw err
        }
        const headers = params['headers'] as Record<string, string>
        return { data: 'ok', sentAuth: headers['authorization'] }
      },
    )
    const res = (await hook(request, 'GET /x', {})) as {
      data: string
      sentAuth: string
    }
    expect(res.data).toBe('ok')
    expect(res.sentAuth).toBe('token fresh')
    expect(cache.invalidated).toEqual(['stale'])
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('does not retry on non-401 errors', async () => {
    const cache = makeCache(['tok'])
    const { hook } = createOctoStsAuthStrategy(cache)()
    const request = vi.fn(async () => {
      const err = Object.assign(new Error('boom'), { status: 500 })
      throw err
    })
    await expect(hook(request, 'GET /x', {})).rejects.toMatchObject({
      status: 500,
    })
    expect(cache.invalidated).toEqual([])
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('does not crash when request throws null', async () => {
    const cache = makeCache(['tok'])
    const { hook } = createOctoStsAuthStrategy(cache)()
    const request = vi.fn(async () => {
      throw null
    })
    await expect(hook(request, 'GET /x', {})).rejects.toBeNull()
    expect(cache.invalidated).toEqual([])
  })
})
