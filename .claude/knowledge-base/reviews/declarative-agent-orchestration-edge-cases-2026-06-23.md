# Discover Edge Case Review — declarative-agent-orchestration

Date: 2026-06-23
Discovery plan analyzed: `.claude/knowledge-base/discoveries/plans/declarative-agent-orchestration-plan.md`
Research questions analyzed: 7
Edge cases found: 6 (MUST FIX: 2, SHOULD TEST: 2, DOCUMENT: 2)

## MUST FIX

### EC-1: Spring AI sobrecarregado vs orçamento (4 questões em 3h; Mastra 2 questões em 3h)
- **Affected question:** Q1, Q2, Q4, Q7 (todas Spring AI) vs Q3, Q5 (Mastra)
- **Family:** Method (time budget)
- **Scenario:** Durante `/discover-execute`, o orçamento de 3h do Spring AI se esgota com 4 questões verbosas em Java (builder + advisor api + advisor test + auto-config), enquanto o Mastra tem 3h para só 2 questões. Spring questions ficam BLOCKED por "budget exhausted" prematuramente.
- **Impact:** Blueprint com seções Spring incompletas → recomendação de builder/strategy mal-ancorada (o eixo "Spring Boot" que o owner pediu fica fraco).
- **Suggested fix:** Rebalancear ADR D1 para **Spring AI 4h · Mastra 2h · in-repo 1h** (Mastra tem menos questões e TS é mais rápido de ler).

### EC-2: Q3 mira `tool-loop-agent` do Mastra, que é alpha (1.46.0-alpha.3) — pode ser experimental, não o loop canônico
- **Affected question:** Q3
- **Family:** Reference path / Interpretation
- **Scenario:** `@mastra/core@1.46.0-alpha.3` é alpha; `tool-loop-agent/` pode ser um módulo experimental, não a máquina de loop canônica (que talvez viva em `packages/core/src/agent/`). O blueprint extrairia um padrão de um módulo instável.
- **Impact:** `LoopStrategy` modelada sobre um experimento → recomendação não-representativa.
- **Suggested fix:** Q3 Fase A faz cross-check em `.claude/knowledge-base/references/mastra/packages/core/src/agent/index.ts` para confirmar se `tool-loop-agent` é o loop canônico; se for experimental, ler `agent/` como fonte primária.

## SHOULD TEST

### EC-3: Portabilidade Java→TS (Q1/Q2) — capturar o CONTRATO, não o idioma Java
- **Affected question:** Q1, Q2
- **Suggested halt-loop checkpoint:** Na Fase B das questões Spring AI, capturar o contrato **language-agnostic** (o que o builder/advisor garante) e **marcar explicitamente mecanismos Java-only** (anotações, `ApplicationContext`, overloading) como NÃO-portáveis — não recomendá-los para o TS.

### EC-4: Analogia "Advisor = Strategy" pode super-mapear (Advisor é interceptor por-call; nossa necessidade é multi-round)
- **Affected question:** Q2
- **Suggested halt-loop checkpoint:** Q2 deve registrar **onde a analogia quebra**: o `Advisor` do Spring é um interceptor around-a-single-call (mais middleware); o nosso `LoopStrategy` decide entre rounds. Capturar a diferença evita recomendar um contrato per-call para um problema multi-round.

## DOCUMENT

### EC-5: Citações in-tree (ADR D3) não são validadas pelo checker do `/discover-confidence`
- **Accepted risk:** O `check_reference_citations.py` só valida paths sob `.claude/knowledge-base/references/`. Citações in-tree `packages/agents/...` (permitidas por ADR D3) não são verificadas pelo gate — dependem de leitura humana no `/review` downstream. Risco baixo (paths já confirmados no V4-A); aceito e já declarado em ADR D3.

### EC-6: Versão dos clones não fixada no plano (clonados 2026-06-23, HEAD `--depth 1`)
- **Accepted risk:** spring-ai e mastra foram clonados shallow no HEAD de 2026-06-23. O discovery é point-in-time por natureza; se o blueprint for re-executado meses depois, os paths podem driftar (o próprio template alerta "paths may drift"). Aceito — registrar a data de clone basta.

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 1 | 0 (compartilha EC-1) | 1 (EC-3) | 0 |
| Q2 | 2 | 0 (compartilha EC-1) | 1 (EC-4) | 0 |
| Q3 | 1 | 1 (EC-2) | 0 | 0 |
| Q4 | 0 (compartilha EC-1) | — | — | — |
| Q7 | 0 (compartilha EC-1) | — | — | — |
| (plano) | 2 | 1 (EC-1, budget) | 0 | 2 (EC-5, EC-6) |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT (2 MUST FIX — rebalancear budget + cross-check do tool-loop-agent)
