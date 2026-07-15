/**
 * M48 (ecosystem-integration-guarantee) T1.1 / ADR D2 — the local `CustomTool` mirror
 * (`packages/theo/src/server/define/define-agent-tool.ts`) is hand-maintained so `@theokit/sdk`
 * stays an OPTIONAL peer (an api-only app compiles theokit's shipped `.d.ts` without the SDK
 * installed). This type gate proves the mirror does NOT silently drift from the SDK it mirrors.
 *
 * The assertion is `toEqualTypeOf` on the handler's **ctx param** (2nd arg) and **return type** —
 * NOT `toMatchTypeOf` on the whole interface. The ctx/handler-param is CONTRAVARIANT, so a mirror
 * with a *narrower* ctx (e.g. missing `ctx.threadId`) is still assignable to the SDK handler — a
 * `toMatchTypeOf` would pass and miss exactly the #119 drift this gate exists to catch. Equality on
 * the ctx param fails `tsc` the moment the SDK ctx gains/loses a field (`threadId`/`messages`) or the
 * return widens (SE7 multimodal `ToolResultContentBlock[]`).
 */
import { describe, expectTypeOf, it } from 'vitest'

import type { CustomTool as SdkCustomTool } from '@theokit/sdk'

import type { CustomTool as LocalCustomTool } from '../../packages/theo/src/server/define/define-agent-tool.js'

type SdkCtx = Parameters<SdkCustomTool['handler']>[1]
type LocalCtx = Parameters<LocalCustomTool['handler']>[1]
type SdkReturn = ReturnType<SdkCustomTool['handler']>
type LocalReturn = ReturnType<LocalCustomTool['handler']>

describe('CustomTool local mirror stays structurally equal to @theokit/sdk (M48 T1.1 / D2)', () => {
  it('mirror handler ctx equals the SDK handler ctx (catches #119 ctx.threadId + SE12 ctx.messages drift)', () => {
    expectTypeOf<LocalCtx>().toEqualTypeOf<SdkCtx>()
  })

  it('mirror handler return is assignable to the SDK handler return (mirror ⊆ SDK — theokit produces string, a subset the SDK accepts)', () => {
    // Return is COVARIANT: theokit's tools return `string`, which the SDK's wider
    // `string | ToolResultContentBlock[]` accepts. `toExtend` = "Local is assignable to Sdk"; it
    // fails if the SDK NARROWS its accepted return (drift theokit must react to), not when it widens.
    expectTypeOf<LocalReturn>().toExtend<SdkReturn>()
  })
})
