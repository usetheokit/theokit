/**
 * M68 T1 — the SDK's trust vocabulary crosses the barrel.
 *
 * COMPILE-time assertions: `npx tsc --noEmit -p packages/agents/tsconfig.test.json` fails if any of
 * these names stops being nameable from `@theokit/agents`, or stops being the SDK's own type.
 *
 * ## Why these four, and why now
 *
 * M68 requires a `TrustPosture` to enable the `project` source of `settingSources` — which turns on
 * shell-executing hooks coming from the working directory. An API that requires a value whose TYPE
 * the consumer cannot name is unusable: they would have to redeclare the shape by hand, and a second
 * declaration of a security contract drifts from the first in silence.
 *
 * ADR 0061 (M67) honestly declared that the ROOT-BAR gate covers values and not types, because
 * `Object.keys` over the namespace does not see `export type`. These four close that gap where it
 * matters — not for completeness, but because M68 depends on them.
 */
import { expectTypeOf } from 'vitest'

import type { TrustLevel, TrustPosture, TrustPostureInput, TrustSource } from '../../src/index.js'
import type {
  TrustLevel as SdkTrustLevel,
  TrustPosture as SdkTrustPosture,
  TrustPostureInput as SdkTrustPostureInput,
  TrustSource as SdkTrustSource,
} from '@theokit/sdk'

// ── 1. Nameable from the barrel ───────────────────────────────────────────────────────────────
expectTypeOf<TrustLevel>().not.toBeNever()
expectTypeOf<TrustSource>().not.toBeNever()
expectTypeOf<TrustPosture<'project'>>().not.toBeNever()
expectTypeOf<TrustPostureInput<'project'>>().not.toBeNever()

// ── 2. They ARE the SDK's types, not a redeclaration ──────────────────────────────────────────
// Pass-through, never wrapper (Rung 9). A structurally equal copy would drift from upstream in
// silence, which is the defect the layered boundary exists to close.
expectTypeOf<TrustLevel>().toEqualTypeOf<SdkTrustLevel>()
expectTypeOf<TrustSource>().toEqualTypeOf<SdkTrustSource>()
expectTypeOf<TrustPosture<'project'>>().toEqualTypeOf<SdkTrustPosture<'project'>>()
expectTypeOf<TrustPostureInput<'project'>>().toEqualTypeOf<SdkTrustPostureInput<'project'>>()

// ── 3. The two properties the M68 gate depends on ─────────────────────────────────────────────
// `level` separates trusted from untrusted; `source` says WHERE the decision came from, and is what
// makes the refusal message actionable ("denied, and the decision came from `default`") rather than
// merely negative.
expectTypeOf<TrustPosture<'project'>>().toHaveProperty('level').toEqualTypeOf<SdkTrustLevel>()
expectTypeOf<TrustPosture<'project'>>().toHaveProperty('source').toEqualTypeOf<SdkTrustSource>()
expectTypeOf<TrustPosture<'project'>>()
  .toHaveProperty('allows')
  .toEqualTypeOf<Readonly<Record<'project', boolean>>>()
