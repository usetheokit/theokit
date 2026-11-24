import { homedir } from 'node:os'

import { resolveTrustPosture } from '@theokit/agents'
// `applySubagentMemory` is on the `./config` subpath, not the root: it lives in
// `src/config/agent-memory.ts` and the root barrel does not re-export it. Importing it from
// the root type-checks — the bundled `.d.ts` declares it — and throws at RUNTIME with
// `does not provide an export named`. Measured 2026-09-16, and the types never said a word.
import { applySubagentMemory, discoverSubagentsAcrossRoots } from '@theokit/agents/config'

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
 * ## Why the framework does the merge
 *
 * `discoverSubagentsAcrossRoots` (`@theokit/agents`) reads both roots through the SDK's one parser,
 * gates the project root by trust, leaves the operator's alone, and labels each definition with the
 * root it came from. The SDK itself has no user-configuration layer; the framework adds it.
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
  const { definitions, shadowed } = await discoverSubagentsAcrossRoots({
    cwd: opts.cwd,
    homeDir: home,
    project: opts.projectAllowed
      ? {
          // A pass-through, not a decision: TheoCode's own `posture.allows.subagents` already
          // chose, and `projectAllowed` is that answer. The framework wants a posture, so this
          // one always allows. Pass a real posture here once callers hold one.
          trustedBy: resolveTrustPosture({
            capabilities: ['projectSettings'] as const,
            isTrusted: () => true,
          }),
        }
      : false,
    // #83 — the foreign dialect, on the PROJECT root only. `~/.claude/agents/` on a machine that
    // also runs Claude Code holds that kit's roles, and importing them would hand this product a team
    // nobody declared for it. A repository's `.claude/` is in front of the operator; their home root
    // is shared with every other tool that speaks the dialect.
    compatSources: { project: [{ kind: 'claude-code' as const, import: FOREIGN_SURFACES }] },
  })
  // The origin travels with each definition: `project` and `local` memory resolve against the root
  // the agent came FROM, `user` against home. Applied per origin, after the merge.
  // A project role dropped for bad memory must leave the operator's same-named role standing, as
  // when each root was applied on its own — so the shadowed operator roles join the operator half.
  const byOrigin: Record<'operator' | 'project', Record<string, SubagentDefinition>> = {
    operator: {},
    project: {},
  }
  for (const [name, { origin: _origin, ...definition }] of Object.entries(shadowed)) {
    byOrigin.operator[name] = definition
  }
  for (const [name, { origin, ...definition }] of Object.entries(definitions)) {
    byOrigin[origin][name] = definition
  }
  return {
    ...applyMemoryToRoles(byOrigin.operator, home, home, applySubagentMemory),
    ...applyMemoryToRoles(byOrigin.project, opts.cwd, home, applySubagentMemory),
  }
}
