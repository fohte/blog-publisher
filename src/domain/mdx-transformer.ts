import type { BlockContent, Code, Image, Paragraph, Root } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { mdxJsxFromMarkdown, mdxJsxToMarkdown } from 'mdast-util-mdx-jsx'
import { toMarkdown } from 'mdast-util-to-markdown'
import { mdxJsx as mdxJsxMicromark } from 'micromark-extension-mdx-jsx'
import { SKIP, visit } from 'unist-util-visit'

import type { ErrorCode } from '@/domain/errors'

export interface ImageVariant {
  width: number
  height: number
  url: string
}

export interface ImageMapEntry {
  base: string
  variants: ImageVariant[]
}

export type ImageUrlMap = Record<string, ImageMapEntry>

export type SlugResolver = (target: string) => string | null

export interface TransformIssue {
  code: ErrorCode
  message: string
}

export interface TransformInput {
  markdown: string
  imageMap: ImageUrlMap
  resolveSlug: SlugResolver
}

export interface TransformResult {
  mdx: string
  errors: TransformIssue[]
  warnings: TransformIssue[]
}

interface MdxJsxAttribute {
  type: 'mdxJsxAttribute'
  name: string
  value: string | null
}

interface MdxJsxFlowElement {
  type: 'mdxJsxFlowElement'
  name: string | null
  attributes: MdxJsxAttribute[]
  children: BlockContent[]
}

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
const EMBED_IMAGE_RE = /!\[\[([^\]]+)\]\]/g
const SPEAKERDECK_RE =
  /<iframe[^>]+src=["']https:\/\/speakerdeck\.com\/player\/([a-f0-9]+)["'][^>]*><\/iframe>/i

function attr(name: string, value: string | null): MdxJsxAttribute {
  return { type: 'mdxJsxAttribute', name, value }
}

function preprocessObsidianSyntax(
  markdown: string,
  resolveSlug: SlugResolver,
  errors: TransformIssue[],
): string {
  let out = markdown.replace(EMBED_IMAGE_RE, (_m, target: string) => {
    return `![${target}](${target})`
  })
  out = out.replace(WIKILINK_RE, (_m, target: string, label?: string) => {
    const slug = resolveSlug(target)
    const text = label ?? target
    if (slug === null) {
      errors.push({
        code: 'WikiLinkUnresolved',
        message: `wikilink cannot be resolved: ${target}`,
      })
      return `[[${target}${label !== undefined ? `|${label}` : ''}]]`
    }
    return `[${text}](/blog/posts/${slug})`
  })
  return out
}

function buildImageNode(
  alt: string,
  url: string,
  width?: number,
  height?: number,
): Image {
  const withQuery =
    width !== undefined && height !== undefined
      ? `${url}?w=${String(width)}&h=${String(height)}`
      : url
  return {
    type: 'image',
    url: withQuery,
    alt,
  }
}

function replaceImageUrls(tree: Root, imageMap: ImageUrlMap): void {
  visit(tree, 'image', (node: Image) => {
    const entry = imageMap[node.url]
    if (entry === undefined) return
    const v = entry.variants[0]
    if (v !== undefined) {
      node.url = `${entry.base}?w=${String(v.width)}&h=${String(v.height)}`
    } else {
      node.url = entry.base
    }
  })
}

function transformKbdInline(tree: Root): void {
  visit(tree, (node) => {
    const n = node as { type: string; name?: string | null }
    if (n.type === 'mdxJsxTextElement' && n.name === 'kbd') {
      n.name = 'Kbd'
    }
  })
}

function transformSpeakerDeck(tree: Root): void {
  visit(tree, (node) => {
    if (node.type === 'html') {
      const m = SPEAKERDECK_RE.exec(node.value)
      if (m === null) return
      const id = m[1] ?? ''
      const n = node as unknown as MdxJsxFlowElement
      n.type = 'mdxJsxFlowElement'
      n.name = 'SpeakerDeck'
      n.attributes = [attr('id', id)]
      n.children = []
      return
    }
    if (
      node.type === 'mdxJsxFlowElement' ||
      node.type === 'mdxJsxTextElement'
    ) {
      const el = node as unknown as MdxJsxFlowElement
      if (el.name !== 'iframe') return
      const srcAttr = el.attributes.find(
        (a) => a.type === 'mdxJsxAttribute' && a.name === 'src',
      )
      const src = typeof srcAttr?.value === 'string' ? srcAttr.value : null
      if (src === null) return
      const m = /^https:\/\/speakerdeck\.com\/player\/([a-f0-9]+)/.exec(src)
      if (m === null) return
      el.name = 'SpeakerDeck'
      el.attributes = [attr('id', m[1] ?? '')]
      el.children = []
    }
  })
}

function transformEmbedCodeBlocks(tree: Root, errors: TransformIssue[]): void {
  visit(tree, 'code', (node: Code, index, parent) => {
    if (node.lang === 'dataview') {
      errors.push({
        code: 'UnsupportedSyntax',
        message: 'dataview code block is not supported',
      })
      return
    }
    if (node.lang !== 'embed') return
    const url = node.value.trim()
    if (parent === undefined || index === undefined) return
    const el: MdxJsxFlowElement = {
      type: 'mdxJsxFlowElement',
      name: 'CardLink',
      attributes: [attr('href', url)],
      children: [],
    }
    ;(parent as unknown as { children: unknown[] }).children.splice(
      index,
      1,
      el,
    )
    return [SKIP, index + 1]
  })
}

function detectCallout(tree: Root, errors: TransformIssue[]): void {
  visit(tree, 'blockquote', (node) => {
    const first = node.children[0]
    if (first === undefined || first.type !== 'paragraph') return
    const t = first.children[0]
    if (t !== undefined && t.type === 'text') {
      if (/^\s*\[![\w-]+\]/.test(t.value)) {
        errors.push({
          code: 'UnsupportedSyntax',
          message: 'Obsidian callout is not supported',
        })
      }
    }
  })
}

function isImageOnlyParagraph(p: Paragraph): boolean {
  const imgs = p.children.filter((c) => c.type === 'image')
  if (imgs.length < 2) return false
  return p.children.every(
    (c) => c.type === 'image' || (c.type === 'text' && c.value.trim() === ''),
  )
}

function wrapImageGrids(tree: Root): void {
  const children = tree.children
  for (let i = 0; i < children.length; i++) {
    const node = children[i]
    if (node === undefined || node.type !== 'paragraph') continue
    if (!isImageOnlyParagraph(node)) continue
    const imgs = node.children.filter((c): c is Image => c.type === 'image')
    const el: MdxJsxFlowElement = {
      type: 'mdxJsxFlowElement',
      name: 'ImageGrid',
      attributes: [],
      children: imgs.map((img) => ({
        type: 'paragraph',
        children: [img],
      })) as unknown as BlockContent[],
    }
    children[i] = el
  }
}

export function transformMarkdownToMdx(input: TransformInput): TransformResult {
  const errors: TransformIssue[] = []
  const warnings: TransformIssue[] = []

  const preprocessed = preprocessObsidianSyntax(
    input.markdown,
    input.resolveSlug,
    errors,
  )

  const tree = fromMarkdown(preprocessed, {
    extensions: [mdxJsxMicromark()],
    mdastExtensions: [mdxJsxFromMarkdown()],
  })

  // Order matters per design: images first, then kbd, SpeakerDeck, CardLink, callout/dataview detect, then ImageGrid wrap last.
  replaceImageUrls(tree, input.imageMap)
  transformKbdInline(tree)
  transformSpeakerDeck(tree)
  transformEmbedCodeBlocks(tree, errors)
  detectCallout(tree, errors)
  wrapImageGrids(tree)

  const mdx = toMarkdown(tree, {
    extensions: [mdxJsxToMarkdown()],
    bullet: '-',
  })

  void buildImageNode

  return { mdx, errors, warnings }
}
