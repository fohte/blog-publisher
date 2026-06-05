/**
 * In-memory stand-in for the GitHub REST API, plugged into `GitHubClient`
 * via its `octokitOverride` so ApplyOrchestrator and the HTTP layer run
 * their real code paths against deterministic responses.
 */

import { createHash } from 'node:crypto'

interface PR {
  number: number
  html_url: string
  state: 'open' | 'closed'
  title: string
  body: string
  created_at: string
  merged_at: string | null
  head: { ref: string; sha: string }
  labels: string[]
}

export interface FakeGitHubOptions {
  /** Paths under `src/content/posts/` that already exist on the target repo. */
  existingPosts?: Set<string>
  /** Every call to the matching route throws to simulate an API outage. */
  failOn?: { route: string; status: number; message: string }
}

function httpError(
  status: number,
  message: string,
): Error & { status: number } {
  const err = new Error(message) as Error & { status: number }
  err.status = status
  return err
}

interface RequestEntry {
  route: string
  params: Record<string, unknown>
}

export class FakeGitHub {
  readonly requests: RequestEntry[] = []
  readonly prs: PR[] = []
  readonly branches = new Map<string, string>()
  readonly options: FakeGitHubOptions

  private commitCounter = 0
  private prCounter = 0

  constructor(options: FakeGitHubOptions = {}) {
    this.options = options
    this.branches.set('master', this.sha('master'))
  }

  private sha(seed: string): string {
    return createHash('sha1').update(seed).digest('hex')
  }

  request = async (
    route: string,
    params: Record<string, unknown> = {},
  ): Promise<{ data: unknown; status: number }> => {
    this.requests.push({ route, params })
    if (this.options.failOn?.route === route) {
      throw httpError(this.options.failOn.status, this.options.failOn.message)
    }

    if (route === 'GET /repos/{owner}/{repo}/contents/{path}') {
      const path = String(params['path'])
      const filename = path.replace(/^src\/content\/posts\//, '')
      if (this.options.existingPosts?.has(filename) === true) {
        return { data: { name: filename }, status: 200 }
      }
      throw httpError(404, 'not found')
    }

    if (route === 'GET /repos/{owner}/{repo}/pulls') {
      const head = String(params['head'] ?? '')
      const wanted = head.split(':').pop() ?? ''
      const matches = this.prs.filter((p) => p.head.ref === wanted)
      return { data: matches, status: 200 }
    }

    if (route === 'GET /repos/{owner}/{repo}/issues') {
      return { data: [], status: 200 }
    }

    if (route === 'GET /repos/{owner}/{repo}/pulls/{pull_number}') {
      const n = Number(params['pull_number'])
      const pr = this.prs.find((p) => p.number === n)
      if (pr === undefined) throw httpError(404, 'not found')
      return { data: pr, status: 200 }
    }

    if (route === 'GET /repos/{owner}/{repo}/git/refs/heads/{branch}') {
      const branch = String(params['branch'])
      const sha = this.branches.get(branch)
      if (sha === undefined) throw httpError(404, 'ref not found')
      return {
        data: { ref: `refs/heads/${branch}`, object: { sha, type: 'commit' } },
        status: 200,
      }
    }

    if (route === 'POST /repos/{owner}/{repo}/git/refs') {
      const ref = String(params['ref'])
      const branch = ref.replace(/^refs\/heads\//, '')
      const sha = String(params['sha'])
      this.branches.set(branch, sha)
      return { data: { ref, object: { sha } }, status: 201 }
    }

    if (route === 'DELETE /repos/{owner}/{repo}/git/refs/heads/{branch}') {
      const branch = String(params['branch'])
      this.branches.delete(branch)
      return { data: {}, status: 204 }
    }

    if (route === 'GET /repos/{owner}/{repo}/git/commits/{sha}') {
      const sha = String(params['sha'])
      return {
        data: { sha, tree: { sha: this.sha(`tree:${sha}`) } },
        status: 200,
      }
    }

    if (route === 'POST /repos/{owner}/{repo}/git/blobs') {
      const content = String(params['content'] ?? '')
      return {
        data: { sha: this.sha(`blob:${content.slice(0, 64)}`) },
        status: 201,
      }
    }

    if (route === 'POST /repos/{owner}/{repo}/git/trees') {
      this.commitCounter++
      return {
        data: { sha: this.sha(`tree:${String(this.commitCounter)}`) },
        status: 201,
      }
    }

    if (route === 'POST /repos/{owner}/{repo}/git/commits') {
      this.commitCounter++
      return {
        data: { sha: this.sha(`commit:${String(this.commitCounter)}`) },
        status: 201,
      }
    }

    if (route === 'PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}') {
      const branch = String(params['branch'])
      const sha = String(params['sha'])
      this.branches.set(branch, sha)
      return { data: {}, status: 200 }
    }

    if (route === 'POST /repos/{owner}/{repo}/pulls') {
      this.prCounter++
      const number = this.prCounter
      const branch = String(params['head'])
      const headSha = this.branches.get(branch) ?? this.sha(branch)
      const pr: PR = {
        number,
        html_url: `https://github.com/fohte/fohte.net/pull/${String(number)}`,
        state: 'open',
        title: String(params['title'] ?? ''),
        body: String(params['body'] ?? ''),
        created_at: '2026-01-01T00:00:00.000Z',
        merged_at: null,
        head: { ref: branch, sha: headSha },
        labels: [],
      }
      this.prs.push(pr)
      return { data: pr, status: 201 }
    }

    if (route === 'POST /repos/{owner}/{repo}/issues/{issue_number}/labels') {
      const n = Number(params['issue_number'])
      const pr = this.prs.find((p) => p.number === n)
      if (pr !== undefined) {
        const labels = params['labels'] as string[] | undefined
        if (Array.isArray(labels)) pr.labels.push(...labels)
      }
      return { data: {}, status: 200 }
    }

    if (route === 'PATCH /repos/{owner}/{repo}/pulls/{pull_number}') {
      const n = Number(params['pull_number'])
      const pr = this.prs.find((p) => p.number === n)
      if (pr === undefined) throw httpError(404, 'not found')
      const state = params['state']
      if (state === 'closed') pr.state = 'closed'
      return { data: pr, status: 200 }
    }

    if (route === 'GET /repos/{owner}/{repo}/commits/{ref}/check-runs') {
      return { data: { total_count: 0, check_runs: [] }, status: 200 }
    }

    if (route === 'GET /repos/{owner}/{repo}/deployments') {
      return { data: [], status: 200 }
    }

    if (
      route === 'GET /repos/{owner}/{repo}/deployments/{deployment_id}/statuses'
    ) {
      return { data: [], status: 200 }
    }

    throw httpError(500, `fake-github: unhandled route ${route}`)
  }
}
