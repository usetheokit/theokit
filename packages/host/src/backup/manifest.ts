import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, sep } from 'node:path'

import { BackupError } from './errors.js'

export interface ManifestEntry {
  readonly path: string
  readonly sha256: string
  readonly size: number
}

export interface BackupManifest {
  readonly version: 1
  readonly files: readonly ManifestEntry[]
  readonly roots: readonly string[]
}

export const MANIFEST_NAME = 'manifest.json'

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => {
        resolve(hash.digest('hex'))
      })
  })
}

/** Split a manifest path into its root and relative parts, refusing anything that leaves the root. */
export function splitEntryPath(
  path: string,
  roots: readonly string[],
): { root: string; relative: string } {
  const parts = path.split('/')
  const [root, ...rest] = parts
  if (
    isAbsolute(path) ||
    (sep === '\\' && path.includes('\\')) ||
    path.includes('\0') ||
    rest.length === 0 ||
    parts.some((part) => part === '' || part === '.' || part === '..') ||
    !roots.includes(root)
  ) {
    throw new BackupError(`manifest path "${path}" is not a file inside a declared root`, { path })
  }
  return { root, relative: rest.join('/') }
}

/**
 * Read `manifest.json`. A manifest written before roots were recorded has none: `legacyRoots`
 * names the roots to verify it with; the file itself is not changed.
 */
export async function readManifest(
  from: string,
  legacyRoots?: readonly string[],
): Promise<BackupManifest> {
  const file = join(from, MANIFEST_NAME)
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (cause) {
    throw new BackupError(`cannot read ${file}`, { path: file, cause })
  }
  return parseManifest(text, file, legacyRoots)
}

/** Parse and validate manifest text; `file` only names the source in errors. */
export function parseManifest(
  text: string,
  file: string,
  legacyRoots?: readonly string[],
): BackupManifest {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (cause) {
    throw new BackupError(`cannot read ${file}`, { path: file, cause })
  }
  const m = value as Partial<BackupManifest> | null
  if (legacyRoots !== undefined && m !== null && typeof m === 'object' && m.roots === undefined) {
    ;(m as { roots?: readonly string[] }).roots = legacyRoots
  }
  if (
    m === null ||
    typeof m !== 'object' ||
    m.version !== 1 ||
    !Array.isArray(m.roots) ||
    !m.roots.every((r) => typeof r === 'string') ||
    !Array.isArray(m.files)
  ) {
    throw new BackupError(`${file} is not a version 1 backup manifest`, { path: file })
  }
  const seen = new Set<string>()
  for (const entry of m.files as unknown[]) {
    const e = entry as Partial<ManifestEntry> | null
    if (
      e === null ||
      typeof e !== 'object' ||
      typeof e.path !== 'string' ||
      typeof e.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(e.sha256) ||
      typeof e.size !== 'number' ||
      !Number.isInteger(e.size) ||
      e.size < 0
    ) {
      throw new BackupError(`${file} holds a malformed entry`, { path: file })
    }
    splitEntryPath(e.path, m.roots)
    if (seen.has(e.path))
      throw new BackupError(`manifest lists "${e.path}" twice`, { path: e.path })
    seen.add(e.path)
  }
  return m as BackupManifest
}
