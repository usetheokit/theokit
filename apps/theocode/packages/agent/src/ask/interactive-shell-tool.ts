import type { CustomTool } from '@theokit/agents'
import type { InteractiveProvider } from '@theokit/agents/interactive'
import { createInteractiveShellTool as createSdkInteractiveShellTool } from '@theokit/agents/tools'

interface InteractiveShellOptions {
  interactive: InteractiveProvider<unknown>
}

/**
 * B-009 — the SDK's tool, unwrapped.
 *
 * This file used to fork the SDK's Zod schema and handler for one reason: `toErrorJson` matched
 * `InteractiveUnavailableError` before its subclass, so a session cap reached the model as
 * `interactive_unavailable` with `max` and `liveSessionIds` discarded — the only fields it could act
 * on. There was no error seam to override, so recovering them meant rebuilding the tool, which left
 * the description coming from the SDK while the schema was a frozen copy that would silently miss
 * any option added upstream.
 *
 * Fixed at the source and released as `@theokit/sdk-tools@0.26.2`, so the fork is now pure cost.
 * `interactive-shell-tool.test.ts` asserts the behaviour it existed to provide, against this
 * delegation — if a future bump regresses it, that test goes red rather than the fork quietly being
 * needed again.
 */
export function createInteractiveShellTool(opts: InteractiveShellOptions): CustomTool {
  return createSdkInteractiveShellTool(opts)
}
