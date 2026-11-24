import { spawnSync } from 'node:child_process'

/** Runs `git <args>`; `ok` is false when git could not be run or exited with an error. */
export type GitRun = (args: string[]) => { ok: boolean; stdout: string }

export interface TurnDiffOptions {
  /** The repository the paths are relative to. Used by the default runner. */
  readonly cwd: string
  /** Replaces the default git runner (tests, or a caller that routes warnings). */
  readonly run?: GitRun
}

const GIT_TIMEOUT_MS = 10_000

function defaultRun(cwd: string): GitRun {
  return (args) => {
    const res = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    })
    if (res.error !== undefined) return { ok: false, stdout: res.error.message }
    // `git diff --no-index` exits 1 when the files differ; that is an answer, not a failure.
    const ok = res.status === 0 || (res.status === 1 && args.includes('--no-index'))
    return { ok, stdout: ok ? res.stdout : `${res.stderr}${res.stdout}` }
  }
}

/**
 * The diff of `paths` against the index, new files included; `undefined` when nothing changed.
 * Read-only: new files are diffed against /dev/null rather than added with `git add -N`.
 */
export function turnDiff(paths: readonly string[], options: TurnDiffOptions): string | undefined {
  if (paths.length === 0) return undefined
  const git = options.run ?? defaultRun(options.cwd)

  const status = git(['status', '--porcelain', '-z', '--untracked-files=all', '--', ...paths])
  if (!status.ok) return unavailable(paths, status.stdout)
  const untracked = new Set<string>()
  const entries = status.stdout.split('\0')
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] ?? ''
    if (entry.startsWith('??')) {
      const p = entry.slice(3)
      if (p.length > 0) untracked.add(p)
    } else if (entry.startsWith('R') || entry.startsWith('C')) {
      i++ // a rename carries the old name as a further field
    }
  }
  const tracked = paths.filter((p) => !untracked.has(p) && !isUnderUntracked(p, untracked))

  const parts: string[] = []
  if (tracked.length > 0) {
    const res = git(['diff', '--', ...tracked])
    if (!res.ok) return unavailable(paths, res.stdout)
    parts.push(res.stdout.trim())
  }
  for (const p of untracked) {
    const res = git(['diff', '--no-index', '--', '/dev/null', p])
    const body = res.stdout.trim()
    if (body.length > 0) parts.push(body)
  }
  const body = parts.filter((p) => p.length > 0).join('\n')
  return body.length === 0 ? undefined : body
}

function isUnderUntracked(p: string, untracked: ReadonlySet<string>): boolean {
  const prefix = p.endsWith('/') ? p : `${p}/`
  for (const u of untracked) if (u.startsWith(prefix)) return true
  return false
}

function unavailable(paths: readonly string[], detail: string): string {
  return `[diff] the changes to ${String(paths.length)} file(s) could not be shown: ${detail.trim()}`
}
