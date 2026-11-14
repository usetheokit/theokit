/**
 * Reads the Claude Code hook dialect (`.claude/settings.json` `hooks`) into framework `HookSpec`s.
 *
 * Every translated spec goes through `hookSpecSchema`, so the framework's command validation
 * (no control characters) applies; every skipped element is reported in `dropped`.
 */
import { hookSpecSchema, type HookEvent, type HookSpec } from './hook-events.js'

/** A name mapped to `null` is known, and not delivered by this engine. */
export const CLAUDE_HOOK_EVENT_ALIASES: Readonly<Record<string, HookEvent | null>> = {
  PreToolUse: 'pre_tool_call',
  PostToolUse: 'transform_tool_result',
  Stop: 'post_assistant_reply',
  SessionStart: 'on_session_start',
}

export interface ParsedClaudeHooks {
  readonly specs: readonly HookSpec[]
  readonly dropped: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function translateEntry(
  event: HookEvent,
  matcher: string | undefined,
  entry: Record<string, unknown>,
): { spec: HookSpec } | { reason: string } {
  if (entry.type !== 'command') return { reason: 'only "command" hooks are supported' }
  const candidate: Record<string, unknown> = { event, command: entry.command }
  if (matcher !== undefined) candidate.matcher = matcher
  if (entry.timeout !== undefined) {
    if (
      typeof entry.timeout !== 'number' ||
      !Number.isFinite(entry.timeout) ||
      entry.timeout <= 0
    ) {
      return { reason: 'timeout must be a positive number of seconds' }
    }
    candidate.timeout_ms = Math.ceil(entry.timeout * 1000)
  }
  const parsed = hookSpecSchema.safeParse(candidate)
  if (!parsed.success) {
    return {
      reason: parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; '),
    }
  }
  return { spec: parsed.data }
}

function translateGroup(
  name: string,
  index: number,
  event: HookEvent,
  group: unknown,
  out: { specs: HookSpec[]; dropped: string[] },
): void {
  const { specs, dropped } = out
  const at = `${name}[${String(index)}]`
  if (!isRecord(group)) {
    dropped.push(`${at}: group is not an object`)
    return
  }
  const matcher =
    typeof group.matcher === 'string' && group.matcher !== '*' && group.matcher !== ''
      ? group.matcher
      : undefined
  if (!Array.isArray(group.hooks)) {
    dropped.push(`${at}: group has no "hooks" array`)
    return
  }
  group.hooks.forEach((entry: unknown, j) => {
    const where = `${at}.hooks[${String(j)}]`
    if (!isRecord(entry)) {
      dropped.push(`${where}: entry is not an object`)
      return
    }
    const result = translateEntry(event, matcher, entry)
    if ('spec' in result) specs.push(result.spec)
    else dropped.push(`${where}: ${result.reason}`)
  })
}

export function parseClaudeHooks(
  raw: unknown,
  options?: { readonly aliases?: Readonly<Record<string, HookEvent | null>> },
): ParsedClaudeHooks {
  const specs: HookSpec[] = []
  const dropped: string[] = []
  if (raw === undefined || raw === null) return { specs, dropped }
  if (!isRecord(raw)) return { specs, dropped: ['hooks is not an object'] }
  const aliases = { ...CLAUDE_HOOK_EVENT_ALIASES, ...options?.aliases }
  for (const [name, groups] of Object.entries(raw)) {
    const event = Object.hasOwn(aliases, name) ? aliases[name] : undefined
    if (event === undefined) {
      dropped.push(`${name}: unknown event`)
    } else if (event === null) {
      dropped.push(`${name}: event is not delivered by this engine`)
    } else if (!Array.isArray(groups)) {
      dropped.push(`${name}: expected an array of matcher groups`)
    } else {
      groups.forEach((group: unknown, i) => {
        translateGroup(name, i, event, group, { specs, dropped })
      })
    }
  }
  return { specs, dropped }
}
