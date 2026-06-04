import { createHash } from 'node:crypto'

import type { Plan, PlanIssue, PlanItem } from '@fohte/blog-publisher-contract'

import type { LiveSyncNote } from '@/adapters/livesync'
import {
  deriveSlug,
  type Frontmatter,
  generatePublishedFilename,
  parseFrontmatter,
  validateFrontmatter,
} from '@/domain/frontmatter'
import {
  type SlugResolver,
  transformMarkdownToMdx,
} from '@/domain/mdx-transformer'

export interface PlanLoaders {
  readNote(docId: string): Promise<LiveSyncNote | null>
  existsOnFohteNet(filename: string): Promise<boolean>
}

export interface BuildPlanOptions {
  /** Stable timestamp used when frontmatter omits `date`. Tests pass a fixed value for determinism. */
  applyTime?: string
}

interface ParsedNote {
  docId: string
  note: LiveSyncNote | null
  frontmatter?: Frontmatter
  body?: string
  slug?: string
  publishedFilename?: string
  parseFailed?: boolean
}

export function computeSignature(docIds: readonly string[]): string {
  const sorted = [...docIds].sort()
  return createHash('sha1').update(sorted.join('\n')).digest('hex').slice(0, 12)
}

const DEFAULT_APPLY_TIME = '1970-01-01T00:00:00.000Z'

export function extractImageSourcePaths(markdown: string): string[] {
  const out = new Set<string>()
  const md = /!\[[^\]]*\]\(([^)\s]+)\)/g
  let m: RegExpExecArray | null
  while ((m = md.exec(markdown)) !== null) {
    if (m[1] !== undefined) out.add(m[1])
  }
  const wiki = /!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g
  while ((m = wiki.exec(markdown)) !== null) {
    if (m[1] !== undefined) out.add(m[1])
  }
  return [...out]
}

function noteBaseName(path: string): string {
  return path.replace(/^.*\//, '').replace(/\.[^.]+$/, '')
}

function summarize(fm: Frontmatter, body: string): string {
  if (fm.description !== undefined && fm.description !== '')
    return fm.description
  const trimmed = body.trim().replace(/\s+/g, ' ').slice(0, 120)
  return trimmed
}

export async function buildPlan(
  docIds: readonly string[],
  loaders: PlanLoaders,
  options: BuildPlanOptions = {},
): Promise<Plan> {
  const signature = computeSignature(docIds)
  const applyTime = options.applyTime ?? DEFAULT_APPLY_TIME
  const sorted = [...docIds].sort()

  const parsed: ParsedNote[] = await Promise.all(
    sorted.map(async (docId): Promise<ParsedNote> => {
      const note = await loaders.readNote(docId)
      if (note === null) {
        return { docId, note: null }
      }
      try {
        const { frontmatter, body } = parseFrontmatter(note.content)
        const slug = deriveSlug(frontmatter) ?? ''
        let publishedFilename = ''
        try {
          publishedFilename = generatePublishedFilename(frontmatter, {
            applyTime,
          })
        } catch {
          publishedFilename = ''
        }
        return { docId, note, frontmatter, body, slug, publishedFilename }
      } catch {
        return { docId, note, parseFailed: true }
      }
    }),
  )

  const slugByKey = new Map<string, string>()
  for (const p of parsed) {
    if (
      p.frontmatter === undefined ||
      p.slug === undefined ||
      p.slug === '' ||
      p.note === null
    )
      continue
    slugByKey.set(p.frontmatter.title, p.slug)
    slugByKey.set(noteBaseName(p.note.path), p.slug)
  }
  const resolveSlug: SlugResolver = (target) => slugByKey.get(target) ?? null

  const items: PlanItem[] = []
  const warnings: PlanIssue[] = []
  const errors: PlanIssue[] = []
  const imagesToUpload: Plan['imagesToUpload'] = []
  const seenImages = new Set<string>()

  for (const p of parsed) {
    if (p.note === null) {
      items.push({
        docId: p.docId,
        kind: 'skipped',
        slug: '',
        publishedFilename: '',
        title: '',
        summary: '',
        skipReason: 'note not found',
      })
      continue
    }
    if (p.parseFailed === true || p.frontmatter === undefined) {
      errors.push({
        docId: p.docId,
        code: 'UnsupportedSyntax',
        message: 'failed to parse frontmatter',
      })
      items.push({
        docId: p.docId,
        kind: 'skipped',
        slug: '',
        publishedFilename: '',
        title: '',
        summary: '',
        skipReason: 'frontmatter parse failed',
      })
      continue
    }

    const fm = p.frontmatter
    if (fm.draft === true) {
      items.push({
        docId: p.docId,
        kind: 'skipped',
        slug: p.slug ?? '',
        publishedFilename: p.publishedFilename ?? '',
        title: fm.title,
        summary: summarize(fm, p.body ?? ''),
        skipReason: 'draft',
      })
      continue
    }

    const fmIssues = validateFrontmatter(fm)
    for (const issue of fmIssues) {
      errors.push({
        docId: p.docId,
        code:
          issue.code === 'TitleMissing' || issue.code === 'DateInvalid'
            ? 'FrontmatterInvalid'
            : issue.code,
        message: issue.message,
      })
    }
    if (fm.description === undefined || fm.description === '') {
      warnings.push({
        docId: p.docId,
        code: 'MissingDescription',
        message: 'description is missing',
      })
    }

    const transform = transformMarkdownToMdx({
      markdown: p.body ?? '',
      imageMap: {},
      resolveSlug,
    })
    for (const e of transform.errors) {
      errors.push({ docId: p.docId, code: e.code, message: e.message })
    }
    for (const w of transform.warnings) {
      warnings.push({ docId: p.docId, code: w.code, message: w.message })
    }

    for (const ref of extractImageSourcePaths(p.body ?? '')) {
      if (seenImages.has(ref)) continue
      seenImages.add(ref)
      imagesToUpload.push({ sourcePath: ref, hash: '', alreadyUploaded: false })
    }

    let kind: PlanItem['kind'] = 'added'
    if (p.publishedFilename !== undefined && p.publishedFilename !== '') {
      const exists = await loaders.existsOnFohteNet(p.publishedFilename)
      kind = exists ? 'modified' : 'added'
      if (fm.publishedFilename !== undefined && !exists) {
        errors.push({
          docId: p.docId,
          code: 'PublishedFileMissing',
          message: `publishedFilename ${p.publishedFilename} not found on fohte.net`,
        })
      }
    }

    items.push({
      docId: p.docId,
      kind,
      slug: p.slug ?? '',
      publishedFilename: p.publishedFilename ?? '',
      title: fm.title,
      summary: summarize(fm, p.body ?? ''),
    })
  }

  return { signature, items, warnings, errors, imagesToUpload }
}
