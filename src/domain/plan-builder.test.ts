import { describe, expect, it } from 'vitest'

import type { LiveSyncNote } from '@/adapters/livesync'
import {
  buildPlan,
  computeSignature,
  extractImageSourcePaths,
  type PlanLoaders,
} from '@/domain/plan-builder'

function note(docId: string, path: string, content: string): LiveSyncNote {
  return { docId, path, content, mtime: 0, size: content.length }
}

function makeLoaders(
  notes: Record<string, LiveSyncNote>,
  existing: Set<string> = new Set(),
): PlanLoaders {
  return {
    readNote: async (docId) => notes[docId] ?? null,
    existsOnFohteNet: async (filename) => existing.has(filename),
  }
}

const FIXED = '2026-06-01T00:00:00.000Z'

describe('computeSignature', () => {
  it('is order-independent (sorted)', () => {
    expect(computeSignature(['b', 'a', 'c'])).toBe(
      computeSignature(['c', 'a', 'b']),
    )
  })

  it('is 8 hex chars', () => {
    expect(computeSignature(['a', 'b'])).toMatch(/^[0-9a-f]{8}$/)
  })

  it('changes when docIds differ', () => {
    expect(computeSignature(['a'])).not.toBe(computeSignature(['b']))
  })
})

describe('extractImageSourcePaths', () => {
  it('extracts both standard and wikilink images, dedup', () => {
    const md = '![](a.png)\ntext\n![alt](b.jpg)\n![[c.png]]\n![[a.png]]'
    expect(extractImageSourcePaths(md)).toEqual(['a.png', 'b.jpg', 'c.png'])
  })
})

describe('buildPlan', () => {
  it('is deterministic for the same input', async () => {
    const n = note(
      'doc1',
      'notes/blogs/foo.md',
      `---\ntitle: Hello\ndate: 2026-01-01\ndescription: desc\n---\nbody`,
    )
    const loaders = makeLoaders({ doc1: n })
    const p1 = await buildPlan(['doc1'], loaders, { applyTime: FIXED })
    const p2 = await buildPlan(['doc1'], loaders, { applyTime: FIXED })
    expect(p1).toEqual(p2)
  })

  it('signature is independent of docId order', async () => {
    const n1 = note(
      'a',
      'notes/blogs/a.md',
      `---\ntitle: A\ndate: 2026-01-01\n---\n`,
    )
    const n2 = note(
      'b',
      'notes/blogs/b.md',
      `---\ntitle: B\ndate: 2026-01-02\n---\n`,
    )
    const loaders = makeLoaders({ a: n1, b: n2 })
    const p1 = await buildPlan(['a', 'b'], loaders, { applyTime: FIXED })
    const p2 = await buildPlan(['b', 'a'], loaders, { applyTime: FIXED })
    expect(p1.signature).toBe(p2.signature)
  })

  it('classifies missing notes as skipped', async () => {
    const loaders = makeLoaders({})
    const plan = await buildPlan(['gone'], loaders, { applyTime: FIXED })
    expect(plan.items[0]?.kind).toBe('skipped')
    expect(plan.items[0]?.skipReason).toBe('note not found')
  })

  it('marks draft as skipped', async () => {
    const n = note(
      'd',
      'notes/blogs/draft.md',
      `---\ntitle: Draft\ndate: 2026-01-01\ndraft: true\n---\n`,
    )
    const plan = await buildPlan(['d'], makeLoaders({ d: n }), {
      applyTime: FIXED,
    })
    expect(plan.items[0]?.kind).toBe('skipped')
    expect(plan.items[0]?.skipReason).toBe('draft')
  })

  it('collects FrontmatterInvalid and SlugRequired errors', async () => {
    const noTitle = note(
      'a',
      'notes/blogs/a.md',
      `---\ndate: 2026-01-01\n---\nx`,
    )
    const badDate = note(
      'b',
      'notes/blogs/b.md',
      `---\ntitle: B\ndate: not-a-date\n---\nx`,
    )
    const nonAscii = note(
      'c',
      'notes/blogs/c.md',
      `---\ntitle: 日本語タイトル\ndate: 2026-01-01\n---\nx`,
    )
    const plan = await buildPlan(
      ['a', 'b', 'c'],
      makeLoaders({
        a: noTitle,
        b: badDate,
        c: nonAscii,
      }),
      { applyTime: FIXED },
    )
    const codes = plan.errors.map((e) => e.code)
    expect(codes).toContain('FrontmatterInvalid')
    expect(codes.filter((c) => c === 'FrontmatterInvalid').length).toBe(2)
    expect(codes).toContain('SlugRequired')
  })

  it('warns when description is missing', async () => {
    const n = note(
      'd',
      'notes/blogs/x.md',
      `---\ntitle: X\ndate: 2026-01-01\n---\n`,
    )
    const plan = await buildPlan(['d'], makeLoaders({ d: n }), {
      applyTime: FIXED,
    })
    expect(plan.warnings.some((w) => w.code === 'MissingDescription')).toBe(
      true,
    )
  })

  it('marks modified when publishedFilename exists on fohte.net', async () => {
    const n = note(
      'm',
      'notes/blogs/m.md',
      `---\ntitle: M\ndate: 2026-01-01\nslug: m\n---\nx`,
    )
    const exists = new Set(['2026-01-01-m.mdx'])
    const plan = await buildPlan(['m'], makeLoaders({ m: n }, exists), {
      applyTime: FIXED,
    })
    expect(plan.items[0]?.kind).toBe('modified')
  })

  it('resolves wikilinks across the docId set; unresolved targets become errors', async () => {
    const a = note(
      'a',
      'notes/blogs/a.md',
      `---\ntitle: A\ndate: 2026-01-01\n---\nlink to [[B]] and [[missing]]\n`,
    )
    const b = note(
      'b',
      'notes/blogs/b.md',
      `---\ntitle: B\ndate: 2026-01-01\n---\nbody`,
    )
    const plan = await buildPlan(['a', 'b'], makeLoaders({ a, b }), {
      applyTime: FIXED,
    })
    const codes = plan.errors.map((e) => e.code)
    expect(codes).toContain('WikiLinkUnresolved')
    expect(plan.errors.filter((e) => /missing/.test(e.message)).length).toBe(1)
  })

  it('collects image references into imagesToUpload (dedup)', async () => {
    const n = note(
      'i',
      'notes/blogs/i.md',
      `---\ntitle: I\ndate: 2026-01-01\n---\n![](a.png)\n![](a.png)\n![[b.png]]`,
    )
    const plan = await buildPlan(['i'], makeLoaders({ i: n }), {
      applyTime: FIXED,
    })
    expect(plan.imagesToUpload.map((i) => i.sourcePath)).toEqual([
      'a.png',
      'b.png',
    ])
  })
})
