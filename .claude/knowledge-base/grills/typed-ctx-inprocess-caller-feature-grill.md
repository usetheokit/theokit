---
slug: typed-ctx-inprocess-caller
generated_by: roadmap-feature
milestone_id: M33
date: 2026-07-08
status: completed
source: .claude/knowledge-base/discoveries/blueprints/universal-handler-architecture-blueprint.md
out_of_scope_overlap_false_positive: "Reimplementing the agent loop / own multi-agent orchestration — NOT contradicted; M33 concerns transport/exposure of app logic, resolved formally by M32's ADR (framework-core transport vs SDK agent runtime, per ADR-0040)."
---

# Grill — typed-ctx-inprocess-caller (M33 — Phase 1 — Typed-ctx reconciliation + in-process caller)

## Q1 — What + why now
Synthesized from the universal-handler deep-research blueprint (12-cluster study, 4 adversarial critics; 4/5 original recommendations REFUTED). M33 encodes the *narrower verdict-adjusted* design that survived. Owner GOLD GOAL: "TUI / MCP / Tauri são superfícies autorizadas do framework-core." Why now: the framework must serve a conventional app (login/cadastro/CRUD) AND the multi-surface agent app from ONE construction; the deep research surfaced the blocking gaps + a code-verified security hole (#97).

## Q2 — Dependencies
See the milestone header in ROADMAP.md (M32→M31; M33→M32; M34→M32,M33).

## Q3 — Definition of done
See the milestone DoD in ROADMAP.md — every bullet is evidence-cited (blueprint section + code file:line + ADR).

## Q4 — Top 2 new risks
See the milestone "Top risks (new)" in ROADMAP.md.
