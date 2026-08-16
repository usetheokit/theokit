/**
 * A written decision for every SDK subpath this layer publishes no door for.
 *
 * ## Why this file exists
 *
 * `packages/agents/src/index.ts` declared the layered boundary CLOSED — "the consumer imports ZERO
 * `@theokit/sdk*` directly". Measured against the consumed SDK (4.52.1) on 2026-08-16, that was
 * false for 25 subpaths, and the claim being documented as closed is worse than documenting it as
 * partial: a consumer reads it and stops looking, which is how a builder ends up rebuilding what
 * already ships.
 *
 * `check-surface-parity.mjs` could not see any of this, and not by oversight: it compares subpaths
 * both packages publish under the SAME NAME (six of them) and skips the rest with a written reason.
 * A subpath with no door here has no shared name to compare against.
 *
 * ## Decision, not coverage — and the measurement behind each one
 *
 * Every entry is `'forward'` (a door is expected, and the test demands it exist) or `{ out }` with a
 * reason. Nothing is bulk-forwarded: 25 new subpaths with no consumer asking for them is surface
 * growth that `system-design-guardrails.md` § G7 and § G11 both forbid, and it would convert a real
 * measurement into exports nobody uses.
 *
 * The number in each reason is `symbols reachable from the layer's ROOT / symbols the subpath
 * exports`, measured by importing both. That is what turns these from opinions into decisions: a
 * subpath at 19/19 needs no door because the capability already crosses; one at 1/4 is where the
 * closed-boundary claim was actually false.
 *
 * Re-measure with:
 *   node --input-type=module -e "…"   (see the commit that introduced this file)
 */

/** @typedef {'forward' | { out: string }} BoundaryDecision */

/** @type {Record<string, BoundaryDecision>} */
export const DOORLESS_DECISIONS = {
  // ---- already fully reachable from the layer root ------------------------------------------
  // The boundary claim holds for these: every symbol crosses, just at `.` rather than at a matching
  // subpath name. A door would be a second way to import what already imports.
  './errors': {
    out: 'All 19 symbols are re-exported from the layer root (measured 19/19), so the error hierarchy already crosses whole — including the base class a `catch` needs to discriminate on. A subpath would be a second import path to the same objects, and identical classes reached two ways is how `instanceof` starts returning false (the M78 splitting bug in the SDK).',
  },
  './models': {
    out: 'All 6 symbols reachable from the layer root (measured 6/6). The model-capability catalog is data; a dedicated door adds an import path, not a capability.',
  },
  './messages': {
    out: 'All 3 SDKMessage readers reachable from the layer root (measured 3/3).',
  },
  './concurrency': {
    out: 'Both symbols reachable from the layer root (measured 2/2).',
  },
  './retry': {
    out: 'The single symbol is reachable from the layer root (measured 1/1).',
  },
  './subagents-loader': {
    out: 'Both symbols reachable from the layer root (measured 2/2).',
  },

  // ---- partially reachable: this is where the closed-boundary claim was FALSE ----------------
  // Recorded as such rather than forwarded, because forwarding is only justified by a consumer who
  // needs the missing part. None was measured in this cycle. The numbers are the evidence for
  // whoever measures one.
  './compaction': {
    out: 'Partially covered: 5 of 13 symbols reach the layer root. The missing 8 are history-compression internals, and compression is SDK-owned runtime by ADR-0040 § D2 — the framework is the home, not the loop. Revisit with a measured consumer rendering compaction state.',
  },
  './path-safety': {
    out: 'Partially covered: 3 of 7 symbols reach the root (`assertNoSymlinkEscape`, `isForbiddenPath`, `safePathJoin` — forwarded deliberately at index.ts). The other 4 are internals of those three; exporting them offers a second, lower-level way to answer a question the three already answer, and a second containment check that disagrees with the first is a bug this ecosystem has already paid for.',
  },
  './a2a': {
    out: 'Partially covered: 1 of 4 symbols reaches the root (`SubAgent`, forwarded deliberately). The other 3 are the transport shapes behind it. Revisit when a consumer is measured driving A2A transport directly rather than through `SubAgent.create()`.',
  },
  './server/errors-envelope': {
    out: "Partially covered: 1 of 3. This is the envelope for the SDK's OWN HTTP server. The framework ships its own server layer (`theokit/server`) with its own error envelope, and forwarding a second one invites two error shapes on one wire.",
  },
  './internal/security': {
    out: 'Partially covered: 3 of 10, and the subpath is named `internal` by the package that owns it. The SDK is actively RETIRING the `internal/*` public subpaths (`internal/persistence/index.ts` carries an `@deprecated` pointing at the sanctioned barrel), so adding a door here would extend a convention being withdrawn.',
  },

  // ---- not reachable at all, and deliberately so --------------------------------------------
  './internal/persistence': {
    out: 'Named `internal` by the owning package AND explicitly `@deprecated` there in favour of the sanctioned `@theokit/sdk/persistence` barrel — which this layer DOES have a door for. Forwarding the deprecated path would hand consumers the door being closed.',
  },
  './internal/memory-adapters': {
    out: 'Named `internal` by the owning package; it exists so `@theokit/sdk-memory` and the SDK stop carrying divergent copies of the embedding runtime, which is a relationship between those two packages and not a capability this layer brokers.',
  },
  './server/auth': {
    out: 'Server-side auth for the SDK\'s OWN HTTP server. The framework has its own server (`theokit/server`) and its own auth primitives; a second auth surface reachable from the agent layer is two answers to "who is this request from".',
  },

  // ---- not reachable, and no consumer measured yet -------------------------------------------
  // Honest state: these are plausible and unclaimed. Each names what would justify a door, so the
  // next person has a threshold rather than a judgement call.
  './cron': {
    out: 'Zero of 1 reachable. Scheduling is a deployment concern the framework routes through `JobBackend` (ADR-0002) rather than through the agent layer. A door is justified by a consumer scheduling agent runs through the SDK rather than through their platform.',
  },
  './context': {
    out: 'Zero of 5 reachable, and plausible for a coding agent that assembles context. No consumer was measured rebuilding it in this cycle — the one adjacent rebuild found (command templates) was closed in the layer directly (T3.3). A door is justified by a measured reimplementation of context assembly.',
  },
  './skills': {
    out: 'Zero of 2 reachable. Skills discovery is adjacent to the custom-command loading this layer already owns; the two should get ONE door together rather than one each, and that decision needs a consumer using both. Justified by a measured reimplementation of skills discovery.',
  },
  './project': {
    out: 'Zero of 2 reachable. Same family as `./skills` and `./context` — instruction assembly. Same threshold: a door when a consumer is measured rebuilding it, and preferably one door for the family.',
  },
  './subagents': {
    out: 'Zero of 2 reachable. Subagent tool-scoping; `SubAgent` itself already crosses at the root. Justified by a consumer measured scoping subagent tools by hand.',
  },
  './task-store': {
    out: "Zero of 3 reachable. Task persistence is a backend concern the framework routes through `JobBackend`/`UsageStorageAdapter` interfaces so a platform can slot in. Forwarding the SDK's store would make one implementation the default by accident.",
  },
  './workflow': {
    out: 'Zero of 21 reachable — the largest doorless surface. Workflow orchestration is explicitly out of framework scope (CLAUDE.md § Out of scope: "a parallel agent runtime / orchestration engine"), so a door here would contradict a recorded architectural decision rather than merely add surface.',
  },
  './eval': {
    out: 'Zero of 8 reachable. Evaluation harnesses are a development-time concern of the agent author, reached from the SDK directly; nothing about them needs the app-shaped layer in between.',
  },
  './subscription': {
    out: 'Zero of 7 reachable. Billing/subscription state is product policy — the framework deliberately keeps usage behind `UsageStorageAdapter` so a platform owns it (ADR-0002 family). A door would put one billing model in the agent layer.',
  },
  './sanitize': {
    out: 'Zero of 1 reachable. Tool-input sanitization runs inside the SDK\'s own tool dispatch, which is the boundary that owns it; a consumer calling it a second time on already-sanitized input is the "second check that disagrees with the first" shape. Justified by a consumer sanitizing input the SDK never sees.',
  },
  './filesystem': {
    out: 'Zero of 8 reachable, and plausible for a coding agent. The file tools a coding agent needs cross via `@theokit/agents/tools` (20 factories, measured) rather than as raw filesystem helpers; a door is justified by a consumer measured needing the helpers OUTSIDE a tool.',
  },
}
