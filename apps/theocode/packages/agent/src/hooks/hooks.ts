import { z } from 'zod'

import { HOOK_EVENTS, type HookEvent, type HookSpec } from './hooks-spec.js'
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

const DEFAULT_TIMEOUT_MS = 5_000

const hookSchema = z
  .object({
    event: z.string(),
    command: z.string().min(1),
    matcher: z.string().optional(),
    timeout_ms: z.number().int().positive().optional(),
  })
  .strict()

function validateShape(entry: unknown, i: number): z.infer<typeof hookSchema> {
  try {
    return hookSchema.parse(entry)
  } catch (err) {
    const issue = err instanceof z.ZodError ? err.issues[0] : undefined
    const where = issue?.path.length ? issue.path.join('.') : 'entry'
    throw new HookError(`hooks[${String(i)}]: ${issue?.message ?? String(err)} [${where}]`)
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

function umHook(entry: unknown, i: number): HookSpec {
  const parsed = validateShape(entry, i)
  requireKnownEvent(parsed.event, i)
  requireCompilableMatcher(parsed.matcher, i)
  return {
    event: parsed.event as HookEvent,
    command: parsed.command,
    ...(parsed.matcher !== undefined ? { matcher: parsed.matcher } : {}),
    timeout_ms: parsed.timeout_ms ?? DEFAULT_TIMEOUT_MS,
  }
}

export function parseHooks(raw: unknown): HookSpec[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new HookError('hooks: expected an array of hook entries')

  return raw.map((entry, i) => umHook(entry, i))
}
