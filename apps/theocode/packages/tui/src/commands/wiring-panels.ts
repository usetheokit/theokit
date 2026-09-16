/**
 * B-070 — rendering what the agent actually wired.
 *
 * Reads the record `buildChatAgent` published, never the config. That is the DoD bullet all three
 * listing items share and the one B-071 was reopened for: config and reality can disagree, and the
 * disagreement is the bug worth catching.
 */
import type { WiredCapabilities, WiredEntity } from '@theocode/agent'

import type { McpFailure } from '../agent-session/mcp-failure-record.js'

/**
 * One entity's lines.
 *
 * The suppressed case lists what was REMOVED rather than showing nothing, because "no skills" and
 * "your skills were dropped because this directory is untrusted" send a user to opposite places.
 */
function renderWiredEntity(
  entity: WiredEntity | undefined,
  labels: { readonly empty: string; readonly suppressed: string },
): string {
  if (entity === undefined) {
    // Before the first turn no agent exists. Saying "none" here would answer for an agent that was
    // never built.
    return 'no agent has been built yet — send a message first, then ask again'
  }
  if (entity.suppressedByTrust) {
    return `${labels.suppressed}\n${entity.requested.map((n) => `  ${n} (not loaded)`).join('\n')}`
  }
  if (entity.active.length === 0) return labels.empty
  return entity.active.map((n) => `  ${n}`).join('\n')
}

export function skillsPanelBody(wired: WiredCapabilities | undefined): string {
  return renderWiredEntity(wired?.skills, {
    // B-070 forbids a config re-read here, and this listing is therefore blind to one whole
    // loading path: `.claude/skills/` reaches the model through the compatibility dialect, never
    // through `.skills()`, so it cannot appear. The old wording — "no skills are enabled for this
    // directory" — asserted about BOTH paths what this panel knows about one. Measured
    // 2026-09-15: it printed that while the model, in the same turn, listed forty skills and named
    // one created minutes earlier under that root. `doctor` counts the disk and is named here
    // because it is the surface that can answer.
    empty:
      'no skills reached this listing — the declared path wired none.\n' +
      'Skills under .claude/skills/ load by the compatibility dialect and are not visible here.\n' +
      'Run `theocode doctor` for what is on disk.',
    suppressed:
      'DIRECTORY UNTRUSTED — these skills are configured and were NOT loaded, so nothing in them is steering the agent:',
  })
}

/**
 * B-069/B-088 — the servers this agent was GIVEN, which is not the same as the servers that
 * answered. The SDK owns the spawn and returns no per-server outcome here, so a listed name means
 * "handed to the builder", not "healthy". Said out loud rather than left for a reader to assume:
 * a listing that overstates what it knows is worse than none, which B-067 cost a reopened item.
 */
export function mcpPanelBody(
  wired: WiredCapabilities | undefined,
  failures: readonly McpFailure[] = [],
): string {
  const body = renderWiredEntity(wired?.mcp, {
    empty: 'no MCP servers are configured for this directory (.mcp.json)',
    suppressed:
      'DIRECTORY UNTRUSTED — these MCP servers are declared and were NOT started. They spawn external processes before any per-tool approval, which is why trust gates them:',
  })
  const listed = wired?.mcp !== undefined && wired.mcp.active.length > 0
  if (!listed) return body
  if (failures.length === 0) {
    // Deliberately NOT "all servers answered". No failure event having arrived is not proof of
    // health — the turn may not have run yet, and upgrading silence into a health claim is the
    // overstatement this item was opened about.
    return `${body}\n\nthese were handed to the agent; a server that fails to answer is reported here after the turn that hit it`
  }
  const named = failures.map((f) => `  ${f.serverName} — ${f.message}`).join('\n')
  // Distinct from the trust-suppressed wording on purpose: suppressed means NOT STARTED by policy,
  // this means started and did not answer. Reporting one as the other sends a user to fix the
  // wrong thing.
  return `${body}\n\nDID NOT ANSWER — these servers were started and their tools could not be listed, so none of their tools exist for this session:\n${named}`
}

/**
 * B-071 — the hooks the agent actually wired.
 *
 * This item was REOPENED because its first implementation re-read the config, which its own DoD
 * refuses: "the listing comes from what was actually wired, not from re-reading the config file —
 * those two can disagree, and the disagreement is the bug worth catching." It now reads the record.
 */
export function hooksPanelBody(wired: WiredCapabilities | undefined): string {
  return renderWiredEntity(wired?.hooks, {
    empty: 'no hooks are wired for this directory',
    suppressed:
      'DIRECTORY UNTRUSTED — these hooks are declared and are NOT wired. Nothing below can block a tool call:',
  })
}
