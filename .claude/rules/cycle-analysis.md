# Cycle: ANALYSIS

PhD-level trajectory validation with empirical evidence. Opt-in per project. Runs **after RELEASE** — findings feed the next iteration.

## Purpose

Validate whether a project is **on the correct trajectory** using quantitative evidence — benchmarks, complexity metrics, architecture fitness functions, scalability projections, and reference comparisons. Unlike `/code-quality` (structural correctness) or `/review` (merge readiness), `/analysis` answers: "Given the evidence, will this architecture meet its goals at target scale?"

The analysis follows the scientific method: extract hypotheses from project documentation, formulate measurable predictions, run experiments (benchmarks + profiling), and conclude with evidence-backed verdicts. Every finding cites numbers, methodology, and reproduction commands.

This cycle is the **post-release feedback loop** — it runs after `/release` on projects that opt in, and its verdict determines what the next iteration looks like. Without this loop, the team ships code but never validates whether the trajectory is sound.

## Position in the chain

```
DISCOVER → PLAN → IMPLEMENT → CODE-QUALITY → REVIEW → RELEASE → ANALYSIS (opt-in)
                                                                     ↓
                                                              feedback loop
```

When enabled, `/analysis` is the **last cycle** before the roadmap super-loop selects the next milestone. Its verdict drives the shape of the next iteration — see § Verdicts below for the full token → feedback-action mapping.

## Pre-conditions

- `/release` has completed — analysis runs on **released code**, not in-progress work. This ensures the measured state is the state that shipped.
- Project has `rules/analysis-config.txt` with `enabled = true`. Without this, `/analysis` exits with INFO "analysis not enabled for this project".
- At least one language enabled in `rules/code-quality-languages.txt` (reused — no separate language config).
- For `engine` and `api` profiles: benchmark suite MUST exist at `benchmark_dir` path. Without benchmarks, these profiles emit `no_benchmarks_for_profile` (HARD finding).
- Working tree is clean (no uncommitted changes — analysis reads a stable state).
- Compilable/runnable state (tests pass, project builds).

Do NOT trigger when:

- Project has no `analysis-config.txt` or `enabled = false` — the cycle is opt-in by design.
- Project is in pre-code phase (no source to analyze).
- Active `/implement` halt-loop is running (wait for `IMPLEMENTATION_COMPLETE`).
- Benchmarks are being written (in-progress benchmark code produces unreliable baselines).
- `/release` has NOT completed — analysis measures released state, not mid-development state.

## Chain

```
/analysis [plan-slug]
     ↓ verify /release completed (pre-condition)
     ↓ load analysis-config.txt + analysis-golden-rule.md
     ↓ Phase 1: extract hypotheses from CLAUDE.md, plans, ADRs, README
     ↓ Phase 2: run analysis modules A1-A6 (per profile weights)
     ↓ Phase 3: evaluate hypotheses against measurements
     ↓ Phase 4: compute verdict + emit report + determine feedback action
```

## Phase contracts

| Phase | Input | Output | Hard gate |
|---|---|---|---|
| **1 — Hypothesis** | Project docs (CLAUDE.md, plans, ADRs, README) | Structured hypothesis list: each with ID, claim, prediction, target module | ≥ 1 testable hypothesis extracted (else INVALID) |
| **2 — Measurement** | Hypothesis list + analysis-config.txt | Per-module raw measurements with methodology | Profile-required modules produce results (else hard finding) |
| **3 — Evaluation** | Hypotheses + measurements | Per-hypothesis verdict (VALIDATED / AT_RISK / FALSIFIED) with evidence | Statistical rigor: ≥ 3 runs for benchmarks, mean ± std dev reported |
| **4 — Verdict + Feedback** | Evaluated hypotheses + module findings | Final report at `knowledge-base/audits/{slug-or-date}-analysis.md` + feedback action | Report follows § 8 contract from golden rule; feedback action maps to next cycle |

## Analysis modules

Six modules, each producing quantitative evidence. Modules run in order A1→A6. Modules with profile weight = 0 are skipped.

| Module | Focus | PhD rigor requirement |
|---|---|---|
| **A1 — Performance** | Benchmark throughput, latency, startup time | ≥ 3 iterations, report mean ± std dev, cite hardware + methodology |
| **A2 — Complexity** | Cyclomatic + cognitive complexity, nesting, LOC | Tool-measured (radon/gocyclo/lizard), not estimated. Cite thresholds source |
| **A3 — Architecture** | Coupling (Ca/Ce/I/A/D), circular deps, layer violations | Dependency graph extracted from imports, not guessed. Robert Martin metrics |
| **A4 — Memory** | Per-object overhead, allocation count, unsafe ratio | Measured via profiler or sizeof analysis, not theoretical |
| **A5 — Scalability** | Empirical Big-O at N/2N/4N, bottleneck ID | ≥ 3 data points, curve fit with R², projection with confidence band |
| **A6 — Reference** | Compare vs reference implementations | Cite specific code patterns + published benchmarks with source URL |

## Verdicts

| Token | Score range | Meaning | Feedback action |
|---|---|---|---|
| `ON_TRACK` | 90-100 | All hypotheses validated. Architecture + performance meet targets. | Archive report as baseline. Next milestone proceeds normally. |
| `ON_TRACK_WITH_RISKS` | 70-89 | Mostly validated. Risks identified with mitigation paths. | Inject risk mitigation tasks into next `/to-plan`. Schedule follow-up `/analysis` after next release. |
| `COURSE_CORRECTION_NEEDED` | 40-69 | Multiple falsified hypotheses OR significant performance gaps. Correctable. | Run `/to-plan` for corrective tasks before next feature work. Then `/implement` corrections. Re-run `/analysis` after correction release. |
| `FUNDAMENTAL_RETHINK` | 0-39 | Evidence contradicts core design assumptions. | Run `/discover-plan` for alternatives + `/to-plan` for redesign. Write ADR documenting failure evidence. |
| `INVALID` | — | Config missing, golden rule missing, or structural failure. | Stop. Surface to human. |

### Why this vocabulary

- Existing verdicts (`PASS`/`FAIL`, `READY_TO_MERGE`, `SHIPPABLE`) describe **gate outcomes**: binary pass/fail or merge readiness. Analysis produces a **trajectory assessment** — the project might be working correctly today but heading toward a wall. `ON_TRACK` vs `COURSE_CORRECTION_NEEDED` captures this gradient that binary gates cannot.
- `FUNDAMENTAL_RETHINK` is distinct from `FAIL` because it carries a specific prescription: the architecture itself needs redesign, not just bug fixes or performance tuning.
- The feedback actions are prescriptive — each verdict maps to a concrete next step in the cycle chain, not a vague "fix it".

### Feedback loop integration with cycle-roadmap

When running inside the `cycle-roadmap` super-loop, the verdict shapes milestone M\<N+1\>: `ON_TRACK` / `ON_TRACK_WITH_RISKS` → roadmap selects the next milestone (risk mitigations injected into `/to-plan` for the latter); `COURSE_CORRECTION_NEEDED` → roadmap inserts a corrective milestone before the next feature milestone; `FUNDAMENTAL_RETHINK` → roadmap pauses for a human redesign/pivot decision.

The analysis report is persisted at `knowledge-base/audits/` and referenced by the next milestone's `/to-plan` as prior art (same as `/discover` blueprints).

## Hard gates

| Gate | Trigger | Source |
|---|---|---|
| Golden rule missing | `analysis-golden-rule.md` not found or unparseable | § 5.1 of golden rule |
| Config not enabled | `analysis-config.txt` missing or `enabled ≠ true` | § 5.2 of golden rule |
| No benchmarks for profile | `engine`/`api` profile with empty `benchmark_dir` | § 5.3 of golden rule |
| Circular dependency | Core module dependency cycle detected by A3 | § 5.4 of golden rule |
| Core hypothesis falsified | A hypothesis tagged `core` is FALSIFIED | § 5.5 of golden rule |
| Release not completed | `/release` verdict not found or not `RELEASED` | Pre-condition |

## Anti-patterns

- **Running before release** — analysis measures released state. Mid-development measurements are noise, not signal.
- **Running without benchmarks on an engine project** — the whole point is empirical evidence. "I'll add benchmarks later" defeats the cycle's purpose.
- **Fabricating measurements** — every number MUST come from an actual tool run. "Estimated ~500K ops/sec" is not evidence.
- **Comparing incomparable baselines** — Neo4j disk-backed vs your in-memory engine without noting the difference is dishonest science.
- **Ignoring statistical variance** — a single benchmark run that looks good is not evidence. Report mean ± std dev over ≥ 3 runs.
- **Treating ON_TRACK_WITH_RISKS as ON_TRACK** — risks are documented for a reason. Address or explicitly accept each one.
- **Ignoring the feedback action** — the verdict prescribes a concrete next step. Shipping the next feature while `COURSE_CORRECTION_NEEDED` is pending is technical debt with empirical evidence that you're ignoring.
- **Skipping hypothesis extraction** — running benchmarks without hypotheses is just benchmarking, not analysis. The hypothesis-driven approach is what makes this PhD-level.

## Output

- `knowledge-base/audits/{slug-or-date}-analysis.md` — full report following § 8 contract.
- `{baseline_dir}/{module}_{date}.json` — raw measurements for regression detection.
- Exit code 0 (`ON_TRACK`), 1 (`ON_TRACK_WITH_RISKS`), 2 (`COURSE_CORRECTION_NEEDED` / `FUNDAMENTAL_RETHINK`), 3 (`INVALID`).

## Cross-references

- Schema for cycle rules: `rules/cycle-rule-schema.md`
- Golden rule: `rules/analysis-golden-rule.md`
- Config: `rules/analysis-config.txt`
- Skill: `skills/analysis/SKILL.md`
- Languages (reused): `rules/code-quality-languages.txt`
- Upstream: `rules/cycle-release.md` (analysis runs after release completes)
- Feedback targets: `rules/cycle-discover.md` (FUNDAMENTAL_RETHINK), `rules/cycle-plan.md` (COURSE_CORRECTION / risk injection)
- Macro super-loop: `rules/cycle-roadmap.md` (analysis verdict shapes next milestone)
- Architecture conventions: `rules/architecture.md`
