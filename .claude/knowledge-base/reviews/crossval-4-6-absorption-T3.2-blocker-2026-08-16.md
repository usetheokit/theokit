# BLOCKER — T3.2 liveness oracle classifies every live project as DEAD

Date: 2026-08-16
Plan: `crossval-4-6-absorption` v1.2 · Task: **T3.2** · Blocks: **T5.3**
Raised by: SEPA initial brief · **Reproduced by the orchestrator against the real module with real data**
Severity: **BLOCKER** — data loss on the GC deletion path
Routing: `cycle-implement.md § Stop conditions` #3 (plan task assumes behaviour contradicted by reality) → returns to `cycle-plan`, NOT a GREEN-phase fix

---

## The reproduction

Ran `classifyProjects` — the real module at `packages/agents/src/session/liveness-oracle.ts`, imported, not re-implemented — wired to the consumer's **existing** enumerator contract, over the actual contents of `~/.theokit/projects` on this machine:

```
sampled 6 real project dirs from /home/paulo/.theokit/projects
  DEAD  -home-paulo-Projetos-theo-theokit-framework-theokit          — no candidate project encodes to this name, within budget
  DEAD  -home-paulo-Projetos-theo-theokit-framework-theokit-packag…  — no candidate project encodes to this name, within budget
  DEAD  -home-paulo-Projetos-theo-theokit-framework-theokit-sdk      — no candidate project encodes to this name, within budget
  DEAD  -home-paulo-Projetos-theo-theokit-framework-theokit-sdk-pa…  — no candidate project encodes to this name, within budget
  DEAD  -home-paulo-Projetos-theo-usetheo-labs-TheoCode              — no candidate project encodes to this name, within budget
  DEAD  -home-paulo-Projetos-theo-usetheo-labs-agent-builder         — no candidate project encodes to this name, within budget

TOTALS  alive=0  dead=6  undetermined=0
```

**Six of six live projects — including this repository, the SDK, and TheoCode itself — classify DEAD.** Every one of them exists on disk right now.

## Why, precisely — three defects, and the reproduction sharpens the third

### 1. `likelyPath` does not round-trip any path containing a hyphen

`encodeProjectDir` maps every non-alphanumeric to `-` (`:57`). `likelyPath` maps every `-` back to `/` (`:65-67`). The two are not inverses whenever the original path contained a hyphen:

```
encoded : -home-paulo-Projetos-theo-theokit-framework
likely  : /home/paulo/Projetos/theo/theokit/framework    ← round-trips? false
```

Every project in this tree contains a hyphen. The fast path — documented at `:62-64` as "correct for the overwhelming majority of real paths" — misses on **all** of them.

### 2. `listProjects` names two different contracts in the two repos

| | Returns | Classification |
|---|---|---|
| Consumer (`TheoCode/.../gc/all-sessions.ts:44-52`) | **encoded directory names** under `projectsRoot` | a **separate** injected `classify: (project) => Liveness` seam at `:50` |
| Framework (`classifyProjects`, `:127-129`) | **real cwd paths** — it calls `encodeProjectDir(candidate)` then `probe(candidate)` | performed internally |

T5.3's plan step is "pass the consumer's enumerator through". Doing so feeds encoded names to a function that expects absolute paths.

### 3. The fall-through after a matched-but-unprobeable candidate returns `dead` — this is the data-loss line

The reproduction refined the mechanism relative to the initial SEPA reading. The pool match **succeeds**: encoded names contain only `[a-zA-Z0-9-]`, so `encodeProjectDir(encodedName)` is the identity and `encodeProjectDir(candidate) !== name` at `:127` does **not** skip it. What fails is the next line — `probe(candidate)` calls `fs.exists` on a bare relative name, which is false. The loop then exhausts and reaches:

```ts
return remaining <= 0
  ? { liveness: 'undetermined', reason: 'search budget exhausted' }
  : { liveness: 'dead', reason: 'no candidate project encodes to this name, within budget' }
```

Two things are wrong here and only one of them is the encoding mismatch:

- **The verdict is `dead` where the evidence supports at most `undetermined`.** The search did not establish absence; it established that the caller-supplied pool could not be probed. D4's own rationale — quoted in the plan — says deleting on could-not-tell is data loss, and T3.2's stated invariant is that `UNDETERMINED` must never collapse to `DEAD`. This line collapses it.
- **The emitted reason is false.** It says "no candidate project encodes to this name" when a candidate *did* encode to it. An operator reading this in a GC log is sent to the wrong question.

## Consequence for the plan

`test_framework_oracle_classifies_the_real_tree_identically()` (T5.3) **cannot pass by construction**. More seriously: T5.3 as written wires this into the consumer's GC sweep, and the sweep deletes on `dead`.

**The root cause is in the plan, not the implementation.** The plan's pseudo-code (`crossval-4-6-absorption-plan.md:1391-1408`) re-specified the consumer's algorithm and dropped its primary resolution path. The consumer's oracle (`TheoCode/packages/agent/src/session/liveness-oracle.ts:64-80`) resolves a project by reading the `cwd` field from the first line of up to 3 transcripts in the project directory — its own docstring at `:28-33` records that this path resolved **91 of 120** sampled projects. The framework version has no equivalent; it has a naive string transform and a caller-supplied pool.

The implementation faithfully built what the plan specified. The plan specified the wrong thing.

## What a corrected T3.2 needs

Not prescribed here — this returns to `cycle-plan` and the shape is the owner's call. The three things the revision must decide:

1. **The primary resolution path.** The consumer reads `cwd` from the transcript itself, which is authoritative and needs no search. Absorbing the oracle without absorbing this is absorbing the fallback and discarding the answer.
2. **The `listProjects` contract**, named unambiguously — encoded names or real paths — since the same identifier currently means both across the seam T5.3 must cross.
3. **The fall-through verdict.** A search that could not probe its candidates has not proven absence. Whatever the encoding decision, this line should not be able to emit `dead` without a completed, probeable search.

## Sequencing consequence

**This must be resolved before the release train, not after.** The six blocked tasks (T1.2, T5.0–T5.4) are blocked on publish. If publish is unblocked first, T5.3 becomes runnable — and T5.3 wires this oracle into a sweep that deletes transcripts. Fixing the release gate before this defect would arm it.

## Provenance

- Reproduction script: run against `packages/agents/src/session/liveness-oracle.ts` via `tsx`, importing the real export; input was `readdirSync(~/.theokit/projects)` and `existsSync` as the `fs` seam. No stub, no re-implementation.
- SEPA initial brief: `.claude/knowledge-base/implementations/crossval-4-6-absorption/sepa-iterations/initial-brief-response.md`
- Consumer oracle: `/home/paulo/Projetos/theo/usetheo-labs/TheoCode/packages/agent/src/session/liveness-oracle.ts`
- Consumer enumerator contract: `/home/paulo/Projetos/theo/usetheo-labs/TheoCode/packages/agent/src/session/gc/all-sessions.ts:44-52`
