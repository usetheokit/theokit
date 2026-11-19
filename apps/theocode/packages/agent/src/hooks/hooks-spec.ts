import {
  CLAUDE_HOOK_EVENT_ALIASES,
  type HookSpec as FrameworkHookSpec,
} from '@theokit/agents/hooks'

/** The names users write: the framework's Claude Code dialect table is the single source. */
export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'Stop' | 'SessionStart'

export const HOOK_EVENTS = Object.keys(CLAUDE_HOOK_EVENT_ALIASES) as HookEvent[]

/** The framework's default is 30 s; this product's is shorter, and stays so. */
export const DEFAULT_HOOK_TIMEOUT_MS = 5_000

/** The framework's spec, spelled in our event names. */
export type HookSpec = Omit<FrameworkHookSpec, 'event'> & { event: HookEvent }
