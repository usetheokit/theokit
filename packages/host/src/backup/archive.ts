import { createReadStream } from 'node:fs'
import { lstat, mkdir, open, readdir, type FileHandle } from 'node:fs/promises'
import path from 'node:path'

import { BackupError } from './errors.js'
import { readManifest, sha256File, splitEntryPath } from './manifest.js'

/** Inner stream: entries of `type, u16 path length, path`, files then `u64 size, bytes`; a 0 byte ends it. */
const END = 0
const DIR = 1
const FILE = 2

type PathImpl = Pick<typeof path, 'isAbsolute' | 'resolve' | 'relative' | 'sep'>

/** Where archive entry `entry` (always `/`-separated) lands below `base`; anything that escapes `base` is refused. */
export function containedPath(base: string, entry: string, impl: PathImpl = path): string {
  const parts = entry.split('/')
  if (
    entry === '' ||
    entry.includes('\0') ||
    entry.includes('\\') ||
    (impl.sep === '\\' && entry.includes(':')) ||
    impl.isAbsolute(entry) ||
    parts.some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new BackupError(`archive entry "${entry}" is not a path inside the backup`, {
      path: entry,
    })
  }
  const target = impl.resolve(base, ...parts)
  const relative = impl.relative(base, target)
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${impl.sep}`) ||
    impl.isAbsolute(relative)
  ) {
    throw new BackupError(`archive entry "${entry}" leaves the backup`, { path: entry })
  }
  return target
}

function entryHeader(type: number, name: string, size?: number): Buffer {
  const bytes = Buffer.from(name, 'utf8')
  if (bytes.length > 0xffff) throw new BackupError(`path ${name} is too long to archive`)
  const head = Buffer.alloc(3)
  head[0] = type
  head.writeUInt16BE(bytes.length, 1)
  const parts: Buffer[] = [head, bytes]
  if (size !== undefined) {
    const length = Buffer.alloc(8)
    length.writeBigUInt64BE(BigInt(size))
    parts.push(length)
  }
  return Buffer.concat(parts)
}

async function* walk(base: string, relative: string): AsyncGenerator<Buffer> {
  const dir = relative === '' ? base : path.join(base, ...relative.split('/'))
  for (const name of (await readdir(dir)).sort((x, y) => x.localeCompare(y))) {
    const rel = relative === '' ? name : `${relative}/${name}`
    const file = path.join(dir, name)
    const info = await lstat(file)
    if (info.isSymbolicLink()) {
      throw new BackupError(`${file} is a symbolic link; a backup follows none`, { path: file })
    }
    if (info.isDirectory()) {
      yield entryHeader(DIR, rel)
      yield* walk(base, rel)
    } else if (info.isFile()) {
      yield entryHeader(FILE, rel, info.size)
      let count = 0
      for await (const chunk of createReadStream(file) as AsyncIterable<Buffer>) {
        count += chunk.length
        if (count > info.size) break
        yield chunk
      }
      if (count !== info.size) {
        throw new BackupError(`${file} changed while it was archived`, { path: file })
      }
    } else {
      throw new BackupError(`${file} is not a regular file or directory`, { path: file })
    }
  }
}

/** The directory as a stream of archive bytes; file contents are read through streams. */
export async function* packDirectory(dir: string): AsyncGenerator<Buffer> {
  yield* walk(dir, '')
  yield Buffer.from([END])
}

class Reader {
  private current: Buffer = Buffer.alloc(0)
  constructor(private readonly source: AsyncIterator<Buffer>) {}

  private async pull(): Promise<void> {
    const next = await this.source.next()
    if (next.done === true) throw new BackupError('the archive is truncated')
    this.current =
      this.current.length === 0 ? next.value : Buffer.concat([this.current, next.value])
  }

  async take(count: number): Promise<Buffer> {
    while (this.current.length < count) await this.pull()
    const out = this.current.subarray(0, count)
    this.current = this.current.subarray(count)
    return out
  }

  async *body(count: number): AsyncGenerator<Buffer> {
    let left = count
    while (left > 0) {
      if (this.current.length === 0) await this.pull()
      const piece = this.current.subarray(0, Math.min(left, this.current.length))
      this.current = this.current.subarray(piece.length)
      left -= piece.length
      if (piece.length > 0) yield piece
    }
  }

  /** Drain the source (an encrypted archive authenticates here); bytes after the end marker are refused. */
  async finish(): Promise<void> {
    let extra = this.current.length
    for (let next = await this.source.next(); next.done !== true; next = await this.source.next()) {
      extra += next.value.length
    }
    if (extra > 0) throw new BackupError('the archive holds data after its end')
  }
}

async function writeAll(handle: FileHandle, chunk: Buffer): Promise<void> {
  let offset = 0
  while (offset < chunk.length) {
    offset += (await handle.write(chunk, offset, chunk.length - offset)).bytesWritten
  }
}

/** Write the archive's entries below `target`, which must exist. Nothing is trusted until this resolves. */
export async function unpackInto(plain: AsyncIterable<Buffer>, target: string): Promise<void> {
  const source = plain[Symbol.asyncIterator]()
  const reader = new Reader(source)
  try {
    const seen = new Set<string>()
    for (;;) {
      const type = (await reader.take(1))[0]
      if (type === END) break
      if (type !== DIR && type !== FILE) throw new BackupError('the archive holds an unknown entry')
      const length = (await reader.take(2)).readUInt16BE(0)
      const name = (await reader.take(length)).toString('utf8')
      const dest = containedPath(target, name)
      if (seen.has(name)) throw new BackupError(`archive lists "${name}" twice`, { path: name })
      seen.add(name)
      if (type === DIR) {
        await mkdir(dest, { recursive: true, mode: 0o700 })
        continue
      }
      const size = Number((await reader.take(8)).readBigUInt64BE(0))
      if (!Number.isSafeInteger(size)) throw new BackupError(`archive entry "${name}" is too large`)
      await mkdir(path.dirname(dest), { recursive: true, mode: 0o700 })
      const handle = await open(dest, 'wx', 0o600)
      try {
        for await (const chunk of reader.body(size)) await writeAll(handle, chunk)
      } finally {
        await handle.close()
      }
    }
    await reader.finish()
  } finally {
    await source.return?.()
  }
}

/** The roots a TheoClaw backup holds; its older manifests do not list them. */
export const LEGACY_ROOTS: readonly string[] = ['state', 'workspace']

/**
 * Write the files of an older TheoClaw archive (`{ files: [{ path, data: base64 }] }`) below
 * `target`, which must exist, with both roots present even when empty. Nothing is trusted until
 * the caller has verified the manifest.
 */
export async function unpackLegacyInto(plain: Buffer, target: string): Promise<void> {
  let payload: unknown
  try {
    payload = JSON.parse(plain.toString('utf8'))
  } catch (cause) {
    throw new BackupError('the archive is not a backup archive', { cause })
  }
  const files = (payload as { files?: unknown } | null)?.files
  if (!Array.isArray(files)) throw new BackupError('the archive is not a backup archive')
  for (const root of LEGACY_ROOTS)
    await mkdir(path.join(target, root), { recursive: true, mode: 0o700 })
  const seen = new Set<string>()
  for (const file of files as unknown[]) {
    const f = file as { path?: unknown; data?: unknown } | null
    if (typeof f?.path !== 'string' || typeof f.data !== 'string') {
      throw new BackupError('the archive holds a malformed entry')
    }
    const dest = containedPath(target, f.path)
    if (seen.has(f.path)) throw new BackupError(`archive lists "${f.path}" twice`, { path: f.path })
    seen.add(f.path)
    await mkdir(path.dirname(dest), { recursive: true, mode: 0o700 })
    const handle = await open(dest, 'wx', 0o600)
    try {
      await writeAll(handle, Buffer.from(f.data, 'base64'))
    } finally {
      await handle.close()
    }
  }
}

/** Check every file the manifest lists exists with its size and sha256. */
export async function verifyBackupDir(dir: string, legacyRoots?: readonly string[]): Promise<void> {
  const manifest = await readManifest(dir, legacyRoots)
  for (const entry of manifest.files) {
    const { root, relative } = splitEntryPath(entry.path, manifest.roots)
    const file = path.join(dir, root, ...relative.split('/'))
    const info = await lstat(file).catch((cause: unknown) => {
      throw new BackupError(`backup file ${file} is missing`, { path: file, cause })
    })
    if (!info.isFile() || info.size !== entry.size || (await sha256File(file)) !== entry.sha256) {
      throw new BackupError(`backup file ${file} does not match its manifest`, { path: file })
    }
  }
}
