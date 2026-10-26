import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, sep } from 'node:path'

/** The default base: outside `/tmp`, which the `workspace-write` sandbox leaves writable. */
export const DEFAULT_TEST_WORKSPACE_ROOT = join(homedir(), '.cache', 'theoclaw-tests')

function insideGitRepository(start: string): boolean {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return true
    if (dirname(dir) === dir) return false
  }
}

function underTmp(path: string): boolean {
  return path === '/tmp' || path.startsWith(`/tmp${sep}`)
}

export interface HostToolsWorkspace {
  readonly path: string
  remove(): void
}

/**
 * A temporary workspace a host-tool test can use: outside `/tmp` (the shell may write there, so a
 * workspace under it is refused at start) and outside any git repository (a `git_diff` with no
 * path would otherwise reach the enclosing one). Refuses a base that breaks either rule, naming it.
 */
export function makeHostToolsWorkspace(
  base: string = process.env.THEOCLAW_TEST_WORKSPACE_ROOT ?? DEFAULT_TEST_WORKSPACE_ROOT,
): HostToolsWorkspace {
  mkdirSync(base, { recursive: true, mode: 0o700 })
  const real = realpathSync(base)
  if (underTmp(real)) throw new Error(`host-tools workspace base ${real} is under /tmp`)
  if (insideGitRepository(real)) throw new Error(`host-tools workspace base ${real} is inside a git repository`)
  const path = mkdtempSync(join(real, 'ws-'))
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) }
}
