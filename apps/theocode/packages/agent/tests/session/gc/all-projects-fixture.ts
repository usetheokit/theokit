/**
 * Shared fixture of the all-projects GC tests: a real temp tree, a controllable registry and writer
 * lease. `state` is mutated by the tests and read by the `vi.mock` factories of each file.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { encodeProjectDir, transcriptPath } from '@theokit/agents/persistence'

import { state } from './all-projects-state.js'


export const DAY = 86_400_000
export const tree = { base: '', root: '', live: '', other: '' }

export function setup(claimRoot: (root: string) => void): void {
  state.registry.clear()
  state.failRegistry.clear()
  state.writers.clear()
  tree.base = mkdtempSync(join(tmpdir(), 'theocode-gc-guards-'))
  tree.root = join(tree.base, 'projects')
  mkdirSync(tree.root)
  claimRoot(tree.root)
  tree.live = join(tree.base, 'live-a')
  tree.other = join(tree.base, 'live-b')
  mkdirSync(tree.live)
  mkdirSync(tree.other)
}

export function teardown(): void {
  chmodSync(tree.base, 0o700)
  rmSync(tree.base, { recursive: true, force: true })
}

export function age(path: string, days: number): void {
  const t = new Date(Date.now() - days * DAY)
  utimesSync(path, t, t)
}

export function put(cwd: string, name: string, days: number): string {
  const dir = join(tree.root, encodeProjectDir(cwd))
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name)
  writeFileSync(file, `${JSON.stringify({ cwd })}\n`)
  age(file, days)
  return file
}

/** A transcript named the way the SDK names the session `id` of `cwd`. */
export function session(cwd: string, id: string, days: number): string {
  const file = transcriptPath(tree.base, cwd, id)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ cwd })}\n`)
  age(file, days)
  return file
}

export function point(cwd: string, id: string): void {
  mkdirSync(join(cwd, '.theokit'), { recursive: true })
  writeFileSync(join(cwd, '.theokit', 'tui-session'), `${id}\n`)
}

export const opts = (extra = {}) => ({
  projectsRoot: tree.root,
  keepLast: 1,
  maxAgeDays: 7,
  ...extra,
})
export const targets = (plan: { candidates: { target: string }[] }): string[] =>
  plan.candidates.map((c) => c.target)
