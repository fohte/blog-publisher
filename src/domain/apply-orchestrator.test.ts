import type { BlogPrSummary } from '@fohte/blog-publisher-contract'
import { describe, expect, it, vi } from 'vitest'

import type { LiveSyncNote } from '@/adapters/livesync'
import { apply, type ApplyDeps } from '@/domain/apply-orchestrator'
import type { PlanLoaders } from '@/domain/plan-builder'

const FIXED = '2026-06-01T00:00:00.000Z'

function note(docId: string, path: string, content: string): LiveSyncNote {
  return { docId, path, content, mtime: 0, size: content.length }
}

function ok(docId: string, slug: string): LiveSyncNote {
  return note(
    docId,
    `notes/blogs/${slug}.md`,
    `---\ntitle: ${slug}\ndate: 2026-01-01\ndescription: d\nslug: ${slug}\n---\nbody`,
  )
}

function makeDeps(
  overrides: Partial<ApplyDeps> & {
    notes?: Record<string, LiveSyncNote>
    existing?: Set<string>
  } = {},
): ApplyDeps & {
  __github: {
    createBranch: ReturnType<typeof vi.fn>
    deleteBranch: ReturnType<typeof vi.fn>
    commitFiles: ReturnType<typeof vi.fn>
    createPullRequest: ReturnType<typeof vi.fn>
    findExistingPrByBranch: ReturnType<typeof vi.fn>
  }
} {
  const notes = overrides.notes ?? {}
  const existing = overrides.existing ?? new Set<string>()
  const loaders: PlanLoaders = {
    readNote: async (docId) => notes[docId] ?? null,
    existsOnFohteNet: async (filename) => existing.has(filename),
  }
  const github = {
    findExistingPrByBranch: vi.fn(
      async (): Promise<BlogPrSummary | null> => null,
    ),
    createBranch: vi.fn(async (): Promise<void> => undefined),
    deleteBranch: vi.fn(async (): Promise<void> => undefined),
    commitFiles: vi.fn(async () => ({ sha: 'commit-sha' })),
    createPullRequest: vi.fn(
      async (branch: string, title: string): Promise<BlogPrSummary> => ({
        number: 42,
        url: 'https://github.com/fohte/fohte.net/pull/42',
        branch,
        state: 'open',
        title,
        createdAt: FIXED,
      }),
    ),
  }
  const deps: ApplyDeps = {
    loaders,
    imageProcessor: { uploadAll: vi.fn(async () => ({})) },
    github,
    readImage: async () => null,
    defaultBranch: 'master',
    now: () => FIXED,
    ...overrides,
  }
  return Object.assign(deps, { __github: github })
}

describe('apply', () => {
  it('success path: branch created, files committed, PR opened', async () => {
    const deps = makeDeps({ notes: { a: ok('a', 'a') } })
    const result = await apply(['a'], deps)
    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    expect(result.prNumber).toBe(42)
    expect(result.branch).toMatch(/^blog\/[0-9a-f]{12}$/)
    expect(deps.__github.createBranch).toHaveBeenCalledOnce()
    expect(deps.__github.commitFiles).toHaveBeenCalledOnce()
    expect(deps.__github.createPullRequest).toHaveBeenCalledOnce()
  })

  it('planChanged when plan has errors (e.g., FrontmatterInvalid)', async () => {
    const broken = note('x', 'notes/blogs/x.md', `---\ndate: bad\n---\n`)
    const deps = makeDeps({ notes: { x: broken } })
    const result = await apply(['x'], deps)
    expect(result.kind).toBe('planChanged')
    expect(deps.__github.createBranch).not.toHaveBeenCalled()
  })

  it('alreadyApplied when an open PR exists for the signature', async () => {
    const deps = makeDeps({ notes: { a: ok('a', 'a') } })
    deps.__github.findExistingPrByBranch.mockResolvedValueOnce({
      number: 7,
      url: 'https://example/pr/7',
      branch: 'blog/x',
      state: 'open',
      title: 't',
      createdAt: FIXED,
    } satisfies BlogPrSummary)
    const result = await apply(['a'], deps)
    expect(result.kind).toBe('alreadyApplied')
    if (result.kind !== 'alreadyApplied') return
    expect(result.prNumber).toBe(7)
    expect(deps.__github.createBranch).not.toHaveBeenCalled()
  })

  it('failed with ImageUploadFailed; branch is not created', async () => {
    const deps = makeDeps({ notes: { a: ok('a', 'a') } })
    deps.imageProcessor.uploadAll = vi
      .fn()
      .mockRejectedValue(new Error('R2 down'))
    const result = await apply(['a'], deps)
    expect(result.kind).toBe('failed')
    if (result.kind !== 'failed') return
    expect(result.code).toBe('ImageUploadFailed')
    expect(deps.__github.createBranch).not.toHaveBeenCalled()
  })

  it('rolls back branch when commitFiles fails', async () => {
    const deps = makeDeps({ notes: { a: ok('a', 'a') } })
    deps.__github.commitFiles.mockRejectedValueOnce(new Error('git boom'))
    const result = await apply(['a'], deps)
    expect(result.kind).toBe('failed')
    expect(deps.__github.deleteBranch).toHaveBeenCalledWith(
      expect.stringMatching(/^blog\/[0-9a-f]{12}$/),
    )
  })

  it('rolls back branch when createPullRequest fails', async () => {
    const deps = makeDeps({ notes: { a: ok('a', 'a') } })
    deps.__github.createPullRequest.mockRejectedValueOnce(new Error('PR boom'))
    const result = await apply(['a'], deps)
    expect(result.kind).toBe('failed')
    expect(deps.__github.deleteBranch).toHaveBeenCalled()
  })
})
