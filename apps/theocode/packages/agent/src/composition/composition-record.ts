import { homedir } from 'node:os'

import type { InlineSkill } from '@theokit/sdk'

import type { EffectiveConfig, TrustPosture } from '../config/index.js'
import { projectSourceAllowed } from '../config/project-source.js'
import { agentsMdChain, loadRules, loadUserRules } from '../context/index.js'
import type { RulesLoad } from '../context/rules.js'
import { parseHooks } from '../hooks/index.js'
import type { McpScopes } from '../mcp-scopes.js'
import { wiredCapabilities } from '../wired-capabilities.js'
import type { InstructionCut } from '../context/agents-md.js'
import type { WiredCapabilities } from '../wired-capabilities.js'

/** The hook events, each with the command it runs — see the comment inside for why both. */
function configuredHookEvents(cfg: EffectiveConfig): readonly string[] {
  try {
    // B-071 — event AND command: a listing that showed only the event would tell a user something
    // is allowed to block them without saying what runs, which is the half that matters when the
    // directory came from a clone.
    // #132 — no longer marked. `SessionStart` used to parse and never fire, so the listing carried
    // a `DECLARED BUT NEVER RUNS` note; it now fires from the surface that starts the session
    // (`hooks/session-start.ts`), so the plain listing is true again. `inert-events.ts` was deleted
    // rather than emptied — a list of known-broken things is a liability the moment it stops being
    // true, which is what its own docblock said to do.
    return parseHooks(cfg.hooks).map((h) => `${h.event}  ${h.command}`)
  } catch {
    return []
  }
}

/**
 * The record of what was just wired, from the values the builder received.
 *
 * Its own function so `buildChatAgent` keeps one statement for it. That was forced by the linter's
 * length ceiling and the ceiling was right: the derivation now carries two MCP scopes, and a record
 * that has grown its own rules is no longer a line of the composition.
 */
function wiringRecord(
  posture: TrustPosture,
  cwd: string,
  cfg: EffectiveConfig,
  mcp: McpScopes,
  /**
   * #65 — the operator's own skill names, already read from `~/.theokit/skills/`.
   *
   * Handed in rather than re-read here, for the reason the whole record exists: a second read is a
   * second answer, and the disagreement between what a surface lists and what the agent holds is
   * the bug B-071 was reopened for.
   */
  operatorSkills: readonly string[],
  /**
   * #91 — how much of the rules block reached the prompt, from the load the caller already
   * performed. Re-reading it here would give the panel a second answer to a question the builder
   * has already answered, which is the disagreement this whole record exists to prevent.
   */
  rules: ReturnType<typeof wiredCapabilities>['rules'],
): ReturnType<typeof wiredCapabilities> {
  return wiredCapabilities({
    posture,
    projectSourcesAllowed: projectSourceAllowed(posture.allows),
    mcpServers: mcp.servers,
    mcpPersonal: mcp.personal,
    mcpWithheld: mcp.projectWithheld,
    configuredSkills: cfg.skills,
    operatorSkills,
    ...(rules !== undefined ? { rules } : {}),
    hookEvents: configuredHookEvents(cfg),
    // The same walk `projectDocument` runs below, so the record and the prompt cannot name
    // different files. Paths only — the record is a listing, never a copy of the instructions.
    agentsMdFiles: agentsMdChain(cwd),
    // Already carries the session override — `chatContext` applied it once, above.
    sandboxMode: cfg.sandbox_mode,
  })
}

/**
 * #91 — both rule roots, read ONCE.
 *
 * Here rather than inline in `buildChatAgent` for the reason `mcpScopes` is: the prompt and the
 * record must not be able to disagree about how much of the rules block made it in.
 * `projectDocument` used to read them inside the builder and drop the counts on the floor, so the
 * only trace that 74% of this repository's own rules were being cut was a `stderr` line the TUI
 * does not surface.
 */
export function bothRuleRoots(
  cwd: string,
  /**
   * B-167 — the operator's root, injectable for the same reason `cwd` is. `homedir()` was read here
   * and at two sites in `chat.ts`, so a build could not be told which operator root to read and every
   * test wanting a controlled one reached for the process-wide `HOME`.
   */
  home: string = homedir(),
): {
  project: RulesLoad
  user: RulesLoad
  /** The same load, projected for the record — so the call site cannot project it differently. */
  record: WiredCapabilities['rules']
} {
  const project = loadRules(cwd)
  const user = loadUserRules(home)
  return { project, user, record: rulesLoad([project, user]) }
}

/**
 * B-173 — fold the aggregate ceiling's rules cut into the record the surfaces read.
 *
 * Only a cut whose `source` is `rules` reaches the rules row. The ceiling can equally cut the
 * surface document or leave an oversized base, and attributing either here is how a 25-char
 * intact load once reported "1 of 1 — 0% dropped": false in both numbers, about a block nothing
 * had touched.
 *
 * Returns the record UNCHANGED when nothing cut the rules — the identity case is the one an
 * implementation that always reports a cut gets wrong, so it is the one the tests assert.
 */
export function withAggregateCut(
  record: WiredCapabilities['rules'],
  cuts: readonly InstructionCut[],
): WiredCapabilities['rules'] {
  if (record === undefined) return record
  const cut = cuts.find((c) => c.source === 'rules')
  return cut === undefined ? record : { ...record, aggregateCut: { from: cut.from, to: cut.to } }
}

/**
 * Build the record and hand it to whoever asked for it.
 *
 * Derived from the SAME values the builder just received, at the point it received them. That is
 * the DoD bullet B-071 was reopened for: not a second read of config, but a record of the decision.
 */
export function publishWiring(
  onWired: ((wired: WiredCapabilities) => void) | undefined,
  from: {
    posture: TrustPosture
    cwd: string
    cfg: EffectiveConfig
    mcp: McpScopes
    operatorSkills: readonly InlineSkill[]
    rules: ReturnType<typeof bothRuleRoots>
    /** B-173 — what the aggregate ceiling cut, from the build that applied it. */
    aggregateCuts?: readonly InstructionCut[]
  },
): void {
  onWired?.(
    wiringRecord(
      from.posture,
      from.cwd,
      from.cfg,
      from.mcp,
      from.operatorSkills.map((s) => s.name),
      withAggregateCut(from.rules.record, from.aggregateCuts ?? []),
    ),
  )
}

/**
 * #91 — the two loads as one figure, because the operator asks one question: *is what I wrote in
 * the prompt?*
 *
 * The sums are addition over two DISJOINT loads, not an invented aggregate: each root is read once
 * and sliced against its own ceiling, so `read` and `chars` add cleanly. `truncated` is a
 * disjunction — either root losing content is the answer "no".
 */
function rulesLoad(both: readonly RulesLoad[]): WiredCapabilities['rules'] {
  return {
    count: both.reduce((n, r) => n + r.count, 0),
    read: both.reduce((n, r) => n + r.read, 0),
    chars: both.reduce((n, r) => n + r.chars, 0),
    kept: both.reduce((n, r) => n + r.kept, 0),
    truncated: both.some((r) => r.truncated),
  }
}
