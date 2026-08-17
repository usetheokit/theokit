---
type: Milestone Run
title: Milestone M54: open the LoopStrategy seam
description: Closing the runner's OCP asymmetry so the stop criterion is injectable like the other three axes.
tags: [milestone, runner, ocp]
status: stable
generated: { by: theokit-agent/unrecorded, at: 2026-07-24T00:00:00Z }
migrated: { by: claude-opus-5/okf-skill, at: 2026-08-06T00:00:00Z, from: knowledge-base/roadmap-runs/M54-2026-07-24.md }
sources:
  - id: origin
    resource: knowledge-base/roadmap-runs/M54-2026-07-24.md
    title: Original document, absorbed into this bundle verbatim
    last_modified: 2026-07-24
# --- keys carried over from the source document ---
milestone_id: M54
slug: loop-strategy-seam
date: 2026-07-24
record_status: completed
grill: grills/loop-strategy-seam.md
blueprint: blueprints/loop-strategy-seam.md
plan: plans/loop-strategy-seam.md
adr: decisions/0004-loop-strategy-seam.md
review: reviews/loop-strategy-seam-2026-07-24.md
release: '@theokit/agents@3.0.0'
pr: https://github.com/usetheodev/theokit/pull/150
merge_commit_sha: ec3bcb588e7688a5e95733cfde1945438a558a4e
checkbox_flipped_at: 2026-07-24T18:55:00Z
---

# Milestone M54 — Abrir o seam de `LoopStrategy` (critério de parada injetável, OCP)

## Objective (do)

Fechar a assimetria de OCP do `AgentRunner`: três dos quatro eixos de comportamento já aceitavam
injeção (reflexão, compactação, produção do round); o critério de parada era o único trancado
(`z.enum` de 3 nomes). Abrir por composição (Strategy), nunca por herança (ADR-0001).

## Outcome

Entregue com o **bottleneck real identificado pela discovery e tratado sem workaround**: abrir o seam
exigia **mover o teto de terminação para o runner**. Antes, o loop era `while (!signal?.aborted)` e as
3 built-in embutiam `round < maxIterations` no próprio `shouldContinue` — o teto era convenção de cada
estratégia, não garantia do runner. Uma custom `() => true` rodaria para sempre. Abrir o seam sem
isso seria o workaround que o goal proíbe. Prior art `opencode` (`prompt.ts:1178`) confirmou o design.

## O ciclo achou 3 defeitos, todos corrigidos antes do release

1. **O compilador forçou** o fix do ponto de quebra que a discovery previu: com `.name` relaxado para
   `string`, a re-resolução por nome em `stream()` deixou de tipar — exatamente onde uma custom
   crasharia (`resolveLoopStrategy(name)` com nome fora do `z.enum`).
2. **F-1 (BLOCKER, review adversarial):** `maxIterations: Infinity` numa custom escapava do
   `z.number().int().min(1)` das built-in → `round < Infinity` sempre true → loop infinito (o agente
   reproduziu: worker a 100% CPU, 3.2 GB RSS, 2+ min). Corrigido com validação na autoria
   (`assertValidCustomLoopStrategy`, mesma regra SSoT das built-in).
3. **F-2 (HIGH, review adversarial):** `{ ...loop, maxIterations }` descartava `shouldContinue` de uma
   custom implementada como **instância de classe** (método no prototype, não own property) — o shape
   idiomático do Strategy. Todos os testes usavam object literal, que escondia o bug. O ADR D4
   **afirmava** que o `shouldContinue` sobrevive — era falso. Corrigido com `Object.create` +
   `Object.assign` (preserva o prototype); teste de regressão com custom de classe.

O review (F-3) também apontou que o type-break de `LoopStrategy.name` (union→string) merecia **major**,
não minor — corrigido (bump 2.1.0 → 3.0.0, sem publicar o minor errado).

## Evidência

| Gate | Resultado |
|---|---|
| `vitest` (agents) | 608 passed, 3 skipped, 92 arquivos |
| `vitest` (http) | 411 passed, 56 arquivos |
| Live contra provider real | custom `while-tool-calling` rodou 2 rounds, runner limitou no teto (`max(rounds)=2`), terminou limpo |
| Dogfood contra o pacote **publicado** | 3/3 — seam + F-1 (Infinity rejeitado) + F-2 (custom de classe preserva shouldContinue), fora do monorepo |
| `tsc` / `eslint --max-warnings=0` / `knip` / `check:direction` | limpos |
| Zero-behavior | 3 built-in idênticas, zero expectativa editada (confirmado independentemente pelo review, F-5) |

`@theokit/agents@3.0.0` publicado; o bump não cascateou (`http` em 1.0.0, `theo` via `workspace:^`).

## Zero-behavior — a prova mais forte do milestone

O termo `&& round < loop.maxIterations` adicionado à condição do loop é **matematicamente
redundante** para as 3 built-in: `shouldContinue(o) && (round < max)` é idêntico a `shouldContinue(o)`
porque as 3 já embutem `round < max` (e `outcome.round` é o mesmo `round` local). `A && A = A`.
Provado por simulação exaustiva (todos os rounds de 1 a max+1, para os 3) no plano, e confirmado pela
suíte passando com **zero expectativa editada** e pelo próprio agente de review.

## Este era o último milestone aberto — ROADMAP 57/57

Com o flip do M54, o do theokit atinge **ROADMAP_COMPLETED**: todos os 57 milestones
(M0–M56) marcados `[x]`.

# Related
* [loop-strategy-seam](/grills/loop-strategy-seam.md) — the scope questions.
* [loop-strategy-seam](/blueprints/loop-strategy-seam.md) — the research blueprint.
* [loop-strategy-seam](/plans/loop-strategy-seam.md) — the implementation plan.
* [loop-strategy-seam-deps-audit-2026-07-24](/reviews/loop-strategy-seam-deps-audit-2026-07-24.md) — the dependency audit.
* [0004-loop-strategy-seam](/decisions/0004-loop-strategy-seam.md) — the decision.
* [loop-strategy-seam-2026-07-24](/reviews/loop-strategy-seam-2026-07-24.md) — the merge review.

