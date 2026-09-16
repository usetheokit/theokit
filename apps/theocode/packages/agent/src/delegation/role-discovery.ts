import { homedir } from 'node:os'

import { discoverSubagents } from '@theokit/agents'
// `applySubagentMemory` is on the `./config` subpath, not the root: it lives in
// `src/config/agent-memory.ts` and the root barrel does not re-export it. Importing it from
// the root type-checks — the bundled `.d.ts` declares it — and throws at RUNTIME with
// `does not provide an export named`. Measured 2026-09-16, and the types never said a word.
import { applySubagentMemory } from '@theokit/agents/config'

import { FOREIGN_SURFACES } from '../setting-sources.js'
import { applyMemoryToRoles } from './role-memory.js'
import type { SubagentDefinition } from '@theokit/agents'

/**
 * The roles a delegation may resolve, across both roots (#65).
 *
 * ## Why the operator's root needed adding at all
 *
 * Measured 2026-09-05 with a positive control: `.theokit/agents/<name>.md` in the project delegates
 * and answers; the identical file under `~/.theokit/agents/` leaves the model reporting that no such
 * subagent exists. The gap was ours. `@theokit/sdk` has no user-configuration layer for any surface —
 * its only user-root accessor lives in credential, transcript and token storage — so the user-level
 * rules and `AGENTS.md` that DO load are read by `context/rules.ts` and `context/user-agents-md.ts`,
 * this product's own code. Two surfaces got a user layer; two fell through to nothing.
 *
 * ## Why this reuses the SDK's reader instead of listing a directory
 *
 * `discoverSubagents(cwd)` reads `<cwd>/.theokit/agents/*.md`, so handing it the home directory
 * reaches the operator's root through the SAME parser the project root goes through. Writing our own
 * reader was the alternative, and the SDK exposed this function precisely to end one: two readers of
 * one convention disagree eventually, and the disagreement surfaces as a command that lists a role
 * the runtime cannot find.
 *
 * The `settingSources: ['project']` on the operator call is not a mistake. That token selects the
 * `<cwd>/.theokit/agents` LAYOUT, and the layout is the same in both roots; what changes is which
 * directory is handed in. The SDK has no `'user'` member to pass — that is the absence this function
 * works around.
 *
 * ## Trust
 *
 * The project root stays behind the gate, because an untrusted repository must not steer a child's
 * model, sandbox or tools. The operator's root is read regardless, for the reason
 * `context/user-agents-md.ts` sets out for instructions: the gate asks whether the code in THIS
 * directory is trusted, and nobody's home directory is the repository. Gating it would refuse
 * someone their own configuration because of where they happened to run.
 *
 * The project wins a name collision. It is the more specific context, and the one whoever is reading
 * has in front of them.
 */
export async function discoverRoles(opts: {
  readonly cwd: string
  readonly home?: string
  readonly projectAllowed: boolean
}): Promise<Record<string, SubagentDefinition>> {
  const home = opts.home ?? homedir()
  const [mine, theirs] = await Promise.all([
    discoverSubagents(home, { settingSources: ['project'] }),
    opts.projectAllowed
      ? // #83 — the foreign dialect, on the PROJECT root only. Without it a role in
        // `.claude/agents/` is invisible while the identical file in `.theokit/agents/` resolves:
        // one dialect, two answers, depending on which selector asks. Measured with four arms, arm N
        // proving the foreign root was live in the same build (a rule from `.claude/rules/` reached
        // the model) — so the dialect was admitted and only the agents were not read.
        //
        // Deliberately NOT on the operator call above. `~/.claude/agents/` on a machine that also
        // runs Claude Code holds that kit's roles, and importing them would hand this product a team
        // nobody declared for it — the same effect that forced `skills-on-disk.ts` to scope
        // `presentButUndeclared` to the native root when dogfooding surfaced 39 foreign skills.
        // A repository's `.claude/` is the one the operator has in front of them; their home root
        // is shared with every other tool that speaks the dialect.
        discoverSubagents(opts.cwd, {
          settingSources: ['project'],
          // #188 — the same declaration the builder carries, so this call stops being a fourth
          // independent answer to "which surfaces of `.claude/` do we admit". Before this it passed
          // the wide form and the list could name `subagents` while governing nothing here.
          compatSources: [{ kind: 'claude-code' as const, import: FOREIGN_SURFACES }],
        })
      : Promise.resolve({}),
  ])
  // The root travels with each half, and that is the whole decision here. `project` and `local`
  // resolve against the root the agent came FROM; `user` resolves against home. Applying after the
  // merge would lose it — by then both halves share a key space and the origin is gone.
  return {
    ...applyMemoryToRoles(mine, home, home, applySubagentMemory),
    ...applyMemoryToRoles(theirs, opts.cwd, home, applySubagentMemory),
  }
}
