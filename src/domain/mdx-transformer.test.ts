import { describe, expect, it } from 'vitest'

import {
  type ImageUrlMap,
  transformMarkdownToMdx,
} from '@/domain/mdx-transformer'

const emptyMap: ImageUrlMap = {}
const noResolver = () => null

describe('transformMarkdownToMdx', () => {
  it('resolves wikilinks via resolver', () => {
    const r = transformMarkdownToMdx({
      markdown: 'See [[Other Post]] for details.',
      imageMap: emptyMap,
      resolveSlug: (t) => (t === 'Other Post' ? 'other-post' : null),
    })
    expect(r.errors).toEqual([])
    expect(r.mdx).toContain('[Other Post](/blog/posts/other-post)')
  })

  it('records error for unresolved wikilink', () => {
    const r = transformMarkdownToMdx({
      markdown: 'See [[Missing]] now.',
      imageMap: emptyMap,
      resolveSlug: noResolver,
    })
    expect(r.errors.some((e) => e.code === 'WikiLinkUnresolved')).toBe(true)
  })

  it('uses alias text for wikilinks', () => {
    const r = transformMarkdownToMdx({
      markdown: '[[Page|displayed]]',
      imageMap: emptyMap,
      resolveSlug: () => 'page',
    })
    expect(r.mdx).toContain('[displayed](/blog/posts/page)')
  })

  it('converts embed code block to CardLink', () => {
    const r = transformMarkdownToMdx({
      markdown: '```embed\nhttps://example.com\n```\n',
      imageMap: emptyMap,
      resolveSlug: noResolver,
    })
    expect(r.mdx).toContain('<CardLink href="https://example.com" />')
  })

  it('converts <kbd> html to <Kbd>', () => {
    const r = transformMarkdownToMdx({
      markdown: 'Press <kbd>Ctrl</kbd> now.',
      imageMap: emptyMap,
      resolveSlug: noResolver,
    })
    expect(r.mdx).toContain('<Kbd>Ctrl</Kbd>')
  })

  it('converts SpeakerDeck iframe', () => {
    const r = transformMarkdownToMdx({
      markdown:
        '<iframe src="https://speakerdeck.com/player/abc123def" frameborder="0"></iframe>',
      imageMap: emptyMap,
      resolveSlug: noResolver,
    })
    expect(r.mdx).toContain('<SpeakerDeck id="abc123def"')
  })

  it('does not wrap single image in ImageGrid', () => {
    const r = transformMarkdownToMdx({
      markdown: '![a](/a.png)\n',
      imageMap: emptyMap,
      resolveSlug: noResolver,
    })
    expect(r.mdx).not.toContain('<ImageGrid')
  })

  it('wraps consecutive images in ImageGrid', () => {
    const r = transformMarkdownToMdx({
      markdown: '![a](/a.png)\n![b](/b.png)\n',
      imageMap: emptyMap,
      resolveSlug: noResolver,
    })
    expect(r.mdx).toContain('<ImageGrid>')
  })

  it('replaces image URLs via imageMap', () => {
    const r = transformMarkdownToMdx({
      markdown: '![a](local.png)\n',
      imageMap: {
        'local.png': {
          base: 'https://assets.fohte.net/images/abc.webp',
          variants: [
            {
              width: 1280,
              height: 720,
              url: 'https://assets.fohte.net/images/abc-1280x720.webp',
            },
          ],
        },
      },
      resolveSlug: noResolver,
    })
    expect(r.mdx).toContain('https://assets.fohte.net/images/abc.webp?w=1280')
  })

  it('converts ![[image]] embed to image', () => {
    const r = transformMarkdownToMdx({
      markdown: '![[my.png]]\n',
      imageMap: {
        'my.png': {
          base: 'https://assets.fohte.net/images/x.webp',
          variants: [{ width: 100, height: 50, url: 'x' }],
        },
      },
      resolveSlug: noResolver,
    })
    expect(r.mdx).toContain('https://assets.fohte.net/images/x.webp')
  })

  it('preserves wikilinks inside fenced code blocks and inline code', () => {
    const r = transformMarkdownToMdx({
      markdown:
        'Use `[[Page]]` to link.\n\n```text\n[[ExamplePage]]\n```\n',
      imageMap: emptyMap,
      resolveSlug: () => null,
    })
    expect(r.errors).toEqual([])
    expect(r.mdx).toContain('`[[Page]]`')
    expect(r.mdx).toContain('[[ExamplePage]]')
  })

  it('detects callout as error', () => {
    const r = transformMarkdownToMdx({
      markdown: '> [!note]\n> body\n',
      imageMap: emptyMap,
      resolveSlug: noResolver,
    })
    expect(r.errors.some((e) => e.code === 'UnsupportedSyntax')).toBe(true)
  })

  it('detects dataview as error', () => {
    const r = transformMarkdownToMdx({
      markdown: '```dataview\nlist\n```\n',
      imageMap: emptyMap,
      resolveSlug: noResolver,
    })
    expect(r.errors.some((e) => e.code === 'UnsupportedSyntax')).toBe(true)
  })
})
