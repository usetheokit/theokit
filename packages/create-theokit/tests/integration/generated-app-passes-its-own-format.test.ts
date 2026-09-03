import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { scaffold } from '../../src/index.js'

/**
 * A generated project must pass the `format:check` it ships with, on the files it did not write.
 *
 * The sibling check in `tests/unit/scaffold-ignores-what-the-framework-writes.test.ts` reads the
 * TEMPLATE and only its `**\/*.md`. That is not the artifact a user receives, and the gap let two
 * real defects reach a generated app — both found by scaffolding one and running its own script:
 *
 *   - `README.md.tmpl` was never formatted, because `.tmpl` does not match `*.md`. It becomes
 *     `README.md`, so it IS checked in the user's project and failed there.
 *   - the Tailwind CSS import was written by `cli.ts` as `@import "tailwindcss";` while the
 *     template's `.prettierrc` sets `singleQuote: true` — a file the user never typed, failing
 *     their gate on their first commit.
 *
 * So this runs over the OUTPUT, with the config the output carries. A failure here is a failure the
 * user meets.
 */
const REPO = resolve(import.meta.dirname, '../../../..')
const PRETTIER = resolve(REPO, 'node_modules/.bin/prettier')
const TEMPLATE_CONFIG = resolve(import.meta.dirname, '../../templates/default/.prettierrc')

let projectDir: string

beforeAll(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'theokit-format-'))
  scaffold(projectDir, 'format-probe')
}, 30_000)

afterAll(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

describe('the generated project passes its own format:check', () => {
  it('every file the scaffold writes is formatted to the config it ships', () => {
    const result = execFileSync(
      PRETTIER,
      ['--check', '.', '--config', TEMPLATE_CONFIG],
      // `cwd` is the generated project so `.prettierignore` — which the scaffold renames into
      // place — applies exactly as it will for the user.
      { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )

    expect(result).not.toMatch(/Code style issues/)
    // 30s, not the 5s default. This spawns Prettier over a whole project tree — 1.7s on an idle
    // machine, and it timed out in a full-suite run where 16 workers were competing for the same
    // CPUs. A test whose verdict depends on what else is running is a flaky test, and a flaky test
    // is a bug (`rules/testing.md` § 3); the fix is a budget that reflects what the test does
    // rather than one that happens to fit when nothing else does.
  }, 30_000)
})
