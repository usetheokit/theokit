/**
 * The two things every part of configuration needs, in a module that imports nothing from them.
 *
 * Extracted when `settings-load.ts` was split out of `config.ts` and the two started importing each
 * other — `config.ts` for the disk layer, `settings-load.ts` for the schema keys and the error type.
 * `depcruise` refused the cycle, correctly: a cycle between the schema and the loader means neither
 * can be read without the other, and the next split has nowhere to go.
 *
 * Both are re-exported from `config.ts`, so no caller outside this directory changes.
 */
import { TheokitAgentError } from '@theokit/agents'

export class ConfigError extends TheokitAgentError {
  override readonly name = 'ConfigError'

  constructor(message: string) {
    super(message)
  }
}

export const CONFIG_SCHEMA_KEYS = [
  'model',
  'reasoning_effort',
  'sandbox_mode',
  'approval_policy',
  'goal_oracle',
  'skills',
  'hooks',
  'memory',
  'home_dir',
  'shell_timeout_ms',
  'session_gc',
  'context_window',
  'output_style',
] as const

export type SchemaKey = (typeof CONFIG_SCHEMA_KEYS)[number]
