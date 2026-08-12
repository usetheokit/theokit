/**
 * B-102 — every build script is importable without executing.
 *
 * A script that runs its body on import is untestable by construction: any test of one helper runs
 * the whole gate and exits the process. That is not a theoretical cost — `theokit#200` shipped a
 * publish guard that read the last stdout line as a filename, which in CI is `}`, and it accused six
 * packages falsely. The helper that got it wrong could not be tested alone.
 *
 * Two scripts still ran on import when this was written: `lint-by-group.mjs` awaited `main()` at the
 * top level, and `validate-all-latest-tags.mjs` went further — it made REGISTRY CALLS at module
 * scope, so importing it fetched every dist-tag and then called `process.exit`.
 *
 * The check is by execution rather than by grep: importing each script and observing that nothing
 * happens is the property, and a pattern match for `import.meta.url` would pass for a script that
 * guards the wrong thing.
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const SCRIPTS = join(import.meta.dirname, '..', '..', '..', 'scripts')

const everyScript = readdirSync(SCRIPTS)
  .filter((f) => f.endsWith('.mjs'))
  .sort((a, b) => a.localeCompare(b))

describe('B-102 — build scripts do not execute on import', () => {
  it('test_there_are_scripts_to_check', () => {
    // The canary: a moved directory would make every case below vacuously pass.
    expect(everyScript.length).toBeGreaterThan(5)
  })

  it.each(everyScript)('test_%s_is_importable_without_running', async (name) => {
    // A script that runs on import either throws here, hangs, or exits the worker — all three are
    // failures, and none of them can be faked by a guard that merely LOOKS right.
    await expect(import(join(SCRIPTS, name))).resolves.toBeDefined()
  })
})
