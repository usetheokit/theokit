/**
 * The SHAPE of a parsed invocation: the `ExecArgs` union, the option declarations, and the
 * `OptionValues` derived from them.
 *
 * Its own module because `args.ts` and `subcommands.ts` both need it, and keeping it in either made
 * them import each other — a cycle `depcruise` refused twice in one session, for the same reason
 * each time: splitting a file without first extracting what both halves share only moves the
 * coupling into an import edge. Nothing here imports from either side.
 */
import { parseArgs } from 'node:util'

export type StdinBehavior = 'none' | 'required' | 'forced' | 'append'

export type CliOverrides = readonly string[]

export interface ExecRun {
  mode: 'run' | 'resume'
  prompt?: string
  stdinBehavior: StdinBehavior
  json: boolean
  model?: string
  cd?: string
  outputLastMessage?: string
  skipGitCheck: boolean
  resume?: { last: boolean; id?: string }
  overrides: CliOverrides
}

export interface ExecReview {
  mode: 'review'
  target: string
  json: boolean
  cd?: string
  skipGitCheck: boolean
  overrides: CliOverrides
}

export interface ExecGoal {
  mode: 'goal'
  goal: string
  json: boolean
  model?: string
  cd?: string
  skipGitCheck: boolean
  maxTurns?: number
  tokenBudget?: number
  overrides: CliOverrides
}

export interface ExecUsageError {
  mode: 'error'
  message: string
}

/**
 * B-074 — the session actions this surface offers.
 *
 * The audit that filed this found a 5+1 asymmetry: the TUI could list, fork, archive, rename and
 * delete, and the CLI could only `gc` and `resume`. Every operation already existed in
 * `@theocode/agent/session`, so these actions are dispatch over tested code rather than a second
 * implementation — which is the DoD bullet that mattered, since a second copy is how the two
 * surfaces would drift again.
 */
export const SESSION_ACTIONS = ['gc', 'list', 'archive', 'rename', 'delete', 'fork'] as const

export type SessionAction = (typeof SESSION_ACTIONS)[number]

export interface ExecSessions {
  mode: 'sessions'
  action: SessionAction
  /** The session id an action operates on. Required by archive/rename/delete/fork. */
  target?: string
  /** The new name for `rename`. */
  name?: string
  apply: boolean
  allProjects: boolean
  keepLast?: number
  maxAgeDays?: number
  json: boolean
  cd?: string
}

interface ExecDoctor {
  mode: 'doctor'
  json: boolean
  cd?: string
}

export interface ExecVersion {
  mode: 'version'
}

interface ExecMigrateConfig {
  mode: 'migrate-config'
  cd?: string
}

export interface ExecHelp {
  mode: 'help'
  usage: string
}

export type ExecArgs =
  | ExecRun
  | ExecReview
  | ExecGoal
  | ExecSessions
  | ExecDoctor
  | ExecMigrateConfig
  | ExecVersion
  | ExecHelp
  | ExecUsageError

export const OPTIONS = {
  // B-023 — the usage text used to be reachable ONLY by triggering an error, so a user asking for
  // help got a failure exit and a message about a mistake they had not made.
  help: { type: 'boolean', short: 'h', default: false },
  // #128 — a MODE, not an unknown option. It is the first thing anyone types against an unfamiliar
  // binary, and it used to exit 1 with a usage dump, which reads as "you used the tool wrong".
  version: { type: 'boolean', short: 'v', default: false },
  json: { type: 'boolean', default: false },
  model: { type: 'string', short: 'm' },
  cd: { type: 'string', short: 'C' },
  'output-last-message': { type: 'string', short: 'o' },
  'skip-git-repo-check': { type: 'boolean', default: false },
  last: { type: 'boolean', default: false },
  uncommitted: { type: 'boolean', default: false },
  base: { type: 'string' },
  commit: { type: 'string' },
  'max-turns': { type: 'string' },
  'token-budget': { type: 'string' },
  apply: { type: 'boolean', default: false },
  'all-projects': { type: 'boolean', default: false },
  keep: { type: 'string' },
  'max-age-days': { type: 'string' },
  config: { type: 'string', short: 'c', multiple: true },
  sandbox: { type: 'string' },
  approval: { type: 'string', short: 'a' },
  effort: { type: 'string' },
} as const

export const SUGAR: readonly {
  readonly flag: '--sandbox' | '--approval' | '--effort'
  readonly option: 'sandbox' | 'approval' | 'effort'
  readonly key: string
}[] = [
  { flag: '--sandbox', option: 'sandbox', key: 'sandbox_mode' },
  { flag: '--approval', option: 'approval', key: 'approval_policy' },
  { flag: '--effort', option: 'effort', key: 'reasoning_effort' },
]

export const MODE_TO_POLICY: Readonly<Record<string, string>> = {
  suggest: 'on-request',
  'full-auto': 'never',
}

/** Exported for `subcommands.ts`, which reads the same parsed options this file declares. */
export type OptionValues = ReturnType<
  typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>
>['values']
