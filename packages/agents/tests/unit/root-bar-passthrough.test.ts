import { describe, expect, it } from 'vitest'

import * as barrel from '../../src/index.js'
import * as sdk from '@theokit/sdk'

/**
 * M67 T3/T4 — the config/trust/wiring family crosses `@theokit/agents`.
 *
 * ## What was broken
 *
 * `src/index.ts:53-58` states the doctrine: the consumer imports the SDK's core primitives from
 * `@theokit/agents`, never from `@theokit/sdk` directly. M63 declared that boundary closed. It was
 * not: an entire family lived on the SDK's ROOT BAR and never crossed, and the real consumer
 * (TheoCode) broke its own unbreakable rule SIX times in production to reach it —
 * `config/layers.ts:10`, `config/config.ts:1`, `config/trust-posture.ts:8-11`,
 * `config/security-floor.ts:22`, `wired-capabilities.ts:22`, `tools/view-image.ts:15`.
 *
 * A consumer breaking its own rule rather than reimplementing is the strongest possible evidence that
 * the primitive is wanted and the door is what is missing.
 *
 * ## Why `toBe` and not `toBeDefined`
 *
 * Inherited from M73 (`auth-parity.test.ts`) and restated in `subpath-coverage.test.ts:24-30`: if the
 * build inlines the SDK (`noExternal` in tsup), the layer starts exporting a COPY of the value.
 * `instanceof` silently becomes false across the boundary and no behavioural test goes red.
 * `toBeDefined` does not catch that; referential identity does.
 *
 * ## Why values and types are asserted SEPARATELY (EC-2)
 *
 * Two of the eight are types. A value assertion over a type compares `undefined` with `undefined` and
 * passes — including when the re-export does not exist at all. The edge-case review caught this in the
 * plan before it was written: an assertion that cannot fail is worse than no assertion, because it
 * reports coverage it does not provide.
 */

/** The six VALUES. Runtime objects — referential identity is meaningful for these. */
const VALUES = [
  'foldLayers',
  'verifyLayerOrdering',
  'applySecurityFloor',
  'resolveTrustPosture',
  'auditEnvReachability',
  'recordWiring',
] as const

describe('M67 T3 — the config/trust/wiring family crosses the barrel', () => {
  it.each(VALUES)('test_%s_crosses_with_referential_identity', (name) => {
    expect(
      (barrel as Record<string, unknown>)[name],
      `${name} must be the SAME object the SDK exports, not a copy`,
    ).toBe((sdk as Record<string, unknown>)[name])
  })

  it('test_every_reexported_VALUE_is_defined_at_runtime', () => {
    // A re-export compiles against the `.d.ts` and explodes at runtime if the symbol is absent from
    // the bundle. The type-level green is a known-insufficient proof — this is the other half.
    const missing = VALUES.filter(
      (name) => typeof (barrel as Record<string, unknown>)[name] === 'undefined',
    )
    expect(missing, 'these resolved to undefined at runtime').toEqual([])
  })
})

// The two TYPE-only members are asserted in `tests/type/root-bar-passthrough.test-d.ts`, checked by
// `tsc`. They are deliberately NOT here: `packages/agents/vitest.config.ts` declares no `typecheck`
// block, so `expectTypeOf` in this file is a runtime no-op that would report green while verifying
// nothing (EC-2, measured — the first implementation made exactly that mistake).
