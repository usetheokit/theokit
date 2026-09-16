/**
 * The helper's own proof, because "importing it registers the cleanup" is a claim about vitest's
 * collection order and not something to take on faith.
 *
 * ## Why the import is deferred, and why that is the whole test
 *
 * Vitest runs `afterAll` hooks in REVERSE registration order, which was measured here before this
 * file took its present shape: a hook written below a static `import` of the helper ran BEFORE the
 * helper's cleanup and reported the directory still standing. That is the hook order working
 * correctly, not the helper failing — but it means the observation has to be registered FIRST to run
 * LAST.
 *
 * So the hook below is registered before the helper is imported at all, and the import is a
 * top-level `await` underneath it. Reversing those two lines makes this file assert the opposite of
 * what it means; the order is the mechanism, not a style choice.
 */
import { existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

const made: string[] = []

// Registered BEFORE the helper's own hook exists, so it runs after it. See the docblock.
afterAll(() => {
  expect(made, 'no directory was ever made, so the check below proves nothing').not.toEqual([])
  for (const dir of made) {
    expect(existsSync(dir), `${dir} outlived the file that made it`).toBe(false)
  }
})

const { tempRoot } = await import('./temp-root.js')

describe('tempRoot', () => {
  it('test_it_hands_back_a_directory_that_can_actually_be_written_to', () => {
    // The other half, and what keeps the cleanup check honest: a helper that returned a path it
    // never created would satisfy `existsSync === false` at the end while cleaning up nothing.
    const dir = tempRoot('temp-root-helper-')
    made.push(dir)
    writeFileSync(join(dir, 'marker'), 'content\n')

    expect(dir.startsWith(tmpdir()), 'the root was made outside the system temp directory').toBe(true)
    expect(existsSync(join(dir, 'marker')), 'the path handed back is not a usable directory').toBe(
      true,
    )
  })

  it('test_two_calls_do_not_hand_back_the_same_directory', () => {
    // `mkdtempSync` guarantees this, and the guarantee is worth an assertion because the helper
    // could have been written to cache one root and hand it to every caller — which would make two
    // tests share a fixture and fail in whichever order the runner picked.
    const first = tempRoot('temp-root-helper-')
    const second = tempRoot('temp-root-helper-')
    made.push(first, second)

    expect(first).not.toBe(second)
  })
})
