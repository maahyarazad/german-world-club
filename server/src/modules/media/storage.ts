import { createHash } from 'node:crypto'
import { mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'

/**
 * Content-addressed object storage, with a local-disk and an S3-compatible
 * driver behind one interface (T144).
 *
 * Keying by the SHA-256 of the bytes rather than by an asset id buys three
 * things that matter elsewhere in this feature:
 *
 *  - **Dedupe.** Two members uploading the same partner logo store one copy.
 *  - **Safe retries.** A repeat after a breaker recovery produces identical
 *    bytes at an identical key, so a retry is idempotent by construction rather
 *    than by a cleanup job (media-pipeline.md §6).
 *  - **Immutability.** A URL's content can never change, because different
 *    bytes produce a different key. That is what makes
 *    `Cache-Control: immutable` honest rather than a promise we might break
 *    (FR-062).
 *
 * The corollary is that deleting an asset must NOT delete its bytes when
 * another asset shares the checksum — see `routes.js`, which is the only place
 * that decides.
 */

export const checksumOf = (buffer: Buffer | string): Buffer =>
  createHash('sha256').update(buffer).digest()
export const hexOf = (checksum: Buffer | string): string => Buffer.from(checksum).toString('hex')

const EXTENSION = Object.freeze({
  webp: 'webp', png: 'png', jpeg: 'jpg', webm: 'webm',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
} as Readonly<Record<string, string>>)

export const extensionFor = (formatOrMime: string): string => EXTENSION[formatOrMime] ?? 'bin'

/**
 * The storage key for a piece of content.
 *
 * Fanned out over two levels of hex prefix. A single flat directory with
 * hundreds of thousands of entries is slow to list and, on some filesystems,
 * slow to open; the prefix costs nothing and avoids the problem outright.
 */
export type KeyOptions = { variant?: string; format?: string }

export function keyFor(checksum: Buffer | string, { variant = 'original', format }: KeyOptions = {}): string {
  const hex = hexOf(checksum)
  const ext = extensionFor(format ?? 'bin')
  return `${hex.slice(0, 2)}/${hex.slice(2, 4)}/${hex}/${variant}.${ext}`
}

/** The four verbs every driver implements, and nothing else. */
export type StorageDriver = {
  driver: string
  put(key: string, body: Buffer, opts?: { contentType?: string }): Promise<{ key: string; bytes: number }>
  get(key: string): Promise<Buffer>
  remove(key: string): Promise<void>
  exists(key: string): Promise<boolean>
}

/** The undici `request` seam, narrowed to what the S3 driver uses. */
export type S3Request = (
  url: string,
  options: { method: string; headers?: Record<string, string>; body?: Buffer },
) => Promise<{ statusCode: number; body: { arrayBuffer(): Promise<ArrayBuffer> } }>

/**
 * Local disk. The development and test driver, and a legitimate deployment
 * choice for a single-host install.
 */
export function createLocalDriver({ root }: { root: string }): StorageDriver {
  const resolve = (key: string) => {
    const full = path.resolve(root, key)
    // A key is server-generated hex, but this is the boundary where a path
    // traversal would land if that ever stopped being true.
    if (!full.startsWith(path.resolve(root) + path.sep)) {
      throw new Error(`Refusing to operate outside the media root: ${key}`)
    }
    return full
  }

  return {
    driver: 'local',
    async put(key: string, body: Buffer) {
      const full = resolve(key)
      await mkdir(path.dirname(full), { recursive: true })
      // Content-addressed, so an existing file at this key already holds these
      // exact bytes. Rewriting it is harmless but pointless.
      await writeFile(full, body)
      return { key, bytes: body.length }
    },
    async get(key: string) {
      return readFile(resolve(key))
    },
    async remove(key: string) {
      await rm(resolve(key), { force: true })
    },
    async exists(key: string) {
      try {
        await stat(resolve(key))
        return true
      } catch {
        return false
      }
    },
  }
}

/**
 * S3-compatible object storage.
 *
 * Built on the `undici` dispatcher rather than the AWS SDK: this feature needs
 * exactly four verbs, and the per-dependency timeout control that
 * resilience.md §1's layer 4 requires is explicit here rather than buried in an
 * SDK's retry policy. Signing is SigV4, computed inline.
 */
export type S3DriverOptions = {
  bucket?: string
  endpoint?: string
  region?: string
  accessKeyId?: string
  secretAccessKey?: string
  request?: S3Request
}

export function createS3Driver({
  bucket, endpoint, region = 'us-east-1', accessKeyId, secretAccessKey, request,
}: S3DriverOptions): StorageDriver {
  if (!bucket || !endpoint) throw new Error('S3 storage requires MEDIA_S3_BUCKET and MEDIA_S3_ENDPOINT')

  const urlFor = (key: string) => `${endpoint!.replace(/\/$/, '')}/${bucket}/${key}`

  const sign = async (method: string, key: string, body?: Buffer): Promise<Record<string, string>> => {
    // Deliberately minimal SigV4: fixed payload hash, no chunked encoding, no
    // session tokens. Enough for the four verbs used here, and small enough to
    // read in one sitting.
    const { createHmac } = await import('node:crypto')
    const now = new Date()
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
    const dateStamp = amzDate.slice(0, 8)
    const payloadHash = createHash('sha256').update(body ?? '').digest('hex')
    const host = new URL(endpoint!).host
    const canonical = [
      method, `/${bucket}/${key}`, '',
      `host:${host}`, `x-amz-content-sha256:${payloadHash}`, `x-amz-date:${amzDate}`, '',
      'host;x-amz-content-sha256;x-amz-date', payloadHash,
    ].join('\n')
    const scope = `${dateStamp}/${region}/s3/aws4_request`
    const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonical).digest('hex')].join('\n')
    const hmac = (k: Buffer | string, d: string) => createHmac('sha256', k).update(d).digest()
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), 's3'), 'aws4_request')
    return {
      authorization:
        `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
        'SignedHeaders=host;x-amz-content-sha256;x-amz-date, ' +
        `Signature=${createHmac('sha256', signingKey).update(toSign).digest('hex')}`,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
    }
  }

  const send: S3Request = request ?? (async (url: string, options) => {
    const { request: undiciRequest } = await import('undici')
    return undiciRequest(url, options) as unknown as ReturnType<S3Request>
  })

  return {
    driver: 's3',
    async put(key: string, body: Buffer, { contentType }: { contentType?: string } = {}) {
      const headers = { ...(await sign('PUT', key, body)), 'content-type': contentType ?? 'application/octet-stream' }
      const response = await send(urlFor(key), { method: 'PUT', headers, body })
      if (response.statusCode >= 300) throw new Error(`S3 PUT ${key} failed: ${response.statusCode}`)
      return { key, bytes: body.length }
    },
    async get(key: string) {
      const response = await send(urlFor(key), { method: 'GET', headers: await sign('GET', key) })
      if (response.statusCode >= 300) throw new Error(`S3 GET ${key} failed: ${response.statusCode}`)
      return Buffer.from(await response.body.arrayBuffer())
    },
    async remove(key: string) {
      const response = await send(urlFor(key), { method: 'DELETE', headers: await sign('DELETE', key) })
      if (response.statusCode >= 300 && response.statusCode !== 404) {
        throw new Error(`S3 DELETE ${key} failed: ${response.statusCode}`)
      }
    },
    async exists(key: string) {
      const response = await send(urlFor(key), { method: 'HEAD', headers: await sign('HEAD', key) })
      return response.statusCode < 300
    },
  }
}

/** Pick the driver the environment asks for. */
/** Just the settings this module reads, named rather than the whole Env. */
export type StorageEnv = {
  MEDIA_STORAGE_DRIVER?: string
  MEDIA_S3_BUCKET?: string
  MEDIA_S3_ENDPOINT?: string
  MEDIA_S3_REGION?: string
  MEDIA_S3_ACCESS_KEY_ID?: string
  MEDIA_S3_SECRET_ACCESS_KEY?: string
  MEDIA_LOCAL_PATH: string
}

export function createStorage(env: StorageEnv): StorageDriver {
  if (env.MEDIA_STORAGE_DRIVER === 's3') {
    return createS3Driver({
      bucket: env.MEDIA_S3_BUCKET,
      endpoint: env.MEDIA_S3_ENDPOINT,
      region: env.MEDIA_S3_REGION,
      accessKeyId: env.MEDIA_S3_ACCESS_KEY_ID,
      secretAccessKey: env.MEDIA_S3_SECRET_ACCESS_KEY,
    })
  }
  return createLocalDriver({ root: env.MEDIA_LOCAL_PATH })
}

/**
 * An in-memory driver for tests.
 *
 * Exported from the production module on purpose: it implements the same
 * interface, and keeping it here means a change to that interface cannot leave
 * the test double behind.
 */
export function createMemoryDriver(): StorageDriver & { objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>()
  return {
    driver: 'memory',
    objects,
    async put(key: string, body: Buffer) {
      objects.set(key, Buffer.from(body))
      return { key, bytes: body.length }
    },
    async get(key: string) {
      const value = objects.get(key)
      if (!value) throw new Error(`No object at ${key}`)
      return value
    },
    async remove(key: string) {
      objects.delete(key)
    },
    async exists(key: string) {
      return objects.has(key)
    },
  }
}
