import { CLAUDE_HOOK_EVENT_ALIASES, hookSpecSchema } from '@theokit/agents/hooks'

import {
  DEFAULT_HOOK_TIMEOUT_MS,
  HOOK_EVENTS,
  type HookEvent,
  type HookSpec,
} from './hooks-spec.js'
import { HookError } from './hook-error.js'

/**
 * The PARSER for the `hooks` a user declares in configuration — and nothing else.
 *
 * It used to say `.theokit/hooks.json`, and no caller has ever handed it one. Every call site —
 * `chat.ts:267`, `composition-record.ts:20`, the TUI's consent and review paths — passes
 * `EffectiveConfig.hooks`, which comes from `settings.json` (from `config.toml` before that). A
 * docblock naming a file the code does not read sends the next reader looking for a loader that is
 * not there.
 *
 * The engine moved to `@theokit/agents/hooks` (`build-handlers.ts` bridges to it). What stays is the
 * one thing the framework cannot know: the VOCABULARY users write in their file — `PreToolUse`,
 * `PostToolUse`, `Stop`, `SessionStart`, Claude Code's names. The framework's schema is `.strict()`
 * over eight snake_case names; handing it a user's file would throw at boot for anyone who has one.
 *
 * This file was 423 lines after the local `buildHookHandlers` was deleted. **331 of them were
 * DEAD** — `preToolUseVeto`, `transformResult`, `fireObservational`, `policyBlock` and the rest of
 * the old engine, unreachable because their only caller was the removed function. Deleting just the
 * entry point and leaving the body is how duplication survives a migration: nothing breaks, nothing
 * points there, and the next reader finds two engines.
 */

const EVENTS = HOOK_EVENTS

// Shape and command validation are the framework's (`hookSpecSchema`); what stays here is our
// event spelling, our 5 s default, and the wording of the error an operator reads.
const OWN_KEYS = new Set(['event', 'command', 'matcher', 'timeout_ms'])

function readEntry(entry: unknown, i: number): { record: Record<string, unknown>; event: string } {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    throw new HookError(`hooks[${String(i)}]: expected an object [entry]`)
  }
  const record = entry as Record<string, unknown>
  const stray = Object.keys(record).find((k) => !OWN_KEYS.has(k))
  if (stray !== undefined) {
    throw new HookError(`hooks[${String(i)}]: Unrecognized key: "${stray}" [${stray}]`)
  }
  const event = record['event']
  if (typeof event !== 'string') {
    throw new HookError(`hooks[${String(i)}]: event must be a string [event]`)
  }
  requireKnownEvent(event, i)
  return { record, event }
}

function validateShape(entry: unknown, i: number): HookSpec {
  const { record, event } = readEntry(entry, i)
  const parsed = hookSpecSchema.safeParse({
    ...record,
    event: CLAUDE_HOOK_EVENT_ALIASES[event],
    timeout_ms: record['timeout_ms'] ?? DEFAULT_HOOK_TIMEOUT_MS,
  })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue?.path.length ? issue.path.join('.') : 'entry'
    throw new HookError(`hooks[${String(i)}]: ${issue?.message ?? 'invalid hook'} [${where}]`)
  }
  const { command, matcher, timeout_ms } = parsed.data
  requireCompilableMatcher(matcher, i)
  return {
    event: event as HookEvent,
    command,
    ...(matcher !== undefined ? { matcher } : {}),
    timeout_ms,
  }
}

function requireKnownEvent(event: string, i: number): void {
  if ((EVENTS as readonly string[]).includes(event)) return
  throw new HookError(
    `hooks[${String(i)}]: unknown event "${event}" — expected one of ${EVENTS.join(', ')}`,
  )
}

function requireCompilableMatcher(matcher: string | undefined, i: number): void {
  if (matcher === undefined) return
  try {
    new RegExp(matcher)
  } catch {
    throw new HookError(`hooks[${String(i)}]: matcher is not a valid regex: "${matcher}"`)
  }
}

export function parseHooks(raw: unknown): HookSpec[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new HookError('hooks: expected an array of hook entries')

  return raw.map((entry, i) => validateShape(entry, i))
}
