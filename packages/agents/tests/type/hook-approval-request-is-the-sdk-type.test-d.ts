/**
 * `HookApprovalRequest` from the bridge subpath IS the SDK's type, not a hand-copied mirror: an SDK
 * change (a new field, a narrower `event`) must surface here as a compile error.
 */
import type { HookApprovalRequest } from '@theokit/agents/bridge'
import type { HookApprovalRequest as SdkHookApprovalRequest } from '@theokit/sdk'
import { expectTypeOf } from 'vitest'

expectTypeOf<HookApprovalRequest>().toExtend<SdkHookApprovalRequest>()
expectTypeOf<SdkHookApprovalRequest>().toExtend<HookApprovalRequest>()
