/**
 * A temporary directory that removes itself when the file that made it finishes.
 *
 * The pattern is `aggregate-cut-wiring.test.ts:44-57`'s — an array of what was made and a hook that
 * empties it — lifted here because seven files in this package needed it and copying it into each
 * would be seven places for the next person to forget. The cost of forgetting is measured in this
 * repository rather than assumed: 193 directories and 15 MB of generated rule corpora from ONE
 * uncleaned file in an afternoon, and 2 773 leaked `theocode-*` directories in `/tmp` recorded by
 * `session/gc/background-sweep.test.ts`.
 *
 * ## Why the hook is registered at import and not by a call the test makes
 *
 * Vitest imports a test file to collect it, so this module's top level runs INSIDE that file's
 * collection and `afterAll` attaches to its root suite. Importing `tempRoot` is therefore enough:
 * there is no `setUpCleanup()` for a file to import and then not call, which is the same class of
 * omission the helper exists to remove. Files are isolated from one another (the default `forks`
 * pool re-instantiates the module graph per file), so `made` never spans two files.
 *
 * VERIFIED by running it rather than reasoned from the docs — `temp-root.test.ts` creates a root and
 * asserts, from a later hook, that it is gone.
 *
 * ## Why `afterAll` and not `afterEach`
 *
 * Because a root created at MODULE scope — which several callers here do, to share one fixture
 * across a describe — would be removed before the first test that reads it. `afterAll` is correct
 * for both shapes; `afterEach` is correct only for one. The cost is that a file creating a root per
 * case holds them until it finishes, which is what `background-sweep.test.ts` already does.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll } from 'vitest'

const made: string[] = []

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
  made.length = 0
})

/** A scratch directory under the system temp root, removed when this file's tests are done. */
export function tempRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  made.push(dir)
  return dir
}
