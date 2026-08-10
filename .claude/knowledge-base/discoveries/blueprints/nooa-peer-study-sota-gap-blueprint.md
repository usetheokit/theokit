# Blueprint: NOOA peer study — what "SOTA" actually costs us (post-M56 gap analysis)

> **Exec summary.** NVIDIA's NOOA (`NVIDIA-NeMo/labs-OO-Agents`, Apache-2.0) is the first
> peer to ship the agent-as-a-Python-object model with a published evaluation. This blueprint
> is the evidence-based answer to "are we behind, and where". The finding is narrower than it
> looked from their README: on **interception** (8 hook points vs their 3), **isolation**
> (injected vetted sandbox + mandatory permission gate vs an AST deny-list their own source
> calls "not a security boundary"), **guardrail batteries** (5 shipped detectors vs zero) and
> **product surface** (routes, auth, sessions, typed client, deploy — which they do not attempt)
> TheoKit is ahead. On **code-as-action** we are not absent — `createCodeMode`
> (`packages/theo/src/server/agent/code-mode.ts:1`, M29/ADR-0041) ships it — but ours exposes
> declared tool callables (`api.<tool>(args)`) where theirs exposes the **live object graph**
> (`self` in scope). Four real gaps survive the evidence: pass-by-reference (G1), authoring
> ceremony (G2), a trace UI (G3), and the one that actually carries the word SOTA — **we have
> never submitted this system to an external, reproducible benchmark** (G4).
>
> **This blueprint did NOT come through `/discover-plan` → `/discover-execute`.** It was
> produced from an ad-hoc peer read during a conversation on 2026-08-10. It is offered as
> blueprint-shaped input to `/roadmap-feature` + `/to-plan`, not as a cycle-certified artifact.
> Anything downstream should treat its ADRs as *proposals requiring the normal gate*.

---

## Provenance (per `rules/reference-provenance.md`)

| Field | Value |
|---|---|
| Peer | `NVIDIA-NeMo/labs-OO-Agents` (package name `nooa`) |
| Licence | Apache-2.0, SPDX header on every source file |
| Paper | arXiv `2607.20709` — *"NVIDIA-labs OO Agents: Native Python Object-Oriented Agents"*, 15 authors |
| How it was studied | Read over the network (`gh api` tree listing + `raw.githubusercontent.com` reads). **NOT cloned into `knowledge-base/references/`** — the study zone stays as it is. |
| Copying | None. No NOOA source was copied into this repository. Short quoted lines below are cited for analysis and attributed. |
| Registration | Not in the ROADMAP § State-of-the-art references table — that table describes *cloned* peers. If we later clone it, register it in `wiki/references-catalog.md` first. |

Measured surface: 1497 files in the tree, 211 `src/nooa/**.py`, 469 test files.

---

## Corrections this study forced (read this before trusting any earlier comparison)

Four claims made earlier in conversation were wrong. They are recorded because the *way* they
were wrong is the reusable lesson: **absence of mention in a README is not absence of a feature,
and neither is absence of memory of our own code.**

| Claim made | Reality | Evidence |
|---|---|---|
| "TheoKit has no code-as-action" | **False.** We ship it. | `packages/theo/src/server/agent/code-mode.ts:1` — `createCodeMode`, 150 LOC, M29/ADR-0041 |
| "NOOA has no guardrails" | **False as to the seam.** They have a 3-point interception engine. True only as to shipped detectors (zero). | `src/nooa/runtime/middleware.py` — `event_manager.intercept("llm_call", my_guardrail)` |
| "NOOA has no OTel" | **False.** `opentelemetry-api` / `-sdk` / `-exporter-otlp-proto-http` are core deps; they ship OTLP HTTP + file exporters, a serializer, a React trace viewer, and Langfuse/Phoenix examples. | `pyproject.toml`; `src/nooa/tracing/_otlp_http_exporter.py` |
| "Their interception seam is broader than ours" | **False.** Theirs: 3 points. Ours: 8, one with veto power. | `packages/agents/src/bridge/hook-handlers.ts:40` |

---

## Coverage Corner 1 — Where TheoKit is ahead (do not spend effort here)

| Dimension | TheoKit | NOOA | Evidence |
|---|---|---|---|
| Interception seam | 8 points — `pre_tool_call` (**veto**), `post_tool_call`, `transform_tool_result`, `transform_llm_output`, `pre_user_send`, `post_assistant_reply`, session start/end | 3 — `agent_call`, `llm_call`, `execute_python` | `hook-handlers.ts:40` vs `runtime/middleware.py` |
| Guardrail batteries | 5 shipped — prompt-injection, PII, cost guard, unicode normalizer, output moderation | 0 shipped (seam only) | `define-agent.ts` `guardrails`; NOOA tree grep for `pii\|moder\|inject` → only execution guards |
| Isolation | Injected **vetted** sandbox (isolated-vm / QuickJS-WASM / locked worker), `node:vm` banned by ADR, mandatory permission gate, **no default-allow** | In-process AST validator + module deny-list | `code-mode.ts:1-18`; their `runtime/restrictions.py` docstring |
| HITL | Tool-level approval, `approval_required` event, pause/resume, wired in the default template | none shipped | `chat.ts` `.approval('send_notification', …)` |
| Agent interop | A2A agent-card + client, ACP, subagents, handoff | MCP only | `packages/agents/src/{a2a,acp}`; NOOA grep → empty |
| Loop termination | Finite `maxIterations` + `no_progress` detection, Zod-validated at resolve time | not surfaced | `loop/loop-strategy.ts` |
| Product surface | routes, auth, sessions, typed client, devtools, deploy adapters, `create-theokit` | not attempted | — |

Their own source is candid about the isolation gap, which is why this row is not a close call:

> "guardrails, not a security boundary … extending these lists to 'close an escape' is
> unwinnable whack-a-mole. The real containment boundary is OS-level isolation."
> — `src/nooa/runtime/restrictions.py` (Apache-2.0, quoted for attribution)

---

## Coverage Corner 2 — The four real gaps

### G1 — Pass-by-reference over a live object graph

**What they have.** Their code-as-action runs in a REPL with `self` in scope. The model calls
`self.is_refund_eligible(order)` against the *real* object. No serialization, no schema
round-trip, and N composed operations cost one code block instead of N turns.

**What we have.** `createCodeMode` hands the sandbox a `CodeModeApi` —
`Record<string, (args: unknown) => Promise<unknown>>`, i.e. **declared tool callables only**.
Composition works; holding a live domain object across calls does not.

**Why the gap is narrower than it sounds.** Ours is the safer half of the trade by design: the
restricted API *is* the containment surface, and every call through it hits the permission gate.
Theirs achieves reference semantics by having no boundary — the thing their own docstring warns
about.

**Why it is still a gap.** Token cost and turn count are real. A 200-row result set passed by
value through JSON is paid for twice (out and back) on every turn.

**Honest difficulty.** This is the hardest item in the blueprint and must not be planned as if
it were easy. Reference semantics *across* an isolation boundary is not free: isolated-vm
requires explicit `Reference`/transferable wrappers, and a naive implementation reintroduces
exactly the host-reachability the boundary exists to prevent. Any plan must open with a
feasibility spike, not a task list.

### G2 — Authoring ceremony (time-to-first-agent)

Their quickstart is 8 lines, one import, no config, no build. Ours (`templates/default/agents/chat.ts`)
is a 9-call builder chain plus four sibling files. Both facts are verified; the comparison is fair
only for *first agent*, not for *first app*, where we win outright.

**Constraint that binds any proposal here.** M53 deleted the agent decorators *deliberately and
atomically*, and M2 locked a single canonical surface. A terser third syntax would resurrect the
dual-path problem those milestones paid to remove. The legitimate move is reducing ceremony
*inside* the existing surface (defaults, convention) and measuring it — not adding a surface.

### G3 — Trace UI

They ship a React trace viewer + `trace_explorer` + an OTLP store. We ship the OTLP serializer,
spans, trace-context propagation and adapters — but no viewer. Our tracing data is at parity;
the *inspection experience* is not.

### G4 — External measurement (this is the one that carries the word "SOTA")

They published a paper with 15 authors and reported results on SWE-bench Verified,
Terminal-Bench 2.0 and ARC-AGI-3. We have never run this system against any public, reproducible
benchmark.

Everything in Corner 1 is an *internal* quality claim. "SOTA" is not a self-assessment — it is a
number someone outside the team can reproduce. Until a TheoKit-harnessed agent posts a score on a
public benchmark, no amount of feature parity earns the label, and `rules/public-copy.md` § 4
already forbids us from claiming it.

Secondary signal in the same family: their test-to-source ratio is 2.2 (469/211); ours is 0.94
(737/780, git-tracked). File counts are a weak proxy and are recorded as such — but the direction
is consistent with the rest of this corner.

---

## Coverage Corner 3 — Out-of-scope cross-check (what we must NOT copy)

Every idea below was considered and is **rejected**, each against an existing locked decision.
Recorded so a future reader does not re-litigate them.

| Tempting import from NOOA | Rejected because |
|---|---|
| Docstring-as-prompt, `...`-as-loop | Not expressible in TS (no elided body, no runtime docstring). Worse, the `...` rule means **a forgotten stub silently becomes an LLM call** — a footgun that fails our no-magic principle. |
| `class A(Agent, llm=llm)` metaclass keyword | Same no-magic principle. Elegant, non-obvious, and unnecessary given the builder. |
| Bundling an in-process sandbox | ADR-0041 locked: core ships no VM, the boundary is injected and vetted. Their model is precisely what we refuse. |
| A second/parallel agent loop | ROADMAP § Explicitly out of scope, reaffirmed at M38/M39/M40. `@theokit/sdk` is the only runtime. |
| `from nooa.util.quickstart import *` ergonomics | Their own example disables the linter (`# ruff: noqa: F403,F405`) to make it work. Good demo, bad pattern to teach. |

---

## ADRs (proposals — each requires the normal gate before it is binding)

### ADR-N1 — Pursue G4 (external benchmark) before G1/G2/G3

**Decision.** The next initiative's first milestone is a public, reproducible benchmark run of a
TheoKit-harnessed agent, published with the harness config and a re-run command.

**Rationale.** G1–G3 are feature work whose value we can already argue internally. G4 is the only
gap that changes what we are *permitted to claim*. It is also the cheapest to falsify: either the
number exists or it does not.

**Alternatives considered.** (a) Ship G1 first — rejected: it is the highest-risk item and
delivering it still would not license the SOTA claim. (b) Skip benchmarking and claim SOTA on
feature comparison — rejected: `rules/public-copy.md` § 4 forbids comparative performance claims
without a reproducible artifact, and this blueprint would be the artifact contradicting us.

**Cost, honestly.** A benchmark harness is real work and may produce a number we do not like. That
is the point of running it.

### ADR-N2 — G1 enters as a feasibility spike, never as a feature task

**Decision.** Pass-by-reference in code-mode is scoped as a time-boxed spike answering one
question: can a live object handle cross the injected sandbox boundary without widening host
reachability? A `NEEDS_REVISION`-shaped answer kills the item; it does not downgrade to
"do it unsafely".

**Alternatives considered.** (a) Plan it as an M-sized feature — rejected: we do not know it is
possible under ADR-0041, and planning implies we do. (b) Drop it — rejected too early: the token
and turn-count cost is measurable and real.

### ADR-N3 — G2 is measured before it is optimized

**Decision.** Instrument time-to-first-agent (lines, files, imports, commands from `create-theokit`
to a first streamed token) and treat the number as the acceptance criterion. No new authoring
surface (M2/M53 constraint).

**Alternatives considered.** (a) Add a terse `defineAgent`-lite — rejected: reintroduces the dual
path M53 deleted. (b) Do nothing — rejected: 8 lines vs 9 chained calls + 4 files is a real
first-impression cost for a framework whose HERO promises a shippable agent.

### ADR-N4 — G3 (trace UI) is deferred, not adopted

**Decision.** No trace viewer this cycle. Our OTLP output already flows to Langfuse/Phoenix/Jaeger,
which are better than anything we would build.

**Alternatives considered.** (a) Build one — rejected as YAGNI + Don't-Reinvent (parsimony ladder
rungs 1 and 2/3): the data is already standard, the consumers already exist. (b) Ship an
integration guide instead — accepted as the cheap substitute, folded into G4's publication.

---

## Edge cases (to settle in PLAN)

- **G4 harness honesty.** A benchmark run through our harness measures *harness + model*, not the
  framework alone. The publication must state the model, the date, the config and the re-run
  command, or it is marketing.
- **G4 negative result.** Define, before running, what we publish if the score is poor. Deciding
  afterwards is how benchmarks become dishonest.
- **G1 and the permission gate.** If a live handle is passed in, every method reachable through it
  is a new call surface. The gate currently keys on tool name; a handle has methods. Either the
  gate extends to methods or handles are read-only projections.
- **G1 serialization boundary.** Read-only projection may capture most of the token win at a
  fraction of the risk. Evaluate it *before* true reference semantics.
- **G2 measurement bias.** Time-to-first-agent measured by us, on our machine, with our API key, is
  not the user's number. Measure from a clean container.
- **Test-ratio signal.** Do not turn 0.94 → 2.2 into a target. File-count ratios are a proxy; the
  golden rules already gate what matters (mutation score, wiring triad).

---

## What this blueprint deliberately does not say

It does not claim TheoKit is behind NOOA. On the evidence gathered, the opposite is true on most
axes that matter for shipping an agent app, and NOOA does not attempt the product surface at all.
What it says is narrower and harder: **we cannot prove we are ahead to anyone outside this repo**,
and NOOA can. That is what G4 buys, and it is why it is ordered first.

---

## References

- `NVIDIA-NeMo/labs-OO-Agents` — Apache-2.0. Files cited: `src/nooa/runtime/middleware.py`,
  `src/nooa/runtime/restrictions.py`, `src/nooa/runtime/hooks.py`, `src/nooa/tracing/_otlp_http_exporter.py`,
  `examples/quickstart/01_first_generation_method.py`, `pyproject.toml`.
- arXiv `2607.20709` — the NOOA paper (design principles + benchmark evaluation).
- `packages/theo/src/server/agent/code-mode.ts` — M29/ADR-0041, our code-as-action.
- `packages/agents/src/bridge/hook-handlers.ts` — our 8-point interception seam.
- `packages/agents/src/guardrails/` — the 5 shipped detectors.
- `packages/create-theokit/templates/default/agents/chat.ts` — the authoring surface G2 measures.
- `ROADMAP.md` § Scope → Explicitly out of scope — the locked list Corner 3 cross-checks against.
- `rules/public-copy.md` § 4 — why G4 gates the claim, not the feature work.
- `rules/parsimony-ladder.md` — rungs cited in ADR-N4.
