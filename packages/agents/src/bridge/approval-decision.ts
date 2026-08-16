/**
 * T2.1 — "may I auto-approve this tool right now?", as a symbol a surface can call.
 *
 * ## Why this exists next to `approval-posture.ts` rather than inside it
 *
 * {@link applyPosture} answers a different question: *"construct this agent with a gate?"*. It runs
 * once, at factory time, mutating an options bag. A surface asks per EVENT, before it decides
 * whether to render a prompt, and it has no options bag in hand.
 *
 * Until this function existed the only reachable half of the rule was the type. `approval-posture.ts`
 * says in writing that the consumer implemented the refusal twice and calls that a G12 violation —
 * and it was still true when this was written, because the enforcement stayed private. A rule that
 * lives in an unexported function lives once for the framework and zero times for everyone else.
 *
 * ## The invariant, stated once
 *
 * **Nothing auto-approves without positive evidence of enforced confinement.** Two consumer defects
 * reduce to it:
 *
 *  - *B-006* — an absent posture counts as unconfined. Absence of evidence is not evidence of
 *    confinement, and defaulting the other way silently disables the guard anywhere the posture has
 *    not been threaded through.
 *  - *B-021* — the headless path made the posture a required argument precisely because omitting it
 *    returned "approved" for `full-auto`, skipping the refusal the function exists for.
 *
 * `posture` stays OPTIONAL in the type so a surface mid-migration still compiles; it just gets
 * `false`. Making it required would be the stricter type and the worse outcome — a caller who cannot
 * yet supply it writes its own predicate instead, which is how the duplication started.
 *
 * The peers resolve omission the same way: `codex`'s `GranularApprovalConfig` auto-REJECTS an absent
 * field, and `opencode` resolves an absent rule to `ask`.
 */
import type { SandboxPosture } from '@theokit/sdk/sandbox'

/**
 * What a surface does about asking, as the three modes a coding agent actually offers.
 *
 * Not a framework invention: these are the values the only real consumer put in front of users, and
 * naming them here is what lets its two copies of the rule become one call.
 */
export const APPROVAL_MODES = ['suggest', 'auto-edit', 'full-auto'] as const

export type ApprovalMode = (typeof APPROVAL_MODES)[number]

/**
 * Tools whose writes are bounded by their own write root rather than by the kernel.
 *
 * The names are the SDK factories' defaults (`apply-patch.ts:51`, `edit-file.ts:155`,
 * `write-file.ts:86`), not a list invented here — a product that re-names them with `withName`
 * passes its own set rather than losing the behaviour silently.
 */
export const WRITE_SCOPED_TOOLS: ReadonlySet<string> = new Set([
  'apply_patch',
  'edit_file',
  'write_file',
])

export interface ShouldAutoApproveOptions {
  /** Overrides {@link WRITE_SCOPED_TOOLS} for a product that re-named its write tools. */
  writeScopedTools?: ReadonlySet<string>
}

/**
 * Whether a gated tool may run without asking a human.
 *
 * Pure over its arguments and holds no state, so a surface can call it per event.
 *
 * @param mode - what the user chose.
 * @param toolName - the name the model sees, which is also the approval key.
 * @param posture - the sandbox's own answer to "am I kernel-enforced right now?". Absent or
 *   unenforced means NOT confined, and nothing auto-approves.
 */
export function shouldAutoApprove(
  mode: ApprovalMode,
  toolName: string,
  posture?: Pick<SandboxPosture, 'enforced'>,
  options?: ShouldAutoApproveOptions,
): boolean {
  switch (mode) {
    case 'suggest':
      return false
    case 'auto-edit':
      // No posture needed: the bound is the tool's write root, and the user opted into edits
      // specifically. An unknown name is refused — the B-006 shape applied to names.
      return (options?.writeScopedTools ?? WRITE_SCOPED_TOOLS).has(toolName)
    case 'full-auto':
      // The one place the sandbox's own report is the deciding evidence.
      return posture?.enforced === true
  }
}
