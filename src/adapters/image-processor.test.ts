import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'

import { ImageProcessor } from '@/adapters/image-processor'
import { DomainError } from '@/domain/errors'

async function makePng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 100, b: 50 },
    },
  })
    .png()
    .toBuffer()
}

function makeMockS3(
  handlers: { existing?: Set<string>; failOnPut?: string } = {},
): {
  s3: { send: ReturnType<typeof vi.fn> }
  puts: { key: string; ifNoneMatch: string | null }[]
  heads: string[]
} {
  const existing = handlers.existing ?? new Set<string>()
  const puts: { key: string; ifNoneMatch: string | null }[] = []
  const heads: string[] = []
  const send = vi.fn(async (cmd: unknown) => {
    if (cmd instanceof HeadObjectCommand) {
      const key = cmd.input.Key ?? ''
      heads.push(key)
      if (existing.has(key)) return {}
      const err: { name: string; $metadata: { httpStatusCode: number } } = {
        name: 'NotFound',
        $metadata: { httpStatusCode: 404 },
      }
      throw err
    }
    if (cmd instanceof PutObjectCommand) {
      const key = cmd.input.Key ?? ''
      const ifNone =
        typeof cmd.input.IfNoneMatch === 'string' ? cmd.input.IfNoneMatch : null
      puts.push({ key, ifNoneMatch: ifNone })
      if (handlers.failOnPut === key) {
        throw new Error('boom')
      }
      if (existing.has(key) && ifNone === '*') {
        const err: { name: string; $metadata: { httpStatusCode: number } } = {
          name: 'PreconditionFailed',
          $metadata: { httpStatusCode: 412 },
        }
        throw err
      }
      existing.add(key)
      return {}
    }
    return {}
  })
  return { s3: { send }, puts, heads }
}

describe('ImageProcessor', () => {
  it('uploads webp variants with IfNoneMatch: *', async () => {
    const { s3, puts } = makeMockS3()
    const proc = new ImageProcessor({
      bucket: 'b',
      publicBaseUrl: 'https://assets.example.com',
      variantWidths: [320, 640],
      s3: s3 as unknown as ConstructorParameters<
        typeof ImageProcessor
      >[0]['s3'],
    })
    const png = await makePng(800, 400)
    const result = await proc.uploadAll([{ sourcePath: 'a.png', buffer: png }])
    expect(puts.length).toBeGreaterThan(0)
    expect(puts.every((p) => p.ifNoneMatch === '*')).toBe(true)
    const entry = result['a.png']
    expect(entry?.base).toMatch(
      /^https:\/\/assets\.example\.com\/images\/[0-9a-f]{64}\.webp$/,
    )
    expect(entry?.variants.length).toBeGreaterThan(0)
  })

  it('skips on 412 PreconditionFailed (second upload)', async () => {
    const { s3 } = makeMockS3()
    const proc = new ImageProcessor({
      bucket: 'b',
      publicBaseUrl: 'https://assets.example.com',
      variantWidths: [320],
      s3: s3 as unknown as ConstructorParameters<
        typeof ImageProcessor
      >[0]['s3'],
    })
    const png = await makePng(800, 400)
    await proc.uploadAll([{ sourcePath: 'a.png', buffer: png }])
    // Second upload should not throw, even though objects exist.
    await expect(
      proc.uploadAll([{ sourcePath: 'a.png', buffer: png }]),
    ).resolves.toBeDefined()
  })

  it('diffExisting separates already-uploaded from new', async () => {
    const { s3 } = makeMockS3()
    const proc = new ImageProcessor({
      bucket: 'b',
      publicBaseUrl: 'https://assets.example.com',
      variantWidths: [320],
      s3: s3 as unknown as ConstructorParameters<
        typeof ImageProcessor
      >[0]['s3'],
    })
    const png1 = await makePng(800, 400)
    const png2 = await makePng(500, 500)
    await proc.uploadAll([{ sourcePath: 'a.png', buffer: png1 }])
    const diff = await proc.diffExisting([
      { sourcePath: 'a.png', buffer: png1 },
      { sourcePath: 'b.png', buffer: png2 },
    ])
    expect(diff.alreadyUploaded.map((i) => i.sourcePath)).toContain('a.png')
    expect(diff.toUpload.map((i) => i.sourcePath)).toContain('b.png')
  })

  it('throws ImageUploadFailed on non-412 errors', async () => {
    const png = await makePng(800, 400)
    const webp = await sharp(png).webp().toBuffer()
    const { createHash } = await import('node:crypto')
    const hash = createHash('sha256').update(webp).digest('hex')
    const baseKey = `images/${hash}.webp`
    const { s3 } = makeMockS3({ failOnPut: baseKey })
    const proc = new ImageProcessor({
      bucket: 'b',
      publicBaseUrl: 'https://assets.example.com',
      variantWidths: [],
      s3: s3 as unknown as ConstructorParameters<
        typeof ImageProcessor
      >[0]['s3'],
    })
    await expect(
      proc.uploadAll([{ sourcePath: 'a.png', buffer: png }]),
    ).rejects.toBeInstanceOf(DomainError)
  })
})
