import { CLAUDE_HOOK_EVENT_ALIASES } from '@theokit/agents/hooks'

/** The names users write: the framework's Claude Code dialect table is the single source. */
export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'Stop' | 'SessionStart'

export const HOOK_EVENTS = Object.keys(CLAUDE_HOOK_EVENT_ALIASES) as HookEvent[]

export interface HookSpec {
  event: HookEvent
  command: string
  matcher?: string
  timeout_ms: number
}
