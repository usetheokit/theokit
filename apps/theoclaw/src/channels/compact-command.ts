import { Agent } from '@theokit/sdk'

import { TheoClawConfigError, describeError } from '../control-plane/errors.js'

/** The variable that compacts a session after a turn whose prompt reached this many tokens (OC-53). */
export const COMPACT_AT_VARIABLE = 'THEOCLAW_COMPACT_AT'

const COMPACT_COMMAND = /^\/compact(?:\s+([\s\S]*))?$/

/** The line `/compact` answers with when the session has no transcript to compact. */
export const COMPACT_FAILED_REPLY = 'I could not compact this conversation; it goes on unchanged.'

export interface CompactSettings {
  /** Compacts the agent's persisted transcript; `Agent.compact` in production. */
  readonly run: (agentId: string, trigger: 'manual' | 'auto') => Promise<{ readonly preTokens: number; readonly postTokens: number }>
  /** Compact after a turn whose input reached this many tokens; absent: only `/compact`. */
  readonly at?: number
  readonly write: (line: string) => void
}

/**
 * `THEOCLAW_COMPACT_AT` (a positive whole number of tokens, unset: no threshold) and the SDK's
 * `Agent.compact` as the compactor, unless `run` replaces it.
 */
export function readCompactSettings(
  env: Readonly<Record<string, string | undefined>>,
  write: (line: string) => void,
  run?: CompactSettings['run'],
): CompactSettings {
  const raw = (env[COMPACT_AT_VARIABLE] ?? '').trim()
  const at = Number(raw)
  if (raw !== '' && (!/^\d+$/.test(raw) || at <= 0)) {
    throw new TheoClawConfigError(`${COMPACT_AT_VARIABLE} must be a positive whole number of tokens`, { variable: COMPACT_AT_VARIABLE })
  }
  return { run: run ?? ((agentId, trigger) => Agent.compact(agentId, { trigger })), ...(raw === '' ? {} : { at }), write }
}

/**
 * The instructions of a `/compact` message, matched on the whole trimmed text: `''` for a bare
 * one, undefined for anything else. The SDK's summarizer takes no instructions, so they are accepted and unused.
 */
export function compactOf(text: string): string | undefined {
  const match = COMPACT_COMMAND.exec(text.trim())
  return match === null ? undefined : (match[1] ?? '').trim()
}

/** Compact the session's transcript and say so in one line; a failure is a line, never a thrown error. */
export async function runCompact(settings: CompactSettings, agentId: string | undefined): Promise<string> {
  try {
    if (agentId === undefined) throw new Error('the session has no agent id')
    const { preTokens, postTokens } = await settings.run(agentId, 'manual')
    return `⚙️ Compacted (${String(preTokens)} → ${String(postTokens)} tokens)`
  } catch (error) {
    settings.write(`compact failed: ${describeError(error)}`)
    return COMPACT_FAILED_REPLY
  }
}

/** After a turn: compact when its input reached the threshold. Best effort, the reply is already sent. */
export async function compactIfNeeded(
  settings: CompactSettings,
  agentId: string,
  result: { readonly usage?: { readonly inputTokens?: number } } | undefined,
): Promise<void> {
  const input = result?.usage?.inputTokens
  if (settings.at === undefined || input === undefined || input < settings.at) return
  try {
    const { preTokens, postTokens } = await settings.run(agentId, 'auto')
    settings.write(`compacted ${agentId}: ${String(preTokens)} -> ${String(postTokens)} tokens`)
  } catch (error) {
    settings.write(`compact failed: ${describeError(error)}`)
  }
}
