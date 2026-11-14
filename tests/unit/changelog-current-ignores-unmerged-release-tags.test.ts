/**
 * The release-record gate measures the history it is run on, not every tag in the repository.
 *
 * Measured on 2026-11-14 (usetheokit/theokit#2106, again after #2035): the promotion pull request
 * workspace -> develop failed `Release record` because `main` had cut `@theokit/agents@16.7.0`
 * after the branches diverged. The tag was fetched (`fetch-depth: 0`), the checkout's CHANGELOG
 * could not name it, and `develop` could not advance until a back-merge happened.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = resolve(__dirname, '../../scripts/check-changelog-current.mjs')
const dirs: string[] = []

function git(cwd: string, ...args: string[]): void {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- toolchain binary, fixed argv
  execFileSync('git', args, { cwd, stdio: 'ignore', env: { ...process.env, ...tagDate } })
}

/** Tags made in one second tie on `creatordate`; each release gets its own day. */
let tagDate: Record<string, string> = {}

function tag(cwd: string, name: string, day: string): void {
  tagDate = { GIT_COMMITTER_DATE: `${day}T12:00:00Z` }
  git(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'tag', '-a', name, '-m', 'r')
  tagDate = {}
}

function record(cwd: string, heading: string): void {
  writeFileSync(join(cwd, 'CHANGELOG.md'), `# Changelog\n\n## [Unreleased]\n\n${heading}\n`)
}

function commit(cwd: string, message: string): void {
  git(cwd, 'add', '.')
  git(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', message)
}

function run(cwd: string) {
  return spawnSync(process.execPath, [SCRIPT, cwd], { encoding: 'utf8' })
}

/** main carries a release the workspace branch (forked earlier) does not. */
function diverged(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'changelog-'))
  dirs.push(cwd)
  mkdirSync(cwd, { recursive: true })
  git(cwd, 'init', '-q', '-b', 'main')
  record(cwd, '## [theokit 1.0.0] - 2026-11-01')
  commit(cwd, 'base')
  tag(cwd, 'theokit@1.0.0', '2026-11-01')
  git(cwd, 'branch', 'workspace')
  record(cwd, '## [theokit 1.1.0] - 2026-11-14\n\n## [theokit 1.0.0] - 2026-11-01')
  commit(cwd, 'release 1.1.0')
  tag(cwd, 'theokit@1.1.0', '2026-11-14')
  git(cwd, 'checkout', '-q', 'workspace')
  return cwd
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('the release record on a diverged promotion checkout (#2106)', () => {
  it('passes when the newest tag exists only on main', () => {
    const result = run(diverged())

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('theokit@1.0.0')
  })

  it('still fails when a release in the checked-out history is not recorded', () => {
    const cwd = diverged()
    git(cwd, 'checkout', '-q', 'main')
    record(cwd, '## [theokit 1.0.0] - 2026-11-01')
    commit(cwd, 'drop the 1.1.0 section')

    const result = run(cwd)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('theokit@1.1.0')
  })
})
