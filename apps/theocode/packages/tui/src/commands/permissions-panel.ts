/**
 * `/permissions` — the two halves of "what may this agent do to my machine" on one screen.
 *
 * Approval and sandbox are one decision split across two commands here, and split is how a user
 * gets it wrong: `full-auto` reads as reckless until you know a `read-only` sandbox is under it,
 * and `suggest` reads as safe under `danger-full-access` when the gate is only asked about some
 * tools. Reading them together is the only way the posture is legible, which is what Codex's
 * `/permissions` gives and what two separate toasts here did not.
 *
 * It REPORTS only. `/approval` and `/sandbox` remain the setters — the sandbox one in particular
 * carries an armed confirmation for a loosening, and a second way to change the same value would
 * either duplicate that guard or quietly bypass it.
 */
import { APPROVAL_MODES } from '@theokit/agents/bridge'
import { SANDBOX_MODES } from '@theocode/agent/config'

import type { ApprovalMode } from '../consent/index.js'
import type { ContentPanel } from '../screen-types.js'

/**
 * One knob: its value, what it decides, and the command that changes it.
 *
 * The vocabularies come from the SAME constants the parsers use (`parseApprovalMode` over
 * `APPROVAL_MODES`, `parseSandboxMode` over `SANDBOX_MODES`) rather than from a sentence typed
 * here. A panel is read as a menu, and a menu that offers a word the parser then rejects is worse
 * than one that offers nothing.
 */
function knob(name: string, current: string, decides: string, values: readonly string[]): string {
  return [
    `${name}: ${current}`,
    `  ${decides}`,
    `  change it with /${name} <${values.join(' | ')}>`,
  ].join('\n')
}

export function permissionsPanel(approval: ApprovalMode, sandboxDetail: string): ContentPanel {
  return {
    title: 'permissions',
    body: [
      knob('approval', approval, 'what needs your say-so before it runs', APPROVAL_MODES),
      // `sandboxDetail`, not `sandboxLabel`: the label carries a `sandbox:` prefix for the footer,
      // where it sits in a `·`-joined run of bare values. The detail is also what carries the
      // `⚠ tool-gating` warning, which is the single most important thing on this panel — it says
      // the confinement the approval mode is trusting is not actually enforced.
      knob('sandbox', sandboxDetail, 'what the tools may touch on disk', SANDBOX_MODES),
    ].join('\n\n'),
  }
}
