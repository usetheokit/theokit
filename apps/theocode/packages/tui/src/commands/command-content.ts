import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { Dispatch, MutableRefObject, SetStateAction } from 'react'

import type { ApprovalMode } from '../consent/index.js'
import type { ContentPanel, ToastPayload } from '../screen-types.js'
import { userAgentsMdPath } from '@theocode/agent/context'

import { resolveMentions } from './mentions.js'
import type {
  AgentTheInterpreterUses,
  PtysTheInterpreterUses,
  SessionTheInterpreterUses,
} from './command-capabilities.js'
import { workingDirectory } from '../working-directory.js'
import { THEME_RESOLUTION } from '../theme/theme.js'
import { themeResolutionLine } from './theme-command.js'
import { sessionThemeLabel } from '../theme/theme-session.js'
import { keybindingsNotApplied } from '../terminal-io/use-tui-keyboard.js'
import type { WiredCapabilities } from '@theocode/agent'
import { BASE_NAMES, agentsMdChain, loadRules, loadUserRules } from '@theocode/agent/context'

/** Paths as the user reads them — relative to the directory the session is in. */
const relative = (paths: readonly string[]): string =>
  paths.map((p) => p.replace(`${workingDirectory()}/`, '')).join(', ')

/**
 * One line for the `AGENTS.md` chain: what is steering the agent, or why nothing is.
 *
 * Four states, and they are not interchangeable. Suppressed means files EXIST and were refused —
 * the only state where the panel has to say what was lost. Empty means the walk found nothing,
 * which is a normal repository.
 *
 * The fourth is the one this row is most often read in. `/status` is what a person runs BEFORE the
 * first turn — that is when you ask which rules the agent is about to follow — and until an agent
 * has been built there is no wiring record, so the row said `<unknown>` exactly when it was asked.
 * The walk that produces the record is a pure read of the disk (`agentsMdChain`, the same function
 * `buildChatAgent` hands to `wiredCapabilities`), so the answer is available without building
 * anything.
 *
 * It is labelled `on disk`, and that word is load-bearing: the trust gate has not run yet, so what
 * the walk finds is what WOULD be loaded, not what was. Reporting it as though it were already in
 * the prompt would be the same overstatement `<unknown>` was avoiding — this says the true thing
 * instead of saying nothing.
 */
export function agentsMdRow(
  wired: WiredCapabilities | undefined,
  /**
   * The walk, injectable for the same reason `fittedCwd` takes its directory: with the ambient one
   * the outcome depends on whether the checkout the suite happens to run in has an `AGENTS.md`, and
   * both branches would be unassertable on half the machines.
   */
  onDiskChain: (cwd: string) => readonly string[] = agentsMdChain,
  /**
   * The operator's own files, injectable for the same reason as the chain above: with the ambient
   * home the outcome depends on whether the machine running the suite happens to have one.
   */
  userChain: (home: string) => readonly string[] = defaultUserChain,
): string {
  const user = userChain(homedir())
  const userNote = user.length === 0 ? '' : `user: ${relative(user)}`

  if (wired === undefined) {
    const onDisk = onDiskChain(workingDirectory())
    const project =
      onDisk.length === 0 ? '' : `${relative(onDisk)}  (on disk — not loaded yet)`
    return joinParts(project, userNote)
  }
  const entity = wired.agentsMd
  if (entity.suppressedByTrust) {
    // The user layer is NOT gated (#65), so the old wording — "NOT LOADED" — became a lie by
    // omission the moment that layer existed: the project chain is ignored and the operator's file
    // is in the prompt. A status row that overstates in the safe direction is still one nobody can
    // trust.
    const ignored = `project NOT LOADED — directory untrusted (${entity.requested.length} file(s) ignored)`
    return joinParts(ignored, userNote)
  }
  return joinParts(entity.active.length === 0 ? '' : relative(entity.active), userNote)
}

/**
 * #91 — how much of the rules block reached the prompt.
 *
 * Sibling of `agentsMdRow`, and here for the same reason its own comment gives: *"the case that
 * matters is the silent one"*. A truncated rules block is silent by construction — the agent
 * answers normally, having never seen the part that was cut, and until now the only notice was a
 * `stderr` line the TUI does not surface. Measured on this product's own checkout at v0.7.0:
 * 248,669 chars against a 64,000 ceiling, so 74% of the rules were dropped in the repository that
 * wrote them.
 *
 * The complete case prints WITHOUT arithmetic on purpose. A row that always read "12 of 12 · 4,000
 * chars" is a row people learn to skip, and then the one time it says something different, nobody
 * is reading it.
 */
export function rulesRow(
  rules: WiredCapabilities['rules'],
  /**
   * #61 item C — what a walk of the disk WOULD load, for the window before the first turn.
   *
   * Codex answers `/status` immediately because it resolves at startup; this product builds the
   * agent per turn, so until one runs there is no record. `<not loaded yet>` was honest and was not
   * an answer. `agentsMdRow` solved the same window one row up by walking the disk and labelling
   * the result, and this follows it rather than inventing a second convention.
   *
   * Injectable for the reason that row's walk is: with the ambient reader the arms would depend on
   * whether the checkout the suite runs in happens to have rules.
   */
  onDisk: (cwd: string) => WiredCapabilities['rules'] = defaultRulesOnDisk,
): string {
  if (rules === undefined) {
    const found = onDisk(workingDirectory())
    // Nothing on disk is `<none>`, not `<none> (on disk — not loaded yet)`: the label answers "this
    // may still change", and there is nothing here to change into.
    if (found === undefined || found.read === 0) return '<none>'
    return `${rulesBody(found)}  (on disk — not loaded yet)`
  }
  if (rules.read === 0) return '<none>'
  return rulesBody(rules)
}

function defaultRulesOnDisk(cwd: string): WiredCapabilities['rules'] {
  // The loader, not a second reader of the same convention — the row exists to say what the prompt
  // holds, and a row computing its own answer is a row that can be wrong about it.
  const project = loadRules(cwd)
  const user = loadUserRules(homedir())
  const both = [project, user]
  return {
    count: both.reduce((n, r) => n + r.count, 0),
    read: both.reduce((n, r) => n + r.read, 0),
    chars: both.reduce((n, r) => n + r.chars, 0),
    kept: both.reduce((n, r) => n + r.kept, 0),
    truncated: both.some((r) => r.truncated),
  }
}

function rulesBody(rules: NonNullable<WiredCapabilities['rules']>): string {
  return `${firstCeiling(rules)}${secondCeiling(rules)}`
}

/** The loader's ceiling, in SOURCE chars. Unchanged from #91. */
function firstCeiling(rules: NonNullable<WiredCapabilities['rules']>): string {
  if (!rules.truncated) return `${String(rules.count)} loaded`

  // From the two numbers the record carries — never from the ceiling, which lives in the loader
  // and would be a second copy here, wrong the day it moved.
  const dropped = Math.round((100 * (rules.chars - rules.kept)) / rules.chars)
  return `${String(rules.count)} of ${String(rules.read)} — ${String(dropped)}% dropped (${rules.chars.toLocaleString('en-US')} chars over the ceiling)`
}

/**
 * B-173 — the aggregate ceiling, in RENDERED chars, as its OWN clause.
 *
 * Appended rather than folded into the share above, and the separation is the point: the first
 * ceiling counts source chars the loader read, this one counts rendered chars in the composed
 * prompt. One percentage over two units would be unverifiable, and the attempt that tried it
 * printed "0% dropped" over a persona cut to 363 chars.
 *
 * Empty when the aggregate ceiling did not cut the rules — which is the case a renderer that
 * always appends gets wrong, and the one the tests pin.
 */
function secondCeiling(rules: NonNullable<WiredCapabilities['rules']>): string {
  const cut = rules.aggregateCut
  if (cut === undefined) return ''
  return `; a later ceiling cut the block from ${cut.from.toLocaleString('en-US')} to ${cut.to.toLocaleString('en-US')} chars`
}

/** Both halves, or whichever exists; `<none>` only when there is genuinely nothing. */
function joinParts(project: string, user: string): string {
  const parts = [project, user].filter(Boolean)
  return parts.length === 0 ? '<none>' : parts.join('  ·  ')
}

function defaultUserChain(home: string): readonly string[] {
  // #72 — the path comes from the loader, not from a second literal here. `/status` exists to say
  // what IS in the prompt, and a row computing its own answer is a row that can be wrong about it.
  const path = userAgentsMdPath(home)
  return existsSync(path) ? [path] : []
}

export function sendMessage(
  text: string,
  goalActive: boolean,
  agent: AgentTheInterpreterUses,
  lastSentMessage: MutableRefObject<string | null>,
  setToast: Dispatch<SetStateAction<ToastPayload | null>>,
): void {
  if (goalActive) {
    setToast({
      message: 'A goal is running — wait for it, or press Esc to abort, before sending',
      variant: 'info',
    })
    return
  }
  const { message, attached } = resolveMentions(text, workingDirectory())
  if (attached.length > 0) {
    setToast({ message: `Attached: ${attached.join(', ')}`, variant: 'info' })
  }
  lastSentMessage.current = message
  agent.send({ message })
}

export function switchModel(
  arg: string,
  SESSION: SessionTheInterpreterUses,
  setToast: Dispatch<SetStateAction<ToastPayload | null>>,
): void {
  const target = arg.trim()
  if (target.length === 0) {
    setToast({
      message: `model: ${SESSION.sessionModel() ?? SESSION.cfg().modelLabel} (use /model <name> to switch)`,
      variant: 'info',
    })
    return
  }
  SESSION.setSessionModel(target)
  setToast({ message: `this session's model: ${target}`, variant: 'success' })
}

/**
 * The prompt `/init` sends. Module-local now that `initAgents` lives beside it: the request and
 * the only function that sends it moved into one file, and an export nobody imports is dead
 * surface rather than API — the rule `knip.jsonc` enforces for every package here.
 */
const AGENTS_MD_REQUEST =
  'Read this repository (structure, manifests, scripts, tests) and write an AGENTS.md at the ' +
  'root describing: what the project is, how to run/test/build it, the code conventions observed ' +
  'in the code itself, and the boundaries that must not be crossed. ' +
  'Base every statement on what you read — do not invent a convention the code does not show.'

/**
 * `/init` — ask the agent to write an `AGENTS.md`, unless one is already there.
 *
 * It lived in `interpret-command.ts`, extracted from the `inspection` switch because it is the only
 * arm with a branch of its own. It moved HERE when that file crossed its own 400-line cap: the same
 * answer one level up, and the better home anyway — the request it sends is declared three lines
 * above, and a function and the constant it exists to send belong in one file.
 *
 * It REFUSES rather than overwrites. An `AGENTS.md` is hand-written policy; regenerating one on top
 * of the rules a team already agreed on is a destructive act that a three-letter command must not
 * perform silently.
 */
export function initAgents(
  agent: AgentTheInterpreterUses,
  lastSentMessage: MutableRefObject<string | null>,
  setToast: Dispatch<SetStateAction<ToastPayload | null>>,
): void {
  // Every name the loader reads, not just the one `/init` writes. Checking `AGENTS.md` alone was
  // correct while it was the only name; under the first-wins chain it let `/init` write an
  // `AGENTS.md` into a repository steered by `CLAUDE.md` — nothing overwritten, and the operator's
  // file silently stops being read because AGENTS.md wins. The list is IMPORTED rather than
  // retyped: two copies of a precedence order drift, and this one would drift silently.
  const steering = BASE_NAMES.find((n) => existsSync(join(workingDirectory(), n)))
  if (steering !== undefined) {
    setToast({
      message: `${steering} already exists — delete it first if you want to regenerate it`,
      variant: 'info',
    })
    return
  }
  agent.send({ message: AGENTS_MD_REQUEST })
  lastSentMessage.current = AGENTS_MD_REQUEST
}

export function statusPanel(
  SESSION: SessionTheInterpreterUses,
  approvalMode: ApprovalMode,
  currentSessionId: () => string,
  ptyOwner: PtysTheInterpreterUses,
  /**
   * What the last build actually wired. Passed in rather than read here for the reason B-071 was
   * reopened over: a panel that re-reads config can disagree with the agent that is running, and
   * the disagreement is the bug worth catching.
   */
  wired?: WiredCapabilities,
): ContentPanel {
  const c = SESSION.cfg()
  const rows: readonly (readonly [string, string])[] = [
    ['model', SESSION.sessionModel() ?? c.modelLabel],
    ['effort', SESSION.effort()],
    ['approval', approvalMode],
    // `sandboxDetail`, not `sandboxLabel`: the latter carries a `sandbox:` prefix for the footer's
    // `·`-joined run, and this panel already supplies the label as a column. Using it here printed
    // `sandbox:    sandbox:workspace-write`.
    ['sandbox', c.sandboxDetail],
    ['cwd', workingDirectory()],
    // Codex reports the same fact on its own status panel (`Agents.md: <none>`). Until now this
    // product reported it nowhere, and the case that matters is the silent one: an untrusted
    // directory drops the file, so the agent runs WITHOUT the rules the repository wrote for it
    // and nothing on screen says so.
    ['agents.md', agentsMdRow(wired)],
    // #91 — beside `agents.md` because it answers the other half of one question: are the
    // instructions this repository wrote actually in the prompt? That row covers the file being
    // dropped by the trust gate; this one covers the rules block being cut by the ceiling. Both
    // failures are silent, and this product's own checkout was losing 74% when the row was added.
    ['rules', rulesRow(wired?.rules)],
    ['session', currentSessionId()],
    ['shells', `${String(ptyOwner.backend().activeSessionCount())} in background`],
    // B-073 — the source answers "why is it this colour?", which is the only question anyone
    // asks about a theme. It is also where an unusable THEOCODE_THEME value surfaces: the
    // resolver falls back so a typo cannot end the session, and this row is what keeps that from
    // being a swallowed error. The line is rendered by `theme-command.ts` because `/theme` reports
    // the same resolution, and the rejected-value clause is exactly what would drift if the two
    // were written separately.
    //
    // The override is passed as a SECOND fact rather than substituted for the first: once `/theme`
    // can switch, "the frame is light" and "this terminal resolves dark" are different answers, and
    // a panel that reported only the active base would leave a user unable to tell a switch they
    // made from an environment they need to go and fix.
    // #14 — the LABEL, so `/theme custom:<slug>` is named here too. The narrower accessor this
    // replaces answered "which built-in base", and returned `undefined` for a custom theme — so
    // this row reported the environment while the frame was drawn in the operator's own file.
    ['theme', themeResolutionLine(THEME_RESOLUTION, sessionThemeLabel())],
    // The keybindings file is silent by construction: a binding that was not applied is a key that
    // does nothing, which reads as a broken terminal rather than as an unsupported action. This row
    // is the only place that says otherwise, and it is here rather than in `theocode doctor`
    // because the CLI does not depend on the TUI — the boundary `theme-base.ts` records.
    ['keybindings', keybindingsRow(keybindingsNotApplied())],
  ]
  return {
    title: 'session status',
    body: alignedRows(rows),
  }
}

/**
 * What a `~/.claude/keybindings.json` asked for and did not get.
 *
 * Answers on BOTH branches. A row that vanishes when everything applied is indistinguishable from a
 * row nobody wrote, and `/status` is a fixed set of labels read at a glance. Long lists are counted
 * rather than printed: seven refusals would push the rows below this one off the screen, and the
 * count is what makes an operator go and look.
 */
export function keybindingsRow(notApplied: readonly string[]): string {
  if (notApplied.length === 0) return 'honoured'
  if (notApplied.length <= 2) return `not applied: ${notApplied.join('; ')}`
  return `${String(notApplied.length)} not applied: ${notApplied.slice(0, 2).join('; ')}; …`
}

/**
 * `label: value` rows with the values in one column.
 *
 * The padding used to be typed into each template literal, and it was already wrong: `model:` sat
 * one column left of the other seven, so the panel read as ragged from the first render. Widths
 * that are maintained by hand drift the moment a label is added or renamed — computing the column
 * makes that class of defect unrepresentable rather than merely fixed.
 */
function alignedRows(rows: readonly (readonly [string, string])[]): string {
  const width = Math.max(...rows.map(([label]) => label.length)) + 1
  return rows.map(([label, value]) => `${`${label}:`.padEnd(width + 3)}${value}`).join('\n')
}

/**
 * B-145 — the bound on `/diff`'s two git calls.
 *
 * `spawnSync` blocks the event loop, and in the TUI that is the Ink render loop: a `git diff` on a
 * large working tree, or against a slow filesystem, freezes the frame with no cursor and no way to
 * tell it apart from a crash.
 *
 * 10 s is the same number `/review` already bounds its git calls with. Two different answers to "how
 * long may git take" inside one product is the inconsistency B-128 was about, one file over.
 */
export const DIFF_TIMEOUT_MS = 10_000

/**
 * The options both `git diff` calls are made with, as a value a test can read.
 *
 * Same reason as the clipboard's: a constant that never reaches the call is the same as no bound,
 * and asserting the constant alone is how that goes unnoticed.
 */
export function diffSpawnOptions(): { cwd: string; encoding: 'utf8'; timeout: number } {
  return { cwd: workingDirectory(), encoding: 'utf8', timeout: DIFF_TIMEOUT_MS }
}

export function diffPanel(): ContentPanel | undefined {
  const r = spawnSync('git', ['diff', '--stat', 'HEAD'], diffSpawnOptions())
  // A timeout leaves `status` null, which is not 0 — so a killed diff renders no panel rather than
  // an empty one claiming a clean tree. Measured 2026-09-03: `spawnSync('sleep', ['5'], {timeout:200})`
  // returns `status: null, signal: 'SIGTERM', error.code: 'ETIMEDOUT'`.
  if (r.status !== 0) return undefined
  const detail = spawnSync('git', ['diff', 'HEAD'], diffSpawnOptions())
  const stat = r.stdout.trim()
  const patch = detail.stdout
  if (stat.length === 0 && patch.trim().length === 0) {
    return { title: 'working tree diff', body: 'clean working tree — no uncommitted changes' }
  }
  return {
    title: 'working tree diff',
    body: stat,
    ...(patch.trim().length > 0 ? { patch } : {}),
  }
}
