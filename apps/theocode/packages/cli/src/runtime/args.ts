import { USAGE } from './usage.js'
import { SUBCOMMANDS } from './subcommands.js'
import { parseArgs } from 'node:util'

import {
  MODE_TO_POLICY,
  OPTIONS,
  SUGAR,
  type ExecArgs,
  type ExecRun,
  type ExecUi,
  type ExecUsageError,
  type OptionValues,
  type StdinBehavior,
} from './exec-args.js'


function resolveResume(
  values: OptionValues,
  positionals: string[],
): { isResume: boolean; resume: ExecRun['resume']; promptParts: string[] } | { error: string } {
  const isResume = positionals[0] === 'resume'
  const rest = isResume ? positionals.slice(1) : positionals
  if (!isResume) return { isResume, resume: undefined, promptParts: rest }

  if (values.last === true) {
    if (
      rest.length > 0 &&
      /^(exec-|tui-|review-)?[0-9a-f]{8}-[0-9a-f-]{4,}/i.test(rest[0] as string)
    ) {
      return { error: 'resume: use EITHER --last OR a SESSION_ID, not both' }
    }
    return { isResume, resume: { last: true }, promptParts: rest }
  }
  if (rest.length > 0) {
    return { isResume, resume: { last: false, id: rest[0] as string }, promptParts: rest.slice(1) }
  }
  return { error: 'resume requires --last or a SESSION_ID' }
}

function resolveInput(
  rawPrompt: string,
  stdinIsTTY: boolean,
):
  | { prompt: string | undefined; stdinBehavior: StdinBehavior }
  | { ui: true }
  | { error: string } {
  const raw = rawPrompt.length > 0 ? rawPrompt : undefined
  if (raw === '-') return { prompt: undefined, stdinBehavior: 'forced' }
  if (raw === undefined) {
    // No prompt AND a terminal: the user wants a session, not an answer. This used to be
    // `{ error: 'No prompt provided' }`, which made the UI reachable only through `npm run dev`
    // — so an INSTALL had no way to reach the 46 slash commands, `/login` among them, and the
    // documented OAuth device flow could not be run at all.
    //
    // A pipe with no prompt keeps reading stdin: that is a real use, and it has no terminal for
    // the UI to draw on.
    if (stdinIsTTY) return { ui: true }
    return { prompt: undefined, stdinBehavior: 'required' }
  }
  return { prompt: raw, stdinBehavior: stdinIsTTY ? 'none' : 'append' }
}


/**
 * An interactive session, or a refusal naming the flags it would have dropped.
 *
 * `security-floor.ts` (B-006) makes `cli` the operator's override — the one layer that wins in BOTH
 * directions, because the threat model is a repository or an inherited environment, never the person
 * at the keyboard. `ExecUi` carries nothing, so on this path that override reaches nobody.
 *
 * Measured 2026-09-17 against a trusted workspace whose file said `danger-full-access`: the operator
 * typed `--sandbox read-only`, asking for MORE confinement, and the session came up
 * `workspace-write` with no message. A control believed to be in force and absent is worse than one
 * refused out loud — which is what this product's `doctor` says about permission rules one surface
 * over.
 *
 * Derived from what was PASSED, so a flag added later is covered without anyone coming back here.
 * The filter is not decoration: `values` carries EVERY boolean in the schema at its default, and
 * without it the bare `theocode` was refused. A boolean nobody passed reads `false`; a string nobody
 * passed reads `undefined`.
 */
function resolveUiOrRefuse(values: OptionValues): ExecUi | ExecUsageError {
  const typed = Object.entries(values)
    .filter(([, v]) => v !== false && v !== undefined)
    .map(([k]) => (k.length === 1 ? `-${k}` : `--${k}`))
  if (typed.length === 0) return { mode: 'ui' }
  return {
    mode: 'error',
    message:
      `${typed.join(', ')} cannot be applied to an interactive session — the UI resolves its ` +
      `configuration from the working directory. Pass a prompt to use them for one answer, or ` +
      `set them in .theokit/settings.json.`,
  }
}

function parseResumeOrPrompt(
  values: OptionValues,
  positionals: string[],
  overrides: string[],
  stdinIsTTY: boolean,
): ExecArgs {
  const r = resolveResume(values, positionals)
  if ('error' in r) return { mode: 'error', message: r.error }
  const { isResume, resume, promptParts } = r

  const e = resolveInput(promptParts.join(' '), stdinIsTTY)
  if ('error' in e) return { mode: 'error', message: e.error }
  if ('ui' in e) return resolveUiOrRefuse(values)
  const { prompt, stdinBehavior } = e

  return {
    mode: isResume ? 'resume' : 'run',
    ...(prompt !== undefined ? { prompt } : {}),
    stdinBehavior,
    json: values.json === true,
    ...(values.model !== undefined ? { model: values.model } : {}),
    ...(values.cd !== undefined ? { cd: values.cd } : {}),
    ...(values['output-last-message'] !== undefined
      ? { outputLastMessage: values['output-last-message'] }
      : {}),
    skipGitCheck: values['skip-git-repo-check'] === true,
    ...(resume !== undefined ? { resume } : {}),
    overrides,
  }
}

function translateApproval(values: OptionValues): string | undefined {
  if (values.approval === 'auto-edit') return AUTO_EDIT_HAS_NO_POLICY
  if (values.approval !== undefined && values.approval in MODE_TO_POLICY) {
    values.approval = MODE_TO_POLICY[values.approval]
  }
  return undefined
}

const AUTO_EDIT_HAS_NO_POLICY =
  '--approval auto-edit: this mode exists only in the TUI (auto-approves edits, gates shell) and has ' +
  'no equivalent policy in the runtime. Use `suggest` (= on-request) or `full-auto` (= never).'

/**
 * The scoping `usage.ts` PRINTS, as data the parser can enforce.
 *
 * #24 — the text has scoped twelve flags to a command for as long as it has existed, and this
 * check covered three of them: `--last`, `-m/--model` and `-o/--output-last-message`. The other
 * nine parsed on every mode and were dropped by the mode that never reads them — `theocode hello
 * --max-turns 3` produced a plain run carrying no `maxTurns`, and `sessions delete abc --keep 5`
 * dropped it too. That is precisely what `flagAppliedToNoCommand`'s own docblock refuses.
 *
 * A table rather than nine more branches, for the reason `SUBCOMMANDS` is one: the scoping is a
 * LIST, and written as a list it can be read against the usage text it mirrors instead of being
 * reconstructed from control flow.
 *
 * `scope` is the positional PREFIX that honours the flag, so `sessions gc` is expressible and
 * `sessions delete --apply` is refused — `apply` is read on the gc path alone. `because` finishes
 * the sentence "the flag <because>", so the refusal says where the flag belongs rather than only
 * that it does not belong here.
 */
const SCOPED_FLAGS: readonly {
  readonly option: keyof OptionValues
  readonly flag: string
  readonly scope: readonly string[]
  readonly because: string
}[] = [
  { option: 'last', flag: '--last', scope: ['resume'], because: 'selects the most recent session' },
  { option: 'uncommitted', flag: '--uncommitted', scope: ['review'], because: 'names a diff' },
  { option: 'base', flag: '--base', scope: ['review'], because: 'names a diff' },
  { option: 'commit', flag: '--commit', scope: ['review'], because: 'names a diff' },
  { option: 'max-turns', flag: '--max-turns', scope: ['goal'], because: 'bounds a goal run' },
  {
    option: 'token-budget',
    flag: '--token-budget',
    scope: ['goal'],
    because: 'bounds a goal run',
  },
  {
    option: 'apply',
    flag: '--apply',
    scope: ['sessions', 'gc'],
    because: 'turns a dry run into a deletion',
  },
  {
    option: 'all-projects',
    flag: '--all-projects',
    scope: ['sessions', 'gc'],
    because: 'widens the sweep past this project',
  },
  {
    option: 'keep',
    flag: '--keep',
    scope: ['sessions', 'gc'],
    because: 'bounds what a sweep keeps',
  },
  {
    option: 'max-age-days',
    flag: '--max-age-days',
    scope: ['sessions', 'gc'],
    because: 'bounds what a sweep keeps',
  },
]

/** Supplied on the command line. Booleans default to `false`, so only `true` is a presence. */
function supplied(value: OptionValues[keyof OptionValues]): boolean {
  return value !== undefined && value !== false
}

/**
 * B-023 — a flag that parses and does nothing is worse than an unknown flag, which at least errors.
 *
 * Two shapes, because the flags come in two. `SCOPED_FLAGS` is an INCLUSION list: the flag belongs
 * to one command path and nowhere else. `-m/--model` and `-o/--output-last-message` are the
 * opposite — documented in the global Options line and honoured by every mode that builds an agent
 * — so they are refused by EXCLUSION, naming the two modes that build none.
 */
function flagAppliedToNoCommand(
  values: OptionValues,
  positionals: readonly string[],
): string | undefined {
  for (const { option, flag, scope, because } of SCOPED_FLAGS) {
    if (!supplied(values[option])) continue
    if (scope.every((token, i) => positionals[i] === token)) continue
    return `${flag} ${because} and applies to \`${scope.join(' ')}\` only`
  }
  const sub = positionals[0] ?? ''
  if (sub === 'review' || sub === 'sessions') {
    if (values.model !== undefined) {
      return `-m/--model builds an agent, and \`${sub}\` does not build one`
    }
    if (values['output-last-message'] !== undefined) {
      return `-o/--output-last-message writes the final message, and \`${sub}\` produces none`
    }
  }
  return undefined
}

/** The `-c key=value` list, plus the sugar flags that expand into one, and which flags supplied them. */
function collectOverrides(values: OptionValues): {
  overrides: string[]
  overridesPresent: string[]
} {
  return {
    overrides: [
      ...SUGAR.flatMap((a) =>
        values[a.option] !== undefined ? [`${a.key}=${values[a.option]!}`] : [],
      ),
      ...(values.config ?? []),
    ],
    overridesPresent: [
      ...(values.config !== undefined ? ['-c/--config'] : []),
      ...SUGAR.flatMap((a) => (values[a.option] !== undefined ? [a.flag] : [])),
    ],
  }
}

export function parseExecArgs(argv: string[], stdinIsTTY: boolean): ExecArgs {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true })
  } catch (err) {
    return { mode: 'error', message: err instanceof Error ? err.message : String(err) }
  }
  const { values, positionals } = parsed

  if (values.version === true) return { mode: 'version' }
  if (values.help === true) return { mode: 'help', usage: USAGE }

  const misapplied = flagAppliedToNoCommand(values, positionals)
  if (misapplied !== undefined) return { mode: 'error', message: misapplied }

  const translation = translateApproval(values)
  if (translation !== undefined) return { mode: 'error', message: translation }

  const { overrides, overridesPresent } = collectOverrides(values)

  // A table rather than a switch: adding a subcommand is then an entry, not a branch, and the
  // routing gate in `args.test.ts` reads the same list the usage text is checked against.
  const sub = SUBCOMMANDS[positionals[0] ?? '']
  if (sub !== undefined) return sub({ values, positionals, overrides, overridesPresent })
  return parseResumeOrPrompt(values, positionals, overrides, stdinIsTTY)
}

export * from './exec-args.js'
