/**
 * The committed lockfile must not name a workspace member the checkout does not contain.
 *
 * `pnpm-workspace.yaml` declares `my-test` as a member and says, in the same comment, that it is not
 * committed — *"Neither directory is committed."* Both halves are deliberate: the root install links a
 * scaffold to this working tree and only links declared members.
 *
 * What nothing prevented is the LOCKFILE capturing it. A `pnpm install` run while the scratch app exists
 * writes an importer for it, and `0add5d2db` committed one. CI then checks out a lockfile naming a
 * directory it does not have, the store never gets an index for that importer's dependencies, and
 * `pnpm licenses list --prod --json` — which reads the store rather than the network — fails:
 *
 *     check-licenses: `pnpm licenses list --prod --json` failed
 *       "Failed to find package index file for @usetheo/ui@0.26.0(…),
 *        please consider running 'pnpm install'"
 *
 * That was the 1 failure of 29 checks on PR #919, three layers from its cause and reading as a licence
 * problem. It is not one: the same command on the same lockfile passes locally, where the scratch app and
 * its store entries exist.
 *
 * ## Why this asks git rather than the workspace file
 *
 * The declared members and the committed ones differ ON PURPOSE, so a check that compared the lockfile
 * against `pnpm-workspace.yaml` would find nothing wrong. The question is whether a checkout that does
 * not have the directory can install what the lockfile describes, and only git knows which directories a
 * checkout gets.
 *
 * ## What this does NOT do
 *
 * It does not stop `pnpm install` from writing the importer — nothing in this repository can. It refuses
 * the state before it ships, which is the difference between a recurring trap and a caught one.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO = resolve(__dirname, '../..')

/** Importer paths the lockfile declares, excluding the root (`.`). */
function importers(lockText: string): string[] {
  const lines = lockText.split('\n')
  const out: string[] = []
  let inside = false
  for (const line of lines) {
    if (line.trimEnd() === 'importers:') {
      inside = true
      continue
    }
    if (inside && line !== '' && !line.startsWith(' ')) break
    const m = inside ? /^ {2}(\S.*):$/.exec(line) : null
    if (m && m[1] !== '.') out.push(m[1])
  }
  return out
}

/** Whether git tracks anything under this directory — i.e. whether a fresh checkout gets it. */
function isTracked(dir: string): boolean {
  // Reads the local index only, and the per-call exemption below is the pattern four existing call
  // sites in `tests/lint/` already use for the same question. The directive is the LAST line before the
  // call on purpose: `eslint-disable-next-line` covers exactly one line, and a reason written after it
  // consumes the coverage — measured here, where a two-line comment left the call unexempted and the
  // directive reported as unused.
  // eslint-disable-next-line sonarjs/no-os-command-from-path
  const out = execFileSync('git', ['ls-files', '--', `${dir}/package.json`], {
    cwd: REPO,
    encoding: 'utf8',
  })
  return out.trim().length > 0
}

describe('the committed lockfile names only committed members', () => {
  it('every importer resolves to a directory a fresh checkout receives', () => {
    const lock = readFileSync(resolve(REPO, 'pnpm-lock.yaml'), 'utf8')

    const orphans = importers(lock).filter((dir) => !isTracked(dir))

    expect(
      orphans,
      'the lockfile declares an importer for a directory git does not track, so a checkout cannot ' +
        'install what it describes — `pnpm licenses list` reads the store and fails on the missing ' +
        'index, three layers from this cause. Regenerate with the directory moved aside.',
    ).toEqual([])
  })

  it('the probe reads real importers, and reports a synthetic orphan', () => {
    // COUNTERPROOF. `toEqual([])` also passes over a parser that found nothing, over a repo-root that
    // resolved wrong, and over an `isTracked` that answers true for everything. Four of this session's
    // probes were green over exactly that, so this one is proved before its result is believed.
    const lock = readFileSync(resolve(REPO, 'pnpm-lock.yaml'), 'utf8')
    const real = importers(lock)

    expect(
      real.length,
      'no importers were parsed at all, so the case above measured nothing',
    ).toBeGreaterThan(3)
    expect(real, 'the workspace packages are not being seen').toContain('packages/theo')

    // A directory that is declared in `pnpm-workspace.yaml` and deliberately never committed.
    const synthetic = `importers:\n\n  .:\n    dependencies: {}\n\n  my-test:\n    dependencies: {}\n`
    expect(importers(synthetic)).toEqual(['my-test'])
    expect(
      importers(synthetic).filter((d) => !isTracked(d)),
      'a synthetic importer for an uncommitted member was NOT reported, so the case above cannot fail',
    ).toEqual(['my-test'])
  })
})
