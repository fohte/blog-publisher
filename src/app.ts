import {
  ApplyResult,
  BlogPrSummary,
  CiStatus,
  Note,
  Plan,
  PlanRequest,
} from '@fohte/blog-publisher-contract'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import type { Context } from 'hono'

import type { GitHubClient } from '@/adapters/github-client'
import type { LiveSyncAdapter, NoteMetadata } from '@/adapters/livesync'
import { apply, type ApplyDeps } from '@/domain/apply-orchestrator'
import { parseFrontmatter } from '@/domain/frontmatter'
import { buildPlan, type PlanLoaders } from '@/domain/plan-builder'

export interface AppDeps {
  bearerToken: string
  notesPathPrefix: string
  liveSync: Pick<LiveSyncAdapter, 'listNotesByPath' | 'readNote'>
  github: Pick<
    GitHubClient,
    | 'existsOnFohteNet'
    | 'findExistingPrByBranch'
    | 'createBranch'
    | 'deleteBranch'
    | 'commitFiles'
    | 'createPullRequest'
    | 'listBlogPrs'
    | 'closePullRequest'
    | 'resolveCiStatus'
  >
  apply: Pick<ApplyDeps, 'imageProcessor' | 'readImage' | 'defaultBranch'>
}

const ErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    issues: z.array(z.unknown()).optional(),
  }),
})

const PrNumberParam = z.object({
  number: z.string().regex(/^\d+$/),
})

const PrsQuery = z.object({
  state: z.enum(['open', 'closed', 'all']).optional(),
})

function bearerMiddleware(token: string) {
  return async (c: Context, next: () => Promise<void>) => {
    const auth = c.req.header('authorization') ?? c.req.header('Authorization')
    if (auth === undefined) {
      return c.json(
        { error: { code: 'Unauthorized', message: 'missing bearer token' } },
        401,
      )
    }
    if (auth !== `Bearer ${token}`) {
      return c.json(
        { error: { code: 'Unauthorized', message: 'invalid bearer token' } },
        401,
      )
    }
    await next()
    return undefined
  }
}

function isHttpStatus(e: unknown, status: number): boolean {
  if (typeof e !== 'object' || e === null || !('status' in e)) return false
  return e.status === status
}

function summarize(description: string | undefined, body: string): string {
  if (description !== undefined && description !== '') return description
  return body.trim().replace(/\s+/g, ' ').slice(0, 120)
}

async function listNotesHandler(
  deps: AppDeps,
): Promise<z.infer<typeof Note>[]> {
  const metas: NoteMetadata[] = await deps.liveSync.listNotesByPath(
    deps.notesPathPrefix,
  )
  metas.sort((a, b) => b.mtime - a.mtime)
  const out: z.infer<typeof Note>[] = []
  for (const meta of metas) {
    let content
    try {
      content = (await deps.liveSync.readNote(meta.docId)).content
    } catch {
      continue
    }
    const { frontmatter, body } = parseFrontmatter(content)
    if (frontmatter.draft === true) continue
    if (frontmatter.title === '') continue
    const filename = frontmatter.publishedFilename
    let kind: 'new' | 'update' = 'new'
    if (filename !== undefined && filename !== '') {
      kind = (await deps.github.existsOnFohteNet(filename)) ? 'update' : 'new'
    }
    const note: z.infer<typeof Note> = {
      docId: meta.docId,
      path: meta.path,
      title: frontmatter.title,
      kind,
      mtime: meta.mtime,
    }
    const desc = frontmatter.description ?? summarize(undefined, body)
    if (desc !== '') note.description = desc
    out.push(note)
  }
  return out
}

export function createApp(deps: AppDeps): OpenAPIHono {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          {
            error: {
              code: 'BadRequest',
              message: 'request validation failed',
              issues: result.error.issues,
            },
          },
          400,
        )
      }
      return undefined
    },
  })

  app.get('/health', (c) => c.json({ status: 'ok' }))

  app.use('/notes', bearerMiddleware(deps.bearerToken))
  app.use('/plan', bearerMiddleware(deps.bearerToken))
  app.use('/apply', bearerMiddleware(deps.bearerToken))
  app.use('/prs', bearerMiddleware(deps.bearerToken))
  app.use('/prs/*', bearerMiddleware(deps.bearerToken))

  const planLoaders: PlanLoaders = {
    readNote: (docId) => deps.liveSync.readNote(docId),
    existsOnFohteNet: (filename) => deps.github.existsOnFohteNet(filename),
  }

  app.openapi(
    createRoute({
      method: 'get',
      path: '/notes',
      responses: {
        200: {
          content: { 'application/json': { schema: z.array(Note) } },
          description: 'note list',
        },
        401: {
          content: { 'application/json': { schema: ErrorBody } },
          description: 'unauthorized',
        },
      },
    }),
    async (c) => c.json(await listNotesHandler(deps), 200),
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/plan',
      request: {
        body: { content: { 'application/json': { schema: PlanRequest } } },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: Plan } },
          description: 'plan',
        },
        400: {
          content: { 'application/json': { schema: ErrorBody } },
          description: 'bad request',
        },
        401: {
          content: { 'application/json': { schema: ErrorBody } },
          description: 'unauthorized',
        },
      },
    }),
    async (c) => {
      const { docIds } = c.req.valid('json')
      const plan = await buildPlan(docIds, planLoaders)
      return c.json(plan, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/apply',
      request: {
        body: { content: { 'application/json': { schema: PlanRequest } } },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: ApplyResult } },
          description: 'apply result',
        },
        400: {
          content: { 'application/json': { schema: ErrorBody } },
          description: 'bad request',
        },
        401: {
          content: { 'application/json': { schema: ErrorBody } },
          description: 'unauthorized',
        },
      },
    }),
    async (c) => {
      const { docIds } = c.req.valid('json')
      const result = await apply(docIds, {
        loaders: planLoaders,
        github: deps.github,
        imageProcessor: deps.apply.imageProcessor,
        readImage: deps.apply.readImage,
        defaultBranch: deps.apply.defaultBranch,
      })
      return c.json(result, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/prs',
      request: { query: PrsQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: z.array(BlogPrSummary) } },
          description: 'pr list',
        },
        401: {
          content: { 'application/json': { schema: ErrorBody } },
          description: 'unauthorized',
        },
      },
    }),
    async (c) => {
      const { state } = c.req.valid('query')
      return c.json(await deps.github.listBlogPrs(state ?? 'open'), 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/prs/{number}/cancel',
      request: { params: PrNumberParam },
      responses: {
        200: {
          content: {
            'application/json': {
              schema: z.object({ closed: z.literal(true) }),
            },
          },
          description: 'closed',
        },
        401: {
          content: { 'application/json': { schema: ErrorBody } },
          description: 'unauthorized',
        },
        404: {
          content: { 'application/json': { schema: ErrorBody } },
          description: 'not found',
        },
      },
    }),
    async (c) => {
      const { number } = c.req.valid('param')
      try {
        await deps.github.closePullRequest(Number.parseInt(number, 10))
        return c.json({ closed: true as const }, 200)
      } catch (e) {
        if (isHttpStatus(e, 404)) {
          return c.json(
            { error: { code: 'NotFound', message: 'PR not found' } },
            404,
          )
        }
        throw e
      }
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/prs/{number}/ci',
      request: { params: PrNumberParam },
      responses: {
        200: {
          content: { 'application/json': { schema: CiStatus } },
          description: 'ci status',
        },
        401: {
          content: { 'application/json': { schema: ErrorBody } },
          description: 'unauthorized',
        },
        404: {
          content: { 'application/json': { schema: ErrorBody } },
          description: 'not found',
        },
      },
    }),
    async (c) => {
      const { number } = c.req.valid('param')
      try {
        const ci = await deps.github.resolveCiStatus(
          Number.parseInt(number, 10),
        )
        return c.json(ci, 200)
      } catch (e) {
        if (isHttpStatus(e, 404)) {
          return c.json(
            { error: { code: 'NotFound', message: 'PR not found' } },
            404,
          )
        }
        throw e
      }
    },
  )

  app.doc('/doc', {
    openapi: '3.1.0',
    info: { title: 'blog-publisher', version: '1' },
  })

  app.onError((err, c) => {
    console.error('[app] uncaught error', err)
    return c.json(
      {
        error: {
          code: 'InternalServerError',
          message: err instanceof Error ? err.message : String(err),
        },
      },
      500,
    )
  })

  return app
}
