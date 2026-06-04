import type { BlogPrSummary } from '@fohte/blog-publisher-contract'
import { describe, expect, it, vi } from 'vitest'

import { type AppDeps, createApp } from '@/app'

function ok(slug: string): string {
  return `---\ntitle: ${slug}\ndate: 2026-01-01\ndescription: d\nslug: ${slug}\n---\nbody`
}

function makeDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  const note = (docId: string, path: string, content: string) => ({
    docId,
    path,
    content,
    mtime: 1,
    size: content.length,
  })
  const notes: Record<string, ReturnType<typeof note>> = {
    a: note('a', 'notes/blogs/a.md', ok('a')),
  }
  const metas = Object.values(notes).map((n) => ({
    docId: n.docId,
    path: n.path,
    mtime: n.mtime,
    size: n.size,
  }))
  return {
    bearerToken: 'tok',
    notesPathPrefix: 'notes/blogs/',
    liveSync: {
      listNotesByPath: vi.fn(async () => metas),
      readNote: vi.fn(async (docId: string) => {
        const n = notes[docId]
        if (n === undefined) throw new Error('not found')
        return n
      }),
    },
    github: {
      existsOnFohteNet: vi.fn(async () => false),
      findExistingPrByBranch: vi.fn(async () => null),
      createBranch: vi.fn(async () => undefined),
      deleteBranch: vi.fn(async () => undefined),
      commitFiles: vi.fn(async () => ({ sha: 'sha' })),
      createPullRequest: vi.fn(
        async (branch: string, title: string): Promise<BlogPrSummary> => ({
          number: 1,
          url: 'https://example/pr/1',
          branch,
          state: 'open',
          title,
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
      ),
      listBlogPrs: vi.fn(async () => []),
      closePullRequest: vi.fn(async () => undefined),
      resolveCiStatus: vi.fn(async () => ({
        state: 'success' as const,
        failedChecks: [],
      })),
    },
    apply: {
      imageProcessor: { uploadAll: vi.fn(async () => ({})) },
      readImage: vi.fn(async () => null),
      defaultBranch: 'master',
    },
    ...overrides,
  }
}

const AUTH = { authorization: 'Bearer tok' }

describe('createApp', () => {
  it('GET /health is open and returns ok', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('returns 401 without bearer token', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/notes')
    expect(res.status).toBe(401)
  })

  it('returns 401 with wrong bearer token', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/notes', {
      headers: { authorization: 'Bearer nope' },
    })
    expect(res.status).toBe(401)
  })

  it('GET /notes returns Note list', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/notes', { headers: AUTH })
    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown[]
    expect(body).toHaveLength(1)
  })

  it('POST /plan validates body (400)', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/plan', {
      method: 'POST',
      headers: { ...AUTH, 'content-type': 'application/json' },
      body: JSON.stringify({ wrong: true }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /plan returns Plan with deterministic signature', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/plan', {
      method: 'POST',
      headers: { ...AUTH, 'content-type': 'application/json' },
      body: JSON.stringify({ docIds: ['a'] }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { signature: string; items: unknown[] }
    expect(body.signature).toMatch(/^[0-9a-f]{8}$/)
    expect(body.items).toHaveLength(1)
  })

  it('POST /apply returns success when path is clean', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/apply', {
      method: 'POST',
      headers: { ...AUTH, 'content-type': 'application/json' },
      body: JSON.stringify({ docIds: ['a'] }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { kind: string }
    expect(body.kind).toBe('success')
  })

  it('uncaught errors become 500 with { error } body', async () => {
    const deps = makeDeps()
    deps.github.listBlogPrs = vi.fn().mockRejectedValue(new Error('boom'))
    const app = createApp(deps)
    const res = await app.request('/prs', { headers: AUTH })
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('InternalServerError')
  })

  it('/doc returns OpenAPI spec (no auth required)', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/doc')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { openapi: string; paths: object }
    expect(body.openapi).toBe('3.1.0')
    expect(Object.keys(body.paths)).toEqual(
      expect.arrayContaining([
        '/notes',
        '/plan',
        '/apply',
        '/prs',
        '/prs/{number}/cancel',
        '/prs/{number}/ci',
      ]),
    )
  })
})
