/**
 * Memoise per source file, invalidated by the file's own stamp.
 *
 * ## Why this exists
 *
 * `theokit dev` re-scans the routes and agents directories on EVERY request, so any work that
 * parses a file with the TypeScript AST turns a build-time check into per-request latency.
 * `agent-scan.ts` recognised this and carried its own `Map` keyed on `path:mtimeMs:size`;
 * `scan.ts` — with far more files — carried neither the cache nor the reasoning, and the
 * route-policy gate then added a SECOND full parse of every route file on top of the one
 * `detectExportedHttpMethods` had been paying since before it (usetheokit/theokit#417).
 *
 * Lifting the mechanism here rather than copying it is the point: two hand-rolled caches keyed
 * "the same way" are two chances for the keys to stop being the same.
 *
 * ## Why the stamp and not a watcher
 *
 * `mtimeMs` and `size` together come from the `statSync` the scanner is doing anyway, so an edit
 * invalidates the entry without anyone remembering to, and a `theokit build` — one process, one
 * scan — never notices the cache exists.
 *
 * The known limit, stated rather than discovered: a rewrite that preserves BOTH mtime and size is
 * invisible. That is a deliberate trade every mtime cache makes, and the alternative (hashing the
 * contents) reads the file to avoid reading the file.
 */
import { statSync } from 'node:fs'

export interface FileStampCache<T> {
  /** The memoised value for `filePath`, computing it when the file's stamp has changed. */
  get: (filePath: string, compute: () => T) => T
  /** Test seam — a module-level cache would otherwise outlive a fixture directory. */
  clear: () => void
}

export function createFileStampCache<T>(): FileStampCache<T> {
  const entries = new Map<string, T>()

  return {
    get(filePath, compute) {
      // A path the scanner itself discovered by globbing the project, never caller input at runtime.
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- see above
      const stat = statSync(filePath)
      const key = `${filePath}:${String(stat.mtimeMs)}:${String(stat.size)}`

      const hit = entries.get(key)
      // `has` rather than a truthiness check on the value: `false`, `0` and `''` are all legitimate
      // results to cache, and a truthiness test would recompute them on every call — which is the
      // defect this file exists to remove, wearing a subtler hat.
      if (hit !== undefined || entries.has(key)) return hit as T

      const value = compute()
      entries.set(key, value)
      return value
    },
    clear() {
      entries.clear()
    },
  }
}
