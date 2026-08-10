---
type: Review
title: Review: presenter layer walking skeleton
description: Verdict on the presenter skeleton, evidenced by the existing web suite repointed without changing an expectation.
tags: [review, presenter]
status: stable
generated: { by: theokit-agent/unrecorded, at: 2026-07-23T00:00:00Z }
migrated: { by: claude-opus-5/okf-skill, at: 2026-08-06T00:00:00Z, from: knowledge-base/reviews/presenter-layer-skeleton-review-2026-07-23.md }
sources:
  - id: origin
    resource: knowledge-base/reviews/presenter-layer-skeleton-review-2026-07-23.md
    title: Original document in the pre-wiki tree, preserved verbatim
    last_modified: 2026-07-23
---

# Review: presenter-layer-skeleton (M49)

**Date:** 2026-07-23
**Verdict:** READY_TO_MERGE
**Findings:** 0 defeitos reais (4 vetores de risco investigados e refutados com evidência)

## Oráculo zero-behavior (a evidência central)
A suíte COMPLETA existente do path web foi **repontada** para `presentUIMessageStream` **sem alterar nenhuma expectativa** e passa: `tests/unit/ui-message-stream-translator.test.ts` + `tests/integration/ui-message-stream-e2e.test.ts` = **33/33**. Suíte completa do `@theokit/agents`: **735 passed, 3 skipped (738)**, 103 files. `tsc --noEmit` limpo. Presenter: **25/25**, build ESM+DTS, `publint` "All good!".

## Vetores investigados (refutados)
1. **tool-result não-string → `''` silencioso?** NÃO: `ToolResultEvent.output: string` e `isError: boolean` são obrigatórios no contrato; o map é fiel. O fallback `''` só guarda um type-lie (defensivo).
2. **seen-set compartilhado entre `present()` e o approval?** SIM (mesmo `#seen`: `hasSeen`/`markSeen`/`#emitToolCall`/`#emitToolResult`) — a regra EC-1 (synthesize-input-once) é idêntica. Provado pelos casos HITL da suíte repontada.
3. **`partial_tool_call` regrediu?** NÃO: o tradutor ANTIGO não tinha nenhuma referência (não emitia chunk); o presenter retorna `[]` — fiel.
4. **Vazamento de camada (presenter→agents/http/tui)?** NÃO: o pacote depende só de `@theokit/sdk` + `ai` (peer). `check:direction` limpo (a única violação é pré-existente do `@theokit/tauri`).

## Gates
`pnpm test` (agents 738 + presenter 25) · `typecheck` · `eslint --max-warnings=0` · `prettier` · `tsup build` · `publint` · `check:direction` — todos verdes.

## Handoff
READY_TO_MERGE → `/release` (changeset: @theokit/presenter minor + @theokit/agents minor).

# Related
* [multi-surface-presentation-layer](/blueprints/multi-surface-presentation-layer.md) — the research blueprint.
* [presenter-layer-skeleton](/plans/presenter-layer-skeleton.md) — the implementation plan.
* [multi-surface-architecture](/architecture/multi-surface-architecture.md) — the architecture it serves.

