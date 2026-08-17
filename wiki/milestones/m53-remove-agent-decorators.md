---
type: Milestone Run
title: Milestone M53: remove the agent decorators completely
description: The atomic decorator removal, its migration guide and the tests deleted along with the code they covered.
tags: [milestone, decorators, breaking]
status: stable
generated: { by: theokit-agent/unrecorded, at: 2026-07-24T00:00:00Z }
migrated: { by: claude-opus-5/okf-skill, at: 2026-08-06T00:00:00Z, from: knowledge-base/roadmap-runs/M53-2026-07-24.md }
sources:
  - id: origin
    resource: knowledge-base/roadmap-runs/M53-2026-07-24.md
    title: Original document, absorbed into this bundle verbatim
    last_modified: 2026-07-24
# --- keys carried over from the source document ---
milestone_id: M53
slug: remove-agent-decorators
date: 2026-07-24
record_status: completed
migration: MIGRATION.md
audit_table: agents/decorator-to-capability.md
adr: decisions/0002-decorator-removal-scope.md
published: "@theokit/agents@1.0.0, @theokit/http@1.0.0"
checkbox_flipped_at: 2026-07-24
---

# Milestone M53 — Remove the agent decorators COMPLETELY

## DoD — estado item a item

| # | Item | Estado |
|---|---|---|
| 1 | Tabela de auditoria 1:1 dos 28 decorators (hard gate) | ✅ `agents/decorator-to-capability.md` + ADR 0002 |
| 2 | Zero-behavior: testes repontados sem editar expectativa | ✅ com **uma exceção declarada** (abaixo) |
| 3 | `src/decorators/` + `walk-agent-metadata.ts` deletados; grep = 0 | ✅ |
| 4 | `@theokit/http` desacoplado; `reflect-metadata` + flags fora; ESLint ignores removidos | ✅ |
| 5 | Docs + templates + `MIGRATION.md` | ✅ |
| 6 | Gates do monorepo + bump **major** | ⚠️ **parcial — ver Ressalvas** |
| 7 | Dogfood pela API publicada | ✅ live contra provider real |

## Exceção declarada no item 2

Os testes que cobriam **apenas** decorators/walk foram **deletados** com o código que cobriam (18
arquivos + `fixture-equivalence.test.ts`, que era o oráculo do repoint e cumpriu seu papel). Está
previsto no ADR 0002: um teste de metadata removida não afirma nada sobre o produto. Nenhuma
expectativa de teste sobrevivente foi editada.

## Ressalvas honestas (item 6)

O DoD pedia "full monorepo green". O estado real:

- `pnpm test` do monorepo: **13 falhas, todas PRÉ-EXISTENTES**. Comprovado empiricamente rodando os
  mesmos arquivos num git worktree no commit anterior ao milestone (`562c706e`). São sobre
  `@theokit/ui` peer ranges, `sdk-peer-ranges`, `pnpm-11-compat`, um fixture de template
  desatualizado e o `harness-invariant-guard`. **Exatamente uma** falha foi causada pelo M53 (o
  guard do DAG, que checava a forma antiga da ponte dinâmica) e foi corrigida.
- `check:direction`: **falha por violação pré-existente** — `@theokit/tauri` depende do principal
  `theokit` (viola ADR 0030), desde `fa173b91`. Corrigir exige mover `streamAgentTurnInProcess` +
  `client/core` para sub-pacotes: refactor arquitetural fora do escopo deste milestone.
- `theokit@0.43.10` **não foi publicado**: `pnpm publish` local falha em provenance
  (`provider: null` — exige CI). Consequência prática medida no dogfood: consumidores que instalam
  `@theokit/agents@1.0.0` junto do `theokit` publicado (0.43.7, que pede `^0.44.6`) ficam com **duas
  cópias** do pacote. Fecha quando o CI publicar o `theokit`.
- `validate:publint`: ✅ verde.

## Defeito encontrado pelo dogfood

**usetheodev/theokit#145** — uma toolbox com `namespace` compila para `ns.tool`, e o SDK rejeita o
ponto (`/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/`). Um caminho **documentado** que nunca funcionou contra um
provider real, invisível às suítes do framework porque elas mockam o `@theokit/sdk`. Pré-existente
(desde `74a4c9ed`), alto impacto.

## Dois defeitos corrigidos no caminho

1. **Todo agente servido por HTTP rodava no modelo de fallback** — `@Agent({ model })` e `llmModel`
   eram descartados (passava-se `walk` onde se esperava `compiled`, através de um import dinâmico
   sem tipo). Nada pegava porque o ramo de agentes do `TheoApp` **não tinha teste algum**:
   `@theokit/agents` não era sequer declarado no `package.json` do `@theokit/http`.
2. **Validação de fronteira faltante no `skills-resolver`** — validava o formato do retorno do
   resolver, não os itens; `[42, null]` chegaria ao `Agent.create` como "skill names".

## Publicado

`@theokit/agents@1.0.0` e `@theokit/http@1.0.0` (major, breaking documentado em `MIGRATION.md`).

# Related
* [capability-oo-design-spike](/blueprints/capability-oo-design-spike.md) — the design spike.
* [0001-capability-patterns-budget](/decisions/0001-capability-patterns-budget.md) — the patterns budget.
* [capability-core](/plans/capability-core.md) — the implementation plan.
* [0002-decorator-removal-scope](/decisions/0002-decorator-removal-scope.md) — the per-decorator disposition.
* [decorator-to-capability](/agents/decorator-to-capability.md) — the decorator-to-capability audit.

