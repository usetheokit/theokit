import { describe, expect, it } from 'vitest'

import { assertSdkCanReadCompatSources } from '../../src/bridge/sdk-adapter-create-options.js'

/**
 * #739 — an SDK that cannot read the foreign root is refused, not warned about.
 *
 * `compatSources` landed in `@theokit/sdk@5.0.0`. Below it the option is accepted and ignored, so
 * every `.claude/` surface is unavailable while the package resolves, compiles and runs — a consumer
 * at the permitted minimum got zero parity and nothing stopped them.
 *
 * A `console.warn` stood here, and its own text named the condition that kept it a warning: "Until
 * this package's floor can name a stable 5.x". The floor is `^5.3.0`. The condition is met, so the
 * warning becomes the typed refusal the issue asked for — the shape `CompatImportUnsupportedError`
 * already set one function away.
 *
 * A warning was the right instrument while the floor genuinely permitted such a version: refusing
 * would have broken installs the manifest said were supported. It is the wrong one now, because the
 * only way to reach it is an override, and an override that silently disables every foreign surface
 * is exactly the failure this refusal exists to make loud.
 */
describe('an SDK below the compat floor', () => {
  it('test_it_is_refused_with_the_version_that_introduced_the_root', () => {
    expect(() => {
      assertSdkCanReadCompatSources('4.52.1')
    }).toThrow(/5\.0\.0/)
  })

  it('test_a_supported_version_passes', () => {
    // The control: the refusal must not fire on the versions the manifest actually permits, or the
    // package would refuse to start on its own floor.
    expect(() => {
      assertSdkCanReadCompatSources('5.3.0')
    }).not.toThrow()
    expect(() => {
      assertSdkCanReadCompatSources('6.0.0')
    }).not.toThrow()
  })

  it('test_an_unreadable_version_is_not_refused', () => {
    // Saying nothing beats guessing. A version this cannot parse is not evidence of an old SDK, and
    // refusing on it would take down an install over a string we failed to read.
    expect(() => {
      assertSdkCanReadCompatSources(undefined)
    }).not.toThrow()
  })
})
