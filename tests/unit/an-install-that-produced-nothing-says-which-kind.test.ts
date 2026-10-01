import { describe, expect, it } from 'vitest'

import { describeInstallOutcome } from '../../scripts/describe-install-outcome.js'

/**
 * The message that cost an investigation instead of ending one.
 *
 * `tests/integration/pnpm-11-compat.test.ts` asserts `existsSync(node_modules/theokit)` and, when it
 * is false, prints `pnpm install did not produce node_modules/theokit.\npnpm stderr:` followed by
 * whatever the thrown error carried. Measured on the v1.2.0-rc.2 cut (CI run 36636655271,
 * 2026-09-29 22:03:57): the install **exited 0**, so nothing was thrown and nothing was captured, and
 * the whole payload was the literal `pnpm stderr:` with an empty line under it.
 *
 * The docblock above that catch says the previous fix existed because "the previous version swallowed
 * it, so a genuinely broken install surfaced as a bare `expected false to be true`". The output was
 * not swallowed this time — there was none. The message cannot tell the two cases apart, and they
 * call for opposite next steps:
 *
 *   - pnpm failed and said why          -> read the error
 *   - pnpm succeeded and installed nothing -> the manifest, the store or the registry, not pnpm
 *
 * A third case is worth naming because pnpm's layout produces it: `node_modules/theokit` is a symlink
 * into `.pnpm`, and `existsSync` FOLLOWS symlinks. A link that exists while its target does not
 * returns false — the shape of a store entry that was linked and never materialised. Without the
 * distinction that reads identically to "nothing was installed at all".
 *
 * Pure, and beside `unpublished-pins.ts` for the reason that module's own docblock gives: the decision
 * is testable without a network.
 */
describe('describeInstallOutcome', () => {
  it('names the case where pnpm succeeded and installed nothing', () => {
    // THE case measured in CI. `stderr` is empty because there was no error to carry.
    const msg = describeInstallOutcome({
      threw: false,
      stdout: 'Progress: resolved 412, reused 0, downloaded 0, added 0\n',
      stderr: '',
      linkPresent: false,
    })

    expect(
      msg,
      'the message does not say the install SUCCEEDED, so a reader looks for an error that does not exist',
    ).toMatch(/exited 0/i)
    expect(msg).toContain('added 0')
  })

  it('carries the error when pnpm failed', () => {
    // COUNTERPROOF: the existing behaviour must not regress. This is the case the current message
    // handles correctly and the only one it was written for.
    const msg = describeInstallOutcome({
      threw: true,
      stdout: '',
      stderr: 'ERR_PNPM_FETCH_404  GET https://registry.npmjs.org/theokit/-/theokit-0.74.0.tgz',
      linkPresent: false,
    })

    expect(msg).toContain('ERR_PNPM_FETCH_404')
    expect(msg).not.toMatch(/exited 0/i)
  })

  it('names a dangling link rather than calling it absent', () => {
    // pnpm links into `.pnpm` and `existsSync` follows the link, so a materialised-nothing store
    // reads as "not installed". These are different failures and only one of them is about pnpm.
    const msg = describeInstallOutcome({
      threw: false,
      stdout: '',
      stderr: '',
      linkPresent: true,
    })

    expect(msg).toMatch(/symlink|link/i)
  })

  it('says nothing was written when neither the link nor the target exists', () => {
    // COUNTERPROOF for the case above: `linkPresent: false` must NOT claim a dangling link.
    const msg = describeInstallOutcome({ threw: false, stdout: '', stderr: '', linkPresent: false })

    expect(msg).not.toMatch(/dangl/i)
  })
})
