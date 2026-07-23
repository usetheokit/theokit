---
slug: capability-core
milestone_id: M52
created_at: 2026-07-23
goal: introduzir a camada Capability (OO) que produz o CompiledAgentOptions JÁ EXISTENTE, com registry + preset, provando byte-identidade contra o caminho de decorators
---

# Plan: capability-core (M52) — a camada Capability sobre a cintura que já existe

## Goal

Substituir a autoria por decorators (metadata-driven) por **capabilities componíveis** (OO). O discover
revelou que a cintura estreita **já existe**: `CompiledAgentOptions` (24 campos) é produzido por DUAS
fontes hoje (`defineAgent` e decorators) e consumido por UM adapter (`assembleM8CreateOptions`). Este
milestone adiciona uma TERCEIRA fonte — capabilities — provando byte-identidade, para que o M53 possa
deletar a fonte de decorators sem risco.

## Baseline Context (deep review do estado atual)

**Achado (discover 2026-07-23):** o pipeline é
`defineAgent → compileAgentDefinition ─┐` / `decorators → walkAgentMetadata → compileAgent ─┘` →
`CompiledAgentOptions` → `assembleM8CreateOptions` → `Agent.create`. Ou seja, a cintura e o adapter
existem; inventar `AgentSpec`/`SdkAgentAdapter` (como o design spike propunha) criaria uma TERCEIRA
representação — exatamente a duplicação que a iniciativa quer eliminar.

### Files that will be touched

| Arquivo | LoC | Papel | file:line-chave |
|---|---|---|---|
| `packages/agents/src/capability/` | NOVO | contrato + capabilities + registry + preset | `capability.ts`, `capabilities/*.ts`, `registry.ts` |
| `packages/agents/src/bridge/agent-compiler.ts` | 250 | define `CompiledAgentOptions` (a cintura reusada) | `CompiledAgentOptions` (`:135`), `compileAgent` (`:219`) |
| `packages/agents/src/bridge/sdk-adapter-create-options.ts` | 156 | o Adapter que já existe (reusado, não reescrito) | `assembleM8CreateOptions` (`:37`) |
| `packages/agents/src/bridge/define-agent.ts` | 299 | a fonte zero-config atual (referência de shape) | `compileAgentDefinition` (`:197`) |

### Current callers / dependents

- `assembleM8CreateOptions(compiled)` — consumidor único das duas fontes; NÃO muda (é o oráculo de que a fonte nova é equivalente).
- `walkAgentMetadata` + `compileAgent` — a fonte de decorators; intocada no M52 (deletada no M53).
- `compileAgentDefinition` — a fonte zero-config; intocada.

### Domain glossary

- **Capability** = unidade componível que enriquece um `CompiledAgentOptionsDraft`. Strategy (N implementações) + Decorator de valor (envolve sem herança).
- **cintura estreita** = `CompiledAgentOptions` — a única linguagem entre autoria e runtime.
- **provenance** = registro de qual capability contribuiu com qual campo (resolve a opacidade que o `@Expose`/M47 remendou).
- **byte-identidade** = `deep-equal` entre o `CompiledAgentOptions` da fonte nova e o da fonte de decorators para o mesmo agente.

### Architecture boundaries affected

- Novo diretório `src/capability/` dentro de `@theokit/agents` — depende só de tipos do próprio pacote + SDK. Nenhuma dep nova (rung 4: reusa `CompiledAgentOptions` e `assembleM8CreateOptions`).
- Nenhuma mudança em `@theokit/http` neste milestone (o desacoplamento do `app.ts` é M53).

**Baseline de segurança:** suíte do `@theokit/agents` = **738 testes verdes** (735 passed / 3 skipped, 103 files), `tsc` limpo — o oráculo do refactor.

## ADRs

### ADR-1 — Reusar `CompiledAgentOptions` como o spec; NÃO inventar `AgentSpec`

- **Decisão:** capabilities constroem um draft de `CompiledAgentOptions`.
- **Alternativas:** criar `AgentSpec` novo (proposta do design spike) — rejeitada: seria uma TERCEIRA representação, exigindo dois adapters e duplicando conhecimento de mapeamento.
- **Rationale:** a cintura já existe e já é consumida por um adapter único. Don't-Reinvent (rung 4) + DRY.

### ADR-2 — Reusar `assembleM8CreateOptions` como Adapter

- **Decisão:** nenhum adapter novo; a fonte nova desemboca no adapter existente.
- **Rationale:** o adapter é o ponto onde a equivalência é observável — reusá-lo é o que torna a prova de byte-identidade possível.

### ADR-3 — Orçamento de patterns (adotados × recusados)

- **Adotados** (com a variação que justifica): Builder (autoria, tipos acumulados), Facade (`agent()`), Composite (preset), Strategy (capability), Registry (nome→capability, OCP p/ autoria por arquivo), Factory Method (`registry.resolve`), Adapter (reusado), Decorator-de-valor (envolver tool), Chain of Responsibility (interceptors/hooks), Specification (guardrails componíveis), State (ciclo do run), Memento (snapshot/backtrack), Null Object (`NoopMemoryProvider`, já no SDK).
- **Recusados** (com a regra): Singleton (DIP/testabilidade), Visitor (KISS — sem hierarquia), Abstract Factory (YAGNI — uma família), Mediator (capabilities não conversam), Template Method (OCP — composição > herança), Observer (async-iterator já é o mecanismo), Flyweight/Prototype/Interpreter (problema inexistente).
- **Rationale:** densidade de pattern de framework é maior que a de app, mas pattern sem variação real é o anti-pattern nomeado em KISS §10 / YAGNI §11.

## Tasks

### Phase 0 — contrato + capabilities + prova

### T0.1 — Contrato `Capability` + draft + provenance

`src/capability/capability.ts`: `CompiledAgentOptionsDraft` (mutável, com `provenance`), `interface Capability { name; apply(draft) }`, erro tipado `CapabilityConflictError`.

##### Why this step
É a peça load-bearing (Strategy). Sem contrato não há composição nem registry.

##### TDD
- `test_capability_applies_and_records_provenance`: uma capability fake escreve um campo e registra `{capability, contributed}`.
- `test_conflict_is_typed_and_fails_fast`: duas capabilities escrevendo o MESMO campo com valores diferentes → `CapabilityConflictError` (nunca "último vence").

#### Concurrency tests
- `(none — aplicação síncrona sobre um draft local)`.

### T0.2 — Três capabilities reais (`model`, `tools`, `sandbox`)

`src/capability/capabilities/`: `ModelCapability` (classe — valida id não-vazio), `ToolsCapability` (acumula `CompiledTool[]`), `SandboxCapability` (classe — valida modo + conflito). `skills` como função (dado puro) documentando quando NÃO usar classe.

##### Why this step
Prova o contrato com variação real (uma com validação, uma acumuladora, uma com conflito) sem migrar os 24 (isso é M53).

##### TDD
- `test_model_capability_validates_and_sets`: id vazio → `ConfigurationError`; válido → `draft.model`.
- `test_tools_capability_accumulates`: duas aplicações somam tools sem sobrescrever.
- `test_sandbox_conflict_throws`: `workspace-write` + `read-only` → conflito tipado.

#### Concurrency tests
- `(none — puro)`.

### T0.3 — `CapabilityRegistry` (Factory Method/OCP) + `CapabilityPreset` (Composite)

`registry.ts`: `register(name, factory)` / `resolve(name, arg)` com `UnknownCapabilityError` (fail-fast, lista os conhecidos). `preset.ts`: `CapabilityPreset implements Capability` aplicando membros em ordem determinística.

##### Why this step
O registry é o que destrava autoria por ARQUIVO (o caminho do Agent Builder); o preset é o que torna "agente de código" uma unidade.

##### TDD
- `test_registry_resolves_and_fails_fast`: nome desconhecido → erro tipado listando os conhecidos.
- `test_preset_applies_members_in_order`: composite aplica na ordem declarada (determinístico).

#### Concurrency tests
- `(none — mapa local)`.

### T0.4 — Prova de byte-identidade vs o caminho de decorators

Teste golden: para um agente representativo, o `CompiledAgentOptions` produzido pelas capabilities é `deep-equal` ao produzido por `compileAgent` (decorators), e ambos passam por `assembleM8CreateOptions` gerando opções idênticas.

##### Why this step
É o DoD central (zero-behavior) e o que autoriza o M53 a deletar a fonte antiga.

##### TDD
- `test_capability_path_matches_decorator_path`: `deep-equal` de `CompiledAgentOptions` e de `assembleM8CreateOptions(...)` para o mesmo agente.

#### Concurrency tests
- `(none — comparação pura)`.

### T0.5 — Validação: gates + ADR + CHANGELOG

Suíte completa do `agents` verde; `typecheck`/`lint --max-warnings=0`/`check:direction`/`publint`; ADR do orçamento de patterns em `knowledge-base/adrs/`; CHANGELOG.

##### Why this step
Fecha o DoD e deixa o orçamento de patterns escrito (não vira opinião de quem editar depois).

##### TDD
- N/A (validação). Acceptance: 738+ testes verdes; gates limpos; ADR presente.

#### Concurrency tests
- `(none — validação)`.

## Coverage Matrix

| # | DoD claim | ADR | Tasks |
|---|---|---|---|
| 1 | Contrato `Capability` + draft + provenance | ADR-1 | T0.1 |
| 2 | 3 capabilities reais (classe onde há comportamento; função onde é dado) | ADR-3 | T0.2 |
| 3 | Registry (OCP/arquivo) + Preset (Composite) | ADR-3 | T0.3 |
| 4 | Zero-behavior: byte-identidade vs decorators | ADR-1, ADR-2 | T0.4 |
| 5 | Gates verdes + ADR do orçamento de patterns | ADR-3 | T0.5 |

## Failure scenarios

| Cenário | Task cobre |
|---|---|
| Duas capabilities escrevem o mesmo campo | T0.1 (`CapabilityConflictError`, fail-fast) |
| Nome de capability inexistente no arquivo de config | T0.3 (`UnknownCapabilityError` listando conhecidos) |
| Draft incompleto (sem `model`) chega ao adapter | T0.4 (o adapter existente já lança `ConfigurationError`) |
| Capability não expressa um campo do `CompiledAgentOptions` | T0.4 (a byte-identidade falha e bloqueia — o gate 1:1 completo é M53) |

## Drawbacks & Risks

| # | Risco | Impacto | Mitigação |
|---|---|---|---|
| 1 | O modelo de capability não expressa algum decorator | M53 bloqueia | M52 cobre 3 capabilities; a auditoria 1:1 é gate duro do M53, antes de qualquer deleção |
| 2 | Draft mutável compartilhado gera acoplamento temporal | bug sutil de ordem | ordem determinística (Composite) + conflito tipado + `provenance` para diagnóstico |
| 3 | Terceira fonte convivendo com duas aumenta superfície | confusão temporária | M53 remove a de decorators atomicamente (sem janela de depreciação) |

## Unresolved Questions

(none — every decision is resolved at plan time) — o discover mapeou o pipeline com file:line, a cintura
(`CompiledAgentOptions`) e o adapter (`assembleM8CreateOptions`) já existem e são reusados, e o orçamento
de patterns está travado no ADR-3.

## Prior Art

- theokit: `bridge/agent-compiler.ts:135` (`CompiledAgentOptions` — a cintura), `:219` (`compileAgent`), `bridge/sdk-adapter-create-options.ts:37` (`assembleM8CreateOptions` — o Adapter), `bridge/define-agent.ts:197` (`compileAgentDefinition` — a fonte zero-config).
- Precedente interno: M49 (`@theokit/presenter`) — um evento canônico + N implementações componíveis, com a suíte existente repontada como oráculo de zero-behavior.
- Design spike: `knowledge-base/discoveries/blueprints/capability-oo-design-spike.md` (corrigido por este plano no ponto do `AgentSpec`).

## Global Definition of Done

- [ ] `src/capability/` com contrato + 3 capabilities + registry + preset, cada um com teste RED→GREEN.
- [ ] `provenance` registra quem contribuiu com o quê.
- [ ] Conflito de capability é erro TIPADO (nunca último-vence).
- [ ] Byte-identidade provada contra o caminho de decorators (`CompiledAgentOptions` + opções do adapter).
- [ ] Suíte do `agents` verde; `typecheck`/`lint`/`check:direction`/`publint` limpos.
- [ ] ADR do orçamento de patterns (13 adotados / 8 recusados) em `knowledge-base/adrs/`.
