import type { HookHandlers } from '@theokit/agents/hooks'
import { hooksForChild } from '@theokit/agents/hooks'
import type { AgentOptions } from '@theokit/sdk'

declare const h: HookHandlers

export const o: AgentOptions = { plugins: [hooksForChild(h)!] }
