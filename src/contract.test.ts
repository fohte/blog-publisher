import { describe, expect, it } from 'vitest'

import {
  ApplyResult,
  BlogPrSummary,
  CiStatus,
  Note,
  Plan,
  PlanItem,
  PlanRequest,
} from '#contract'

describe('Note', () => {
  it('parses a note with required and optional fields', () => {
    const note = {
      docId: 'note:abc',
      path: 'posts/hello.md',
      title: 'Hello',
      description: 'A greeting',
      kind: 'new',
      mtime: 1700000000,
    }
    expect(Note.parse(note)).toEqual(note)
  })

  it('rejects an unknown kind', () => {
    const result = Note.safeParse({
      docId: 'note:abc',
      path: 'posts/hello.md',
      title: 'Hello',
      kind: 'archived',
      mtime: 1700000000,
    })
    expect(result.success).toBe(false)
  })
})

describe('PlanRequest', () => {
  it('parses a request with at least one docId', () => {
    expect(PlanRequest.parse({ docIds: ['note:abc'] })).toEqual({
      docIds: ['note:abc'],
    })
  })

  it('rejects an empty docIds array', () => {
    const result = PlanRequest.safeParse({ docIds: [] })
    expect(result.success).toBe(false)
  })
})

describe('PlanItem', () => {
  it('parses an item without the optional diffStat and skipReason', () => {
    const item = {
      docId: 'note:abc',
      kind: 'added',
      slug: 'hello',
      publishedFilename: 'hello.mdx',
      title: 'Hello',
      summary: 'A greeting',
    }
    expect(PlanItem.parse(item)).toEqual(item)
  })

  it('rejects a non-numeric diffStat field', () => {
    const result = PlanItem.safeParse({
      docId: 'note:abc',
      kind: 'modified',
      slug: 'hello',
      publishedFilename: 'hello.mdx',
      title: 'Hello',
      summary: 'A greeting',
      diffStat: { added: '3', removed: 1 },
    })
    expect(result.success).toBe(false)
  })
})

describe('Plan', () => {
  const validPlan = {
    signature: 'a1b2c3d4',
    items: [
      {
        docId: 'note:abc',
        kind: 'added',
        slug: 'hello',
        publishedFilename: 'hello.mdx',
        title: 'Hello',
        summary: 'A greeting',
      },
    ],
    warnings: [],
    errors: [
      { docId: 'note:abc', code: 'SlugMissing', message: 'slug is missing' },
    ],
    imagesToUpload: [
      { sourcePath: 'images/x.webp', hash: 'deadbeef', alreadyUploaded: false },
    ],
  }

  it('parses a plan with items, issues, and images', () => {
    expect(Plan.parse(validPlan)).toEqual(validPlan)
  })

  it('rejects a plan missing the signature', () => {
    const result = Plan.safeParse({
      items: validPlan.items,
      warnings: validPlan.warnings,
      errors: validPlan.errors,
      imagesToUpload: validPlan.imagesToUpload,
    })
    expect(result.success).toBe(false)
  })
})

describe('ApplyResult', () => {
  it('parses the success variant', () => {
    const success = {
      kind: 'success',
      prNumber: 42,
      prUrl: 'https://github.com/fohte/fohte.net/pull/42',
      branch: 'blog/a1b2c3d4',
    }
    expect(ApplyResult.parse(success)).toEqual(success)
  })

  it('parses the planChanged variant with a nested Plan', () => {
    const planChanged = {
      kind: 'planChanged',
      newPlan: {
        signature: 'a1b2c3d4',
        items: [],
        warnings: [],
        errors: [],
        imagesToUpload: [],
      },
    }
    expect(ApplyResult.parse(planChanged)).toEqual(planChanged)
  })

  it('rejects an unknown kind', () => {
    const result = ApplyResult.safeParse({ kind: 'unknown' })
    expect(result.success).toBe(false)
  })

  it('rejects a success variant missing prNumber', () => {
    const result = ApplyResult.safeParse({
      kind: 'success',
      prUrl: 'https://github.com/fohte/fohte.net/pull/42',
      branch: 'blog/a1b2c3d4',
    })
    expect(result.success).toBe(false)
  })
})

describe('BlogPrSummary', () => {
  it('parses a summary without the optional mergedAt', () => {
    const summary = {
      number: 42,
      url: 'https://github.com/fohte/fohte.net/pull/42',
      branch: 'blog/a1b2c3d4',
      state: 'open',
      title: 'Publish hello',
      createdAt: '2026-05-19T00:00:00Z',
    }
    expect(BlogPrSummary.parse(summary)).toEqual(summary)
  })

  it('rejects an unknown state', () => {
    const result = BlogPrSummary.safeParse({
      number: 42,
      url: 'https://github.com/fohte/fohte.net/pull/42',
      branch: 'blog/a1b2c3d4',
      state: 'merged',
      title: 'Publish hello',
      createdAt: '2026-05-19T00:00:00Z',
    })
    expect(result.success).toBe(false)
  })
})

describe('CiStatus', () => {
  it('parses a status with failed checks and a preview URL', () => {
    const status = {
      state: 'failure',
      failedChecks: ['build', 'lint'],
      previewUrl: 'https://preview.fohte.net',
    }
    expect(CiStatus.parse(status)).toEqual(status)
  })

  it('rejects a non-array failedChecks', () => {
    const result = CiStatus.safeParse({
      state: 'pending',
      failedChecks: 'build',
    })
    expect(result.success).toBe(false)
  })
})
