import { createHash } from 'node:crypto'

import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import sharp from 'sharp'

import { DomainError } from '@/domain/errors'
import type {
  ImageMapEntry as ImageUrlMapEntry,
  ImageUrlMap,
  ImageVariant as ImageVariantUrl,
} from '@/domain/mdx-transformer'

export type { ImageUrlMap, ImageUrlMapEntry, ImageVariantUrl }

export interface ImageInput {
  sourcePath: string
  buffer: Buffer
}

export interface DiffResult {
  toUpload: ImageInput[]
  alreadyUploaded: ImageInput[]
}

export interface ImageProcessorConfig {
  bucket: string
  publicBaseUrl: string
  variantWidths: number[]
  s3: S3Client
}

interface VariantPlan {
  width: number
  height: number
  key: string
  buffer: Buffer
}

interface ImagePlan {
  sourcePath: string
  hash: string
  baseKey: string
  baseBuffer: Buffer
  variants: VariantPlan[]
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

export class ImageProcessor {
  constructor(private readonly config: ImageProcessorConfig) {}

  private async planVariants(input: ImageInput): Promise<ImagePlan> {
    const baseBuffer = await sharp(input.buffer).webp().toBuffer()
    const hash = sha256(baseBuffer)
    const baseKey = `images/${hash}.webp`
    const metadata = await sharp(baseBuffer).metadata()
    const originalWidth = metadata.width ?? 0
    const originalHeight = metadata.height ?? 0
    const variants: VariantPlan[] = []
    for (const w of this.config.variantWidths) {
      if (originalWidth > 0 && w >= originalWidth) continue
      const resized = await sharp(input.buffer)
        .resize({ width: w })
        .webp()
        .toBuffer()
      const m = await sharp(resized).metadata()
      const height = m.height ?? 0
      const key = `images/${hash}-${String(w)}x${String(height)}.webp`
      variants.push({ width: w, height, key, buffer: resized })
    }
    if (variants.length === 0 && originalWidth > 0) {
      variants.push({
        width: originalWidth,
        height: originalHeight,
        key: baseKey,
        buffer: baseBuffer,
      })
    }
    return {
      sourcePath: input.sourcePath,
      hash,
      baseKey,
      baseBuffer,
      variants,
    }
  }

  private async objectExists(key: string): Promise<boolean> {
    try {
      await this.config.s3.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      )
      return true
    } catch (e) {
      const err = e as {
        name?: string
        $metadata?: { httpStatusCode?: number }
      }
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404)
        return false
      throw e
    }
  }

  async diffExisting(images: ImageInput[]): Promise<DiffResult> {
    const toUpload: ImageInput[] = []
    const alreadyUploaded: ImageInput[] = []
    for (const img of images) {
      const plan = await this.planVariants(img)
      if (await this.objectExists(plan.baseKey)) {
        alreadyUploaded.push(img)
      } else {
        toUpload.push(img)
      }
    }
    return { toUpload, alreadyUploaded }
  }

  private async putIfAbsent(key: string, body: Buffer): Promise<void> {
    try {
      await this.config.s3.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Body: body,
          ContentType: 'image/webp',
          IfNoneMatch: '*',
        }),
      )
    } catch (e) {
      const err = e as {
        name?: string
        $metadata?: { httpStatusCode?: number }
      }
      const status = err.$metadata?.httpStatusCode
      if (status === 412 || err.name === 'PreconditionFailed') return
      throw new DomainError(
        'ImageUploadFailed',
        `failed to upload ${key}: ${(e as Error).message}`,
      )
    }
  }

  async uploadAll(
    images: ImageInput[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<ImageUrlMap> {
    const out: ImageUrlMap = {}
    let done = 0
    for (const img of images) {
      const plan = await this.planVariants(img)
      await this.putIfAbsent(plan.baseKey, plan.baseBuffer)
      const variants: ImageVariantUrl[] = []
      for (const v of plan.variants) {
        if (v.key !== plan.baseKey) await this.putIfAbsent(v.key, v.buffer)
        variants.push({
          width: v.width,
          height: v.height,
          url: `${this.config.publicBaseUrl}/${v.key}`,
        })
      }
      out[img.sourcePath] = {
        base: `${this.config.publicBaseUrl}/${plan.baseKey}`,
        variants,
      }
      done++
      onProgress?.(done, images.length)
    }
    return out
  }
}
