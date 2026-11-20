import { closeSync, openSync, readSync } from 'node:fs'
import { createRequire } from 'node:module'

import { BackupError } from './errors.js'

/** Detect SQLite by its 16-byte header, so databases without a conventional extension are found. */
export function isSQLite(path: string): boolean {
  const fd = openSync(path, 'r')
  try {
    const header = Buffer.alloc(16)
    return readSync(fd, header, 0, 16, 0) === 16 && header.toString() === 'SQLite format 3\0'
  } finally {
    closeSync(fd)
  }
}

const SIDECAR = /^(.+)-(wal|shm|journal)$/

/** The database a `-wal`, `-shm` or `-journal` file belongs to, or undefined for any other name. */
export function sidecarOf(relativePath: string): string | undefined {
  return SIDECAR.exec(relativePath)?.[1]
}

interface SqliteModule {
  DatabaseSync: new (
    path: string,
    options?: { readOnly?: boolean },
  ) => { exec(sql: string): void; close(): void }
  backup?: (db: unknown, target: string) => Promise<unknown>
}

/** A consistent snapshot of `from` at `to`, without sidecars, through the asynchronous `node:sqlite` backup API. */
export async function snapshotSQLite(from: string, to: string): Promise<void> {
  const sqlite = createRequire(import.meta.url)('node:sqlite') as SqliteModule
  if (typeof sqlite.backup !== 'function') {
    throw new BackupError('backing up a SQLite database needs Node 22.16 or later', { path: from })
  }
  const db = new sqlite.DatabaseSync(from, { readOnly: true })
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    await sqlite.backup(db, to)
  } finally {
    db.close()
  }
}
