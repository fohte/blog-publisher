import { describe, expect, it } from 'vitest'

import { LiveSyncAdapter } from '@/adapters/livesync'
import { DomainError } from '@/domain/errors'

type Doc = Record<string, unknown> & { _id: string }

function makeFetch(docs: Doc[]): (
  input: string,
  init?: { method?: string; body?: string },
) => Promise<{
  status: number
  ok: boolean
  json: () => Promise<unknown>
  text: () => Promise<string>
}> {
  const byId = new Map<string, Doc>()
  for (const d of docs) byId.set(d._id, d)
  return async (input, init) => {
    const url = new URL(input)
    const path = url.pathname
    const method = init?.method ?? 'GET'
    const ok = (body: unknown) => ({
      status: 200,
      ok: true,
      json: async () => body,
      text: async () => JSON.stringify(body),
    })
    const notFound = () => ({
      status: 404,
      ok: false,
      json: async () => ({ error: 'not_found' }),
      text: async () => 'not_found',
    })
    if (path.endsWith('/_all_docs') && method === 'POST') {
      const body =
        init?.body !== undefined
          ? (JSON.parse(init.body) as { keys: string[] })
          : { keys: [] }
      const rows = body.keys.map((id) => ({ id, doc: byId.get(id) }))
      return ok({ rows })
    }
    if (path.endsWith('/_all_docs')) {
      const rows = [...byId.values()].map((d) => ({ id: d._id, doc: d }))
      return ok({ rows })
    }
    const id = decodeURIComponent(path.split('/').pop() ?? '')
    const d = byId.get(id)
    if (d === undefined) return notFound()
    return ok(d)
  }
}

const config = {
  couchUrl: 'http://couch.local:5984',
  username: 'admin',
  password: 'pw',
  database: 'vault',
}

describe('LiveSyncAdapter', () => {
  it('fails fast on Path Obfuscation', async () => {
    const adapter = new LiveSyncAdapter({
      fetch: makeFetch([
        { _id: 'obsydian_livesync_version', useObfuscatedPath: true },
      ]),
    })
    await expect(adapter.init(config)).rejects.toBeInstanceOf(DomainError)
  })

  it('fails fast on Property Encryption', async () => {
    const adapter = new LiveSyncAdapter({
      fetch: makeFetch([
        { _id: 'obsydian_livesync_version', usePropertyEncryption: true },
      ]),
    })
    await expect(adapter.init(config)).rejects.toBeInstanceOf(DomainError)
  })

  it('lists notes under the given prefix', async () => {
    const adapter = new LiveSyncAdapter({
      fetch: makeFetch([
        {
          _id: 'note-a',
          path: 'notes/blogs/a.md',
          mtime: 1,
          size: 10,
          children: ['h:1'],
        },
        {
          _id: 'note-b',
          path: 'notes/other/b.md',
          mtime: 2,
          size: 20,
          children: ['h:2'],
        },
      ]),
    })
    await adapter.init(config)
    const notes = await adapter.listNotesByPath('notes/blogs/')
    expect(notes.map((n) => n.docId)).toEqual(['note-a'])
  })

  it('readNote reassembles chunk contents in order', async () => {
    const adapter = new LiveSyncAdapter({
      fetch: makeFetch([
        {
          _id: 'note-a',
          path: 'notes/blogs/a.md',
          mtime: 1,
          size: 6,
          children: ['h:1', 'h:2'],
        },
        { _id: 'h:1', data: 'hello ' },
        { _id: 'h:2', data: 'world' },
      ]),
    })
    await adapter.init(config)
    const note = await adapter.readNote('note-a')
    expect(note.content).toBe('hello world')
    expect(note.path).toBe('notes/blogs/a.md')
  })

  it('readNote throws when an encrypted chunk lacks a decryption hook', async () => {
    const adapter = new LiveSyncAdapter({
      fetch: makeFetch([
        {
          _id: 'note-a',
          path: 'notes/blogs/a.md',
          children: ['h:enc'],
        },
        { _id: 'h:enc', data: '%=ciphertext' },
      ]),
    })
    await adapter.init(config)
    await expect(adapter.readNote('note-a')).rejects.toBeInstanceOf(DomainError)
  })

  it('readNote applies the decryption hook when configured', async () => {
    const adapter = new LiveSyncAdapter({
      fetch: makeFetch([
        {
          _id: 'note-a',
          path: 'notes/blogs/a.md',
          children: ['h:enc'],
        },
        { _id: 'h:enc', data: '%=ciphertext' },
      ]),
      decryptChunk: async (cipher) => cipher.replace(/^%=/, 'plain-'),
    })
    await adapter.init(config)
    const note = await adapter.readNote('note-a')
    expect(note.content).toBe('plain-ciphertext')
  })
})
