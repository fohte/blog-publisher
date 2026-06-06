import { describe, expect, it } from 'vitest'

import { loadConfig } from '@/config'

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
    R2_BUCKET: 'b',
    R2_PUBLIC_BASE_URL: 'https://cdn.example',
    R2_ACCOUNT_ID: 'acc',
    R2_ACCESS_KEY_ID: 'ak',
    R2_SECRET_ACCESS_KEY: 'sk',
  }
}

describe('loadConfig', () => {
  it('parses a valid env', () => {
    const c = loadConfig(baseEnv())
    expect(c.bearerToken).toBe('tok')
    expect(c.r2.variantWidths).toEqual([640, 1280, 1920])
    expect(c.github.defaultBranch).toBe('master')
    expect(c.octoSts.url).toBe('https://octo-sts.fohte.net')
    expect(c.octoSts.scope).toBe('fohte/fohte.net')
    expect(c.octoSts.identity).toBe('fohte.net-blog-publisher')
    expect(c.octoSts.saTokenPath).toBe('/var/run/secrets/tokens/octo-sts-token')
  })

  it('throws when a required variable is missing', () => {
    const env = baseEnv()
    delete (env as Record<string, string | undefined>)['BEARER_TOKEN']
    expect(() => loadConfig(env)).toThrow(/BEARER_TOKEN/)
  })

  it('throws when OCTO_STS_URL is missing', () => {
    const env = baseEnv()
    delete (env as Record<string, string | undefined>)['OCTO_STS_URL']
    expect(() => loadConfig(env)).toThrow(/OCTO_STS_URL/)
  })

  it('honors OCTO_STS_IDENTITY override', () => {
    const env = { ...baseEnv(), OCTO_STS_IDENTITY: 'custom-identity' }
    expect(loadConfig(env).octoSts.identity).toBe('custom-identity')
  })

  it('parses custom variant widths', () => {
    const env = { ...baseEnv(), IMAGE_VARIANT_WIDTHS: '320, 800' }
    expect(loadConfig(env).r2.variantWidths).toEqual([320, 800])
  })

  it('rejects non-positive widths', () => {
    const env = { ...baseEnv(), IMAGE_VARIANT_WIDTHS: '0,100' }
    expect(() => loadConfig(env)).toThrow(/IMAGE_VARIANT_WIDTHS/)
  })
})
