/**
 * Helpers for shaping documents the way Obsidian LiveSync stores them in CouchDB
 * with Path Obfuscation / Property Encryption disabled.
 *
 * LiveSync splits a note body into chunks (`h:<hash>`) and stores them as
 * separate documents alongside a metadata document that references them through
 * `children` (or `eden` for small notes). See
 * specs/blog-publish-via-livesync/research/livesync-couchdb-schema.md for the
 * upstream layout we mimic.
 */

import { createHash } from 'node:crypto'

export interface LiveSyncMetaDoc {
  _id: string
  path: string
  mtime: number
  size: number
  type: 'plain' | 'newnote' | 'notes'
  children: string[]
}

export interface LiveSyncChunkDoc {
  _id: string
  data: string
}

export interface NoteFixture {
  meta: LiveSyncMetaDoc
  chunks: LiveSyncChunkDoc[]
}

function chunkId(data: string): string {
  return `h:${createHash('sha1').update(data).digest('hex').slice(0, 20)}`
}

/** Build a LiveSync-shaped note from a path + content string. */
export function buildNoteFixture(input: {
  docId: string
  path: string
  content: string
  mtime?: number
}): NoteFixture {
  const chunkSize = 1024
  const chunks: LiveSyncChunkDoc[] = []
  const childIds: string[] = []
  for (let i = 0; i < input.content.length; i += chunkSize) {
    const data = input.content.slice(i, i + chunkSize)
    const id = chunkId(`${input.docId}:${String(i)}:${data}`)
    chunks.push({ _id: id, data })
    childIds.push(id)
  }
  return {
    meta: {
      _id: input.docId,
      path: input.path,
      mtime: input.mtime ?? Date.now(),
      size: input.content.length,
      type: 'plain',
      children: childIds,
    },
    chunks,
  }
}

export const livesyncVersionDoc = {
  _id: 'obsydian_livesync_version',
  useObfuscatedPath: false,
  usePathObfuscation: false,
  usePropertyEncryption: false,
}
