/**
 * The entry-point gate probes EVERY publishable package, and says how many it probed.
 *
 * MEASURED 2026-09-16 cutting `@theokit/agents@14.5.0`. The gate reported `FAIL — 1 of 32 did not
 * load`, and the one was the meta-package: `npm install` of its tarball could not resolve
 * `@theokit/agents`, because `workspace:^` packs to the version being released and the publish step
 * is fifty lines further down the same workflow. Every release that bumps a package `theokit`
 * depends on died there, before publishing anything.
 *
 * ## Why a test, when the gate already fails loudly
 *
 * Because the loud failure was the SMALL half. With the install fixed the gate probes 60 entry
 * points where it probed 32 — the meta-package's 28 had never run a single import, and the gate
 * reported `32 of 32` green on every release before this one. A package dropping silently out of
 * the count is invisible exactly the way it was invisible then: the verdict stays PASS.
 *
 * So this asserts the SHAPE of the count rather than a number that would need editing whenever a
 * package is added — every publishable package appears, and the total is at least what a run
 * already achieved.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, it, expect, beforeAll } from 'vitest'

const REPO = join(import.meta.dirname, '..', '..')

/**
 * The packages the gate is supposed to reach: publishable AND importable.
 *
 * The second half is not a technicality, and writing this test found it. `create-theokit` declares
 * only `bin` — it promises a COMMAND, not a module — and the gate excludes it deliberately, saying
 * so in its own comment: probing it for an import "invents an entry point it never offered". A test
 * that demanded every publishable package would have been asking the gate to check something the
 * package never claimed, which is the shape of a false finding rather than a real one.
 */
const importablePackages = (): string[] =>
  readdirSync(join(REPO, 'packages'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(REPO, 'packages', e.name, 'package.json'))
    .flatMap((p) => {
      try {
        const m = JSON.parse(readFileSync(p, 'utf8')) as {
          name?: string
          private?: boolean
          exports?: unknown
          main?: unknown
          module?: unknown
        }
        if (m.private === true || m.name === undefined) return []
        const importable = m.exports !== undefined || m.main !== undefined || m.module !== undefined
        return importable ? [m.name] : []
      } catch {
        return []
      }
    })

let output = ''

describe('the entry-point gate reaches every publishable package', () => {
  beforeAll(() => {
    // The gate packs each package and installs the tarball, which is why this is the slow test in
    // the file rather than a unit. 46s measured on the machine this was written on; the budget is
    // ~6x that, sized the way `typecheck-clean-gate.test.ts` documents — the aggregate runs four
    // processes at once, and a budget close to the isolated time fails on load rather than on merit.
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- toolchain binary, fixed argv
    output = execFileSync('node', ['scripts/check-pack-entry-points-load.mjs'], {
      cwd: REPO,
      encoding: 'utf8',
    })
  }, 300_000)

  it('every importable package appears in the report', () => {
    const missing = importablePackages().filter((n) => !output.includes(`${n}: `))
    expect(missing, `packages the gate never probed: ${missing.join(', ')}`).toEqual([])
  })

  it('the meta-package is probed, not skipped over', () => {
    // Named explicitly because it is the one that was silently absent, and the one whose
    // `workspace:^` dependency makes it the first to break when the ordering regresses.
    expect(output).toMatch(/\btheokit: \d+ entry point\(s\) probed/)
  })

  it('the total is at least what a working run already reached', () => {
    // 60 on 2026-09-16. A floor rather than an equality: adding an entry point should not fail a
    // test, and losing 28 of them silently is the failure this file exists for.
    const m = /all (\d+) declared entry points/.exec(output)
    expect(m, `no total in the gate's own report:\n${output.slice(-200)}`).not.toBeNull()
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(60)
  })
})
