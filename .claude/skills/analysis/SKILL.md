---
name: analysis
version: 0.1.0
requires: []
description: PhD-level trajectory validation with empirical evidence — benchmarks, complexity metrics, architecture fitness, scalability projections. Opt-in per project via rules/analysis-config.txt. Runs 6 analysis modules (A1-A6) weighted by project profile (engine/api/library/cli/infrastructure). Produces hypothesis-driven report with quantitative evidence, not opinions. Independent cycle — does not gate the main chain.
user-invocable: true
allowed-tools: Read Glob Grep Bash Write Agent
argument-hint: "[plan-slug] (optional — bind analysis to a plan's architecture claims)"
---

# Analysis — PhD-Level Trajectory Validation

> **INQUEBRÁVEL — 95% Confidence Gate**
>
> NÃO FAÇA NADA SE NÃO TIVER 95% DE CONFIANÇA.
> SEMPRE QUE PRECISAR DE UMA DECISÃO DO USUÁRIO, APRESENTE
> OPÇÕES PARA ELE ESCOLHER.
>
> Ver `/home/paulo/.claude/CLAUDE.md` § 1 (95% Confidence).

Single entry-point for [`cycle-analysis`](../../rules/cycle-analysis.md). Validates whether a project is on the correct trajectory using the scientific method: hypotheses → measurements → evidence → verdict.

**Project rules consumed:**
- `.claude/rules/analysis-golden-rule.md` — locked unbreakable contract.
- `.claude/rules/analysis-config.txt` — opt-in enablement + profile + paths.
- `.claude/rules/code-quality-languages.txt` — which languages are enabled (reused).
- Unbreakable Rule 9 (`/home/paulo/.claude/CLAUDE.md § 9`) — use existing benchmark/profiling tools, never reimplement.

---

## Cycle contract

This skill is **the only phase** of [`cycle-analysis`](../../rules/cycle-analysis.md). The cycle rule is the **source of truth** for: pre-conditions, hard gates, verdicts, anti-patterns, and output paths.

**Read `cycle-analysis.md` before invoking this skill.**

This SKILL.md retains phase-specific detail (module execution, hypothesis methodology, report generation).

---

## When to Trigger

User explicitly invokes `/analysis [plan-slug]` when:

- `/release` completed — analysis runs on **released code**, not in-progress work
- Project has `rules/analysis-config.txt` with `enabled = true`
- Codebase is in a stable, buildable, testable state
- Benchmarks exist (required for `engine` and `api` profiles)
- User wants evidence-backed assessment of project trajectory post-release

Exception: on project bootstrap (no release yet), `/analysis` MAY run once to establish the initial baseline. The report MUST note "pre-release baseline — no regression comparison available".

Refuse to start when:

- `/release` has NOT completed and this is not the initial baseline run → refuse with "analysis runs after release"
- `analysis-config.txt` missing or `enabled ≠ true` → INFO "analysis not enabled for this project"
- `analysis-golden-rule.md` missing → INVALID
- Working tree has uncommitted changes
- Project doesn't compile / tests don't pass
- Active `/implement` halt-loop running (unstable state)

---

## Modes

### Mode 1 — Standalone analysis

```
/analysis
```

Extracts hypotheses from project CLAUDE.md, README, and ADRs. Runs all profile-enabled modules against current codebase. Report to stdout + `knowledge-base/audits/{date}-analysis.md`.

### Mode 2 — Plan-bound analysis (RECOMMENDED)

```
/analysis {plan-slug}
```

Additionally reads `.claude/knowledge-base/plans/{slug}-plan.md` to extract architecture claims and performance targets declared in the plan. Hypotheses are richer because they include plan-specific goals.

---

## Workflow

### Step 0 — Pre-flight checks (MANDATORY)

```
1. Verify /release completed → REFUSE if no release found (exception: initial baseline)
2. Read analysis-config.txt → REFUSE if not enabled
3. Read analysis-golden-rule.md → INVALID if missing
4. Check working tree clean → REFUSE if dirty
5. Detect languages from code-quality-languages.txt + manifests
5. Load profile weights from golden-rule § 6
6. If plan-slug provided, read the plan file
```

### Step 1 — Hypothesis extraction

Read these sources in order and extract testable claims:

| Source | What to extract | Example |
|---|---|---|
| `CLAUDE.md` | Architecture decisions, stated patterns | "MVCC via delta chains provides snapshot isolation" |
| Plan file (Mode 2) | Performance targets, scalability goals | "Support 1M vertices with < 10ms traversal" |
| `README.md` | Public promises, claimed capabilities | "Concurrent reads without locking" |
| `knowledge-base/adrs/*.md` | Design decisions with stated rationale | "Chose DashMap over RwLock<HashMap> for concurrent access" |
| Source code (key modules) | Implicit claims from architecture | "SmallVec<4> for inline adjacency avoids heap alloc for typical degree" |

For each claim, formulate:

```
Hypothesis H{N}:
  Claim: {what the project claims}
  Prediction: If true, then {metric} should be {comparison} {threshold}
  Module: A{N} (which module measures this)
  Core: true/false (is this a fundamental architecture claim?)
```

**Hard gate**: At least 1 testable hypothesis MUST be extracted. Zero hypotheses → INVALID.

**Target**: 5-15 hypotheses covering performance, architecture, and scalability.

### Step 2 — Run analysis modules

Run each module with profile weight > 0, in order A1→A6. For each module:

#### A1 — Performance benchmarks

```bash
# Rust
cargo bench 2>&1 | tee .benchmarks/a1_raw.txt
# OR criterion JSON output
cargo bench -- --output-format json > .benchmarks/a1_criterion.json

# Python
pytest --benchmark-only --benchmark-json=.benchmarks/a1_pytest.json

# TypeScript
npx vitest bench --reporter=json > .benchmarks/a1_vitest.json

# Go
go test -bench=. -benchmem -count=3 ./... > .benchmarks/a1_go.txt
```

Parse results. For each benchmark:
- Record: name, iterations, mean time, std dev, throughput (if applicable)
- Compare against baseline (if exists at `baseline_dir`)
- Flag regressions > 10% as MEDIUM, > 30% as CRITICAL

If no benchmark suite exists:
- `engine`/`api` profile → emit `no_benchmarks_for_profile` HARD finding
- Other profiles → emit INFO and skip A1

#### A2 — Complexity analysis

```bash
# Rust (using external tools when available, fallback to grep-based)
# Count functions > 50 LOC, files > 500 LOC, nesting > 4

# Python
radon cc --min C --json {src_dirs} > .benchmarks/a2_radon.json
radon mi --json {src_dirs} >> .benchmarks/a2_radon_mi.json

# TypeScript
npx ts-complexity {src_dirs} > .benchmarks/a2_ts.json

# Go
gocyclo -over 10 . > .benchmarks/a2_gocyclo.txt
```

For each function with CC > 15: emit finding with severity per golden rule § 4.

#### A3 — Architecture fitness

```bash
# Dependency graph extraction
# Rust
cargo modules dependencies --no-fuzz > .benchmarks/a3_deps.dot

# Python
pydeps --cluster --no-show {package} -o .benchmarks/a3_deps.svg

# TypeScript
npx madge --json {src_dir} > .benchmarks/a3_madge.json
npx madge --circular {src_dir} > .benchmarks/a3_circular.txt

# Go
go list -json ./... > .benchmarks/a3_golist.json
```

Compute Robert Martin metrics:
- **Ca** (Afferent coupling): incoming dependencies
- **Ce** (Efferent coupling): outgoing dependencies
- **I** (Instability): Ce / (Ca + Ce) — 0 = stable, 1 = unstable
- **A** (Abstractness): abstract types / total types
- **D** (Distance from main sequence): |A + I - 1|

Flag:
- Circular dependencies → CRITICAL
- I > 0.8 on a module that should be stable → HIGH
- D > 0.7 → MEDIUM (zone of pain or uselessness)

#### A4 — Memory & resource profile

```bash
# Rust
cargo bloat --release --crates > .benchmarks/a4_bloat.txt
# Count unsafe blocks
grep -rn "unsafe" --include="*.rs" | wc -l > .benchmarks/a4_unsafe.txt
# Estimate per-struct size using std::mem::size_of (requires test binary)

# Python
python -c "import tracemalloc; tracemalloc.start(); ... ; print(tracemalloc.get_traced_memory())"

# Go
go test -memprofile=.benchmarks/a4_mem.prof ./...
```

For Rust specifically, analyze:
- `SmallVec` inline capacity vs actual usage (is N=4 the right choice?)
- `Arc` vs `Box` usage patterns (shared ownership justified?)
- `DashMap` shard count vs concurrent access patterns
- `unsafe` block count and justification

#### A5 — Scalability projection

Run A1 benchmarks at multiple N values (if parameterized):

```
N=1000    → measure
N=2000    → measure
N=4000    → measure
N=10000   → measure (if feasible)
```

Fit curve: O(1), O(log n), O(n), O(n log n), O(n²). Report best fit with R².

If benchmarks are not parameterized, analyze algorithmic complexity statically:
- Hot paths identified from A2
- Data structure lookup complexity (DashMap = O(1) amortized, BTreeMap = O(log n))
- Traversal complexity (adjacency list = O(degree))

#### A6 — Reference comparison

If `reference_repos` configured in `analysis-config.txt`:

For each reference project:
1. Read its architecture (CLAUDE.md or equivalent)
2. Compare patterns: data structures, concurrency model, storage model
3. Note published benchmarks (README, papers, blog posts)
4. Compute delta: where this project is better/worse/different

If no references configured: skip with INFO.

### Step 3 — Evaluate hypotheses

For each hypothesis from Step 1:

1. Gather relevant measurements from Step 2
2. Compare measurement vs prediction
3. Score:
   - `VALIDATED` (100 pts) — measurement meets/exceeds prediction
   - `AT_RISK` (50 pts) — within 20% of threshold OR insufficient data
   - `FALSIFIED` (0 pts) — measurement clearly contradicts (> 20% below)

Compute overall score:
```
module_scores = {A1: mean(A1_hypothesis_scores), A2: mean(A2_scores), ...}
overall = Σ (module_scores[Ai] × profile_weight[Ai]) / 100
```

Map to verdict per golden rule § 1.

### Step 4 — Generate report

Write `knowledge-base/audits/{slug-or-date}-analysis.md` following this structure:

```markdown
# Analysis Report: {project} — {date}

## Verdict: {ON_TRACK | ON_TRACK_WITH_RISKS | COURSE_CORRECTION_NEEDED | FUNDAMENTAL_RETHINK}

Overall score: {N}/100 | Profile: {profile}

## Scorecard

| Module | Weight | Score | Key finding |
|---|---|---|---|
| A1 Performance | {w}% | {s}/100 | {one-line} |
| A2 Complexity | {w}% | {s}/100 | {one-line} |
| ... | | | |

## Hypotheses

| ID | Claim | Prediction | Measurement | Result |
|---|---|---|---|---|
| H1 | {claim} | {prediction} | {actual numbers} | VALIDATED/AT_RISK/FALSIFIED |
| ... | | | | |

## Benchmark Results (A1)

{Raw numbers with units, methodology, hardware, comparison to baseline}

## Architecture Metrics (A3)

{Dependency graph summary, coupling metrics table, circular deps}

## Scalability Projection (A5)

{Data points, curve fit, R², projected bottleneck}

## Methodology

{Exact commands to reproduce every measurement}

## Recommendations

| Priority | Action | Expected impact | Effort |
|---|---|---|---|
| 1 | {what to do} | {quantified improvement} | {S/M/L} |
| ... | | | |

## Risk Register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| {risk} | {H/M/L} | {H/M/L} | {concrete action} |
| ... | | | |
```

Save baseline measurements to `baseline_dir` for future regression detection.

### Step 5 — Emit verdict + feedback action

Print JSON summary to stdout:

```json
{
  "verdict": "ON_TRACK_WITH_RISKS",
  "score": 78,
  "profile": "engine",
  "hypotheses_validated": 8,
  "hypotheses_at_risk": 3,
  "hypotheses_falsified": 0,
  "findings_critical": 0,
  "findings_high": 2,
  "findings_medium": 3,
  "report_path": "knowledge-base/audits/theo-graphdb-analysis-2026-06-16.md",
  "baseline_updated": true,
  "feedback_action": "inject_risk_tasks",
  "feedback_detail": "Risk mitigation tasks to inject into next /to-plan: [list]",
  "schema_version": "0.1.0"
}
```

---

## Multi-agent execution (RECOMMENDED for thoroughness)

For comprehensive analysis, spawn specialist agents in parallel:

| Agent | Modules | Focus |
|---|---|---|
| **benchmark-analyst** | A1, A5 | Run benchmarks, scalability projection, regression detection |
| **architecture-analyst** | A3, A6 | Dependency graph, coupling metrics, reference comparison |
| **code-analyst** | A2, A4 | Complexity metrics, memory profiling, resource analysis |

Consolidate findings from all agents into a single report.

---

## Feedback loop — what happens after the verdict

The verdict is not advisory — it prescribes a concrete next step in the cycle chain.

| Verdict | `feedback_action` | What Claude Code does next |
|---|---|---|
| `ON_TRACK` | `proceed` | Report archived as baseline. Next milestone proceeds normally via `cycle-roadmap`. |
| `ON_TRACK_WITH_RISKS` | `inject_risk_tasks` | Report includes specific risk mitigation tasks. These MUST be injected as requirements in the next `/to-plan`. The report is cited as prior art (same as a `/discover` blueprint). |
| `COURSE_CORRECTION_NEEDED` | `corrective_plan` | Before any new feature work: run `/to-plan` scoped to the falsified hypotheses. The analysis report becomes the "problem statement" input. Then `/implement` the corrections, re-release, re-run `/analysis`. |
| `FUNDAMENTAL_RETHINK` | `redesign` | Run `/discover-plan` to investigate alternatives. Write ADR documenting empirical evidence of why the current approach fails. Then `/to-plan` for the redesigned architecture. `cycle-roadmap` pauses until the human decides. |
| `INVALID` | `stop` | Surface to human. Fix config/golden-rule before proceeding. |

The analysis report at `knowledge-base/audits/` is referenced by the next iteration's `/to-plan` as **prior art** — the same way `/discover` blueprints feed planning.

---

## Anti-patterns

1. **NEVER fabricate measurements** — every number comes from an actual tool run with subprocess evidence.
2. **NEVER skip hypothesis extraction** — benchmarks without hypotheses are just benchmarking, not analysis.
3. **NEVER compare incomparable baselines** — always note differences in hardware, storage model, workload.
4. **NEVER report a single benchmark run as evidence** — minimum 3 iterations with mean ± std dev.
5. **NEVER treat ON_TRACK_WITH_RISKS as ON_TRACK** — each risk has a documented mitigation.
6. **NEVER run on dirty working tree** — analysis reads stable state only.
7. **NEVER edit source code** — this skill is read-only by contract. Recommendations go in the report.

---

## Rollback

| Artifact | Procedure |
|---|---|
| Analysis report at `knowledge-base/audits/{slug}-analysis-{date}.md` | Delete file; no further state. |
| Baseline files at `{baseline_dir}/` | Delete files; next run creates fresh baseline. |

---

## Cross-references

- Golden rule: [`.claude/rules/analysis-golden-rule.md`](../../rules/analysis-golden-rule.md)
- Config: [`.claude/rules/analysis-config.txt`](../../rules/analysis-config.txt)
- Cycle: [`.claude/rules/cycle-analysis.md`](../../rules/cycle-analysis.md)
- Languages (reused): [`.claude/rules/code-quality-languages.txt`](../../rules/code-quality-languages.txt)
- Sibling (structural gate): [`/code-quality`](../code-quality/SKILL.md)
- Sibling (merge gate): [`/review`](../review/SKILL.md)
