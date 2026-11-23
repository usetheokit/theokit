/**
 * B-069/B-070/B-071 — what the agent ACTUALLY wired, as opposed to what config asked for.
 *
 * Three items each needed a listing, and the obvious implementation for each was to re-read the
 * config from the surface. Their shared DoD bullet refuses that, in the same words: "the listing
 * comes from what was actually wired, not from re-reading the config file — those two can disagree,
 * and the disagreement is the bug worth catching." B-071 was REOPENED for shipping the re-read.
 *
 * So this is derived from the values the builder itself receives, at the point it receives them —
 * the same `posture`, `cfg` and loaded MCP map that reach `.mcp()`, `.skills()` and `.hooks()`.
 * Pure and parameterized: it performs no I/O, which is what makes "no second read" checkable rather
 * than promised.
 *
 * Built ONCE for every consumer. Building it privately per command is what B-085 had to undo for
 * the composer, and there would have been four of them.
 *
 * B-108 — the derivation is now `@theokit/sdk`'s `recordWiring`, which takes the trust posture as
 * its gate. What stays here is this product's shape: which three capabilities are lists of NAMES
 * (the posture gates eight things, and durable memory is not a list), plus the two fields that are
 * not entities at all — whether project sources loaded, and which sandbox mode the build was given.
 */
import { recordWiring, type WiredEntity } from '@theokit/agents'

export type { WiredEntity }

export interface WiredCapabilities {
  readonly mcp: WiredEntity
  readonly skills: WiredEntity
  readonly hooks: WiredEntity
  /**
   * The `AGENTS.md` chain, gated by the same posture as the other three.
   *
   * It was the one trust-gated INSTRUCTION source with no listing: `/skills`, `/mcp` and `/hooks`
   * each report what survived the gate, and the file that most directly steers the model reported
   * nothing. An untrusted directory drops it silently, which is the case a user most needs told —
   * the agent is running without the rules the repository wrote for it, and nothing on screen says
   * so. Codex puts the same fact on its status panel (`Agents.md: <none>`).
   */
  readonly agentsMd: WiredEntity
  /**
   * #91 — how much of the rules block reached the prompt.
   *
   * A `WiredEntity` would be the wrong shape: the other four answer "which of the things you
   * declared survived?", and rules are truncated by LENGTH, mid-block. There is no list of dropped
   * names to report, only a proportion — so this carries the proportion.
   *
   * `undefined` where no build has published it yet, matching how the panel already treats a
   * missing record rather than inventing a zero that reads as "no rules".
   */
  readonly rules?: {
    /** Blocks that reached the prompt, out of `read`. */
    readonly count: number
    readonly read: number
    /** Length before the ceiling was applied. */
    readonly chars: number
    /** Length that reached the prompt, so a surface computes the loss without knowing the ceiling. */
    readonly kept: number
    readonly truncated: boolean
    /**
     * B-173 — what the AGGREGATE ceiling cut from the rules, in RENDERED chars.
     *
     * A second ceiling acts after the loader's: `composeInstructions` trims the whole persona to
     * `MAX_AGGREGATE`, and it can take ~30,000 chars of rules that the first ceiling passed
     * untouched. Until this field existed the record said "N loaded" over that corpus.
     *
     * Its own field rather than a smaller `kept`, because the two ceilings measure different
     * things: `chars`/`kept` are SOURCE chars from the loader, these are RENDERED chars from the
     * composed prompt. Folding one into the other would produce a percentage over two units —
     * a number no reader could check, and the shape that made a reversed attempt print
     * "0% dropped" over a persona cut to 363 chars.
     *
     * `undefined` means the aggregate ceiling did not cut the rules — never that it did not run.
     */
    readonly aggregateCut?: { readonly from: number; readonly to: number }
  }
  /** Whether `.theokit/agents/*.md` were allowed to load — subagents and project hooks ride on it. */
  readonly projectSources: boolean
  /**
   * B-076 — the sandbox mode this build was given, AFTER any session override. The footer used to
   * resolve config itself and therefore kept showing the mode the session started with, while the
   * agent had already been rebuilt with another. Two sources, one label, and the label was wrong.
   */
  readonly sandboxMode: string
}

export function wiredCapabilities(input: {
  readonly posture: {
    readonly allows: { mcp: boolean; skills: boolean; hooks: boolean; agentsMd: boolean }
  }
  readonly projectSourcesAllowed: boolean
  /** The map handed to `.mcp()` — already loaded, never re-read here. Both scopes, merged. */
  readonly mcpServers: Readonly<Record<string, unknown>>
  /**
   * Which of those names came from the OPERATOR's own `.mcp.json` (#72).
   *
   * The personal scope is not gated on project trust, so it must not be reported through the gate.
   * `recordWiring` takes the posture and marks every requested server suppressed, which made
   * `theocode doctor` say "declared but NOT wired" about a server that was running — a record that
   * contradicts the run, in the file whose whole reason for existing (B-071) is to BE the record of
   * the decision rather than a second guess at it.
   */
  readonly mcpPersonal?: readonly string[]
  /**
   * The project's server names that trust withheld (#72) — declared, never started.
   *
   * Fed to `recordWiring` as REQUESTED so the posture can refuse them, which is what turns
   * `suppressedByTrust` into a true statement. Without it that flag was always false for MCP and the
   * "declared but NOT wired" report was unreachable for the one capability it mattered most for.
   */
  readonly mcpWithheld?: readonly string[]
  readonly configuredSkills: readonly string[]
  /**
   * #65 — the operator's own skills, from `~/.theokit/skills/`.
   *
   * Separate from `configuredSkills` for the reason `mcpPersonal` is separate from `mcpServers`:
   * they are not subject to the project trust gate, so folding them in would make
   * `suppressedByTrust` a false statement about them. They are added back below, outside it.
   *
   * The record has to carry them or `/skills` lists a set the agent does not have — the exact
   * disagreement between config and reality this record was built (B-071) to make impossible.
   */
  readonly operatorSkills?: readonly string[]
  /** The hook events handed to `.hooks()`, in the order they were registered. */
  readonly hookEvents: readonly string[]
  /** The instruction files the walk found — the paths, never their contents. */
  readonly agentsMdFiles: readonly string[]
  /** #91 — the rules load, handed in by the caller that performed it. See the field above. */
  readonly rules?: WiredCapabilities['rules']
  readonly sandboxMode: string
}): WiredCapabilities {
  const record = recordWiring({
    posture: input.posture,
    requested: {
      // Sorted because the map's key order is insertion order from a JSON file, and a listing whose
      // order changes when someone reorders `.mcp.json` looks like something moved.
      // Only the project's. The personal ones are added back below, outside the gate they are not
      // subject to.
      mcp: [
        ...Object.keys(input.mcpServers).filter(
          (name) => !(input.mcpPersonal ?? []).includes(name),
        ),
        ...(input.mcpWithheld ?? []),
      ].sort(),
      skills: input.configuredSkills,
      hooks: input.hookEvents,
      // NOT sorted: the walk's order is root-most first, which is the order they are composed into
      // the prompt. Sorting would present a precedence that is not the one in effect.
      agentsMd: input.agentsMdFiles,
    },
  })

  return {
    ...record,
    // Both facts survive: what is running, and whether the repository's share was withheld.
    // Collapsing them would leave an operator unable to tell "my server" from "their server got in".
    mcp: {
      ...record.mcp,
      active: [...new Set([...record.mcp.active, ...(input.mcpPersonal ?? [])])].sort(),
    },
    // #65 — same shape as `mcp` above, and for the same reason: what is running, without erasing
    // whose it is. Sorted, because the two sources are read from different directories and an
    // operator should not see the order change with an unrelated edit.
    skills: {
      ...record.skills,
      active: [...new Set([...record.skills.active, ...(input.operatorSkills ?? [])])].sort(),
    },
    ...(input.rules !== undefined ? { rules: input.rules } : {}),
    projectSources: input.projectSourcesAllowed,
    sandboxMode: input.sandboxMode,
  }
}
