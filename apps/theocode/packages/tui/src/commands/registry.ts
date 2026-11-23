import {
  defineCommand,
  createCommandRegistry,
  type CommandDefinition,
} from '@theokit/agents/commands'
import type { ChatComposerCommand } from '@theokit/tui'
import { CODEX_NAMES } from './codex-names.js'

type DemoMode = 'plan' | 'ask' | 'select' | 'progress'

export type CommandAction =
  | { kind: 'noop' }
  | { kind: 'clear' }
  | { kind: 'new' }
  | { kind: 'effort'; arg: string }
  | { kind: 'toggleHelp' }
  | { kind: 'toggleUsage' }
  | { kind: 'retry' }
  | { kind: 'logout' }
  | { kind: 'login'; arg: string }
  | { kind: 'image'; arg: string }
  // M39 — session management. /fork + /sessions are bare; /archive + /rename carry an arg.
  | { kind: 'fork' }
  | { kind: 'listSessions' }
  | { kind: 'archive'; arg: string }
  // B-078 — permanent, and unlike /archive it never defaults to the current session.
  | { kind: 'delete'; arg: string }
  // B-075 — getting a reply out of the terminal without mouse-selecting a wrapped box.
  | { kind: 'copy' }
  | { kind: 'export'; arg: string }
  // B-072 — which subagents exist, answerable before naming one.
  | { kind: 'listSubagents' }
  // B-071 — what is allowed to block me here, before the first turn.
  | { kind: 'listHooks' }
  // B-070 — which skills the agent actually loaded, and which trust removed.
  | { kind: 'listSkills' }
  // B-069 — which MCP servers the agent started, and which trust refused to spawn.
  | { kind: 'listMcp' }
  // B-076 — the other half of the disk decision `/approval` already owned.
  | { kind: 'sandbox'; arg: string }
  // B-087 — open a session `/sessions` already lists.
  | { kind: 'resume'; arg: string }
  | { kind: 'rename'; arg: string }
  | { kind: 'mode'; mode: DemoMode }
  | { kind: 'approvalMode'; arg: string }
  // M48 — user-defined command (loaded from .theokit/commands/); arg = raw argument string.
  | { kind: 'custom'; name: string; arg: string }
  // M49 — durable-memory status (enabled/trusted, store path, fact count).
  | { kind: 'memoryInfo'; arg: string }
  // M50 — manual context compaction (Codex /compact parity).
  | { kind: 'compact' }
  // Codex parity (`/ps`, `/stop`): inventory and stop for background PTYs. We were creating
  // interactive shell sessions and giving the user no way to see or stop them — the gap the
  // side-by-side comparison named as the most consequential.
  | { kind: 'model'; arg: string }
  | { kind: 'showDiff' }
  | { kind: 'showStatus' }
  | { kind: 'initAgents' }
  | { kind: 'quit' }
  // Codex parity — `/pwd` answers "which directory am I in" without opening a panel.
  | { kind: 'pwd' }
  /**
   * Three Codex names answered with a real command instead of a pointer at two others.
   *
   * `/theme` carries an argument it now HONOURS: the base was resolved once at startup until
   * `theme-session.tsx` put a session override in front of it, so the handler switches the running
   * frame instead of explaining why it cannot. A value outside the vocabulary is still refused by
   * name rather than dropped — a silently ignored argument reads as applied.
   */
  | { kind: 'theme'; arg: string }
  | { kind: 'showAgents' }
  | { kind: 'showPermissions' }
  /**
   * Three more Codex names promoted out of `codex-names.ts` into real commands.
   *
   * `/title` and `/statusline` both carry a list of item names; `/raw` carries an optional `all`.
   * All three take `arg: 'optional'` like every other verb here, so the bare form reports rather
   * than erroring — the shape `/model` and `/theme` already set.
   */
  | { kind: 'title'; arg: string }
  | { kind: 'statusline'; arg: string }
  | { kind: 'raw'; arg: string }
  /**
   * A Codex command name this build does not implement, answered with the equivalent here.
   *
   * Carries the NAME rather than the answer so the routing layer stays a vocabulary and the words
   * stay in one file (`codex-names.ts`). Two places holding the same sentence is how one of them
   * comes to name a command that no longer exists.
   */
  | { kind: 'codexName'; name: string }
  | { kind: 'listPtys' }
  | { kind: 'stopPtys' }
  // M51 — review mode (Codex /review parity): arg = target (empty=uncommitted | base <ref> | commit <sha> | custom).
  | { kind: 'review'; arg: string }
  // M55 — autonomous goal (Codex ext/goal parity): arg = objective in natural language.
  | { kind: 'goal'; arg: string }
  | { kind: 'send'; text: string }
  /**
   * A leading `/` that is not a command this build knows.
   *
   * It used to be `{ kind: 'send' }` — every mistyped slash went to the model as prose, and the
   * model answered. `/moddel gpt-5` produced a plausible reply to a command that never ran, which
   * is worse than an error because nothing looks wrong.
   */
  | { kind: 'commandError'; reason: string; input: string }

/**
 * One built-in command: its name, the line the `/` menu shows, and what it routes to.
 *
 * A static `action` is a bare verb; a function takes the argument text (possibly empty — this
 * product has never refused a bare `/model`). Declaring all three together is the point: the menu,
 * the router and the name set used to be three lists kept in step by hand.
 */
interface BuiltinCommand {
  readonly name: string
  readonly description: string
  readonly action: CommandAction | ((arg: string) => CommandAction)
}

const BUILTINS: readonly BuiltinCommand[] = [
  { name: 'clear', description: 'clear the conversation', action: { kind: 'clear' } },
  { name: 'new', description: 'start a fresh conversation', action: { kind: 'new' } },
  {
    name: 'help',
    description: 'toggle the keyboard shortcuts panel',
    action: { kind: 'toggleHelp' },
  },
  { name: 'usage', description: 'toggle the token-usage panel', action: { kind: 'toggleUsage' } },
  { name: 'retry', description: 're-send the last message', action: { kind: 'retry' } },
  {
    name: 'fork',
    description: 'branch the current session into a new one',
    action: { kind: 'fork' },
  },
  { name: 'sessions', description: 'list your sessions', action: { kind: 'listSessions' } },
  {
    name: 'resume',
    description: 'open a session: /resume <id>',
    action: (arg) => ({ kind: 'resume', arg }),
  },
  { name: 'logout', description: 'remove the stored credential', action: { kind: 'logout' } },
  {
    name: 'plan',
    description: 'demo: plan approval card',
    action: { kind: 'mode', mode: 'plan' },
  },
  { name: 'ask', description: 'demo: question prompt', action: { kind: 'mode', mode: 'ask' } },
  {
    name: 'select',
    description: 'demo: multi-select list',
    action: { kind: 'mode', mode: 'select' },
  },
  {
    name: 'progress',
    description: 'demo: multi-step progress',
    action: { kind: 'mode', mode: 'progress' },
  },
  {
    name: 'approval',
    description: 'approval mode: suggest | auto-edit | full-auto',
    action: (arg) => ({ kind: 'approvalMode', arg }),
  },
  {
    name: 'effort',
    description: 'reasoning effort: minimal|low|medium|high|xhigh',
    action: (arg) => ({ kind: 'effort', arg }),
  },
  {
    name: 'login',
    description: 'authenticate a provider: /login <provider>',
    action: (arg) => ({ kind: 'login', arg }),
  },
  {
    name: 'image',
    description: 'attach an image to the NEXT turn: /image <path>',
    action: (arg) => ({ kind: 'image', arg }),
  },
  {
    name: 'archive',
    description: 'archive a session [id]',
    action: (arg) => ({ kind: 'archive', arg }),
  },
  {
    name: 'delete',
    description: 'permanently delete a session: /delete <id>',
    action: (arg) => ({ kind: 'delete', arg }),
  },
  {
    name: 'copy',
    description: 'copy the last reply to the clipboard as markdown',
    action: { kind: 'copy' },
  },
  {
    name: 'export',
    description: 'write the conversation to a file: /export [path]',
    action: (arg) => ({ kind: 'export', arg }),
  },
  {
    name: 'subagents',
    description: 'list the subagents this project defines',
    action: { kind: 'listSubagents' },
  },
  {
    name: 'hooks',
    description: 'list the lifecycle hooks registered for this directory',
    action: { kind: 'listHooks' },
  },
  {
    name: 'skills',
    description: 'list the skills this agent actually loaded',
    action: { kind: 'listSkills' },
  },
  {
    name: 'mcp',
    description: 'list the MCP servers this agent started',
    action: { kind: 'listMcp' },
  },
  {
    name: 'sandbox',
    description: 'show or change the sandbox mode for this session',
    action: (arg) => ({ kind: 'sandbox', arg }),
  },
  {
    name: 'rename',
    description: 'rename the current session',
    action: (arg) => ({ kind: 'rename', arg }),
  },
  {
    name: 'memory',
    description: 'memory: list facts, /memory off|on, /memory forget <n>',
    action: (arg) => ({ kind: 'memoryInfo', arg }),
  },
  {
    name: 'compact',
    description: 'summarize the conversation to free context',
    action: { kind: 'compact' },
  },
  {
    name: 'init',
    description: 'bootstrap an AGENTS.md for this repository',
    action: { kind: 'initAgents' },
  },
  { name: 'quit', description: 'exit the TUI', action: { kind: 'quit' } },
  // Codex answers to BOTH `/quit` and `/exit`. Someone arriving from it types whichever they have
  // in their fingers, and the one we did not have produced an unknown-command error on the way out
  // of a session — the least forgiving moment to be pedantic about a synonym.
  { name: 'exit', description: 'exit the TUI (alias of /quit)', action: { kind: 'quit' } },
  { name: 'pwd', description: 'print the working directory', action: { kind: 'pwd' } },
  {
    name: 'status',
    description: 'show the session state: model, effort, approval, sandbox, cwd',
    action: { kind: 'showStatus' },
  },
  {
    name: 'diff',
    description: 'show the uncommitted changes in the working tree',
    action: { kind: 'showDiff' },
  },
  {
    name: 'model',
    description: 'switch the model for this session (no argument reports it)',
    action: (arg) => ({ kind: 'model', arg }),
  },
  {
    name: 'ps',
    description: 'list the background shell sessions this conversation owns',
    action: { kind: 'listPtys' },
  },
  {
    name: 'stop',
    description: 'terminate every background shell session this conversation owns',
    action: { kind: 'stopPtys' },
  },
  {
    name: 'review',
    description: 'review changes [base <ref> | commit <sha>]',
    action: (arg) => ({ kind: 'review', arg }),
  },
  {
    name: 'goal',
    description: 'run an autonomous goal loop until done/budget',
    action: (arg) => ({ kind: 'goal', arg }),
  },
  // Codex names carrying their own implementation here rather than a pointer at another command.
  // They keep the Codex word because that is the word the fingers of someone arriving from it
  // produce, and what they render is this build's own state.
  {
    name: 'agents',
    description: 'the subagents this project defines and the sessions you can resume',
    action: { kind: 'showAgents' },
  },
  {
    name: 'permissions',
    description: 'the approval mode and the sandbox mode, together',
    action: { kind: 'showPermissions' },
  },
  {
    name: 'theme',
    description: 'switch the colour theme for this session — dark | light | no-color',
    action: (arg) => ({ kind: 'theme', arg }),
  },
  {
    name: 'title',
    description: 'choose what the terminal title shows: /title <items> | none | default',
    action: (arg) => ({ kind: 'title', arg }),
  },
  {
    name: 'statusline',
    description: 'choose which facts the footer shows: /statusline <items> | default',
    action: (arg) => ({ kind: 'statusline', arg }),
  },
  // Named after Codex's `/raw` because that is the word the fingers of someone arriving from it
  // produce, and described as what it actually does. Codex's is a transcript render-mode toggle;
  // this prints once, because Ink hard-wraps everything inside its layout — `raw-command.ts`
  // carries the measurement.
  {
    name: 'raw',
    description: 'print the last reply above the frame as plain text for mouse selection',
    action: (arg) => ({ kind: 'raw', arg }),
  },
]

export const BUILTIN_COMMAND_NAMES: ReadonlySet<string> = new Set([
  ...BUILTINS.map((c) => c.name),
  // Codex names that point at a feature this build HAS under another name are in the menu because
  // reading `/memories → /memory` there is how the real command gets discovered.
  ...[...CODEX_NAMES].filter(([, v]) => v.listed).map(([name]) => name),
])

const BUILTIN_BY_NAME: ReadonlyMap<string, BuiltinCommand> = new Map(
  BUILTINS.map((c) => [c.name, c]),
)

/** A user-defined command's name and the line the menu shows for it. */
type CustomCommands = ReadonlyMap<string, { name: string; description?: string }>

/**
 * Every name this build answers to, in the shape the framework routes over — and the menu.
 *
 * Built per call because the custom commands are loaded from `.theokit/commands/` and change at
 * runtime. A custom command owns its name outright, so a builtin it shadows is dropped before the
 * registry (which rejects duplicates) sees it. Builtins keep their order and customs follow them.
 */
function definitions(custom: CustomCommands): CommandDefinition[] {
  const defs: CommandDefinition[] = []
  const claimed = new Set<string>(custom.keys())
  const add = (def: CommandDefinition): void => {
    if (claimed.has(def.name)) return
    claimed.add(def.name)
    defs.push(def)
  }
  for (const { name, description } of BUILTINS) add(defineCommand({ name, description }))
  // Every Codex name, INCLUDING the ones the menu does not offer: being answerable when typed
  // and being advertised are different jobs, and only the first one is what stops a person
  // arriving from Codex hitting `unknown command`.
  for (const [name, v] of CODEX_NAMES) {
    add(
      defineCommand({
        name,
        description: v.answer,
        ...(v.listed ? {} : { hidden: true }),
      }),
    )
  }
  for (const [name, c] of custom) {
    defs.push(defineCommand({ name, description: c.description ?? 'custom command' }))
  }
  return defs
}

/** The `/` menu: the registry's own palette over builtins, listed Codex names and customs. */
export function commandPalette(custom: CustomCommands): readonly ChatComposerCommand[] {
  return createCommandRegistry(definitions(custom)).palette()
}

/**
 * What the user typed, as this product's verb.
 *
 * The CLASSIFICATION — command, prose, or a slash that names nothing — is the framework's now. It
 * was the defective half: this function ended `EXACT_COMMANDS.get(trimmed) ?? { kind: 'send' }`, so
 * an unrecognised `/moddel` was handed to the model as text and answered plausibly. The framework
 * already distinguishes `unknown-command`, `missing-argument`, `unexpected-argument` and
 * `ambiguous-command`, and states why: a typo hidden behind a helpful answer is worse than an error.
 *
 * The VERB MAPPING stays here, because which slash means which action is this product's vocabulary.
 */
export function routeCommand(input: string, customNames?: ReadonlySet<string>): CommandAction {
  const custom: CustomCommands = new Map([...(customNames ?? [])].map((n) => [n, { name: n }]))
  const trimmed = input.trim()
  if (trimmed.length === 0) return { kind: 'noop' }

  const routed = createCommandRegistry(definitions(custom)).route(trimmed)
  if (routed.kind === 'message') return { kind: 'send', text: routed.text }
  if (routed.kind === 'error') {
    return { kind: 'commandError', reason: routed.reason, input: trimmed }
  }

  // Recognised. A custom command wins over a builtin of the same name only if it IS one — the
  // framework already resolved ambiguity, so this is a lookup, not a second routing pass.
  if (customNames?.has(routed.command.name) === true) {
    return { kind: 'custom', name: routed.command.name, arg: routed.arg }
  }
  const builtin = BUILTIN_BY_NAME.get(routed.command.name)
  if (builtin !== undefined) {
    return typeof builtin.action === 'function' ? builtin.action(routed.arg) : builtin.action
  }
  // Checked AFTER this build's own verbs, so a Codex name we later implement for real takes over
  // without anyone having to remember to delete the pointer.
  if (CODEX_NAMES.has(routed.command.name)) {
    return { kind: 'codexName', name: routed.command.name }
  }
  return { kind: 'send', text: trimmed }
}
