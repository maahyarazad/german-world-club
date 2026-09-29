import { mkdir, writeFile, readFile, rm, stat, rename } from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import type { StorageDriver } from './storage.ts'

/**
 * Media stored on the API server's own disk, under `file_storage/`.
 *
 * Same `StorageDriver` interface and the same content-addressed keys as
 * `storage.ts` (which stays, for its key helpers, the S3 driver and the memory
 * double), so callers cannot tell which one they were handed.
 */

/** Where files live unless `FILE_STORAGE_PATH` says otherwise: `server/file_storage`. */
export const DEFAULT_FILE_STORAGE_PATH = './file_storage'

export type LocalStorageOptions = { root: string }

export function createLocalStorage({ root }: LocalStorageOptions): StorageDriver {
  const base = path.resolve(root)

  const resolve = (key: string) => {
    const full = path.resolve(base, key)
    // Keys are server-generated hex, but this is the boundary where a path
    // traversal would land if that ever stopped being true.
    if (!full.startsWith(base + path.sep)) {
      throw new Error(`Refusing to operate outside the file storage root: ${key}`)
    }
    return full
  }

  return {
    driver: 'local-server',
    async put(key: string, body: Buffer) {
      const full = resolve(key)
      await mkdir(path.dirname(full), { recursive: true })
      // Write beside the target and rename into place: rename is atomic on one
      // filesystem, so a concurrent reader (the variant route, a retry after a
      // crash) sees the whole file or none of it, never a truncated one.
      const temporary = `${full}.${randomBytes(6).toString('hex')}.tmp`
      try {
        await writeFile(temporary, body)
        await rename(temporary, full)
      } catch (error) {
        await rm(temporary, { force: true })
        throw error
      }
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
        return (await stat(resolve(key))).isFile()
      } catch {
        return false
      }
    },
  }
}
