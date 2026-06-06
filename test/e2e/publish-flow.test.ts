/**
 * Service-level E2E: drive `GET /notes` → `POST /plan` → `POST /apply` over
 * the real Hono router with a real CouchDB (LiveSync schema) and a real
 * MinIO bucket (R2-compatible). GitHub is mocked at the Octokit boundary so
 * the surfaces we own (LiveSyncAdapter, ImageProcessor, ApplyOrchestrator,
 * HTTP layer) all execute their real code path.
 *
 * Requires the docker-compose.e2e.yml stack to be running. If the services
 * are unreachable the whole suite is skipped instead of failing.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it } from 'vitest'

import { GitHubClient } from '@/adapters/github-client'
import { ImageProcessor } from '@/adapters/image-processor'
import { LiveSyncAdapter } from '@/adapters/livesync'
import { type AppDeps, createApp } from '@/app'

import { FakeGitHub } from './fake-github'
import { buildNoteFixture } from './fixtures'
import {
  type E2EEndpoints,
  insertNote,
  insertVersionDoc,
  makeS3Client,
  probeServices,
  resetBucket,
  resetCouchDb,
  resolveEndpoints,
} from './services'

const ep: E2EEndpoints = resolveEndpoints()
const available = await probeServices(ep)
if (!available) {
  console.warn(
    `[e2e] services unreachable at ${ep.couchUrl} / ${ep.s3Endpoint}; ` +
      'start them with `docker compose -f docker-compose.e2e.yml up -d` to run this suite',
  )
}

const AUTH = { authorization: 'Bearer e2e-token' } as const
const JSON_HEADERS = { 'content-type': 'application/json' } as const

function frontmatter(slug: string, extra: Record<string, string> = {}): string {
  const lines = [
    '---',
    `title: ${slug}`,
    `slug: ${slug}`,
    'date: 2026-01-01',
    `description: about ${slug}`,
    ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`),
    '---',
  ]
  return lines.join('\n') + '\n'
}

async function buildApp(
  github: FakeGitHub,
  overrides: { applyOverrides?: Partial<AppDeps['apply']> } = {},
): Promise<{
  app: ReturnType<typeof createApp>
  fakeGitHub: FakeGitHub
  imageBytes: Buffer
}> {
  const liveSync = new LiveSyncAdapter()
  await liveSync.init({
    couchUrl: ep.couchUrl,
    username: ep.couchUser,
    password: ep.couchPassword,
    database: ep.couchDatabase,
  })

  const githubClient = new GitHubClient(
    {
      owner: 'fohte',
      repo: 'fohte.net',
      defaultBranch: 'master',
    },
    { octokit: { request: github.request } },
  )

  const s3 = makeS3Client(ep)
  const imageProcessor = new ImageProcessor({
    bucket: ep.s3Bucket,
    publicBaseUrl: ep.s3PublicBaseUrl,
    variantWidths: [320, 640],
    s3,
  })

  const fixtureDir = dirname(fileURLToPath(import.meta.url))
  const imageBytes = readFileSync(resolvePath(fixtureDir, 'pixel.png'))

  const deps: AppDeps = {
    bearerToken: 'e2e-token',
    notesPathPrefix: 'notes/blogs/',
    liveSync,
    github: githubClient,
    apply: {
      imageProcessor,
      readImage: async (sourcePath) =>
        sourcePath.endsWith('.png') ? { sourcePath, buffer: imageBytes } : null,
      defaultBranch: 'master',
      ...overrides.applyOverrides,
    },
  }
  return { app: createApp(deps), fakeGitHub: github, imageBytes }
}

describe.runIf(available)('Service E2E (CouchDB + MinIO + fake GitHub)', () => {
  beforeEach(async () => {
    await resetCouchDb(ep)
    await insertVersionDoc(ep)
    const s3 = makeS3Client(ep)
    await resetBucket(s3, ep)
  })

  it('lists notes, builds a plan, applies it, and opens a PR', async () => {
    await insertNote(
      ep,
      buildNoteFixture({
        docId: 'note-hello',
        path: 'notes/blogs/hello.md',
        content: `${frontmatter('hello')}\nBody of hello.\n\n![p](pixel.png)\n`,
      }),
    )

    const { app, fakeGitHub } = await buildApp(new FakeGitHub())

    const notesRes = await app.request('/notes', { headers: AUTH })
    expect(notesRes.status).toBe(200)
    const notes = (await notesRes.json()) as Array<{ docId: string }>
    expect(notes.map((n) => n.docId)).toContain('note-hello')

    const planRes = await app.request('/plan', {
      method: 'POST',
      headers: { ...AUTH, ...JSON_HEADERS },
      body: JSON.stringify({ docIds: ['note-hello'] }),
    })
    expect(planRes.status).toBe(200)
    const plan = (await planRes.json()) as {
      signature: string
      errors: unknown[]
      imagesToUpload: Array<{ sourcePath: string }>
    }
    expect(plan.errors).toHaveLength(0)
    expect(plan.imagesToUpload.map((i) => i.sourcePath)).toEqual(['pixel.png'])

    const applyRes = await app.request('/apply', {
      method: 'POST',
      headers: { ...AUTH, ...JSON_HEADERS },
      body: JSON.stringify({ docIds: ['note-hello'] }),
    })
    expect(applyRes.status).toBe(200)
    const result = (await applyRes.json()) as {
      kind: string
      prNumber?: number
    }
    expect(result.kind).toBe('success')
    expect(result.prNumber).toBe(1)
    expect(fakeGitHub.branches.has(`blog/${plan.signature}`)).toBe(true)
  })

  it('returns planChanged-style errors when a wikilink is unresolved', async () => {
    await insertNote(
      ep,
      buildNoteFixture({
        docId: 'note-wiki',
        path: 'notes/blogs/wiki.md',
        content: `${frontmatter('wiki')}\nSee [[Missing Note]] for details.\n`,
      }),
    )
    const { app } = await buildApp(new FakeGitHub())

    const planRes = await app.request('/plan', {
      method: 'POST',
      headers: { ...AUTH, ...JSON_HEADERS },
      body: JSON.stringify({ docIds: ['note-wiki'] }),
    })
    const plan = (await planRes.json()) as {
      errors: Array<{ code: string }>
    }
    expect(plan.errors.some((e) => e.code === 'WikiLinkUnresolved')).toBe(true)

    const applyRes = await app.request('/apply', {
      method: 'POST',
      headers: { ...AUTH, ...JSON_HEADERS },
      body: JSON.stringify({ docIds: ['note-wiki'] }),
    })
    const result = (await applyRes.json()) as { kind: string }
    expect(result.kind).toBe('planChanged')
  })

  it('blocks apply on notes that contain an Obsidian callout', async () => {
    await insertNote(
      ep,
      buildNoteFixture({
        docId: 'note-callout',
        path: 'notes/blogs/callout.md',
        content: `${frontmatter('callout')}\n> [!NOTE]\n> heads up\n`,
      }),
    )
    const { app } = await buildApp(new FakeGitHub())

    const applyRes = await app.request('/apply', {
      method: 'POST',
      headers: { ...AUTH, ...JSON_HEADERS },
      body: JSON.stringify({ docIds: ['note-callout'] }),
    })
    const result = (await applyRes.json()) as {
      kind: string
      newPlan?: { errors: Array<{ code: string }> }
    }
    expect(result.kind).toBe('planChanged')
    expect(
      result.newPlan?.errors.some((e) => e.code === 'UnsupportedSyntax'),
    ).toBe(true)
  })

  it('rolls back the branch when image upload fails', async () => {
    await insertNote(
      ep,
      buildNoteFixture({
        docId: 'note-img-fail',
        path: 'notes/blogs/img.md',
        content: `${frontmatter('img')}\n![p](broken.png)\n`,
      }),
    )
    const { app, fakeGitHub } = await buildApp(new FakeGitHub(), {
      applyOverrides: {
        imageProcessor: {
          uploadAll: async () => {
            throw new Error('simulated R2 outage')
          },
        },
      },
    })

    const res = await app.request('/apply', {
      method: 'POST',
      headers: { ...AUTH, ...JSON_HEADERS },
      body: JSON.stringify({ docIds: ['note-img-fail'] }),
    })
    const body = (await res.json()) as { kind: string; code?: string }
    expect(body.kind).toBe('failed')
    expect(body.code).toBe('ImageUploadFailed')
    const blogBranches = [...fakeGitHub.branches.keys()].filter((b) =>
      b.startsWith('blog/'),
    )
    expect(blogBranches).toEqual([])
  })

  it('returns alreadyApplied on a duplicate apply for the same plan', async () => {
    await insertNote(
      ep,
      buildNoteFixture({
        docId: 'note-dup',
        path: 'notes/blogs/dup.md',
        content: `${frontmatter('dup')}\nbody\n`,
      }),
    )
    const { app } = await buildApp(new FakeGitHub())

    const first = await app.request('/apply', {
      method: 'POST',
      headers: { ...AUTH, ...JSON_HEADERS },
      body: JSON.stringify({ docIds: ['note-dup'] }),
    })
    expect(((await first.json()) as { kind: string }).kind).toBe('success')

    const second = await app.request('/apply', {
      method: 'POST',
      headers: { ...AUTH, ...JSON_HEADERS },
      body: JSON.stringify({ docIds: ['note-dup'] }),
    })
    const body = (await second.json()) as { kind: string; prNumber?: number }
    expect(body.kind).toBe('alreadyApplied')
    expect(body.prNumber).toBe(1)
  })

  it('replays a planChanged response when the note is edited between plan and apply', async () => {
    const docId = 'note-edit'
    await insertNote(
      ep,
      buildNoteFixture({
        docId,
        path: 'notes/blogs/edit.md',
        content: `${frontmatter('edit')}\noriginal body\n`,
      }),
    )
    const { app } = await buildApp(new FakeGitHub())

    const planRes = await app.request('/plan', {
      method: 'POST',
      headers: { ...AUTH, ...JSON_HEADERS },
      body: JSON.stringify({ docIds: [docId] }),
    })
    const plan1 = (await planRes.json()) as { signature: string }

    // Signature is docId-only, so editing content keeps it stable; apply's
    // second buildPlan surfaces the new error as planChanged.
    await resetCouchDb(ep)
    await insertVersionDoc(ep)
    await insertNote(
      ep,
      buildNoteFixture({
        docId,
        path: 'notes/blogs/edit.md',
        content: `${frontmatter('edit')}\n> [!WARNING]\n> edited\n`,
      }),
    )

    const applyRes = await app.request('/apply', {
      method: 'POST',
      headers: { ...AUTH, ...JSON_HEADERS },
      body: JSON.stringify({ docIds: [docId] }),
    })
    const body = (await applyRes.json()) as {
      kind: string
      newPlan?: { signature: string; errors: Array<{ code: string }> }
    }
    expect(body.kind).toBe('planChanged')
    expect(body.newPlan?.signature).toBe(plan1.signature)
    expect(
      body.newPlan?.errors.some((e) => e.code === 'UnsupportedSyntax'),
    ).toBe(true)
  })
})
