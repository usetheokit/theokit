/** `hooksForChild` returns the SDK `Plugin`, so it goes into `AgentOptions` with no cast. */
import { hooksForChild } from '@theokit/agents/hooks'
import type { AgentOptions, Plugin } from '@theokit/sdk'
import { expectTypeOf } from 'vitest'

const h = { pre_tool_call: () => undefined }
const o: AgentOptions = { plugins: [hooksForChild(h)!] }

expectTypeOf(hooksForChild(h)).toEqualTypeOf<Plugin | undefined>()
expectTypeOf(o).toExtend<AgentOptions>()
