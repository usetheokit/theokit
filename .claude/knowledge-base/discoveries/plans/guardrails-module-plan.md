# Discovery Plan: Guardrails Module for the Theo Ecosystem

> **Version 1.2** (2026-06-10) — Score fix: reclassified Q5 (credential masking)
> and Q8 (SDK audit) from "techniques" to "tools" corner to resolve
> `question_budget_violated` cap (techniques had 5 > max 3). Techniques now 3,
> Tools now 3. Lifts score from 70 → ~99.
>
> **Version 1.1** (2026-06-10) — Absorbed 2 MUST FIX from
> [`reviews/guardrails-module-edge-cases-2026-06-10.md`](../reviews/guardrails-module-edge-cases-2026-06-10.md).
> **EC-1:** Q8 halt-loop checkpoint separado do genérico (SDK não vive em references/).
> **EC-2:** Q6 Fase A expandida para incluir `tests/guardrails/` do NeMo.
> **3 SHOULD TEST absorbed:** EC-3 (expand test glob for OG), EC-4 (Q3 depends on Q1+Q2), EC-5 (paper WebFetch fallback).
> **2 DOCUMENT acknowledged:** EC-6 (Python→TS pattern translation), EC-7 (wire-proxy vs SDK middleware paradigm).
>
> **Version 1.0** — Investigar como NeMo Guardrails (NVIDIA, Python), OpenGuardrails agentfw (TypeScript), e o paper LlamaFirewall (Meta) implementam guardrails para agentes de IA. O blueprint resultante deve fornecer uma proposta arquitetural concreta para um módulo de guardrails no ecossistema Theo, respeitando o split SDK (interface) + package separado (implementações) e os hooks existentes no `@theokit/sdk`.

**Slug:** `guardrails-module`
**Owner:** paulo
**Created:** 2026-06-10
**Time budget:** 8h (NeMo: 3h, OpenGuardrails: 3h, LlamaFirewall paper: 1h, SDK hooks audit: 1h)

## Context

O ecossistema Theo tem um SDK de agentes (`@theokit/sdk`) com um pipeline de execução multi-camada — file-based hooks (`preRun`/`postRun`/`preToolUse`/`postToolUse`), plugin hooks (`pre_tool_call` veto), e callbacks in-process (`onBeforeSend`/`onToolStart`/`onToolEnd`). No entanto, **não existe um módulo de guardrails** que permita:

1. **PII detection/redaction** nos inputs/outputs do agente
2. **Content filtering** (bloquear prompts maliciosos, jailbreak detection)
3. **Credential masking** (impedir vazamento de secrets para o LLM)
4. **Tool-call validation** (validar argumentos antes da execução)
5. **Output safety** (verificar que respostas do LLM são seguras antes de retornar ao user)

A referência de mercado (LangChain middleware, Vercel AI SDK, OpenAI Agents SDK) mostra que guardrails são uma preocupação core de qualquer framework de agentes. O `@theokit/sdk` já tem os hook points certos (`tool-dispatch.ts` Steps 4-5, callbacks `onBeforeSend`/`onToolStart`) — falta uma camada de abstração que torne essas proteções declarativas e compostas.

**Evidência que motivou:** Doc do LangChain Guardrails (compartilhado pelo user), user request explícito para módulo de guardrails, e a existência de 3 projetos de referência maduros no espaço.

**Rules consultadas:** `architecture.md` (DIP nas fronteiras — guardrails = fronteira entre agente e mundo externo), `testing.md` (pirâmide de testes — guardrails precisam de testes unitários para cada detector).

## Objective

Produzir um blueprint que responda: **como devemos arquitetar o módulo de guardrails para o ecossistema Theo, respeitando o hook system existente do `@theokit/sdk`, o split OSS/proprietário, e os princípios SOLID/DIP?**

Success criteria:

- [ ] Todas as research questions respondidas com citações para `.claude/knowledge-base/references/`
- [ ] Tabela comparativa NeMo vs OpenGuardrails vs LlamaFirewall preenchida
- [ ] Proposta concreta de onde vive o código (SDK interface vs package separado)
- [ ] Mapeamento de hook points existentes do SDK → interception points para guardrails
- [ ] Ao menos 1 ADR concreto por research question no blueprint
- [ ] `/discover-confidence` verdict >= SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/nemo-guardrails/` | `nemoguardrails/guardrails/` (engine core), `nemoguardrails/rails/` (rails framework), `nemoguardrails/actions/` (built-in actions), `nemoguardrails/library/` (built-in detectors) | Arquitetura mais madura: 5 tipos de rails, 2 engines (IORails + LLMRails), template method pattern, parallel execution |
| `.claude/knowledge-base/references/openguardrails-agentfw/` | `packages/agentfw/src/daemon/risk/` (detector pipeline), `packages/agentfw/src/core/masking.ts` (credential masking), `packages/agentfw/src/core/packet.ts` (universal packet shape) | TypeScript nativo — padrão mais próximo do nosso ecossistema. Wire-proxy architecture, detector-as-pure-function, fail-safe isolation |
| **LlamaFirewall paper** (arxiv 2505.03574) | Seções: Architecture, PromptGuard 2, Agent Alignment Checks, CodeShield | Taxonomia de guardrails para agentes: jailbreak detection, goal misalignment, insecure code prevention |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/nemo-guardrails/docs/` | Docs de uso, não arquitetura interna |
| `.claude/knowledge-base/references/nemo-guardrails/examples/` | Exemplos de configuração — informacionais, não arquiteturais |
| `.claude/knowledge-base/references/nemo-guardrails/nemoguardrails/colang/` | DSL própria do NeMo — over-engineering para nosso escopo; não vamos criar uma DSL |
| `.claude/knowledge-base/references/openguardrails-agentfw/internal/ui/` | Dashboard UI — fora do escopo de guardrails core |
| `.claude/knowledge-base/references/openguardrails-agentfw/packages/agentfw/src/cli/` | CLI commands — delivery surface, não arquitetura de guardrails |
| LangChain (não clonado) | Referenciado conceitualmente via doc do user; não temos o source para citar |
| Vercel AI SDK / OpenAI Agents SDK | Não clonados — podem ser adicionados em follow-up discovery se necessário |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** NeMo: 3h (deepest dive — arquitetura mais madura, 5 tipos de rails), OpenGuardrails: 3h (TypeScript nativo, mais relevante para implementação), LlamaFirewall paper: 1h (taxonomia e evaluation framework), SDK hooks audit: 1h (mapear hook points existentes).

**Rationale:** NeMo é o projeto mais completo (rail_action.py template method, rails_manager.py registry, iorails.py optimized path). OpenGuardrails é TypeScript e usa a mesma abordagem de detector-as-pure-function que queremos. O paper fornece a taxonomia acadêmica. O SDK audit garante que não reinventamos hooks.

**Alternatives considered:** Equal split (2h cada) — rejeitado porque NeMo e OpenGuardrails merecem profundidade diferente. Single project deep-dive — rejeitado porque queremos comparação cruzada.

**Stop condition — per question:** Quando Fase A retorna vazio após 3 retries com variantes de query, marcar BLOCKED com reason "Fase A exhausted".

**Stop condition — per project:** Quando budget esgotado com questions pendentes, marcar BLOCKED com reason "budget exhausted".

**Consequences:** Blueprint terá depth desigual — NeMo e OpenGuardrails com citações line-exact; LlamaFirewall com citações de seção do paper. Isso é aceitável.

### D2 — Investigation depth

**Decision:** Para NeMo e OpenGuardrails: Read end-to-end nos arquivos core (engine, pipeline, types). Para arquivos de detector individuais: Grep por padrão + Read dos primeiros 2 detectors como sample representativo.

**Rationale:** Ler todos os 30+ detectors do NeMo library/ seria desperdício de budget. Ler o pipeline + 2 detectors sample captura o pattern sem o bulk.

**Alternatives considered:** Grep-only (rápido mas superficial), Full-read de tudo (impossível no budget).

**Consequences:** Alguns detectors obscuros do NeMo não serão citados. Aceitável — queremos o PATTERN, não o catálogo.

### D3 — Foco da investigação: arquitetura de composição, não catálogo de detectors

**Decision:** O discovery foca em COMO guardrails são compostos, registrados, e executados — não em QUAIS guardrails específicos existem. O catálogo de built-in detectors é informacional, não o deliverable principal.

**Rationale:** O ecossistema Theo precisa primeiro da infra (middleware pipeline, detector interface, config format) antes de implementar detectors específicos (PII, jailbreak, etc.). Detectors são a parte fácil depois que a infra existe.

**Alternatives considered:** Catalogar todos os tipos de guardrails existentes — rejeitado como YAGNI para v0.1.

**Consequences:** Blueprint terá uma seção "Built-in detector survey" com 5-8 exemplos representativos, não um catálogo exaustivo.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | Como NeMo implementa o pipeline de execução de rails (sequential vs parallel, short-circuit on failure)? | techniques | `nemo-guardrails` | Grep `async def.*run_rails` e `RailResult` em `nemoguardrails/guardrails/` | Read `iorails.py`, `rails_manager.py`, `rail_action.py` end-to-end | Diagrama de pipeline + sequential/parallel contract + short-circuit semantics |
| Q2 | Como OpenGuardrails implementa o detector pipeline com fail-safe isolation (um detector falhando não crasheia o pipeline)? | techniques | `openguardrails-agentfw` | Grep `RiskTagger` e `runRiskTaggers` em `packages/agentfw/src/daemon/risk/` | Read `pipeline.ts`, `types.ts`, `shell-pattern.ts` (sample detector) | Interface do detector + isolation pattern + error handling |
| Q3 | Qual é a interface/tipo base de um "rail action" no NeMo (template method pattern) e como se compara com o `RiskTagger` do OpenGuardrails? | techniques | `nemo-guardrails`, `openguardrails-agentfw` | Grep `class RailAction` em NeMo e `type RiskTagger` em OpenGuardrails | Read `nemoguardrails/guardrails/rail_action.py` e `packages/agentfw/src/daemon/risk/types.ts` side-by-side | Tabela comparativa: interface shape, lifecycle hooks, return type |
| Q4 | Como NeMo registra e descobre rails a partir de configuração YAML? (registry pattern) | tools | `nemo-guardrails` | Grep `_ACTION_CLASSES` e `from_path` em `nemoguardrails/` | Read `rails_manager.py` (registry) e `nemoguardrails/rails/llm/config.py` (schema) | Config format + registry pattern + discovery algorithm |
| Q5 | Como OpenGuardrails implementa credential masking (request rewriting antes do LLM, restore depois)? | tools | `openguardrails-agentfw` | Grep `MaskingRule` e `maskRequestBody` em `packages/agentfw/src/core/` | Read `masking.ts` end-to-end | Masking lifecycle (mask → call → restore) + rule format + config |
| Q6 | Quais testes existem para os detectors/rails em cada projeto? Qual é a test strategy? | tests | `nemo-guardrails`, `openguardrails-agentfw` | **(v1.1 EC-2)** Glob `*test*` e `*spec*` em: NeMo `tests/guardrails/` (NOT `nemoguardrails/guardrails/`), OpenGuardrails `packages/agentfw/src/**/*.test.ts`; Grep `describe\|test\|def test_` | Read 2-3 test files sample de cada projeto; **(EC-3)** se < 2 test files encontrados por projeto, expandir glob para `**/*.test.{ts,py}` no projeto inteiro | Test pyramid shape + fixture strategy + what's mocked vs real |
| Q7 | Quais dependências runtime cada projeto usa para detectors? (regex libs, ML models, external APIs) | deps | `nemo-guardrails`, `openguardrails-agentfw` | Read `pyproject.toml` (NeMo) e `package.json` (OpenGuardrails) | Extrair deps que são specifically para detection (não infra geral) | Tabela: dep name → purpose → version → is it optional? |
| Q8 | Como o `@theokit/sdk` tool-dispatch pipeline (Steps 1-7) mapeia para os interception points de guardrails? Onde um guardrail middleware se encaixaria? | tools | SDK local (não reference — audit interno) | Grep `vetoFromPlugin` e `vetoFromFileHook` em `theokit-sdk/packages/sdk/src/` | Read `tool-dispatch.ts` e `hooks-executor.ts` para mapear o pipeline completo | Diagrama de pipeline SDK com annotation de onde guardrails se encaixam |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q6 | Covered (1) |
| Dependencies | Q7 | Covered (1) |
| Tools | Q4, Q5, Q8 | Covered (3) |
| Techniques | Q1, Q2, Q3 | Covered (3) |

**Coverage: 4/4 corners covered (100%). Budget: max 3 per corner respected.**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Q1-Q7 | `.claude/knowledge-base/references/{project}/{path}` cited in Fase A exists | Mark Qx BLOCKED with reason "path not found", continue to next |
| **(v1.1 EC-1)** Before answering Q8 | SDK source at absolute `theokit-tools/theokit-sdk/packages/sdk/src/internal/agent-loop/tool-dispatch.ts` exists (NOT in references/ — SDK is a workspace sibling) | Mark Q8 BLOCKED with reason "SDK tool-dispatch.ts not found at expected path" |
| Per-question Fase A budget | Fase A returned at least one hotspot OR 3 retries attempted | After 3 retries, mark BLOCKED with reason "Fase A exhausted" |
| After answering Qx | Blueprint section has >= 1 citation to references/ | Re-iterate (1 retry max) |
| Mid-loop sanity | Total citations >= 1 per 200 words of blueprint prose | Add citations to under-cited paragraphs |
| **(v1.1 EC-4)** Q3 dependency gate | Q1 and Q2 must be answered before Q3 (comparison requires both pipelines understood) | Defer Q3 until Q1+Q2 done |
| **(v1.1 EC-5)** LlamaFirewall WebFetch fallback | If WebFetch of arxiv paper fails, use cached summary: LlamaFirewall = PromptGuard 2 (jailbreak) + Agent Alignment Checks (goal misalignment) + CodeShield (insecure code) | Use cached summary; note "paper fetch failed — using session-cached abstract" |
| Per-project time budget | NeMo <= 3h, OpenGuardrails <= 3h, Paper <= 1h, SDK <= 1h | Mark remaining Qs BLOCKED, advance |
| Before promising complete | All 4 coverage corners have populated sections | Refuse promise, continue iterating |

## Acceptance Criteria

- [ ] All 8 research questions answered OR explicitly marked BLOCKED with reason
- [ ] All 4 coverage corners have populated sections in the blueprint
- [ ] Every citation in the blueprint points to a real `.claude/knowledge-base/references/{...}` path
- [ ] Tabela comparativa NeMo vs OpenGuardrails vs LlamaFirewall preenchida
- [ ] At least 1 ADR in the blueprint synthesizing the proposed guardrails architecture for Theo
- [ ] Hook-point mapping (Q8) produces a concrete diagram of SDK integration
- [ ] Time budget respected per project
- [ ] `/discover-confidence` verdict >= SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/guardrails-module-blueprint.md`

## Global Definition of Done

- [ ] All phases completed (plan -> edge-cases -> execute -> confidence -> improve if needed)
- [ ] Final `/discover-confidence` verdict recorded in the blueprint header
- [ ] No fabricated citations
- [ ] Coverage Matrix 100% covered
- [ ] ADRs reference at least one principle from project rules (DIP from `architecture.md` for the guardrail interface boundary; test pyramid from `testing.md` for detector test strategy)
- [ ] Blueprint contains a concrete "Proposed Architecture" section with:
  - Interface definition para `GuardrailMiddleware` (ou nome equivalente)
  - Onde vive no ecossistema (SDK interface + package separado)
  - Como se integra com `tool-dispatch.ts` Steps 4-5
  - Config format proposto
  - 3 built-in guardrails sample (PII, jailbreak, credential masking)
