import matter from 'gray-matter'
import yaml from 'js-yaml'

import { DomainError } from '@/domain/errors'

const FAILSAFE_YAML = {
  parse: (input: string): object => {
    const loaded: unknown = yaml.load(input, { schema: yaml.JSON_SCHEMA })
    return typeof loaded === 'object' && loaded !== null ? loaded : {}
  },
  stringify: (input: object) => yaml.dump(input),
}

export interface Frontmatter {
  title: string
  date?: string
  updatedDate?: string
  description?: string
  tags?: string[]
  imagePath?: string
  slug?: string
  publishedFilename?: string
  draft?: boolean
}

export interface PublishedFrontmatter {
  title: string
  date: string
  updatedDate?: string
  description?: string
  tags?: string[]
  imagePath?: string
}

export interface FrontmatterParseResult {
  frontmatter: Frontmatter
  body: string
}

export interface FrontmatterIssue {
  code: 'TitleMissing' | 'DateInvalid' | 'SlugRequired'
  message: string
}

const ISO_8601 =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/

const ASCII_ONLY = /^[\x20-\x7E]+$/

export function parseFrontmatter(source: string): FrontmatterParseResult {
  const parsed = matter(source, { engines: { yaml: FAILSAFE_YAML } })
  const data = parsed.data as Record<string, unknown>
  const fm: Frontmatter = {
    title: typeof data['title'] === 'string' ? data['title'] : '',
  }
  if (typeof data['date'] === 'string') fm.date = data['date']
  else if (data['date'] instanceof Date) fm.date = data['date'].toISOString()
  if (typeof data['updatedDate'] === 'string')
    fm.updatedDate = data['updatedDate']
  else if (data['updatedDate'] instanceof Date)
    fm.updatedDate = data['updatedDate'].toISOString()
  if (typeof data['description'] === 'string')
    fm.description = data['description']
  if (Array.isArray(data['tags']))
    fm.tags = data['tags'].filter((t): t is string => typeof t === 'string')
  if (typeof data['imagePath'] === 'string') fm.imagePath = data['imagePath']
  if (typeof data['slug'] === 'string') fm.slug = data['slug']
  if (typeof data['publishedFilename'] === 'string')
    fm.publishedFilename = data['publishedFilename']
  if (typeof data['draft'] === 'boolean') fm.draft = data['draft']
  return { frontmatter: fm, body: parsed.content }
}

export function validateFrontmatter(fm: Frontmatter): FrontmatterIssue[] {
  const issues: FrontmatterIssue[] = []
  if (fm.title === '') {
    issues.push({ code: 'TitleMissing', message: 'title is required' })
  }
  if (fm.date !== undefined && !ISO_8601.test(fm.date)) {
    issues.push({
      code: 'DateInvalid',
      message: `date is not ISO 8601: ${fm.date}`,
    })
  }
  if (fm.title !== '' && !ASCII_ONLY.test(fm.title) && fm.slug === undefined) {
    issues.push({
      code: 'SlugRequired',
      message: 'slug is required when title contains non-ASCII characters',
    })
  }
  return issues
}

export function mapToPublishedFrontmatter(
  fm: Frontmatter,
  options: { applyTime: string; isUpdate: boolean },
): PublishedFrontmatter {
  const published: PublishedFrontmatter = {
    title: fm.title,
    date: fm.date ?? options.applyTime,
  }
  if (options.isUpdate) {
    published.updatedDate = options.applyTime
  } else if (fm.updatedDate !== undefined) {
    published.updatedDate = fm.updatedDate
  }
  if (fm.description !== undefined) published.description = fm.description
  if (fm.tags !== undefined && fm.tags.length > 0) published.tags = fm.tags
  if (fm.imagePath !== undefined) published.imagePath = fm.imagePath
  return published
}

export function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function deriveSlug(fm: Frontmatter): string | null {
  if (fm.slug !== undefined && fm.slug !== '') return sanitizeSlug(fm.slug)
  if (ASCII_ONLY.test(fm.title)) return sanitizeSlug(fm.title)
  return null
}

export function generatePublishedFilename(
  fm: Frontmatter,
  options: { applyTime: string },
): string {
  if (fm.publishedFilename !== undefined && fm.publishedFilename !== '') {
    return fm.publishedFilename
  }
  const slug = deriveSlug(fm)
  if (slug === null) {
    throw new DomainError(
      'SlugRequired',
      'cannot derive slug: non-ASCII title without slug',
    )
  }
  const datePart = (fm.date ?? options.applyTime).slice(0, 10)
  return `${datePart}-${slug}.mdx`
}
