# 0008 — Two conventions that cost a file each are kept

- **Status:** accepted
- **Date:** 2026-09-20
- **Decides:** B-024's first three DoD bullets. The fourth — re-measuring J2 — is a benchmark run
  and is not decided here.

## Context

The J2 journey loses one countable metric at exactly the 2.0x bar: **4 files against 2**. Two
project conventions account for the difference, and B-024 records that nobody had decided whether
either is worth its file — *"a convention kept for a good reason and a convention kept by inertia
are indistinguishable from the outside"*.

Measured before deciding, because the framing of the item turned out to be wrong for the first one.

## Decision 1 — a tool lives under `agents/<name>/tools/`, and this is not a style rule

**Kept.** `tools/` is a RESERVED ZONE, not a tidy-up.

`packages/theo/src/server/scan/agent-scan.ts:74` reads
`if (dirs.some((segment) => AGENT_SUBFOLDERS.has(segment))) return` over the intermediate
directories of every scanned path. `AGENT_SUBFOLDERS` is `tools`, `skills`, `prompts`, `lib`. A file
whose path passes through one of them is composition and is skipped; a file that does not is a
routed agent.

So the convention is not paying a file for neatness. It is what stops a tool from becoming a public
endpoint. The repository's own test says so in its assertion: `tests/unit/agent-scan.test.ts:85`
expects exactly one agent from a tree containing `agents/tools/weather.ts`, commented *"No phantom
/api/agents/tools/weather"*.

**A convention whose absence publishes an HTTP endpoint nobody wrote is not inertia.** The file is
the price of the reservation, and the reservation is the feature.

## Decision 2 — the scaffold keeps `use-transcript.ts`

**Kept**, on a weaker and purely local argument, and the difference in strength is stated rather
than smoothed over.

The hook is 45 lines and has TWO consumers in the template —
`src/app/components/ChatPanel.tsx` and `src/app/page.tsx`. Deleting it does not delete the work; it
copies the projection into both.

It is also already as small as it goes. Its own docblock records that since M46 the framework's
client store accumulates the conversation thread, so the hook *"is a thin projection: prepend the
warm greeting and map status to the flags the UI reads"* — the hand-rolled transcript it used to
hold is gone. What remains is the smallest thing two components can share.

## What would break, and what would not

**Nothing breaks: both decisions are to keep what ships.** This ADR changes no code. What changes is
that the next reader can tell a reasoned convention from an unexamined one — which is the whole of
what B-024 asked for.

Had decision 1 gone the other way, the break would have been severe and silent: every existing
`agents/<name>/tools/*.ts` would begin resolving as an agent route.

## Who is affected

- **Anyone authoring an agent** — decision 1 is a rule they must follow, and it now has a reason
  they can read instead of a folder they must copy.
- **Anyone scaffolding a new app** — decision 2 keeps one file in the generated tree.
- **The J2 benchmark** — still 4 files against 2, now by decision rather than by default. Whether
  that metric should count a reserved-zone file at all is a question about the metric, and it is
  left open below.

## What was rejected

**Flatten tools into the agent file to win the metric.** Rejected because the metric is a proxy and
the convention is a guard: trading an endpoint-publishing hazard for a file count is optimising the
measurement against the thing it measures.

**Delete `use-transcript.ts` and inline the projection.** Rejected because it has two consumers, so
deleting it duplicates rather than removes. One file becomes two copies that drift.

**Decide only the cheap one and defer the other.** Rejected because B-024's point is that an
undecided convention is indistinguishable from inertia — deciding one of two would leave exactly
that ambiguity on the other.

## What this ADR does NOT settle

Whether the J2 file-count metric is measuring the right thing. It counts a file that exists to
reserve a namespace identically to a file that exists to hold logic, and decision 1 shows those are
not the same cost. Re-measuring J2 (B-024's fourth bullet) will report the same 4-against-2 unless
the metric changes, and this ADR does not change it.
