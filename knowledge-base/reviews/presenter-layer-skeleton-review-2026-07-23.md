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
