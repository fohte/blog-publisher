import type { BlogPrSummary, CiStatus } from '@fohte/blog-publisher-contract'
import { throttling } from '@octokit/plugin-throttling'
import { Octokit } from 'octokit'

import type { OctoStsTokenCache } from '@/auth/octo-sts'

export interface FileToCommit {
  path: string
  content: string
  encoding: 'utf-8' | 'base64'
}

export interface GitHubClientConfig {
  owner: string
  repo: string
  defaultBranch: string
  prLabel?: string
}

const ThrottledOctokit = Octokit.plugin(throttling)

interface OctokitLike {
  request: (
    route: string,
    params?: Record<string, unknown>,
  ) => Promise<{
    data: unknown
    status?: number
  }>
}

interface CheckRunsResponse {
  total_count: number
  check_runs: Array<{
    name: string
    status: 'queued' | 'in_progress' | 'completed'
    conclusion?: string | null
    details_url?: string | null
  }>
}

interface DeploymentResponse {
  id: number
  ref: string
  environment?: string
}

interface DeploymentStatusResponse {
  state: string
  environment_url?: string | null
  target_url?: string | null
}

interface RefResponse {
  ref: string
  object: { sha: string; type: string }
}

interface PullResponse {
  number: number
  html_url: string
  state: 'open' | 'closed'
  title: string
  created_at: string
  merged_at?: string | null
  head: { ref: string; sha: string }
}

function isUnauthorized(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  return 'status' in err && err.status === 401
}

export function createOctoStsAuthStrategy(tokenCache: OctoStsTokenCache) {
  return () => ({
    hook: async (
      request: (
        route: string,
        parameters: Record<string, unknown>,
      ) => Promise<unknown>,
      route: string,
      parameters: Record<string, unknown> = {},
    ): Promise<unknown> => {
      const send = async (token: string): Promise<unknown> => {
        const headers = {
          ...((parameters['headers'] as Record<string, string> | undefined) ??
            {}),
          authorization: `token ${token}`,
        }
        return request(route, { ...parameters, headers })
      }
      const token = await tokenCache.getToken()
      try {
        return await send(token)
      } catch (err) {
        if (!isUnauthorized(err)) throw err
        console.warn('[github-client] octo-sts token rejected (401); rotating')
        // Pass the token we just used so a sibling request that already
        // rotated the cache to a newer token is not invalidated.
        tokenCache.invalidate(token)
        const fresh = await tokenCache.getToken()
        return send(fresh)
      }
    },
  })
}

export class GitHubClient {
  private readonly octokit: OctokitLike
  private readonly owner: string
  private readonly repo: string
  private readonly defaultBranch: string
  private readonly label: string

  constructor(
    config: GitHubClientConfig,
    deps: { tokenCache: OctoStsTokenCache } | { octokit: OctokitLike },
  ) {
    this.owner = config.owner
    this.repo = config.repo
    this.defaultBranch = config.defaultBranch
    this.label = config.prLabel ?? 'blog-publish'
    if ('octokit' in deps) {
      this.octokit = deps.octokit
    } else {
      this.octokit = new ThrottledOctokit({
        authStrategy: createOctoStsAuthStrategy(deps.tokenCache),
        throttle: {
          onRateLimit: () => true,
          onSecondaryRateLimit: () => true,
        },
      })
    }
  }

  async existsOnFohteNet(filename: string): Promise<boolean> {
    try {
      await this.octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
        owner: this.owner,
        repo: this.repo,
        path: `src/content/posts/${filename}`,
        ref: this.defaultBranch,
      })
      return true
    } catch (e) {
      const err = e as { status?: number }
      if (err.status === 404) return false
      throw e
    }
  }

  async findExistingPrByBranch(branch: string): Promise<BlogPrSummary | null> {
    const { data } = await this.octokit.request(
      'GET /repos/{owner}/{repo}/pulls',
      {
        owner: this.owner,
        repo: this.repo,
        head: `${this.owner}:${branch}`,
        state: 'all',
      },
    )
    const prs = data as PullResponse[]
    const pr = prs[0]
    if (pr === undefined) return null
    return this.toSummary(pr)
  }

  async listBlogPrs(
    state: 'open' | 'closed' | 'all',
  ): Promise<BlogPrSummary[]> {
    const { data } = await this.octokit.request(
      'GET /repos/{owner}/{repo}/issues',
      {
        owner: this.owner,
        repo: this.repo,
        labels: this.label,
        state,
      },
    )
    const issues = data as Array<{
      number: number
      html_url: string
      title: string
      created_at: string
      state: 'open' | 'closed'
      pull_request?: { url: string }
    }>
    const prPromises = issues
      .filter((it) => it.pull_request !== undefined)
      .map(async (it) => {
        const { data: prRaw } = await this.octokit.request(
          'GET /repos/{owner}/{repo}/pulls/{pull_number}',
          { owner: this.owner, repo: this.repo, pull_number: it.number },
        )
        return this.toSummary(prRaw as PullResponse)
      })
    return Promise.all(prPromises)
  }

  private toSummary(pr: PullResponse): BlogPrSummary {
    return {
      number: pr.number,
      url: pr.html_url,
      branch: pr.head.ref,
      state: pr.state,
      title: pr.title,
      createdAt: pr.created_at,
      ...(pr.merged_at !== null && pr.merged_at !== undefined
        ? { mergedAt: pr.merged_at }
        : {}),
    }
  }

  private async getRefSha(branch: string): Promise<string> {
    const { data } = await this.octokit.request(
      'GET /repos/{owner}/{repo}/git/refs/heads/{branch}',
      { owner: this.owner, repo: this.repo, branch },
    )
    return (data as RefResponse).object.sha
  }

  async createBranch(baseRef: string, name: string): Promise<void> {
    const baseSha = await this.getRefSha(baseRef)
    await this.octokit.request('POST /repos/{owner}/{repo}/git/refs', {
      owner: this.owner,
      repo: this.repo,
      ref: `refs/heads/${name}`,
      sha: baseSha,
    })
  }

  async deleteBranch(name: string): Promise<void> {
    try {
      await this.octokit.request(
        'DELETE /repos/{owner}/{repo}/git/refs/heads/{branch}',
        { owner: this.owner, repo: this.repo, branch: name },
      )
    } catch (e) {
      const err = e as { status?: number }
      if (err.status !== 404 && err.status !== 422) throw e
    }
  }

  async commitFiles(
    branch: string,
    files: FileToCommit[],
    message: string,
  ): Promise<{ sha: string }> {
    const baseSha = await this.getRefSha(branch)
    const { data: baseCommit } = await this.octokit.request(
      'GET /repos/{owner}/{repo}/git/commits/{sha}',
      { owner: this.owner, repo: this.repo, sha: baseSha },
    )
    const baseTreeSha = (baseCommit as { tree: { sha: string } }).tree.sha

    const blobs = await Promise.all(
      files.map(async (f) => {
        const { data } = await this.octokit.request(
          'POST /repos/{owner}/{repo}/git/blobs',
          {
            owner: this.owner,
            repo: this.repo,
            content: f.content,
            encoding: f.encoding,
          },
        )
        return { path: f.path, sha: (data as { sha: string }).sha }
      }),
    )

    const { data: tree } = await this.octokit.request(
      'POST /repos/{owner}/{repo}/git/trees',
      {
        owner: this.owner,
        repo: this.repo,
        base_tree: baseTreeSha,
        tree: blobs.map((b) => ({
          path: b.path,
          mode: '100644',
          type: 'blob',
          sha: b.sha,
        })),
      },
    )

    const { data: commit } = await this.octokit.request(
      'POST /repos/{owner}/{repo}/git/commits',
      {
        owner: this.owner,
        repo: this.repo,
        message,
        tree: (tree as { sha: string }).sha,
        parents: [baseSha],
      },
    )

    const commitSha = (commit as { sha: string }).sha
    await this.octokit.request(
      'PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}',
      {
        owner: this.owner,
        repo: this.repo,
        branch,
        sha: commitSha,
      },
    )
    return { sha: commitSha }
  }

  async createPullRequest(
    branch: string,
    title: string,
    body: string,
  ): Promise<BlogPrSummary> {
    const { data: pr } = await this.octokit.request(
      'POST /repos/{owner}/{repo}/pulls',
      {
        owner: this.owner,
        repo: this.repo,
        title,
        body,
        head: branch,
        base: this.defaultBranch,
      },
    )
    const created = pr as PullResponse
    await this.octokit.request(
      'POST /repos/{owner}/{repo}/issues/{issue_number}/labels',
      {
        owner: this.owner,
        repo: this.repo,
        issue_number: created.number,
        labels: [this.label],
      },
    )
    return this.toSummary(created)
  }

  async closePullRequest(prNumber: number): Promise<void> {
    await this.octokit.request(
      'PATCH /repos/{owner}/{repo}/pulls/{pull_number}',
      {
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
        state: 'closed',
      },
    )
  }

  async resolveCiStatus(prNumber: number): Promise<CiStatus> {
    const { data: prRaw } = await this.octokit.request(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}',
      { owner: this.owner, repo: this.repo, pull_number: prNumber },
    )
    const pr = prRaw as PullResponse
    const headSha = pr.head.sha
    const { data: checksRaw } = await this.octokit.request(
      'GET /repos/{owner}/{repo}/commits/{ref}/check-runs',
      {
        owner: this.owner,
        repo: this.repo,
        ref: headSha,
        per_page: 100,
      },
    )
    const checks = checksRaw as CheckRunsResponse
    const failed: string[] = []
    let pending = false
    for (const c of checks.check_runs) {
      if (c.status !== 'completed') {
        pending = true
        continue
      }
      const conclusion = c.conclusion ?? ''
      if (
        conclusion === 'failure' ||
        conclusion === 'timed_out' ||
        conclusion === 'cancelled'
      ) {
        failed.push(c.name)
      }
    }
    let state: CiStatus['state']
    if (failed.length > 0) state = 'failure'
    else if (pending || checks.check_runs.length === 0) state = 'pending'
    else state = 'success'

    let previewUrl: string | undefined
    try {
      const { data: deploysRaw } = await this.octokit.request(
        'GET /repos/{owner}/{repo}/deployments',
        {
          owner: this.owner,
          repo: this.repo,
          ref: pr.head.ref,
          environment: 'Preview',
          per_page: 100,
        },
      )
      const deploys = deploysRaw as DeploymentResponse[]
      const latest = deploys[0]
      if (latest !== undefined) {
        const { data: statusesRaw } = await this.octokit.request(
          'GET /repos/{owner}/{repo}/deployments/{deployment_id}/statuses',
          {
            owner: this.owner,
            repo: this.repo,
            deployment_id: latest.id,
          },
        )
        const statuses = statusesRaw as DeploymentStatusResponse[]
        const url =
          statuses[0]?.environment_url ?? statuses[0]?.target_url ?? null
        if (url !== null && url !== '') previewUrl = url
      }
    } catch (e) {
      // Deployment lookup is best-effort; surface the failure so a missing previewUrl is debuggable.
      console.warn('[github-client] deployment lookup failed', e)
    }
    return {
      state,
      failedChecks: failed,
      ...(previewUrl !== undefined ? { previewUrl } : {}),
    }
  }
}
