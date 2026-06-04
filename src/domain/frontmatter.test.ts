import { describe, expect, it } from 'vitest'

import {
  deriveSlug,
  generatePublishedFilename,
  mapToPublishedFrontmatter,
  parseFrontmatter,
  sanitizeSlug,
  validateFrontmatter,
} from '@/domain/frontmatter'

describe('parseFrontmatter', () => {
  it('parses minimal frontmatter', () => {
    const { frontmatter, body } = parseFrontmatter(
      '---\ntitle: Hello\n---\nbody',
    )
    expect(frontmatter.title).toBe('Hello')
    expect(body.trim()).toBe('body')
  })

  it('parses full frontmatter', () => {
    const src = `---
title: Full
date: 2025-01-02T03:04:05+09:00
updatedDate: 2025-02-03T00:00:00Z
description: desc
tags:
  - a
  - b
imagePath: /img.png
slug: full-slug
publishedFilename: 2025-01-02-full-slug.mdx
draft: false
---
content`
    const { frontmatter } = parseFrontmatter(src)
    expect(frontmatter).toMatchObject({
      title: 'Full',
      date: '2025-01-02T03:04:05+09:00',
      updatedDate: '2025-02-03T00:00:00Z',
      description: 'desc',
      tags: ['a', 'b'],
      imagePath: '/img.png',
      slug: 'full-slug',
      publishedFilename: '2025-01-02-full-slug.mdx',
      draft: false,
    })
  })
})

describe('validateFrontmatter', () => {
  it('passes ASCII title with no slug', () => {
    expect(validateFrontmatter({ title: 'Hello' })).toEqual([])
  })

  it('detects missing title', () => {
    expect(validateFrontmatter({ title: '' })[0]?.code).toBe('TitleMissing')
  })

  it('detects invalid date', () => {
    expect(
      validateFrontmatter({ title: 'a', date: 'not-a-date' })[0]?.code,
    ).toBe('DateInvalid')
  })

  it('detects non-ASCII title without slug', () => {
    expect(validateFrontmatter({ title: '日本語' })[0]?.code).toBe(
      'SlugRequired',
    )
  })

  it('accepts non-ASCII title with slug', () => {
    expect(validateFrontmatter({ title: '日本語', slug: 'ja' })).toEqual([])
  })
})

describe('sanitizeSlug', () => {
  it('lowercases and replaces non-alnum with hyphen', () => {
    expect(sanitizeSlug('Hello World!')).toBe('hello-world')
    expect(sanitizeSlug('-A--B-')).toBe('a-b')
  })
})

describe('deriveSlug', () => {
  it('uses slug when present', () => {
    expect(deriveSlug({ title: '日本語', slug: 'ja' })).toBe('ja')
  })

  it('derives from ASCII title', () => {
    expect(deriveSlug({ title: 'Hello World' })).toBe('hello-world')
  })

  it('returns null for non-ASCII title without slug', () => {
    expect(deriveSlug({ title: '日本語' })).toBeNull()
  })
})

describe('generatePublishedFilename', () => {
  it('prefers publishedFilename when set', () => {
    expect(
      generatePublishedFilename(
        {
          title: 'X',
          date: '2025-01-02',
          publishedFilename: '2024-12-31-old.mdx',
        },
        { applyTime: '2025-01-02T00:00:00Z' },
      ),
    ).toBe('2024-12-31-old.mdx')
  })

  it('derives from slug + date', () => {
    expect(
      generatePublishedFilename(
        { title: '日本語', date: '2025-03-04', slug: 'ja-post' },
        { applyTime: '2025-03-04T00:00:00Z' },
      ),
    ).toBe('2025-03-04-ja-post.mdx')
  })

  it('derives from ASCII title when slug omitted', () => {
    expect(
      generatePublishedFilename(
        { title: 'Hello World', date: '2025-03-04' },
        { applyTime: '2025-03-04T00:00:00Z' },
      ),
    ).toBe('2025-03-04-hello-world.mdx')
  })

  it('uses applyTime when date omitted', () => {
    expect(
      generatePublishedFilename(
        { title: 'a' },
        { applyTime: '2025-05-06T01:02:03Z' },
      ),
    ).toBe('2025-05-06-a.mdx')
  })

  it('throws on non-ASCII title without slug', () => {
    expect(() =>
      generatePublishedFilename(
        { title: '日本語' },
        { applyTime: '2025-01-01T00:00:00Z' },
      ),
    ).toThrow()
  })
})

describe('mapToPublishedFrontmatter', () => {
  it('keeps required fields, drops obsidian-only fields', () => {
    const out = mapToPublishedFrontmatter(
      {
        title: 'T',
        date: '2025-01-01',
        description: 'd',
        tags: ['a'],
        imagePath: '/i.png',
        slug: 's',
        publishedFilename: 'f.mdx',
        draft: false,
      },
      { applyTime: '2025-06-01T00:00:00Z', isUpdate: false },
    )
    expect(out).toEqual({
      title: 'T',
      date: '2025-01-01',
      description: 'd',
      tags: ['a'],
      imagePath: '/i.png',
    })
  })

  it('sets updatedDate to applyTime on update', () => {
    const out = mapToPublishedFrontmatter(
      { title: 'T', date: '2025-01-01' },
      { applyTime: '2025-06-01T00:00:00Z', isUpdate: true },
    )
    expect(out.updatedDate).toBe('2025-06-01T00:00:00Z')
  })

  it('uses applyTime when date missing', () => {
    const out = mapToPublishedFrontmatter(
      { title: 'T' },
      { applyTime: '2025-06-01T00:00:00Z', isUpdate: false },
    )
    expect(out.date).toBe('2025-06-01T00:00:00Z')
  })
})
