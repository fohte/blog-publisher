/**
 * Service control helpers shared by E2E tests.
 *
 * The tests target the CouchDB + MinIO stack defined in docker-compose.e2e.yml.
 * Endpoints can be overridden through environment variables (`E2E_COUCHDB_URL`,
 * `E2E_S3_ENDPOINT`) but default to the localhost ports exposed by the
 * compose file. If the services are unreachable, `probeServices()` returns
 * `false` so the suite can skip cleanly instead of failing CI.
 */

import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3'

import {
  type LiveSyncChunkDoc,
  type LiveSyncMetaDoc,
  livesyncVersionDoc,
  type NoteFixture,
} from './fixtures'

export interface E2EEndpoints {
  couchUrl: string
  couchUser: string
  couchPassword: string
  couchDatabase: string
  s3Endpoint: string
  s3AccessKey: string
  s3SecretKey: string
  s3Bucket: string
  s3PublicBaseUrl: string
}

export function resolveEndpoints(): E2EEndpoints {
  return {
    couchUrl: process.env['E2E_COUCHDB_URL'] ?? 'http://127.0.0.1:5984',
    couchUser: process.env['E2E_COUCHDB_USER'] ?? 'admin',
    couchPassword: process.env['E2E_COUCHDB_PASSWORD'] ?? 'password',
    couchDatabase: process.env['E2E_COUCHDB_DATABASE'] ?? 'blog_e2e',
    s3Endpoint: process.env['E2E_S3_ENDPOINT'] ?? 'http://127.0.0.1:9000',
    s3AccessKey: process.env['E2E_S3_ACCESS_KEY'] ?? 'minioadmin',
    s3SecretKey: process.env['E2E_S3_SECRET_KEY'] ?? 'minioadmin',
    s3Bucket: process.env['E2E_S3_BUCKET'] ?? 'blog-e2e',
    s3PublicBaseUrl:
      process.env['E2E_S3_PUBLIC_BASE_URL'] ?? 'https://cdn.example.test',
  }
}

function couchAuthHeader(ep: E2EEndpoints): string {
  return (
    'Basic ' +
    Buffer.from(`${ep.couchUser}:${ep.couchPassword}`).toString('base64')
  )
}

function dbUrl(ep: E2EEndpoints): string {
  return `${ep.couchUrl.replace(/\/$/, '')}/${ep.couchDatabase}`
}

export async function probeServices(ep: E2EEndpoints): Promise<boolean> {
  try {
    const couch = await fetch(`${ep.couchUrl.replace(/\/$/, '')}/_up`)
    if (!couch.ok) return false
    const s3 = await fetch(`${ep.s3Endpoint}/minio/health/live`)
    if (!s3.ok) return false
    return true
  } catch {
    return false
  }
}

export async function resetCouchDb(ep: E2EEndpoints): Promise<void> {
  const headers = {
    Authorization: couchAuthHeader(ep),
    'Content-Type': 'application/json',
  }
  await fetch(dbUrl(ep), { method: 'DELETE', headers })
  const create = await fetch(dbUrl(ep), { method: 'PUT', headers })
  if (!create.ok && create.status !== 412) {
    throw new Error(
      `failed to create CouchDB database: ${String(create.status)}`,
    )
  }
}

export async function insertDoc(
  ep: E2EEndpoints,
  doc: Record<string, unknown> & { _id: string },
): Promise<void> {
  const res = await fetch(`${dbUrl(ep)}/${encodeURIComponent(doc._id)}`, {
    method: 'PUT',
    headers: {
      Authorization: couchAuthHeader(ep),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(doc),
  })
  if (!res.ok) {
    throw new Error(
      `failed to insert ${doc._id}: ${String(res.status)} ${await res.text()}`,
    )
  }
}

export async function insertVersionDoc(ep: E2EEndpoints): Promise<void> {
  await insertDoc(ep, livesyncVersionDoc)
}

export async function insertNote(
  ep: E2EEndpoints,
  fixture: NoteFixture,
): Promise<void> {
  for (const chunk of fixture.chunks) {
    await insertDoc(ep, chunk as LiveSyncChunkDoc & Record<string, unknown>)
  }
  await insertDoc(ep, fixture.meta as LiveSyncMetaDoc & Record<string, unknown>)
}

export function makeS3Client(ep: E2EEndpoints): S3Client {
  return new S3Client({
    region: 'us-east-1',
    endpoint: ep.s3Endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: ep.s3AccessKey,
      secretAccessKey: ep.s3SecretKey,
    },
  })
}

export async function resetBucket(
  s3: S3Client,
  ep: E2EEndpoints,
): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: ep.s3Bucket }))
    const list = await s3.send(
      new ListObjectsV2Command({ Bucket: ep.s3Bucket }),
    )
    if (list.Contents && list.Contents.length > 0) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: ep.s3Bucket,
          Delete: {
            Objects: list.Contents.map((o) => ({ Key: o.Key ?? '' })),
          },
        }),
      )
    }
  } catch (e) {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } }
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      await s3.send(new CreateBucketCommand({ Bucket: ep.s3Bucket }))
    } else {
      throw e
    }
  }
}
