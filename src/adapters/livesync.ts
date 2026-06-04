import { DomainError } from '@/domain/errors'

export interface LiveSyncConfig {
  couchUrl: string
  username: string
  password: string
  database: string
  passphrase?: string
}

export interface NoteMetadata {
  docId: string
  path: string
  mtime: number
  size: number
}

export interface LiveSyncNote {
  docId: string
  path: string
  content: string
  mtime: number
  size: number
}

interface MetadataDocument {
  _id: string
  path?: string
  ctime?: number
  mtime?: number
  size?: number
  type?: 'plain' | 'newnote' | 'notes'
  children?: string[]
  eden?: Record<string, { data: string }>
  // When Property Encryption is enabled these fields are absent and a single ciphertext field appears.
  encrypted?: string
}

interface ChunkDocument {
  _id: string
  data: string
}

interface AllDocsResponse {
  rows: Array<{
    id: string
    doc?: MetadataDocument | ChunkDocument
    key?: string
  }>
}

type Fetch = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  status: number
  ok: boolean
  json: () => Promise<unknown>
  text: () => Promise<string>
}>

/**
 * Direct CouchDB reader for Obsidian LiveSync vault databases.
 *
 * Follows the documented LiveSync data layout (MetadataDocument + EntryLeaf chunks).
 * Path Obfuscation / Property Encryption are not supported here — when detected at init
 * the adapter throws so the Service can fail-fast. E2EE chunk decryption requires the
 * full LiveSync src/lib (HKDF v12 keying); when a passphrase is configured but no
 * decryption hook is wired in, reads of encrypted chunks throw NoteDecryptFailed.
 */
export class LiveSyncAdapter {
  private config: LiveSyncConfig | null = null
  private readonly fetchImpl: Fetch
  private authHeader = ''
  private baseUrl = ''
  private decryptChunk?: (cipher: string) => Promise<string>

  constructor(
    options: {
      fetch?: Fetch
      decryptChunk?: (cipher: string) => Promise<string>
    } = {},
  ) {
    this.fetchImpl = options.fetch ?? globalThis.fetch
    if (options.decryptChunk !== undefined)
      this.decryptChunk = options.decryptChunk
  }

  async init(config: LiveSyncConfig): Promise<void> {
    this.config = config
    this.baseUrl = `${config.couchUrl.replace(/\/$/, '')}/${config.database}`
    this.authHeader =
      'Basic ' +
      Buffer.from(`${config.username}:${config.password}`).toString('base64')

    // Probe a known LiveSync configuration document to detect Path Obfuscation / Property Encryption.
    try {
      const flags = await this.getDoc<{
        useObfuscatedPath?: boolean
        usePropertyEncryption?: boolean
        usePathObfuscation?: boolean
      }>('obsydian_livesync_version')
      if (
        flags?.useObfuscatedPath === true ||
        flags?.usePathObfuscation === true
      ) {
        throw new DomainError(
          'NoteDecryptFailed',
          'LiveSync Path Obfuscation is enabled; disable it before running the publisher',
        )
      }
      if (flags?.usePropertyEncryption === true) {
        throw new DomainError(
          'NoteDecryptFailed',
          'LiveSync Property Encryption is enabled; disable it before running the publisher',
        )
      }
    } catch (e) {
      if (e instanceof DomainError) throw e
      // Missing version doc is acceptable for tests/integration probes.
    }
  }

  private requireConfig(): LiveSyncConfig {
    if (this.config === null)
      throw new Error('LiveSyncAdapter not initialized; call init() first')
    return this.config
  }

  private async getDoc<T>(id: string): Promise<T | null> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/${encodeURIComponent(id)}`,
      {
        headers: { Authorization: this.authHeader, Accept: 'application/json' },
      },
    )
    if (res.status === 404) return null
    if (!res.ok) {
      throw new Error(`CouchDB GET ${id} failed: ${String(res.status)}`)
    }
    return (await res.json()) as T
  }

  async listNotesByPath(prefix: string): Promise<NoteMetadata[]> {
    this.requireConfig()
    // Use _all_docs with include_docs and filter client-side by `path`.
    // For metadata-only listing we avoid include_docs=true on huge vaults in production
    // by using a view; for now the simple path is acceptable.
    const res = await this.fetchImpl(
      `${this.baseUrl}/_all_docs?include_docs=true`,
      {
        headers: { Authorization: this.authHeader, Accept: 'application/json' },
      },
    )
    if (!res.ok) {
      throw new Error(`CouchDB _all_docs failed: ${String(res.status)}`)
    }
    const body = (await res.json()) as AllDocsResponse
    const out: NoteMetadata[] = []
    for (const row of body.rows) {
      const doc = row.doc as MetadataDocument | undefined
      if (doc === undefined) continue
      if (doc.path === undefined) continue
      if (!doc.path.startsWith(prefix)) continue
      if (!Array.isArray(doc.children) && doc.eden === undefined) continue
      out.push({
        docId: doc._id,
        path: doc.path,
        mtime: doc.mtime ?? 0,
        size: doc.size ?? 0,
      })
    }
    return out
  }

  private async decode(cipher: string): Promise<string> {
    if (!cipher.startsWith('%=') && !cipher.startsWith('%')) return cipher
    if (this.decryptChunk === undefined) {
      throw new DomainError(
        'NoteDecryptFailed',
        'encrypted chunk encountered but no decryption hook configured',
      )
    }
    return this.decryptChunk(cipher)
  }

  async readNote(docId: string): Promise<LiveSyncNote> {
    this.requireConfig()
    const meta = await this.getDoc<MetadataDocument>(docId)
    if (meta === null) {
      throw new DomainError('NoteDecryptFailed', `note not found: ${docId}`)
    }
    if (meta.path === undefined) {
      throw new DomainError(
        'NoteDecryptFailed',
        `path missing on note metadata (Property Encryption?): ${docId}`,
      )
    }
    const chunkIds = meta.children ?? []
    let body = ''
    if (chunkIds.length > 0) {
      const res = await this.fetchImpl(
        `${this.baseUrl}/_all_docs?include_docs=true`,
        {
          method: 'POST',
          headers: {
            Authorization: this.authHeader,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ keys: chunkIds }),
        },
      )
      if (!res.ok) {
        throw new Error(
          `CouchDB _all_docs (chunks) failed: ${String(res.status)}`,
        )
      }
      const data = (await res.json()) as AllDocsResponse
      const byId = new Map<string, ChunkDocument>()
      for (const row of data.rows) {
        const d = row.doc as ChunkDocument | undefined
        if (d !== undefined) byId.set(d._id, d)
      }
      for (const id of chunkIds) {
        const c = byId.get(id)
        if (c === undefined) {
          throw new DomainError(
            'NoteDecryptFailed',
            `missing chunk ${id} for note ${docId}`,
          )
        }
        body += await this.decode(c.data)
      }
    } else if (meta.eden !== undefined) {
      for (const v of Object.values(meta.eden)) {
        body += await this.decode(v.data)
      }
    }
    return {
      docId: meta._id,
      path: meta.path,
      content: body,
      mtime: meta.mtime ?? 0,
      size: meta.size ?? body.length,
    }
  }
}
