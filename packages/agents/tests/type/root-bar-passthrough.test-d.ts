/**
 * M67 T4 — the two TYPE-only members of the config/trust/wiring family cross the barrel.
 *
 * These are COMPILE-TIME assertions: `npx tsc --noEmit -p packages/agents/tsconfig.test.json` fails
 * if either type stops being nameable from `@theokit/agents`, or stops matching the SDK's.
 *
 * ## Why they are here and not in `tests/unit/root-bar-passthrough.test.ts`
 *
 * The edge-case review of the plan flagged (EC-2) that a VALUE assertion over a type compares
 * `undefined` with `undefined` and passes vacuously — including when the re-export does not exist.
 * The first implementation moved the two types to `expectTypeOf` inside the unit file, believing that
 * closed it. It did not: `packages/agents/vitest.config.ts` declares no `typecheck` block, so
 * `expectTypeOf` in a `.test.ts` is a RUNTIME NO-OP there. The assertion ran, reported green, and
 * verified nothing — the same failure mode one level deeper.
 *
 * `.test-d.ts` under `tests/type/` is where this repo puts assertions that must be checked by the
 * compiler (see the neighbouring `agent-list-narrowed.test-d.ts`, the M103 narrowing guard).
 */
import { expectTypeOf } from 'vitest'

import type { ToolResultContentBlock, WiredEntity } from '../../src/index.js'
import type {
  ToolResultContentBlock as SdkToolResultContentBlock,
  WiredEntity as SdkWiredEntity,
} from '@theokit/sdk'

// ── 1. Both types are nameable from the barrel ────────────────────────────────────────────────
// A consumer that cannot NAME the type is forced to redeclare its shape by hand — which is what
// `wired-capabilities.ts:22` and `tools/view-image.ts:15` had to reach around the boundary to avoid.
expectTypeOf<WiredEntity>().not.toBeNever()
expectTypeOf<WiredEntity>().not.toBeAny()
expectTypeOf<ToolResultContentBlock>().not.toBeNever()
expectTypeOf<ToolResultContentBlock>().not.toBeAny()

// ── 2. They are the SDK's types, not a local restatement ──────────────────────────────────────
// The pass-through doctrine (Rung 9) forbids wrapping. A structurally-similar copy would drift from
// upstream silently; identity is what makes the re-export a door rather than a duplicate.
expectTypeOf<WiredEntity>().toEqualTypeOf<SdkWiredEntity>()
expectTypeOf<ToolResultContentBlock>().toEqualTypeOf<SdkToolResultContentBlock>()
