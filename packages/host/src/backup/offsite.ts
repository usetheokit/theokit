import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { containedPath, LEGACY_ROOTS, verifyBackupDir } from './archive.js'
import { BackupError } from './errors.js'
import { MANIFEST_NAME, readManifest } from './manifest.js'

export interface OffsiteOptions {
  /** Sent as `Authorization: Bearer`; never put in an error. */
  readonly token?: string
  /** Milliseconds each request, body included, may take. Default 60000. */
  readonly timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 60_000

/** `<url>/<path>` for an HTTPS object directory without credentials, query or fragment. */
function objectUrl(target: string, name: string): URL {
  let base: URL
  try {
    base = new URL(target.endsWith('/') ? target : `${target}/`)
  } catch {
    throw new BackupError('the offsite target is not a valid URL')
  }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
    throw new BackupError(
      'the offsite target must be an HTTPS object directory without credentials, query or fragment',
    )
  }
  return new URL(name.split('/').map(encodeURIComponent).join('/'), base)
}

async function transfer(
  target: string,
  name: string,
  options: OffsiteOptions,
  body?: Buffer,
): Promise<Buffer> {
  const upload = body !== undefined
  try {
    const response = await fetch(objectUrl(target, name), {
      method: upload ? 'PUT' : 'GET',
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(upload ? { 'If-None-Match': '*' } : {}),
      },
      ...(upload ? { body: new Uint8Array(body) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new BackupError(`offsite ${upload ? 'upload' : 'download'} failed (${response.status})`)
    }
    return Buffer.from(await response.arrayBuffer()) // the timeout covers the body too
  } catch (cause) {
    if (cause instanceof BackupError) throw cause
    throw new BackupError(`offsite ${upload ? 'upload' : 'download'} of ${name} failed`, { cause })
  }
}

/**
 * Upload a backup directory to an HTTPS object directory: each file the manifest lists, then
 * `manifest.json` last as the completion marker, so an interrupted upload is never a backup.
 */
export async function uploadDirectory(
  dir: string,
  target: string,
  options: OffsiteOptions = {},
): Promise<void> {
  objectUrl(target, MANIFEST_NAME) // refuse a bad target before anything is read
  await verifyBackupDir(dir, LEGACY_ROOTS)
  const manifest = await readManifest(dir, LEGACY_ROOTS)
  for (const entry of manifest.files) {
    const file = containedPath(dir, entry.path)
    await transfer(target, entry.path, options, await readFile(file))
  }
  await transfer(target, MANIFEST_NAME, options, await readFile(path.join(dir, MANIFEST_NAME)))
}

/** Download into the absent directory `dir` and verify every byte; on any failure `dir` is removed. */
export async function downloadDirectory(
  dir: string,
  target: string,
  options: OffsiteOptions = {},
): Promise<void> {
  objectUrl(target, MANIFEST_NAME)
  if (existsSync(dir))
    throw new BackupError('an offsite download needs an absent directory', { path: dir })
  await mkdir(dir, { recursive: true, mode: 0o700 })
  try {
    await writeFile(path.join(dir, MANIFEST_NAME), await transfer(target, MANIFEST_NAME, options), {
      mode: 0o600,
    })
    const manifest = await readManifest(dir, LEGACY_ROOTS)
    for (const root of manifest.roots)
      await mkdir(path.join(dir, root), { recursive: true, mode: 0o700 })
    for (const entry of manifest.files) {
      const to = containedPath(dir, entry.path)
      await mkdir(path.dirname(to), { recursive: true, mode: 0o700 })
      await writeFile(to, await transfer(target, entry.path, options), { mode: 0o600, flag: 'wx' })
    }
    await verifyBackupDir(dir, LEGACY_ROOTS)
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    throw error
  }
}
