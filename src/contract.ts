import { z } from 'zod'

/** Response element of `GET /notes`. */
export const Note = z.object({
  docId: z.string(),
  path: z.string(),
  title: z.string(),
  description: z.string().optional(),
  // Determined by matching publishedFilename against existing fohte.net articles.
  kind: z.enum(['new', 'update']),
  mtime: z.number().int(),
})
export type Note = z.infer<typeof Note>

/** Request body of `POST /plan` and `POST /apply`. */
export const PlanRequest = z.object({
  docIds: z.array(z.string()).min(1),
})
export type PlanRequest = z.infer<typeof PlanRequest>

export const PlanIssue = z.object({
  docId: z.string(),
  code: z.string(),
  message: z.string(),
})
export type PlanIssue = z.infer<typeof PlanIssue>

export const PlanItem = z.object({
  docId: z.string(),
  kind: z.enum(['added', 'modified', 'skipped']),
  slug: z.string(),
  publishedFilename: z.string(),
  title: z.string(),
  summary: z.string(),
  diffStat: z
    .object({ added: z.number().int(), removed: z.number().int() })
    .optional(),
  skipReason: z.string().optional(),
})
export type PlanItem = z.infer<typeof PlanItem>

/** Publish plan deterministically computed from a docId set. Not persisted; a value object. */
export const Plan = z.object({
  // ID deterministically derived from the docId set; used as the GitHub branch name key.
  signature: z.string(),
  items: z.array(PlanItem),
  warnings: z.array(PlanIssue),
  errors: z.array(PlanIssue),
  imagesToUpload: z.array(
    z.object({
      sourcePath: z.string(),
      hash: z.string(),
      alreadyUploaded: z.boolean(),
    }),
  ),
})
export type Plan = z.infer<typeof Plan>

/** Response of `POST /apply`. Discriminated by `kind`: success, plan changed, already applied, or failed. */
export const ApplyResult = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('success'),
    prNumber: z.number().int(),
    prUrl: z.url(),
    branch: z.string(),
  }),
  z.object({ kind: z.literal('planChanged'), newPlan: Plan }),
  z.object({
    kind: z.literal('alreadyApplied'),
    prNumber: z.number().int(),
    prUrl: z.url(),
  }),
  z.object({
    kind: z.literal('failed'),
    code: z.string(),
    message: z.string(),
  }),
])
export type ApplyResult = z.infer<typeof ApplyResult>

/** Response element of `GET /prs`. */
export const BlogPrSummary = z.object({
  number: z.number().int(),
  url: z.url(),
  branch: z.string(),
  state: z.enum(['open', 'closed']),
  title: z.string(),
  createdAt: z.iso.datetime(),
  mergedAt: z.iso.datetime().optional(),
})
export type BlogPrSummary = z.infer<typeof BlogPrSummary>

/** Response of `GET /prs/{number}/ci`. CI state normalized from check-runs. */
export const CiStatus = z.object({
  state: z.enum(['pending', 'success', 'failure']),
  failedChecks: z.array(z.string()),
  previewUrl: z.url().optional(),
})
export type CiStatus = z.infer<typeof CiStatus>
