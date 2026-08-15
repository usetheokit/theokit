# Review — agent-callable-delegation

Date: 2026-08-15
Plan: `plans/agent-callable-delegation-plan.md` v1.1
Commits reviewed: `ca70a9ca`, `299a0146`, `9e904a4c` · Fixes: `9af52568`
Reviewer: independent `code-reviewer` agent, every finding sabotage-verified

---

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| F1 | HIGH | `isPort` had two owners — an unexported copy in `delegation-scoring.ts:40` and a retyped one in `delegate-tool.ts:74`, already diverged in cast style (`Partial<DelegationPort>` vs `DelegationPort`) | **fixed** `9af52568` |
| F2 | MEDIUM | The `if (!target)` branch labelled an *unknown agent* failure with code `'duplicate_name'` | **fixed** `9af52568` |
| F3 | MEDIUM | Two tests passed for the wrong reason — `toThrow(/agent/i)` matched Zod's `JSON.stringify(issues)` default message, not this tool's contract | **fixed** `9af52568` |
| F4 | LOW | `as DelegationPort` cast that did not narrow from `unknown` (G3) | **fixed** `9af52568` |
| — | — | G1 dependency direction, `any` usage, `instanceof` ordering, duplication with `createA2ATool` | **no defect** |

### F1 — the duplication the file's own docblock warned against

`delegate-tool.ts:16-18` states the design intent — *"re-deriving any of that here would put two
owners on one rule, which is how the two copies diverge in silence (G12)"* — and applies it to
`delegate()`. The same reasoning was **not** applied to `isPort`, which is the identical pattern:
the knowledge is "how to tell a `DelegationPort` from a `SubAgentSpec`", and it existed twice.

Root cause is structural, not carelessness: `delegation-scoring.ts` did not export `isPort`, so the
only way to classify the union from a second file was to retype it. Fixed by giving the
discriminant one owner and exporting it.

The reviewer's reproducible risk is the sharp part: if `DelegationTarget` ever needs a second
discriminating field, a maintainer editing the copy that `delegate()` depends on gets **no compiler
signal** pointing at the copy in `tools/`. Both type-check independently against the same union.

### F2 — a branch that is unreachable, and was lying about which failure it is

`byName` and `names` are derived from the same `roster` in the same expression, so any value
surviving `inputSchema.parse` is a key in `byName`. The reviewer proved it empirically —
instrumented the branch, ran all 16 tests, zero hits.

Kept as defence in depth (TypeScript needs the branch regardless, since `Map.get` is partial), but
the code changed from `'duplicate_name'` to a new `'unknown_agent'`. An unreachable branch is
tolerable; one that names the wrong failure sends a future reader hunting for a collision that never
happened.

### F3 — the most valuable finding, because the tests looked fine

`rejects.toThrow(/agent/i)` was green because Zod's default `.message` is a JSON dump of the issue
array, which contains `"path": ["agent"]`. The assertion depended on a third party's stringification
format — one Zod has changed across majors — and not on anything this tool does.

Fixed twice over. The tests now assert the `ZodError` and its `path`, **and** assert the contract
that survives whichever layer validates: **nothing was dispatched**. A refusal that still reaches a
sub-agent is a refusal in name only, and costs real tokens.

### A fifth finding, from following F3 with a sabotage

Replacing `inputSchema.parse(raw)` with a cast left all 16 tests green — `Tool.create` already
validates against the same schema before the handler runs. So that line is not the validation; it is
what types `agent`/`task` without an `as` on `raw` (G3), with re-validation as a harmless byproduct.
The comment now says so. A line whose stated purpose is not its actual purpose is a trap for the
next reader.

---

## Branch-level hard gates (`cycle-review § Hard gates`)

Two tests were red on the branch. Both **pre-existing** — verified against `HEAD~3`, where the
CHANGELOG 9.x heading count was already 0 and `packages/theo/package.json` was last touched by
`c9735140`, the commit before this work began. Fixed regardless: the gate is "failing tests on the
working branch", not "failing tests you caused".

| Test | Cause | Fix |
|---|---|---|
| `changelog_has_heading_for_published_version` | `@theokit/agents` shipped 9.0.0→9.3.0 and the **root** CHANGELOG got no version headings (`changeset version` writes only the package changelog) | 7 headings written for the consumer, not copied from the package dump |
| `test_the_sdk_family_lives_in_exactly_one_bucket_per_manifest` | `theokit` declared `@theokit/sdk` at `^4.52.1` (dev) and `^4.49.0` (peer) | Peer raised to `^4.52.1` — the old floor was already unreachable, since `agents` depends on `^4.52.1` and `theo` depends on `agents` |

## Gates

| Gate | Result |
|---|---|
| `pnpm typecheck` | green |
| `pnpm lint` | green across 9 groups |
| `pnpm check:deps` | 0 violations (412 modules, 1219 deps) |
| `/code-quality` | **PASS**, 0 findings |
| `@theokit/agents` suite | 1325 passed, 3 skipped |
| `delegate-tool` suite | 16/16, 6 sabotages detected |
| `pnpm knip` | **FAILS — pre-existing**, verified identical without this change (redundant entry patterns in `packages/http/knip.json`). Out of this plan's scope; recorded rather than silently absorbed |

## Verdict

`READY_TO_MERGE` — no BLOCKER; the 4 HIGH/MEDIUM findings are fixed rather than mitigated, and both
pre-existing red tests are green.

One caveat carried forward honestly: `pnpm knip` still fails on `packages/http` configuration debt
that predates this work and belongs to a separate slice.
