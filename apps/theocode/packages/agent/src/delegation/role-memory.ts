/**
 * Apply each subagent's declared `memory:` to the prompt it governs.
 *
 * ## THIS HAS NO CALLER YET, declared rather than left to be discovered
 *
 * The join is written and tested; what is missing is the reader it calls. `applySubagentMemory`
 * lives in `@theokit/agents/config` and is NOT in the published 14.4.0 this project pins — so the
 * one line that wires it does not compile here yet, and committing it would leave the tree red for
 * a reason that has nothing to do with the code.
 *
 * It was proved end to end before being held back, with both packages linked to their local builds:
 * an agent declaring `memory: project` came out of `discoverRoles` with its `MEMORY.md` note in the
 * prompt, and a sibling declaring nothing came out untouched. TWO dependency edges had to be
 * repointed for that — this project's pin AND the nested `@theokit/sdk` inside the linked package,
 * which resolved to 5.5.0 and rejects `memory:`. The second was invisible until the stack trace
 * named it, and both were restored afterwards.
 *
 * The wiring, verbatim, so publication is a paste rather than a rediscovery. In
 * `delegation/role-discovery.ts`, import `applySubagentMemory` from `@theokit/agents/config` and
 * replace `return { ...mine, ...theirs }` with:
 *
 *     return {
 *       ...applyMemoryToRoles(mine, home, home, applySubagentMemory),
 *       ...applyMemoryToRoles(theirs, opts.cwd, home, applySubagentMemory),
 *     }
 *
 * The ROOT travels with each half on purpose: `project` and `local` resolve against the root the
 * agent came FROM, `user` against home. Applying after the merge loses that — by then both halves
 * share a key space and the origin is gone. Flip `agent-memory` to `read` in
 * `foreign-surfaces-on-disk.ts` in the SAME commit, and not before.
 *
 * MEASURED 2026-09-15: `@theokit/sdk` carries the declaration on the definition and
 * `@theokit/agents` resolves the root and reads `MEMORY.md` — and nothing joined them. The applier
 * had zero callers here, so an author wrote `memory: project`, saw no complaint, and concluded it
 * took effect. That is accepted-and-ignored arriving through an absent call rather than a refusal.
 *
 * ## The applier is a parameter
 *
 * Not for testability alone: `discoverRoles` reads two roots and the scopes resolve against
 * different bases, so the wiring has a decision of its own to make — which root each agent's
 * `project` and `local` resolve against. Passing the reader in keeps that decision testable without
 * a filesystem, and keeps this module honest about being the JOIN rather than the reader.
 */

/** The half of a definition this module touches. Deliberately structural: it does not need the rest. */
export interface MemoryBearing {
  readonly prompt: string
  readonly memory?: string
}

/** The reader's shape — `applySubagentMemory` from `@theokit/agents`. */
export type ApplyMemory = <T extends MemoryBearing>(
  definition: T,
  agent: string,
  cwd: string,
  home?: string,
) => T

/**
 * Every role with its declared notes folded into its prompt, and the ones whose scope nobody
 * recognises left out.
 *
 * ## Why an unrecognised scope drops ONE agent
 *
 * The reader THROWS on a scope it does not define, and that is right: among three scopes differing
 * only in who can see the notes, defaulting would publish on the next commit something written
 * expecting privacy. But a throw inside a loop over a directory takes every sibling with it — the
 * defect B-098 fixed one layer down, where one ported file stopped every other agent from loading.
 * Same shape, same answer: skip the one, keep the rest, and say so on the diagnostic channel.
 *
 * The input is never mutated: a caller mapping over a loaded record should not find it changed.
 */
export function applyMemoryToRoles<T extends MemoryBearing>(
  roles: Record<string, T>,
  root: string,
  home: string,
  apply: ApplyMemory,
  warn: (message: string) => void = (m) => process.stderr.write(`${m}\n`),
): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [name, definition] of Object.entries(roles)) {
    try {
      out[name] = apply(definition, name, root, home)
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error)
      warn(`[theocode] subagent "${name}": ${why} — this role is not available`)
    }
  }
  return out
}
