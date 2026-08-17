# Discover-Plan-Confidence Score — theokit-arch-gaps-investigation

**Date:** 2026-06-06
**Plan analyzed:** `.claude/knowledge-base/discoveries/plans/theokit-arch-gaps-investigation-plan.md` (v1.1)
**Skill:** `/discover-plan-confidence`
**Calibration:** PROVISIONAL_v1 (SOTA defaults, sem holdout calibration)

## Verdict

**SHIPPABLE** — final_score **99.5/100**

| Field | Value |
|---|---|
| Weighted average | 99.5 |
| Final score after caps | 99.5 |
| Hard caps triggered | 0 |
| Bands aplicáveis | SHIPPABLE ≥ 90 |

## Per-dimension scores

| Dimension | Score | Weight | Contribution |
|---|---|---|---|
| research_coverage | 100.0 | 0.30 | 30.0 |
| reference_citations | 100.0 | 0.30 | 30.0 |
| plan_completeness | 100.0 | 0.25 | 25.0 |
| structural_risk | 97.0 | 0.15 | 14.55 |
| **Total** | — | 1.00 | **99.55** |

## Per-dimension detail

### research_coverage (100.0)
- ✓ Corner `tests` populated (1 Q — Q7)
- ✓ Corner `deps` populated (1 Q — Q4)
- ✓ Corner `tools` populated (2 Qs — Q5, Q6)
- ✓ Corner `techniques` populated (3 Qs — Q1, Q2, Q3)

Cobertura: 4/4 corners. Distribuição respeita max 3 / min 1 per corner.

### reference_citations (100.0)
- ✓ 46 verified `.claude/knowledge-base/references/` citations
- ✓ 0 fabricated paths

### plan_completeness (100.0)
- ✓ 10/10 mandatory sections present (Header, Context, Objective, In-Scope, ADRs, Research Questions, Coverage Matrix, Halt-loop Checkpoints, Acceptance Criteria, Global Definition of Done)
- ✓ 4 ADRs found (D1 budget, D2 scope of refs, D3 depth, D4 invariant check)
- ✓ Every Q has Fase A + Fase B populated
- ✓ Question budget respected (7 questions; max 15; min 5)

### structural_risk (97.0)
- ⚠ Detractor: `weak_imperatives: 1 hit` — 1 ocorrência de linguagem fraca ("devemos" / "talvez" / "considerar") em algum lugar do plano. Não bloqueia. Recomendação: revisar quando tiver tempo.

## Calibration warning

O orchestrator emite:
> `WARN: PROVISIONAL_v1 calibration — score bands are SOTA defaults, not yet calibrated against project holdout.`

Significa: as bandas (90/70/50) são defaults SOTA não calibrados contra histórico do projeto (holdout target=30). Não invalida o verdict; apenas declara que a calibração ainda não é empírica.

## Trajetória do score (debugging history)

| Iteração | Verdict | Score | Hard caps |
|---|---|---|---|
| Initial v1.0 | INVALID | 49.0 | empty_corner_tests, fabricated_citation, question_budget_violated |
| v1.0 + EC fixes (v1.1) | INVALID | 49.0 | empty_corner_tests, fabricated_citation, question_budget_violated |
| v1.1 + `plugin-*.js` → explicit paths | INVALID | 49.0 | empty_corner_tests, question_budget_violated |
| v1.1 + Coverage Matrix vocab fix | INVALID | 49.0 | empty_corner_tests, question_budget_violated |
| v1.1 + Q7 corner cell `integration tests` → `tests` | INVALID (bug) | 99.5 | (none) |
| v1.1 + thresholds.txt `=` → `\|` delimiter fix | **SHIPPABLE** | **99.5** | (none) |

**3 issues encontrados e corrigidos durante scoring:**

1. **Plan content:** Coverage Matrix usava vocabulário humano (`Integration tests`) — corrigido para vocabulário do checker (`tests`).
2. **Plan content:** Citation `fastify/lib/plugin-*.js` tinha wildcard que o regex truncava. Substituído por paths explícitos.
3. **Plugin infrastructure bug (DEAL-WITH-IN-FEEDBACK):** o arquivo `.claude/rules/discover-plan-thresholds.txt` usava `=` como delimitador mas o parser `_parse_thresholds` usa `split("|")`. Arquivo reescrito com `|` delimiter + nomes de bands corrigidos (`band.shippable` → `SHIPPABLE`).

## Próximo passo no cycle-discover

Plan SHIPPABLE → autorizado seguir para:

```
/discover-execute theokit-arch-gaps-investigation
```

Per `cycle-discover.md`, `/discover-execute` produz o blueprint real em `.claude/knowledge-base/discoveries/blueprints/theokit-arch-gaps-investigation-blueprint.md` rodando o halt-loop por todas as 7 questions respeitando os 13 halt-loop checkpoints (7 originais + EC-3 order constraint + EC-4 a EC-8 budgets).

## Artifacts

- Plan (v1.1): `.claude/knowledge-base/discoveries/plans/theokit-arch-gaps-investigation-plan.md`
- Edge-case review: `.claude/knowledge-base/reviews/theokit-arch-gaps-investigation-edge-cases-2026-06-05.md`
- Score JSON: `.claude/knowledge-base/reviews/theokit-arch-gaps-investigation-discover-plan-confidence-2026-06-06.json`
- This MD report
