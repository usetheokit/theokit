/**
 * B-175 — count what `.claude/` holds, so `doctor` stops being silent about it.
 *
 * MEASURED 2026-09-15 in a consumer: `.claude/agents/` held 139 files and the whole report named
 * none of them. Fourteen checks ran and not one was about the agent definitions being loaded.
 *
 * The positive control is what made that a gap rather than a guess about intent: `skills-on-disk`
 * beside this file already reports the foreign root — "91 under .claude/skills/, loaded by the
 * compatibility dialect without a config line". The report can speak about these surfaces and did
 * not, so these were missing checks and not a principle that diagnostics stay in the native root.
 *
 * Counting rather than asserting presence, because a directory somebody created and a tree of 139
 * definitions must not read alike to an operator deciding whether their configuration took effect.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ForeignSurface } from './doctor/doctor.js'

/**
 * The surfaces this product has a relationship with, and which one it is.
 *
 * `skills` is deliberately absent: `skills-on-disk` reports it against the DECLARED list, which is
 * a question a counter cannot ask, and two answers to one question eventually disagree.
 *
 * The installed kit's own directories — `mechanisms`, `records`, `session-state`, `squad` — are
 * absent for the opposite reason: this product neither reads nor refuses them, so it has nothing
 * to report, and a row about them would crowd out the four it does act on.
 *
 * ## Coverage, checked rather than assumed
 *
 * `FOREIGN_SURFACES` in `setting-sources.ts` declares what the dialect admits: `skills`,
 * `subagents`, `plugins`, `commands`, `context`. Held against this list on 2026-09-15, every one is
 * accounted for and none by accident:
 *
 *     skills    -> `skills-on-disk`, which asks the better question
 *     plugins   -> HERE, since #826. The line above said `skills-on-disk` covered it, and that was
 *                  true of one question and not of the other: `bundledSkillNames` stopped such a skill
 *                  being called "declared with no SKILL.md", and nothing counted the bundles or said
 *                  whether this product acts on them. Measured 2026-09-17 on a workspace holding one
 *                  bundled skill and one ordinary one: `skills-on-disk` reported `1`, and the
 *                  `foreign-surfaces` row named `agents`, `commands`, `agent-memory` and `workflows`
 *                  and not `plugins` — so the one surface whose coverage this comment ASSERTED was the
 *                  only one a reader could not see at all
 *     subagents -> here, as `agents`
 *     commands  -> here
 *     context   -> the `[rules]` diagnostic the instruction tree already emits
 *
 * The check was worth running and its conclusion was wrong, which is worth more than recording that it
 * passed: a fix covering four of five surfaces left the fifth in the silence this whole file exists to
 * end, and the comment asserting coverage is what stopped anyone looking.
 */
const SURFACES: readonly {
  readonly dir: ForeignSurface['dir']
  readonly state: ForeignSurface['state']
  /** Counts what the surface's own loader would take, never every file under the directory. */
  readonly count: (dir: string) => number
}[] = [
  // `.md` at the TOP level only, which is what `listSubagents` reads — `if (!entry.endsWith('.md'))
  // continue`, over a flat `readdirSync`. MEASURED 2026-09-15 and this is why the distinction is
  // not pedantic: `.claude/agents/` held 139 files here and 17 definitions. The other 122 were
  // per-review audit trails in `review-*/` subdirectories, which the kit's own `cycle-review.md`
  // says belong under `records/` precisely because "mixing the two put a run's trail where a reader
  // looks for a roster". A row reporting 139 agents would have repeated that mistake in the
  // diagnostic, and an operator reading it would believe their roster was eight times its size.
  { dir: 'agents', state: 'read', count: (d) => definitions(d) },
  { dir: 'commands', state: 'read', count: (d) => definitions(d) },
  // One per agent, at `<agent>/MEMORY.md` — the layout the reference prescribes, so a top-level
  // count would report every configured memory as absent.
  //
  // `read` since 2026-09-16, and the condition the previous comment set is the one that was met:
  // `discoverRoles` now calls `applySubagentMemory` through `applyMemoryToRoles`, once per half,
  // with the root each half came from. Three tests read a note back out of `discoverRoles` — one
  // per scope that resolves against a root — so this row is backed by the journey, not by the
  // function existing.
  //
  // Flipping it took two releases, and the second is why the rule says to wire before claiming.
  // `14.5.0` shipped the applier with no caller; wiring it here ran `user` for the first time and
  // it threw — `applySubagentMemory` passed `{ home }` where `resolveAgentMemory` reads `homeDir`.
  // Had this row been flipped when the function appeared, it would have reported `read` while the
  // one scope that crosses projects could not resolve at all.
  { dir: 'agent-memory', state: 'read', count: (d) => memories(d) },
  // REFUSED, and counted so the refusal is visible rather than implied by an absent row.
  { dir: 'workflows', state: 'refused', count: (d) => topLevel(d, '.js') },
  // #826 — one per bundle that ships at least one skill, which is what this product acts on there.
  // Counting bundles rather than skills, because the question the row answers is "did my bundle take
  // effect"; how many skills each contributes is `skills-on-disk`'s answer, and two readings of one
  // number eventually disagree. A bundle with no `skills/` is not counted — nothing here loads it, and
  // a row claiming otherwise would be the accepted-and-ignored failure in the diagnostic.
  { dir: 'plugins', state: 'read', count: (d) => bundlesWithSkills(d) },
]

/** Entries directly in `dir` with the given extension — no recursion, like the loaders. */
function topLevel(dir: string, ext: string): number {
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(ext))
    .length
}

/**
 * Top-level `.md` files that OPEN WITH FRONTMATTER, which is what makes one loadable.
 *
 * MEASURED 2026-09-15 against the real directory, one layer finer than the `review-*` subdirectory
 * finding: 17 `.md` at the top level, 16 that the loader returns. The odd one is `README.md` —
 * documentation somebody left beside the roster, with no frontmatter, so nothing loads it.
 *
 * Counting it would have the row claim one agent that does not exist. That is the same defect as
 * claiming 122, differing only in being small enough to survive a glance — which makes it the more
 * durable of the two.
 *
 * Reading the first line rather than parsing the frontmatter: the question here is how many the
 * loader would take, and a file without the opening fence is not one of them. A full parse would
 * cost more and answer no better for a count.
 */
function definitions(dir: string): number {
  let n = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    if (readFileSync(join(dir, entry.name), 'utf8').startsWith('---')) n += 1
  }
  return n
}

/** One per `<bundle>/skills/` that exists — the bundles this product reads something from. */
function bundlesWithSkills(dir: string): number {
  return readdirSync(dir, { withFileTypes: true }).filter(
    (e) => e.isDirectory() && existsSync(join(dir, e.name, 'skills')),
  ).length
}

/** One per `<agent>/MEMORY.md`. */
function memories(dir: string): number {
  return readdirSync(dir, { withFileTypes: true }).filter(
    (e) => e.isDirectory() && existsSync(join(dir, e.name, 'MEMORY.md')),
  ).length
}

/**
 * What the foreign root holds, one entry per surface that actually has files.
 *
 * An absent root, an absent surface and an empty one all yield nothing: none of the three is a
 * finding, and reporting them would make the rows that matter harder to see.
 */
export function foreignSurfacesOnDisk(cwd: string): ForeignSurface[] {
  const found: ForeignSurface[] = []
  for (const surface of SURFACES) {
    const path = join(cwd, '.claude', surface.dir)
    if (!existsSync(path)) continue
    const files = surface.count(path)
    if (files === 0) continue
    found.push({ dir: surface.dir, files, state: surface.state })
  }
  return found
}
