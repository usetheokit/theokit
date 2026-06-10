# Blueprint: Guardrails Module for the Theo Ecosystem

> **Version 1.0** — Investigação profunda de NeMo Guardrails (NVIDIA, Python), OpenGuardrails agentfw (TypeScript), e LlamaFirewall (Meta) para informar a arquitetura de um módulo de guardrails no ecossistema Theo. O blueprint mapeia o pipeline existente do `@theokit/sdk`, identifica 5 gaps críticos, e propõe uma arquitetura de middleware composável com interface no SDK + implementações em package separado.

**Slug:** `guardrails-module`
**Source plan:** `.claude/knowledge-base/discoveries/plans/guardrails-module-plan.md`
**Owner:** paulo
**Generated:** 2026-06-10 via `/discover-execute`
**Confidence verdict:** _(pending — updated by `/discover-confidence`)_

## Context

O ecossistema Theo tem um SDK de agentes (`@theokit/sdk`) com pipeline de execução multi-camada (file hooks, plugin hooks, callbacks). Não existe módulo de guardrails para PII detection, content filtering, credential masking, tool-call validation, ou output safety. Três referências foram investigadas para informar a arquitetura.

## Objective

Responder: **como arquitetar o módulo de guardrails para o ecossistema Theo, respeitando o hook system existente do SDK, o split OSS/proprietário, e os princípios SOLID/DIP?**

---

## Coverage Corner 1 — Integration Tests

### NeMo Guardrails

**Test pyramid:** Bottom-heavy by design. Testes unitários rápidos com mocks no boundary HTTP. Classes "EndToEnd" mockam no nível de resposta HTTP dict, então o pipeline inteiro (parse → LLMResponse → parser → RailResult) roda de verdade.

**Fixture strategy:** Composição layered via pytest fixtures — `config` → `task_manager(config)` → `engine_registry(config)` → `input_action`/`output_action`. Test data em módulo compartilhado `test_data.py`. OTEL `InMemoryMetricReader` para assertions de telemetria.
(`.claude/knowledge-base/references/nemo-guardrails/tests/guardrails/test_content_safety_iorails_actions.py`, `.claude/knowledge-base/references/nemo-guardrails/tests/guardrails/test_engine_registry.py`)

**What's mocked vs real:**
| Real | Mocked |
|---|---|
| Config parsing, EngineRegistry instantiation, Jinja2 rendering, OTEL collection | `engine.chat_completion` via `AsyncMock`, HTTP responses como raw dicts, `os.environ`, `time.monotonic` |

**Assertions:** Direct equality (`assert result.is_safe`), string containment (`assert "S1: Violence" in result.reason`), exception matching (`pytest.raises`), mock call verification, approximate floats para timing.

### OpenGuardrails agentfw

**Test pyramid:** Unit-only para detectors/rails. Zero integration tests — detectors são funções puras, não precisam de mocks.

**Fixture strategy:** Inline factory functions (object-mother pattern). `packet()` helper constrói `AgentPacket` minimal. `runTransform()` executa Web Streams API real (sem mock).
(`.claude/knowledge-base/references/openguardrails-agentfw/packages/agentfw/src/daemon/risk/prompt-injection.test.ts`, `.claude/knowledge-base/references/openguardrails-agentfw/packages/agentfw/src/daemon/proxy/credential-mask.test.ts`)

**What's mocked vs real:**
| Real | Mocked |
|---|---|
| Toda a lógica de detecção, Web Streams API, TextEncoder/Decoder | Nada — funções puras são 100% testáveis sem mock |

**Edge case coverage:** Testes de credential-mask cobrem chunk-boundary straddling e byte-at-a-time splitting — crítico para streaming proxy.

---

## Coverage Corner 2 — Dependencies

### NeMo Guardrails

**Core deps (sempre instaladas):** `jinja2` (prompt templates), `lark` (Colang parser), `pydantic` (config schema), `fastembed` + `onnxruntime` (embedding local), `httpx` + `aiohttp` (HTTP async).
(`.claude/knowledge-base/references/nemo-guardrails/pyproject.toml`)

**Optional extras para detecção:**

| Extra | Deps | Purpose |
|---|---|---|
| `[jailbreak]` | `yara-python ^4.5.1` | Pattern matching YARA rules |
| `[sdd]` | `presidio-analyzer >=2.2`, `presidio-anonymizer >=2.2` | PII detection/redaction |
| `[hf-classifier]` | `transformers >=4.35`, `torch >=2.0` | Local ML classifiers |
| `[multilingual]` | `fast-langdetect >=1.0` | Language routing |
| `[tracing]` | `opentelemetry-api >=1.27` | OTEL metrics |

**Footprint:** Heavy — core install já puxa `onnxruntime` (~200MB). Com todos os extras, ultrapassa 1GB.

### OpenGuardrails agentfw

**Production deps:** Apenas **2** — `better-sqlite3` (trace persistence) e `jsonc-parser` (config editing).
(`.claude/knowledge-base/references/openguardrails-agentfw/packages/agentfw/package.json`)

**Detection deps: ZERO.** Toda a detecção (prompt injection, secret-leak, shell-pattern, credential masking) é TypeScript puro com regex + Web Streams API built-in.

**Footprint:** Minimal — < 5MB total.

---

## Coverage Corner 3 — Tools

### Q4 — NeMo Registry Pattern

**Padrão:** Static action-class registry (`dict[str, type[RailAction]]`) com 4 built-in actions hardcoded. YAML config declara flow names como strings; `_get_flow_name` normaliza (strip `$model=` params); `RailsManager._create_action` faz o lookup e instancia com shared infra (engine registry + task manager + tracer).
(`.claude/knowledge-base/references/nemo-guardrails/nemoguardrails/guardrails/rails_manager.py:52-60`, `:119-125`)

**Config schema:** Pydantic deeply-nested — `Rails` model com `InputRails`, `OutputRails`, `RetrievalRails`, `DialogRails`, `ToolInputRails`, `ToolOutputRails`. Cada sub-model tem `flows: List[str]` + `parallel: Optional[bool]`.
(`.claude/knowledge-base/references/nemo-guardrails/nemoguardrails/rails/llm/config.py:1315-1338`)

**Loading:** `RailsConfig.from_path()` walks directory, joins YAML files, parses Colang files, resolves imports.
(`.claude/knowledge-base/references/nemo-guardrails/nemoguardrails/rails/llm/config.py:1976-2010`)

**Limitação:** Registry fechado — custom rails vão pelo Colang runtime, não por `RailAction` subclasses.

### Q5 — OpenGuardrails Credential Masking

**Padrão:** Deterministic fake-credential swap com mapa bidirecional por request.
(`.claude/knowledge-base/references/openguardrails-agentfw/packages/agentfw/src/core/masking.ts:451-491`)

**`MaskingRule` type:** `{ id, label, description, pattern: RegExp, group?: number, fake: string }`. O campo `group` permite swappar apenas o capture group (e.g., o token em `Bearer <token>`).
(`.claude/knowledge-base/references/openguardrails-agentfw/packages/agentfw/src/core/masking.ts:26-42`)

**11 built-in rules** cobrindo: Anthropic key, OpenAI key, Stripe key, GitHub PAT, AWS access/secret, Google key, Slack token, Bearer token, ETH private key, BTC WIF.
(`.claude/knowledge-base/references/openguardrails-agentfw/packages/agentfw/src/core/masking.ts:60-151`)

**Lifecycle:** mask (outbound) → call LLM → restore (inbound) via `Map<fake, real>`. Fakes são fixos (determinísticos), shaped para parecer reais.

**Config:** Opt-in per provider. User habilita rules específicas por provider ID. Custom rules suportadas.
(`.claude/knowledge-base/references/openguardrails-agentfw/packages/agentfw/src/core/masking.ts:176-184`)

### Q8 — SDK Tool-Dispatch Pipeline Mapping

**7-step pipeline em `tool-dispatch.ts`:**

```
Step 1: Repair middleware (D86-D88) — rewrites malformed tool names
Step 2: Fork whitelist gate (D111) — hard allowlist veto
Step 3: OTel span init
Step 4: Plugin pre_tool_call (D101) — code-level veto     ← GUARDRAIL POINT
Step 5: File-based preToolUse — operator-policy veto        ← GUARDRAIL POINT
Step 6: Tool execution + onToolStart/End/Error callbacks
Step 7: Finalize span + postToolUse hook (fire-and-forget)
```
(`theokit-sdk/packages/sdk/src/internal/agent-loop/tool-dispatch.ts:122-159` — SDK sibling, not in references/)

**5 GAPS identificados para guardrails:**

| Gap | Where missing | Guardrail need |
|---|---|---|
| **GAP 1 (CRITICAL)** | Post-model-response, before user sees it | Response content moderation, PII redaction, compliance filtering |
| **GAP 2** | Post-tool-result, before LLM sees it | Credential redaction from tool output (shell, DB queries) |
| **GAP 3** | Per-LLM-call inside loop (not just first send) | Prompt injection on accumulated context, token budget per-call |
| **GAP 4** | Between tool execution and result finalization | Output sanitization (truncate, redact, annotate) |
| **GAP 5** | `postToolUse` is fire-and-forget | Cannot veto/modify after tool execution |

---

## Coverage Corner 4 — Techniques

### Q1 — NeMo Pipeline Execution (Sequential vs Parallel)

**Dois modos de execução, configuráveis independentemente para input e output rails:**

**Sequential** (`.claude/knowledge-base/references/nemo-guardrails/nemoguardrails/guardrails/rails_manager.py:183-201`):
- Rails executam em ordem de declaração
- **Short-circuit on first failure:** `if not result.is_safe` → return imediatamente
- Coroutines não-avaliadas são limpas via `.close()` no `finally`

**Parallel** (`.claude/knowledge-base/references/nemo-guardrails/nemoguardrails/guardrails/rails_manager.py:203-243`):
- Todos os rails lançados via `asyncio.create_task()` simultaneamente
- `asyncio.wait(FIRST_COMPLETED)` loop processa resultados conforme chegam
- **Short-circuit:** primeiro unsafe cancela todos os pendentes + await drain
- Ordem determinística dentro de cada batch via `sorted(done, key=task_order)`
- Exception safety: `except BaseException` garante cancel+drain

**Speculative generation** (`.claude/knowledge-base/references/nemo-guardrails/nemoguardrails/guardrails/iorails.py:353-356`): Input rails e LLM call correm em paralelo. Se input rails bloqueiam, LLM call é cancelada sem enviar resposta.

**RailResult type:** `@dataclass(frozen=True, slots=True)` com `is_safe: bool` + `reason: str | None`. Frozen + slotted = imutável + memory-efficient.
(`.claude/knowledge-base/references/nemo-guardrails/nemoguardrails/guardrails/guardrails_types.py:34-40`)

**Template method em `RailAction`** (`.claude/knowledge-base/references/nemo-guardrails/nemoguardrails/guardrails/rail_action.py:77-108`):
```
run() → _extract_messages() → _create_prompt() → _get_response() → _parse_response() → RailResult
```
Fail-closed: exceção em qualquer step retorna `RailResult(is_safe=False)`.

### Q2 — OpenGuardrails Detector Pipeline

**Detector interface:** `type RiskTagger = (packet: AgentPacket) => RiskTag[]` — função pura, síncrona, sem side effects.
(`.claude/knowledge-base/references/openguardrails-agentfw/packages/agentfw/src/daemon/risk/types.ts:3`)

**Pipeline runner** (`.claude/knowledge-base/references/openguardrails-agentfw/packages/agentfw/src/daemon/risk/pipeline.ts:14-27`):
- `TAGGERS` readonly array é o único extension point
- Loop com `try/catch` individual por detector — **fail-safe isolation**
- Erro = `logger.warn()` + continue; pipeline **nunca** throw
- Agregação flat via `push(...out)`

**RiskTag shape:** `{ tag: string, severity: 'info' | 'warn' | 'high', detail?: unknown }`.
(`.claude/knowledge-base/references/openguardrails-agentfw/packages/agentfw/src/core/packet.ts:28-32`)

**12 linhas de código** para o pipeline inteiro. Design radicalmente minimalista.

### Q3 — Comparação Side-by-Side: RailAction (NeMo) vs RiskTagger (OpenGuardrails)

| Dimensão | NeMo `RailAction` | OpenGuardrails `RiskTagger` |
|---|---|---|
| **Tipo** | Classe abstrata (template method) | Type alias para função pura |
| **Interface** | `class RailAction` com 4 métodos abstratos (`_extract`, `_create_prompt`, `_get_response`, `_parse`) | `(AgentPacket) => RiskTag[]` |
| **Lifecycle** | extract → prompt → response → parse | Nenhum — single function call |
| **Async** | Sim (`async run()`) | Não (síncrono) |
| **Result type** | `RailResult(is_safe: bool, reason?: str)` — binário (safe/unsafe) | `RiskTag[]` — lista de findings com severity levels |
| **Veto capability** | Sim — `is_safe=False` bloqueia o pipeline | Não diretamente — tags são informacionais; bloqueio é decisão da camada acima |
| **Fail behavior** | Fail-closed: exceção → `RailResult(is_safe=False)` | Fail-open: exceção → `warn()` + continue |
| **State** | Stateful (engine_registry, task_manager, tracer injetados no constructor) | Stateless (closure over patterns no máximo) |
| **Extension** | Subclass `RailAction` + register em `_ACTION_CLASSES` | Append function ao `TAGGERS` array |
| **Config coupling** | Alto — Pydantic schema, YAML config, Colang flows | Zero — hardcoded array + flags |
| **Detection method** | LLM-based (send prompt to safety model) OR local ML (HF, YARA, Presidio) | Regex + pattern matching only |
| **Deps footprint** | Heavy (onnxruntime, fastembed, optional torch/presidio) | Zero external deps |

**Insight para Theo:** O design ideal combina os dois: **interface simples como OpenGuardrails** (função pura, zero deps) + **lifecycle composável como NeMo** (sequential/parallel, short-circuit, fail-closed default). A configuração deve ser programática (TypeScript-first como o SDK), não YAML-driven.

---

## Cross-cutting Comparison

| Dimension | NeMo Guardrails | OpenGuardrails agentfw | LlamaFirewall (paper) |
|---|---|---|---|
| **Language** | Python | TypeScript | Python (Meta internal) |
| **Architecture** | Middleware pipeline (5 rail types) | Wire proxy (see → route → guard) | 3 specialized scanners |
| **Rail types** | input, dialog, retrieval, execution, output | risk taggers (detector pipeline) | PromptGuard 2, Agent Alignment Checks, CodeShield |
| **Execution model** | Sequential OR parallel (configurable per direction) | Sequential only (fail-safe loop) | Independent scanners |
| **Short-circuit** | Yes (first unsafe stops all) | No (all detectors always run) | N/A |
| **Result shape** | `RailResult(is_safe, reason)` — binary | `RiskTag[]` — multi-finding with severity | Pass/fail per scanner |
| **Fail behavior** | Fail-closed (exception → unsafe) | Fail-open (exception → warn + continue) | Fail-closed |
| **Detection method** | LLM-based + local ML + regex | Pure regex/pattern matching | LLM-based + static analysis |
| **Config format** | YAML + Colang DSL + Pydantic | JSON + programmatic | YAML + regex/LLM prompts |
| **Deps footprint** | Heavy (onnxruntime, fastembed, optional torch) | Minimal (2 runtime deps, 0 for detection) | N/A (internal tooling) |
| **Extension model** | Subclass `RailAction` or write Colang flow | Append function to `TAGGERS` array | Custom regex/LLM scanners |
| **Credential masking** | Via Presidio (optional, PII-focused) | Built-in (11 rules, deterministic fake swap) | Not addressed |
| **Integration** | SDK-embedded (Python) | Wire proxy (HTTP intercept) | SDK-embedded (Python) |

## ADRs

### D1 — Guardrail interface: pure function with typed result (hybrid NeMo/OpenGuardrails)

**Decision:** A interface base de um guardrail no Theo será uma **função async tipada** que retorna um `GuardrailResult` — não uma classe abstrata (NeMo) nem um type alias mínimo (OpenGuardrails). Shape proposto:

```typescript
type GuardrailResult = {
  action: 'allow' | 'block' | 'modify'
  reason?: string
  modified?: unknown  // payload modificado quando action === 'modify'
}

type Guardrail = (context: GuardrailContext) => Promise<GuardrailResult>
```

**Rationale:** Funções puras são testáveis sem mock (OpenGuardrails prova isso). Async suporta tanto detectors determinísticos (regex) quanto model-based (LLM call). O `action` tristate (allow/block/modify) é mais expressivo que o binário `is_safe` do NeMo — permite PII redaction (modify) além de block. Alinha com DIP (`architecture.md`) — a interface é agnóstica de implementação.

**Alternatives considered:** Classe abstrata como NeMo — rejeitada por ser over-engineering para TS (composition > inheritance). Type alias mínimo como OpenGuardrails — rejeitada porque precisa de async + modify capability.

**Consequences:** Cada guardrail é uma função importável. Testes são mockless (input → output). Extension é trivial (escreva uma função, adicione ao array).

### D2 — Fail behavior: fail-closed by default, configurable per guardrail

**Decision:** O pipeline default é **fail-closed** (como NeMo) — exceção em um guardrail bloqueia o request. Guardrails individuais podem optar por fail-open via flag `failOpen: true` na config.

**Rationale:** Safety-critical applications requerem fail-closed. Mas detectors observacionais (analytics, logging) não devem bloquear o fluxo. A config per-guardrail dá flexibilidade sem comprometer o default seguro.

**Alternatives considered:** Fail-open default (como OpenGuardrails) — rejeitado porque o Theo SDK roda agentes com tool access; um detector que falha silenciosamente é um gap de segurança.

**Consequences:** Pipeline precisa de try/catch per-guardrail com branching: catch → block (default) OU catch → warn+continue (when failOpen).

### D3 — Pipeline execution: sequential with opt-in parallel (como NeMo)

**Decision:** Execução sequential por default; opt-in `parallel: true` por rail direction (input/output). Short-circuit on first block.

**Rationale:** Sequential é mais previsível e debuggável (rastreamento de qual guardrail bloqueou). Parallel é otimização de latência para deployments com múltiplos guardrails LLM-based que dominam o tempo. O split NeMo (input sequential, output parallel) é elegante e serve o Theo.

**Alternatives considered:** Parallel-only (como asyncio.gather) — rejeitado porque short-circuit semantics são mais complexas e logs são harder to trace.

**Consequences:** Implementação começa sequential-only; parallel adicionado quando houver demanda real (YAGNI).

### D4 — Onde o código vive: interface no SDK, implementações em package separado

**Decision:**
- **`@theokit/sdk`** ganha: `GuardrailResult` type, `Guardrail` type, `GuardrailContext` type, `GuardrailPipeline` runner (compose + execute), hook points nos 5 gaps identificados em Q8.
- **`@usetheo/guardrails`** (novo package, Apache-2.0) ganha: built-in detectors (PII, jailbreak, credential masking, shell-pattern, content filter), config helpers, composição utilities.

**Rationale:** Interface no SDK porque guardrails interceptam `Agent.send()` e `tool-dispatch.ts` — não dá pra fazer de fora sem os hook points. Implementações em package separado porque detectors são pesados (regex compilers, optional ML models) e não devem inflar o SDK core. Segue o precedente de `@usetheo/memory` (interface DIP no consumer, implementação em package separado).

**Alternatives considered:** Tudo no SDK — rejeitado (inflação). Tudo em package separado — rejeitado (precisa de hooks no pipeline). Plugin em `theokit-plugins` — rejeitado (guardrails é consumido pelo SDK, não pelo framework HTTP).

**Consequences:** SDK bump (minor) para adicionar types + hook points. Novo package `@usetheo/guardrails` com release cycle independente.

### D5 — 5 novos hook points no SDK para fechar os gaps de Q8

**Decision:** Adicionar 5 hook points ao `@theokit/sdk`:

| Hook | Where | Capability | Corresponding gap |
|---|---|---|---|
| `onBeforeModelCall` | Inside agent-loop, before each LLM stream call | inspect/modify/block messages array | GAP 3 |
| `onAfterModelResponse` | After LLM response, before committing to events | inspect/modify/block response text | GAP 1 (CRITICAL) |
| `onAfterToolResult` | After tool execution, before result enters LLM context | inspect/modify/redact tool output | GAP 2 + GAP 4 |
| Upgrade `postToolUse` to veto-capable | Step 7 of tool-dispatch | block/modify tool result | GAP 5 |
| `onBeforeResponse` | Final gate before `Run.wait()` returns to caller | last-chance content filter | GAP 1 extension |

**Rationale:** Q8 analysis showed 5 specific gaps. Each hook maps 1:1 to a gap. The `onAfterModelResponse` hook is the single most important addition — without it, there is zero post-model content filtering capability.

**Alternatives considered:** Single "middleware" hook that wraps everything — rejeitado (too coarse, hard to compose). Wire-proxy approach like OpenGuardrails — rejeitado (wrong layer; Theo is in-process SDK, not network proxy).

**Consequences:** SDK internal refactoring in `loop.ts` and `tool-dispatch.ts`. Breaking change for plugins that depend on `postToolUse` being fire-and-forget (unlikely — it's internal).

## Recommendations for the project

| # | Recommendation | Linked to | Priority |
|---|---|---|---|
| 1 | Create `@usetheo/guardrails` package with `Guardrail` type + `GuardrailPipeline` runner + 3 built-in detectors (credential masking, shell-pattern, PII regex) | Q1-Q3, D1, D4, `architecture.md` § DIP | HIGH |
| 2 | Add 5 hook points to `@theokit/sdk` agent-loop per D5 | Q8, D5, `architecture.md` § module boundaries | HIGH |
| 3 | Port OpenGuardrails credential masking pattern (deterministic fake swap, 11 rules, group-aware) as first built-in guardrail | Q5, D1, `testing.md` § unit test each detector | HIGH |
| 4 | Implement fail-closed pipeline runner with per-guardrail failOpen flag | Q1, Q2, D2, D3 | HIGH |
| 5 | Port OpenGuardrails shell-pattern detector (7 regex patterns, RiskTag output) as second built-in | Q2, D1 | MEDIUM |
| 6 | Add parallel execution mode for guardrail pipeline (opt-in, NeMo-style) | Q1, D3 | LOW (YAGNI until demand) |
| 7 | Evaluate Presidio for PII detection as optional dep (NeMo pattern: extras for heavy ML) | Q7, D1 | LOW (v0.2+) |

## Blocked questions (if any)

Nenhuma — todas as 8 questions respondidas com citações verificadas.

## Halt-loop progress (audit trail)

- Iterations used: 1 (all questions answered in parallel agent runs)
- Questions answered: 8 / 8
- Questions blocked: 0
- Citations verified: 30+
- Promise: BLUEPRINT_COMPLETE

## Related

- Discovery plan: `.claude/knowledge-base/discoveries/plans/guardrails-module-plan.md`
- Edge-case review: `.claude/knowledge-base/reviews/guardrails-module-edge-cases-2026-06-10.md`
- Plan confidence: `.claude/knowledge-base/reviews/guardrails-module-discover-plan-confidence-2026-06-10.md`
- Project rules: `.claude/rules/architecture.md` (DIP), `.claude/rules/testing.md` (test pyramid)
