/* eslint-disable security/detect-non-literal-fs-filename --
 * Build-time scanner: walks directories derived from cwd.
 * No HTTP input ever reaches these fs calls.
 */
import { readdirSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { extname, join, resolve } from 'node:path'

import { compareByCodeUnit } from './compare-by-code-unit.js'

/**
 * Options for walkSourceFiles.
 *
 * Sequential by design — callers (route precedence) depend on insertion
 * order (EC-19 documented decision). Async-callback support is implicit
 * via JavaScript's serial await loop.
 *
 * Tested on macOS + Linux. Windows long-path support not validated (EC-20).
 */
interface WalkOptions {
  /** File extensions to include (e.g., new Set(['.ts', '.tsx'])). */
  extensions: ReadonlySet<string>
  /** Skip directories whose name starts with any of these (default: ['_', '.']). */
  skipPrefixes?: readonly string[]
  /**
   * Read one directory. Defaults to `readdirSync`.
   *
   * Injected for one reason: the ordering below cannot be tested against a real
   * filesystem. `readdirSync` returns whatever the filesystem returns — creation
   * order on tmpfs, hash order on ext4 with `dir_index` — and on the machine
   * this was written on those four names came back already sorted, so a
   * name-based test passed before the sort existed and proved nothing. A test
   * that agrees with the code because both read the same accidental order is
   * `B-022`, and writing one here would have been that item committed inside its
   * own fix.
   */
  readDir?: (dir: string) => Dirent[]
}

/**
 * Recursively walk `root`, invoking `onFile(absPath)` for every file matching
 * `opts.extensions`. Directories whose name starts with any `skipPrefixes`
 * char are skipped (defaults to `_` and `.`).
 *
 * Entries are emitted in UTF-16 code-unit order, files and directories in one
 * total order. Without it the walker passed the filesystem's order through to
 * six scanners — routes, actions, websockets, cron, agents, jobs — and only one
 * re-orders afterwards, so five emitted a different manifest per machine. Where
 * that order is an execution order it decides what runs first (#346, B-004).
 *
 * Replaces 3 near-identical recursive walkers in scan.ts, action-scan.ts,
 * ws-scan.ts (PV-3 — DRY consolidation). Resolves T3.1 of
 * architecture-review-remediation-plan. Six call sites consume it today, not
 * three; the count in this paragraph was true when it was written.
 *
 * Symlink loops are NOT tracked — callers must avoid them or pre-resolve
 * via `fs.realpath`. EC-11 documented but not implemented (rare in dev).
 */
export function walkSourceFiles(
  root: string,
  opts: WalkOptions,
  onFile: (absPath: string) => void,
): void {
  const skipPrefixes = opts.skipPrefixes ?? ['_', '.']
  const readDir = opts.readDir ?? ((dir: string) => readdirSync(dir, { withFileTypes: true }))
  const visit = (dir: string): void => {
    let entries
    try {
      entries = readDir(dir)
    } catch {
      // Silently skip unreadable directories — caller controls discoverability
      return
    }
    // One total order over files and directories together, so a name sorts the
    // same way whichever it is. Sorting the two groups separately would emit a
    // different interleaving than a single pass, which is an ordering decision
    // nobody made (#346).
    const ordered = [...entries].sort((a, b) => compareByCodeUnit(a.name, b.name))
    for (const entry of ordered) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory() && !skipPrefixes.some((p) => entry.name.startsWith(p))) {
        visit(fullPath)
      } else if (entry.isFile() && opts.extensions.has(extname(entry.name))) {
        onFile(resolve(fullPath))
      }
    }
  }
  visit(root)
}
