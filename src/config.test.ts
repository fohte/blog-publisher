import { describe, expect, it } from 'vitest'

import { loadConfig } from '#config'

function baseEnv(): Record<string, string> {
  return {
    BEARER_TOKEN: 'tok',
    COUCHDB_URL: 'http://couch',
    COUCHDB_USERNAME: 'u',
    COUCHDB_PASSWORD: 'p',
    COUCHDB_DATABASE: 'd',
    GITHUB_OWNER: 'fohte',
    GITHUB_REPO: 'fohte.net',
    OCTO_STS_URL: 'https://octo-sts.fohte.net',
    OCTO_STS_SCOPE: 'fohte/fohte.net',
    OCTO_STS_IDENTITY: 'fohte.net-blog-publisher',
    R2_BUCKET: 'b',
    R2_PUBLIC_BASE_URL: 'https://cdn.example',
    R2_ACCOUNT_ID: 'acc',
    R2_ACCESS_KEY_ID: 'ak',
    R2_SECRET_ACCESS_KEY: 'sk',
  }
}

describe('loadConfig', () => {
  it('parses a valid env', () => {
    expect(loadConfig(baseEnv())._unsafeUnwrap()).toEqual({
      port: 3000,
      bearerToken: 'tok',
      notesPathPrefix: 'notes/blogs/',
      liveSync: {
        couchUrl: 'http://couch',
        username: 'u',
        password: 'p',
        database: 'd',
      },
      github: {
        owner: 'fohte',
        repo: 'fohte.net',
        defaultBranch: 'master',
      },
      octoSts: {
        url: 'https://octo-sts.fohte.net',
        scope: 'fohte/fohte.net',
        identity: 'fohte.net-blog-publisher',
        saTokenPath: '/var/run/secrets/tokens/octo-sts-token',
      },
      r2: {
        bucket: 'b',
        publicBaseUrl: 'https://cdn.example',
        accountId: 'acc',
        accessKeyId: 'ak',
        secretAccessKey: 'sk',
        variantWidths: [640, 1280, 1920],
      },
    })
  })

  it('reports an issue when a required variable is missing', () => {
    const env = baseEnv()
    delete (env as Record<string, string | undefined>)['BEARER_TOKEN']
    expect(loadConfig(env)._unsafeUnwrapErr().issues).toEqual([
      'missing required environment variable: BEARER_TOKEN',
    ])
  })

  it('reports an issue when OCTO_STS_URL is missing', () => {
    const env = baseEnv()
    delete (env as Record<string, string | undefined>)['OCTO_STS_URL']
    expect(loadConfig(env)._unsafeUnwrapErr().issues).toEqual([
      'missing required environment variable: OCTO_STS_URL',
    ])
  })

  it('reports an issue when OCTO_STS_IDENTITY is missing', () => {
    const env = baseEnv()
    delete (env as Record<string, string | undefined>)['OCTO_STS_IDENTITY']
    expect(loadConfig(env)._unsafeUnwrapErr().issues).toEqual([
      'missing required environment variable: OCTO_STS_IDENTITY',
    ])
  })

  it('aggregates every missing variable instead of stopping at the first', () => {
    const env = baseEnv()
    delete (env as Record<string, string | undefined>)['BEARER_TOKEN']
    delete (env as Record<string, string | undefined>)['GITHUB_OWNER']
    expect(loadConfig(env)._unsafeUnwrapErr().issues).toEqual([
      'missing required environment variable: BEARER_TOKEN',
      'missing required environment variable: GITHUB_OWNER',
    ])
  })

  it('parses custom variant widths', () => {
    const env = { ...baseEnv(), IMAGE_VARIANT_WIDTHS: '320, 800' }
    expect(loadConfig(env)._unsafeUnwrap().r2.variantWidths).toEqual([320, 800])
  })

  it('rejects non-positive widths', () => {
    const env = { ...baseEnv(), IMAGE_VARIANT_WIDTHS: '0,100' }
    expect(loadConfig(env)._unsafeUnwrapErr().issues).toEqual([
      'IMAGE_VARIANT_WIDTHS must contain positive integers: 0',
    ])
  })
})
