# Analysis Golden Rule

Locked unbreakable contract that `/analysis` reads to score hypotheses, run analysis modules, decide verdicts, and surface trajectory evidence. **This file is the Source of Truth for the analysis methodology, module contracts, severity rubric, and verdict score caps.**

Without this file, `/analysis` emits `INVALID` with flag `analysis_golden_rule_missing` and refuses to run.

## § 1 — Verdict tokens (LOCKED)

`/analysis` MUST emit one of the following verdicts. They are aligned with the canonical matrix in `cycle-rule-schema.md`.

| Verdict | Score range | Meaning | Downstream action |
|---|---|---|---|
| `ON_TRACK` | 90-100 | All hypotheses validated with quantitative evidence. Architecture, performance, and scalability meet or exceed targets. | Archive report as baseline. Next milestone proceeds normally via `cycle-roadmap`. |
| `ON_TRACK_WITH_RISKS` | 70-89 | Most hypotheses validated. Identified risks have concrete mitigation paths. No fundamental design flaw. | Next milestone proceeds, but risk mitigation tasks are injected into the next `/to-plan`. Follow-up `/analysis` scheduled after next release. |
| `COURSE_CORRECTION_NEEDED` | 40-69 | Multiple hypotheses falsified OR performance significantly below targets. Correctable without architectural rewrite. | Before next feature work, run `/to-plan` for corrective tasks. Then `/implement` corrections and re-release. Re-run `/analysis` to validate corrections. |
| `FUNDAMENTAL_RETHINK` | 0-39 | Architecture cannot meet stated goals based on empirical evidence. Benchmark data contradicts core design assumptions. | Run `/discover-plan` for alternatives + `/to-plan` for redesign. Write ADR documenting failure evidence. `cycle-roadmap` pauses until human decides. |
| `INVALID` | — | Structural integrity broken (config missing, no benchmarks exist for engine profile, golden rule corrupted). | Stop. Surface to human. |

A new verdict token requires an ADR + an entry in `cycle-rule-schema.md` § Canonical verdict vocabularies.

## § 2 — Analysis modules (LOCKED)

Six modules, run in fixed order. Each module produces **findings** with quantitative evidence. A module MAY be skipped when its profile weight is zero (see § 6).

| Module | Name | What it measures | Evidence type |
|---|---|---|---|
| A1 | Performance benchmarks | Throughput, latency, startup time via language-specific benchmark frameworks | Numbers: ops/sec, p50/p95/p99 latency, wall-clock time |
| A2 | Complexity analysis | Cyclomatic + cognitive complexity, function/file length, nesting depth | Numbers: CC score, LOC, max nesting |
| A3 | Architecture fitness | Dependency graph, coupling metrics (Ca/Ce/I/A/D), circular deps, layer violations | Graph: module dependency matrix, instability index |
| A4 | Memory & resource profile | Per-object overhead, allocation patterns, unsafe blocks (Rust), resource leaks | Numbers: bytes/entity, alloc count, unsafe ratio |
| A5 | Scalability projection | Empirical Big-O by benchmarking at N, 2N, 4N; bottleneck identification | Curve: measured vs expected growth, inflection points |
| A6 | Reference comparison | Architecture patterns + published benchmarks vs reference implementations | Delta: this project vs reference on each dimension |

### Module toolchain per language

| Module | Rust | Python | TypeScript | Go |
|---|---|---|---|---|
| A1 | `criterion`, `cargo bench` | `pytest-benchmark`, `locust` | `vitest bench`, `autocannon` | `go test -bench`, `benchstat` |
| A2 | `cargo clippy`, custom metrics | `radon cc`, `cognitive_complexity` | `ts-complexity`, `eslint` | `gocyclo`, `gocognit` |
| A3 | `cargo-modules`, `cargo-depgraph` | `pydeps`, `import-linter` | `madge`, `dependency-cruiser` | `go-architect`, `goda` |
| A4 | `cargo-bloat`, `sizeof`, `cargo-geiger` | `tracemalloc`, `memray` | `clinic`, heap snapshot | `pprof heap` |
| A5 | criterion with parameterized N | pytest-benchmark parametrize | custom bench harness | go test -bench with sub-benchmarks |
| A6 | manual comparison | manual comparison | manual comparison | manual comparison |

A module MAY report `module_unavailable_{id}` when its toolchain is missing — this is a SOFT finding, not a hard gate.

## § 3 — Hypothesis methodology (LOCKED)

Every `/analysis` run follows the scientific method:

1. **Extract hypotheses** — Read project CLAUDE.md, plan files, ADRs, README. Extract testable claims about architecture, performance, scalability.
2. **Formulate predictions** — Each hypothesis becomes a measurable prediction: "If the architecture is correct, then [metric] should be [comparison] [threshold]."
3. **Measure** — Run the appropriate module(s) to collect evidence.
4. **Evaluate** — Compare measurement against prediction. Statistical rigor: multiple runs (≥ 3), report mean ± std dev, note confidence interval.
5. **Conclude** — Each hypothesis is scored: `VALIDATED` (evidence supports), `AT_RISK` (evidence is ambiguous or borderline), `FALSIFIED` (evidence contradicts).

### Hypothesis scoring

| Result | Points | Meaning |
|---|---|---|
| `VALIDATED` | 100 | Measurement meets or exceeds prediction with statistical significance |
| `AT_RISK` | 50 | Measurement is within 20% of threshold OR insufficient data for confidence |
| `FALSIFIED` | 0 | Measurement clearly contradicts prediction (> 20% below threshold) |

Overall score = weighted average of hypothesis scores (weights from profile § 6).

### PhD-level rigor requirements

- Every number MUST have units and methodology: "INSERT throughput: 847,000 vertices/sec (criterion, 10 iterations, warm cache, AMD Ryzen 9 5950X)".
- Every comparison MUST cite the baseline: "vs Neo4j published: 120,000 vertices/sec (Neo4j 5.x, LDBC SNB SF-1, comparable hardware)".
- Every projection MUST show the data points and curve fit: "Measured: 1K=0.3ms, 10K=2.8ms, 100K=31ms → O(n) linear confirmed (R²=0.998)".
- Ambiguity MUST be declared: "Insufficient data points for confident O(n log n) vs O(n) discrimination at this scale."
- Reference comparisons MUST note when conditions differ: "Caveat: Neo4j benchmark uses disk-backed storage; our in-memory comparison is expected to be faster for warm cache."

## § 4 — Severity rubric (LOCKED)

Findings from modules are classified by trajectory impact:

| Finding | Severity | Stable identifier | Verdict cap |
|---|---|---|---|
| Golden rule missing | `STRUCTURAL` | `analysis_golden_rule_missing` | `INVALID` (0) |
| Config missing or `enabled ≠ true` | `STRUCTURAL` | `analysis_not_enabled` | `INVALID` (0) |
| Hypothesis falsified (core architecture claim) | `CRITICAL` | `hypothesis_falsified_core_{id}` | `FUNDAMENTAL_RETHINK` (39) |
| Benchmark regression > 30% vs baseline | `CRITICAL` | `benchmark_regression_critical_{name}` | `COURSE_CORRECTION_NEEDED` (69) |
| Circular dependency in core modules | `CRITICAL` | `circular_dependency_{modules}` | `COURSE_CORRECTION_NEEDED` (69) |
| Hypothesis falsified (performance target) | `HIGH` | `hypothesis_falsified_perf_{id}` | `COURSE_CORRECTION_NEEDED` (69) |
| Instability index > 0.8 on stable module | `HIGH` | `instability_high_{module}` | `ON_TRACK_WITH_RISKS` (89) |
| Cyclomatic complexity > 25 on critical path | `HIGH` | `complexity_critical_path_{func}` | `ON_TRACK_WITH_RISKS` (89) |
| Benchmark regression 10-30% vs baseline | `MEDIUM` | `benchmark_regression_medium_{name}` | `ON_TRACK_WITH_RISKS` (89) |
| Hypothesis at risk | `MEDIUM` | `hypothesis_at_risk_{id}` | `ON_TRACK_WITH_RISKS` (89) |
| Module toolchain unavailable | `LOW` | `module_unavailable_{id}` | `ON_TRACK_WITH_RISKS` (89) |
| No benchmark suite found (engine/api profile) | `HIGH` | `no_benchmarks_for_profile` | `COURSE_CORRECTION_NEEDED` (69) |
| Cyclomatic complexity 15-25 | `LOW` | `complexity_moderate_{func}` | `ON_TRACK` (100) |
| File > 500 LOC | `LOW` | `file_too_long_{path}` | `ON_TRACK` (100) |

Smallest cap wins (same as code-quality pattern).

## § 5 — Hard caps (LOCKED)

Hard caps block the verdict at `COURSE_CORRECTION_NEEDED` or below. They cannot be bypassed.

| # | Check | Flag |
|---|---|---|
| 1 | This file (`analysis-golden-rule.md`) exists and parses | `analysis_golden_rule_missing` |
| 2 | `analysis-config.txt` exists with `enabled = true` | `analysis_not_enabled` |
| 3 | Profile-required benchmarks exist (engine/api profiles) | `no_benchmarks_for_profile` |
| 4 | No circular dependency in core modules | `circular_dependency_{modules}` |
| 5 | No core architecture hypothesis falsified | `hypothesis_falsified_core_{id}` |
| 6 | `/release` completed before `/analysis` runs | `release_not_completed` |

## § 5.1 — Pre-condition: post-release only (LOCKED)

`/analysis` MUST run after `/release` emits `RELEASED`. This is non-negotiable because:

- Measuring in-progress code produces unreliable baselines that pollute regression detection.
- The feedback loop only works if the measured state is the state that shipped — otherwise corrections target a moving target.
- Benchmark variance during active development masks real regressions.

If no release exists yet (project bootstrap), `/analysis` MAY run once to establish the initial baseline, but the report MUST note "pre-release baseline — no regression comparison available".

## § 6 — Profile weights (PER-PROJECT — EDIT THIS)

Each profile assigns weights to modules. Weights determine how much each module contributes to the overall score. A weight of 0 disables the module for that profile.

| Module | engine | api | library | cli | infrastructure |
|---|---|---|---|---|---|
| A1 — Performance | 30 | 30 | 15 | 20 | 0 |
| A2 — Complexity | 10 | 15 | 25 | 25 | 15 |
| A3 — Architecture | 15 | 20 | 25 | 15 | 40 |
| A4 — Memory | 25 | 10 | 20 | 25 | 5 |
| A5 — Scalability | 15 | 20 | 5 | 5 | 10 |
| A6 — Reference | 5 | 5 | 10 | 10 | 30 |

Weights MUST sum to 100 per profile. Custom weights require an ADR.

## § 7 — Baseline management

- First `/analysis` run on a project creates the baseline at `baseline_dir`.
- Subsequent runs compare against the most recent baseline.
- A baseline is a JSON file: `{module}_{date}.json` with raw measurements.
- Baselines are committed to the repo (they are reproducibility evidence, not ephemeral).
- Regressions are measured as percentage delta from baseline.

## § 8 — Report contract

Every `/analysis` report MUST contain:

| Section | Required | Content |
|---|---|---|
| Scorecard | Yes | Overall score, per-module scores, verdict |
| Hypotheses | Yes | Table: hypothesis, prediction, measurement, result (VALIDATED/AT_RISK/FALSIFIED) |
| Benchmark results | When A1 runs | Raw numbers with units, methodology, comparison to baseline |
| Architecture metrics | When A3 runs | Dependency graph summary, coupling metrics, layer violations |
| Scalability projection | When A5 runs | Data points, curve fit, projected bottleneck |
| Methodology | Yes | Exact commands to reproduce every measurement |
| Recommendations | Yes | Prioritized by impact, with expected improvement |
| Risk register | When risks found | Each risk with probability, impact, mitigation |

## § 9 — When this rule may change

Per `cycle-rule-schema.md § Golden Rule Change Protocol`. No rule-specific deviations.

## Cross-references

- Schema for cycle rules: `cycle-rule-schema.md`
- Cycle rule: `cycle-analysis.md`
- Skill: `skills/analysis/SKILL.md`
- Config: `analysis-config.txt`
- Languages (reused): `code-quality-languages.txt`
