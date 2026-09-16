import type { ChatComposerCommand } from '@theokit/tui'

/**
 * The Codex slash commands this product does not implement — answered instead of refused.
 *
 * A person moving between the two terminals types what their fingers know. Every name below used to
 * produce `unknown command`, which is accurate and useless: it says the word was wrong without
 * saying what the right word is, and half of these DO have an equivalent here under a different
 * name. Answering costs one line and turns a dead end into a redirection.
 *
 * A pointer is the SECOND-best answer, and six names have since stopped needing one: `/theme`,
 * `/agents` and `/permissions` are implemented here (`theme-command.ts`, `agents-panel.ts`,
 * `permissions-panel.ts`), and `/title`, `/statusline` and `/raw` followed
 * (`title-session.ts` + `surface-commands.ts`, `statusline-session.ts` + `surface-commands.ts`,
 * `raw-command.ts`). Each was deleted from this map in the commit that implemented it. That is the
 * direction this file is meant to shrink in — a name whose equivalent can be rendered on one screen
 * should render it rather than send the user to two other commands.
 *
 * `/raw` is the one worth reading the pointer it replaced against. It used to say "no
 * raw-scrollback toggle" and send the user to `/copy` and `/export`, which was true and unhelpful:
 * neither of those helps someone who wants to drag a mouse over part of an answer. What replaced it
 * is NOT the Codex toggle either — `raw-command.ts` records why that is unreachable under Ink — and
 * it does not claim to be. A narrower capability described honestly beats a pointer at two commands
 * that solve a different problem.
 *
 * `listed` is the honest half of the design. A name that points at a real feature belongs in the
 * `/` menu, because reading it there is how someone discovers `/memory` exists. A name with no
 * equivalent does not: putting `/pets` in the menu of a product that has no pets advertises an
 * absence, and a menu of thirty entries where a third of them say "we don't have that" is worse
 * than a shorter menu. Those still ANSWER when typed — discovery through the menu and forgiveness
 * when typed are different jobs.
 *
 * Three Codex names are deliberately absent even from this map: `debug-m-drop` and `debug-m-update`
 * are documented upstream as "DO NOT USE", and `test-approval` fires a synthetic approval card.
 * Mirroring another product's debug hooks is not parity, it is noise.
 *
 * Every answer states something that is true of THIS build, verified against the registry beside
 * it. An answer that names a command we do not have would be worse than the error it replaces.
 */
interface CodexName {
  /** What the user is told — the equivalent here, or plainly that there is none. */
  readonly answer: string
  /** Whether the `/` menu offers it. See the note above on why this is not always true. */
  readonly listed: boolean
}

/** One answer for every Codex sandbox verb: the mode is set as a whole here, not per-path. */
const SANDBOX_ANSWER = 'the sandbox is set as a whole here — /sandbox shows and changes the mode'

/** Shared by the Codex verbs that branch a conversation. */
const FORK_ANSWER = 'the nearest thing is /fork, which branches this session into a new one'

export const CODEX_NAMES: ReadonlyMap<string, CodexName> = new Map([
  // ── Names with a real equivalent here. Listed, because the menu is where they are found. ──
  [
    'memories',
    { answer: 'it is /memory here — /memory, /memory off|on, /memory forget <n>', listed: true },
  ],
  [
    // Codex renders this one `approve` (`#[strum(to_string = "approve")]`); `auto-review` is the
    // variant name and was never typeable. Kept as the display name, not the variant name — the
    // pointer exists for what a user types.
    'approve',
    { answer: 'it is /review here — /review [base <ref> | commit <sha>]', listed: true },
  ],
  [
    // Codex: "summarize the current conversation now". `/compact` is the nearest thing and NOT the
    // same operation — it summarises to reclaim context, on the loop's terms; this summarises
    // because the user asked. Saying "it is /compact here" would promise a behaviour that differs
    // exactly where a user would notice.
    'recap',
    {
      answer: 'no on-demand recap — /compact summarises to reclaim context, which is a different reason',
      listed: true,
    },
  ],
  [
    // Codex: "start or continue a conversation in a new worktree". `/fork` branches the SESSION and
    // leaves the checkout alone; nothing here creates a git worktree.
    'worktree',
    {
      answer: 'no git-worktree session — /fork branches this session, and leaves the checkout where it is',
      listed: true,
    },
  ],
  [
    // Codex: "start or stop a live voice conversation". No equivalent, and nothing near enough to
    // point at — an honest absence rather than a redirection to something unrelated.
    'voice',
    { answer: 'no voice conversation — this product is text only', listed: false },
  ],
  [
    'mention',
    { answer: 'no command needed — type @ in the composer and pick the file', listed: true },
  ],
  [
    'debug-config',
    {
      answer:
        '/status shows the resolved model, effort, approval, sandbox, cwd and theme; ' +
        '`theocode doctor` checks the same layers from outside the TUI',
      listed: true,
    },
  ],
  [
    'sandbox-add-read-dir',
    {
      answer: SANDBOX_ANSWER,
      listed: true,
    },
  ],
  [
    'setup-default-sandbox',
    {
      answer: SANDBOX_ANSWER,
      listed: true,
    },
  ],
  [
    'side',
    {
      answer: FORK_ANSWER,
      listed: true,
    },
  ],
  [
    'btw',
    {
      answer: FORK_ANSWER,
      listed: true,
    },
  ],
  [
    'cd',
    {
      answer:
        'the TUI runs in the directory it was started in and cannot move — /pwd says which one. ' +
        'Headless takes a directory: `theocode -C <dir> run "…"`',
      listed: true,
    },
  ],

  // ── Names with no equivalent. Answered when typed, kept OUT of the menu. ──
  [
    'ide',
    { answer: 'no IDE bridge — TheoCode reads the repository, not your editor', listed: false },
  ],
  ['app', { answer: 'no desktop app to hand this session to', listed: false }],
  [
    'apps',
    { answer: 'no app directory — MCP servers are the extension point (/mcp)', listed: false },
  ],
  [
    'plugins',
    { answer: 'no plugin browser — MCP servers are the extension point (/mcp)', listed: false },
  ],
  [
    'import',
    {
      answer: 'no importer for Claude Code setup or chats; AGENTS.md is read directly (/status)',
      listed: false,
    },
  ],
  ['keymap', { answer: 'shortcuts are fixed — press ? for the list', listed: false }],
  ['vim', { answer: 'no Vim mode in the composer', listed: false }],
  [
    'personality',
    { answer: 'no communication-style picker; /effort changes how hard it thinks', listed: false },
  ],
  ['pets', { answer: 'no terminal pet', listed: false }],
  [
    'feedback',
    { answer: 'no in-TUI feedback channel — open an issue on the repository', listed: false },
  ],
  ['experimental', { answer: 'no experimental-features switch', listed: false }],
  [
    'rollout',
    {
      answer: 'no rollout-path command; /export writes the conversation where you ask it to',
      listed: false,
    },
  ],
])

/** The subset the `/` menu offers, in the shape the composer takes. */
export const CODEX_NAME_COMMANDS: readonly ChatComposerCommand[] = [...CODEX_NAMES.entries()]
  .filter(([, v]) => v.listed)
  .map(([name, v]) => ({ name, description: v.answer }))

/**
 * What `/name` says when it is a Codex name this build does not implement.
 *
 * The `??` branch is unreachable while the router only produces names from this map, and is written
 * out rather than asserted away: a silent empty toast would read as a command that did nothing,
 * which is the failure mode this whole file exists to remove.
 */
export function codexNameAnswer(name: string): string {
  const entry = CODEX_NAMES.get(name)
  return entry === undefined ? `/${name} is not a command here` : `/${name} — ${entry.answer}`
}
