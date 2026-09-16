/**
 * The subcommand parsers, and the table that routes to them.
 *
 * Split from `args.ts` when it crossed its line budget for the second time. The division is not
 * arbitrary: `args.ts` owns the SHAPE of a parsed invocation — the `ExecArgs` union and the option
 * declarations — while this file owns how each subcommand reads its own arguments. Adding one is an
 * entry in `SUBCOMMANDS` here, and `args.test.ts` holds that table against the usage text.
 */
import { SESSION_ACTIONS, type ExecArgs, type OptionValues, type SessionAction } from './exec-args.js'

function parseReview(values: OptionValues, positionals: string[], overrides: string[]): ExecArgs {
  const targets = [
    values.uncommitted === true,
    values.base !== undefined,
    values.commit !== undefined,
  ]
  if (targets.filter(Boolean).length > 1) {
    return { mode: 'error', message: '--uncommitted, --base and --commit are mutually exclusive' }
  }
  const custom = positionals.slice(1).join(' ')
  const target =
    values.base !== undefined
      ? `base ${values.base}`
      : values.commit !== undefined
        ? `commit ${values.commit}`
        : // B-023 — `--uncommitted` was validated for mutual exclusivity and then never read, so the
          // target fell through to the (empty) positional join. The flag passed every check and
          // selected nothing.
          values.uncommitted === true
          ? 'uncommitted'
          : custom
  return {
    mode: 'review',
    target,
    json: values.json === true,
    ...(values.cd !== undefined ? { cd: values.cd } : {}),
    skipGitCheck: values['skip-git-repo-check'] === true,
    overrides,
  }
}

/**
 * B-074 — the actions that are not `gc`.
 *
 * `list` takes nothing; archive/rename/delete/fork NAME a session. Defaulting to "the current one"
 * has no meaning headless — there is no current session — and guessing would make `delete` destroy
 * whichever transcript happened to be newest.
 */
function parseSessionAction(
  action: SessionAction,
  values: OptionValues,
  positionals: string[],
): ExecArgs {
  const common = {
    mode: 'sessions' as const,
    allProjects: false,
    json: values.json === true,
    ...(values.cd !== undefined ? { cd: values.cd } : {}),
  }
  if (action === 'list') return { ...common, action, apply: false }

  const target = positionals[2]
  if (target === undefined || target.length === 0) {
    return { mode: 'error', message: `sessions ${action} requires a session id` }
  }
  if (action === 'rename' && (positionals[3] === undefined || positionals[3].length === 0)) {
    return { mode: 'error', message: 'sessions rename requires a new name' }
  }
  return {
    ...common,
    action,
    target,
    ...(action === 'rename' ? { name: positionals[3] } : {}),
    apply: values.apply === true,
  }
}

/**
 * B-081 — reports the RESOLVED install, so config overrides are honoured rather than refused:
 * diagnosing "why does `-c sandbox_mode=read-only` not take effect" is the point of the command.
 */
function parseDoctor(values: OptionValues): ExecArgs {
  return {
    mode: 'doctor',
    json: values.json === true,
    ...(values.cd !== undefined ? { cd: values.cd } : {}),
  }
}

interface SubcommandInput {
  values: OptionValues
  positionals: string[]
  overrides: string[]
  overridesPresent: string[]
}

/** Every subcommand the binary routes, keyed by the token a user types after `theocode`. */
export const SUBCOMMANDS: Record<string, (i: SubcommandInput) => ExecArgs> = {
  review: (i) => parseReview(i.values, i.positionals, i.overrides),
  sessions: (i) => parseSessions(i.values, i.positionals, i.overrides, i.overridesPresent),
  doctor: (i) => parseDoctor(i.values),
  'migrate-config': (i) => parseMigrateConfig(i.values),
  goal: (i) => parseGoal(i.values, i.positionals, i.overrides),
}

/** Named by the loader's refusal when a `config.toml` is stranded — see `migrate-config.ts`. */
function parseMigrateConfig(values: OptionValues): ExecArgs {
  return {
    mode: 'migrate-config',
    ...(values.cd !== undefined ? { cd: values.cd } : {}),
  }
}

function parseSessions(
  values: OptionValues,
  positionals: string[],
  _overrides: string[],
  presentOverrides: string[],
): ExecArgs {
  if (presentOverrides.length > 0) {
    return {
      mode: 'error',
      message:
        `sessions does not accept ${presentOverrides.join(', ')}: it resolves no config, so the ` +
        `value would be silently discarded — drop the option, or use the mode that reads config`,
    }
  }
  const action = positionals[1]
  if (!(SESSION_ACTIONS as readonly string[]).includes(action ?? '')) {
    return {
      mode: 'error',
      message: `unknown sessions action "${action ?? ''}" — expected: ${SESSION_ACTIONS.join(' | ')}`,
    }
  }
  return action === 'gc'
    ? parseSessionGc(values)
    : parseSessionAction(action as SessionAction, values, positionals)
}

/** `gc` and its numeric bounds, split out so `parseSessions` stays a router (B-074). */
function parseSessionGc(values: OptionValues): ExecArgs {
  const parsePos = (
    flag: string,
    v: string | undefined,
  ): number | undefined | { error: string } => {
    if (v === undefined) return undefined
    const n = Number(v)
    if (!Number.isInteger(n) || n < 0)
      return { error: `${flag} requires a non-negative integer, got "${v}"` }
    return n
  }
  const keepLast = parsePos('--keep', values.keep)
  if (typeof keepLast === 'object') return { mode: 'error', message: keepLast.error }
  const maxAgeDays = parsePos('--max-age-days', values['max-age-days'])
  if (typeof maxAgeDays === 'object') return { mode: 'error', message: maxAgeDays.error }
  return {
    mode: 'sessions',
    action: 'gc',
    apply: values.apply === true,
    allProjects: values['all-projects'] === true,
    json: values.json === true,
    ...(keepLast !== undefined ? { keepLast } : {}),
    ...(maxAgeDays !== undefined ? { maxAgeDays } : {}),
    ...(values.cd !== undefined ? { cd: values.cd } : {}),
  }
}

function parseGoal(values: OptionValues, positionals: string[], overrides: string[]): ExecArgs {
  const goal = positionals.slice(1).join(' ').trim()
  if (goal.length === 0) {
    return { mode: 'error', message: 'goal requires an OBJECTIVE' }
  }
  const parseNum = (
    flag: string,
    v: string | undefined,
  ): number | undefined | { error: string } => {
    if (v === undefined) return undefined
    const n = Number(v)
    if (!Number.isFinite(n) || n <= 0)
      return { error: `${flag} requires a positive number, got "${v}"` }
    return n
  }
  const maxTurns = parseNum('--max-turns', values['max-turns'])
  if (typeof maxTurns === 'object') return { mode: 'error', message: maxTurns.error }
  const tokenBudget = parseNum('--token-budget', values['token-budget'])
  if (typeof tokenBudget === 'object') return { mode: 'error', message: tokenBudget.error }
  return {
    mode: 'goal',
    goal,
    json: values.json === true,
    ...(values.model !== undefined ? { model: values.model } : {}),
    ...(values.cd !== undefined ? { cd: values.cd } : {}),
    skipGitCheck: values['skip-git-repo-check'] === true,
    ...(maxTurns !== undefined ? { maxTurns } : {}),
    ...(tokenBudget !== undefined ? { tokenBudget } : {}),
    overrides,
  }
}

