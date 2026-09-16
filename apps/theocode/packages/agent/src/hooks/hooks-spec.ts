export const HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'Stop', 'SessionStart'] as const

export type HookEvent = (typeof HOOK_EVENTS)[number]

export interface HookSpec {
  event: HookEvent
  command: string
  matcher?: string
  timeout_ms: number
}
