---
slug: sugar-to-oo
milestone_id: M57
created_at: 2026-07-24
goal: Converter as 12 factory functions livres do @theokit/agents em classes que implementam Capability (e agent() em AgentBuilder construível), terminando a migração OO que o SDK já fez, com zero-behavior provado e as funções deletadas no mesmo milestone.
---

# Plan: sugar → OO — as 12 factory functions viram classes

## Goal

Eliminar o "sugar" do `@theokit/agents`: as 12 factory functions livres viram classes OO, alinhadas ao padrão `X.create()`/classe que o `@theokit/sdk@4.1.0` já padronizou e que `ModelCapability`/`ToolsCapability`/`AgentRunner.fromSpec` já seguem. Zero-behavior provado por equivalência no waist; as funções deletadas no mesmo milestone (playbook M49/M53 — sem sugar layer, sem deprecation window).

## Context

Discovery: `knowledge-base/discoveries/blueprints/layered-oo-boundary-blueprint.md` (`SHIPPABLE` 100) — Q6 (design OO de cada função), Q7 (a reversão do ADR-0001 justificada), D1 (sugar→classe). O `@theokit/agents` está a meio caminho: 4 capabilities **já são classes** (`ModelCapability` `capabilities.ts:26`, `ToolsCapability` `:49`, `AgentConfigCapability` `agent-capabilities.ts:134`, `MainLoopCapability` `:180`); as outras 10 + `agent()`/`contextualTool()` ficaram funções.

## Baseline Context (deep review of current state)

**Git sha:** `14eb98d8` (branch `develop`).

### Files that will be touched

| Arquivo | LoC | O que muda |
|---|---|---|
| `packages/agents/src/capability/capabilities.ts` | 144 | `skills` função → `SkillsCapability` classe |
| `packages/agents/src/capability/agent-capabilities.ts` | 196 | 9 funções → classes (5 field + `contextWindow`/`checkpoint`/`subAgents`/`skillsOptions`); `fieldCapability` helper vira a base `FieldCapability` |
| `packages/agents/src/bridge/agent-builder.ts` | 241 | `agent()` → `AgentBuilder` construível; `contextualTool()` → `ContextualTool.of()` ou classe |
| `packages/agents/tests/**` | 27 arquivos | repontados de `x(...)` para `new XCapability(...)`, sem mudar asserção |

### As 12 funções e o design OO alvo

| Função | Hoje | Classe alvo | Nota |
|---|---|---|---|
| `memory` | `fieldCapability('memory','memory')` | `MemoryCapability` | assignment puro |
| `projectContext` | `fieldCapability(...)` | `ProjectContextCapability` | assignment puro |
| `mcpServers` | `fieldCapability(...)` | `McpServersCapability` | assignment puro |
| `guardrails` | `fieldCapability(...)` | `GuardrailsCapability` | assignment puro |
| `humanInTheLoop` | `fieldCapability(...)` | `HumanInTheLoopCapability` | assignment puro |
| `skills` | inline, delega `compileSkillsSelection` + merge | `SkillsCapability` | lógica: validação + merge (M52) |
| `contextWindow` | inline, delega `compileContextWindow` | `ContextWindowCapability` | lógica: delegação |
| `checkpoint` | inline, warning + setOnce | `CheckpointCapability` | lógica: warning storage-metadata |
| `subAgents` | inline, merge com conflito | `SubAgentsCapability` | lógica: merge + conflito tipado |
| `skillsOptions` | inline | `SkillsOptionsCapability` | lógica |
| `agent` | `function agent(): AgentBuilder` | `AgentBuilder` construível (`new` ou `.create()`) | paralelo a `AgentRunner.fromSpec` |
| `contextualTool` | `function contextualTool(...)` | classe/estático | — |

### Current callers / dependents

- As 12 são API pública (barril `capability/index.ts:6,8` `export *`; `bridge/index.ts:80`).
- **`agent()` e `contextualTool()` NÃO são usados na produção interna** (medido: `grep agent() packages/agents/src` só o barril) — a conversão afeta testes + agent-builder externo, não o pipeline de compilação.
- 27 arquivos de teste chamam as funções — repontados sem mudar asserção.
- `fieldCapability` (`agent-capabilities.ts:37`) é helper interno (não exportado) — vira a base `FieldCapability`.

### Domain glossary

| Termo | Significado |
|---|---|
| **factory function (sugar)** | função livre exportada que constrói/retorna um objeto (`agent()`, `skills()`) — o oposto de classe/`X.create()` |
| **Capability** | contrato `{ name, apply(draft) }` que enriquece o `CompiledAgentOptionsDraft` |
| **waist** | `CompiledAgentOptions` — a representação única entre autoria e runtime; o oráculo de equivalência |
| **fieldCapability** | helper interno que gera uma capability de assignment puro (`setOnce(draft, field, value)`) |
| **zero-behavior** | `new XCapability(a).apply(d)` produz draft deep-equal a `x(a).apply(d)`; a suíte passa sem editar asserção |

### Architecture boundaries affected

`packages/agents/src/capability/` + `bridge/agent-builder.ts`. Sem novo pacote. Reverte o ADR-0001 (skills-como-função) — ADR novo registra com fundamento.

## Prior Art & Related Work

| Fonte | Aporte | Onde |
|---|---|---|
| Blueprint da iniciativa | D1/Q6/Q7 — o design e a justificativa da reversão | `knowledge-base/discoveries/blueprints/layered-oo-boundary-blueprint.md` |
| `@theokit/sdk@4.1.0` | o padrão `X.create()`/classe (zero free functions v3.0) | `node_modules/@theokit/sdk/dist/index.d.ts:454,1014` |
| `ModelCapability`/`ToolsCapability` | o shape de classe `Capability` já existente a espelhar | `packages/agents/src/capability/capabilities.ts:26,49` |
| ADR-0001 | o patterns-budget revertido | `knowledge-base/adrs/0001-capability-patterns-budget.md` |

## Objective

Ao fim: as 12 funções não existem; no lugar, 10 novas classes `Capability` + `AgentBuilder` construível + `contextualTool` OO; a superfície de autoria é 12/12 classe; a suíte (theokit) passa sem editar expectativa; o agent-builder consome as classes.

## ADRs

### D1 — Base `FieldCapability` para as 5 capabilities de assignment puro (DRY sem Template-Method-de-comportamento)

`fieldCapability(name, field)` (helper que gera função) vira uma classe base concreta `FieldCapability` cujo construtor recebe `(name, field, value)` e cujo `apply` faz `setOnce(draft, field, value, name)`. As 5 (`Memory`/`ProjectContext`/`McpServers`/`Guardrails`/`HumanInTheLoop`) estendem com um construtor de 1 linha (`super('memory','memory',value)`).

**Rationale:** 5 classes de assignment idêntico seriam boilerplate; a base concreta é DRY. NÃO é o Template Method que o ADR-0001 recusou (aquele era herança de **comportamento variável** — `shouldContinue`); aqui a base carrega **dados** (name/field), o `apply` é idêntico para todas. **Alternativas:** 5 classes standalone (boilerplate ×5); manter `fieldCapability` e exportar as funções que ele gera (é o status quo, não elimina o sugar). **Consequência:** 1 base + 5 subclasses de 1 linha.

### D2 — `new XCapability(...)` (não `.create()`) para capabilities sync puras

As capabilities são construção síncrona sem factory-logic/validação-async. `new SkillsCapability(x)` é o mais honesto; `.create()` sem lógica seria a cerimônia inversa (o SDK reserva `.create()` para construção async/validada — `Agent.create` é `Promise`).

**Alternativas:** `.create()` estático uniforme com o SDK — rejeitada: seria factory sem factory-logic. **Consequência:** consumidores usam `new`.

### D3 — `agent()` → `AgentBuilder` construível; reverte ADR-0001

`agent()` vira o construtor público de `AgentBuilder` (ou `AgentBuilder.create()` se houver init-logic). A conversão das capabilities reverte a decisão do ADR-0001 (skills-como-função) — registrada com os 3 motivos de Q7 (consistência com o `X.create()` do SDK; superfície uniforme 12/12; custo de ~3 linhas de classe < ganho da uniformidade).

**Alternativas consideradas:** manter `agent()` como função e converter só as capabilities — rejeitada: deixaria a superfície de autoria meio-função-meio-classe, a inconsistência que o milestone existe para remover; usar `AgentBuilder.create()` estático em vez de `new` — mantida como opção se `makeBuilder` tiver init-logic que justifique um factory (decidido em T3 com o código).

**Consequência:** breaking de API (as funções somem) → **major** do `@theokit/agents`.

## Drawbacks & Risks

| # | Risco | Por que é real | Mitigação |
|---|---|---|---|
| R1 | Uma capability com lógica (`skills`/`checkpoint`/`subAgents`) diverge ao virar classe | validação/merge/warning podem ser esquecidos | teste de equivalência no waist (`new X(a).apply(d) ≡ x(a).apply(d)`) — precedente M52; RED antes de deletar a função |
| R2 | Reverter o ADR-0001 sem fundamento vira "everything must be a class" cego | o ADR-0001 recusou explicitamente skills-como-classe | ADR novo com os 3 motivos, citando o ADR-0001 (não apaga) |
| R3 | 27 testes repontados = superfície grande de erro humano | volume | repointing mecânico (`x(a)` → `new XCapability(a)`), suíte verde sem editar asserção é o gate |
| R4 | `AgentBuilder` construível quebra o fluent chain interno | `agent().model().build()` | manter `makeBuilder` como impl; o construtor delega a ele; testes de builder verdes |

## Unresolved Questions

- Q1 — `contextualTool` vira classe ou estático? **Resolução em T3:** é uma função que anexa metadata a uma tool; provável `ContextualTool.of(...)` estático (não tem estado). Decidido com o código na hora.

## Dependency Graph

T1 (base `FieldCapability` + 5 subclasses) é independente. T2 (5 inline → classes) independente de T1. T3 (`agent()`/`contextualTool`) independente. T4 (repontar 27 testes + produção interna + **deletar as 12 funções**) depende de T1+T2+T3 (as classes precisam existir). T5 (ADR + CHANGELOG) fecha.

---

## Phase T1 — As 5 capabilities de assignment → classes (base `FieldCapability`)

### T1.1 — `FieldCapability` base + `MemoryCapability`/`ProjectContextCapability`/`McpServersCapability`/`GuardrailsCapability`/`HumanInTheLoopCapability`

#### Objective
Converter as 5 funções `fieldCapability` em classes, com uma base DRY.

#### Why this step (action + reasoning — ReAct discipline)
São as mais simples (assignment puro) e compartilham a mesma forma — fazê-las primeiro estabelece a base `FieldCapability` que prova o padrão antes das capabilities com lógica. Separa "o mecanismo de classe" de "a lógica preservada".

#### Evidence
`agent-capabilities.ts:37,51,53,55,80` (as 5 funções) + `:37` (`fieldCapability` helper).

#### Files to edit
- `packages/agents/src/capability/agent-capabilities.ts`

#### Tasks
1. `fieldCapability` helper vira `class FieldCapability implements Capability` (base concreta).
2. 5 subclasses de 1 linha de construtor.
3. Remover as 5 `export const`.

#### TDD
```
RED:     memory_capability_equivale_a_funcao() — new MemoryCapability(v).apply(draft) deep-equal a (o comportamento antigo de) memory(v).apply(draft) no waist; idem para as outras 4
GREEN:   FieldCapability base + 5 subclasses
REFACTOR: None expected
VERIFY:  cd packages/agents && npx vitest run tests/unit/agent-capabilities.test.ts
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] As 5 são classes; `grep -nE "^export const (memory|projectContext|mcpServers|guardrails|humanInTheLoop) =" packages/agents/src/capability/agent-capabilities.ts` retorna vazio
- [ ] Teste de equivalência no waist verde para as 5: `npx vitest run tests/unit/agent-capabilities.test.ts` sai 0 com 5 casos `new X(a) ≡ (comportamento antigo)`
- [ ] Pass: lint — `npx eslint --max-warnings=0 $(git diff --name-only HEAD | grep '\.ts$')` sai 0

#### DoD
- [ ] Suíte de `packages/agents` verde; `tsc --noEmit` limpo
- [ ] Commit atômico referenciando T1.1

---

## Phase T2 — As 5 capabilities com lógica → classes

### T2.1 — `SkillsCapability`, `ContextWindowCapability`, `CheckpointCapability`, `SubAgentsCapability`, `SkillsOptionsCapability`

#### Objective
Converter as 5 funções com lógica em classes, preservando validação/delegação/merge/warning.

#### Why this step (action + reasoning — ReAct discipline)
São as de maior risco (R1) — cada uma carrega comportamento (skills: validação+merge; contextWindow: delegação; checkpoint: warning; subAgents: merge+conflito). A classe deve preservar exatamente esse comportamento; o teste de equivalência é o oráculo.

#### Evidence
`capabilities.ts:65` (skills); `agent-capabilities.ts:44,62,87,105`.

#### Files to edit
- `packages/agents/src/capability/capabilities.ts` (skills)
- `packages/agents/src/capability/agent-capabilities.ts` (4)

#### Tasks
1. Cada função vira classe cujo `apply` é o corpo atual da função.
2. A validação de `skills` (boundary check) vai para o construtor (fail-fast na autoria, como as outras classes).
3. Remover as 5 `export const`.

#### TDD
```
RED:     skills_capability_equivale_a_funcao() — mesma saída no waist, incl. o merge/concat e a validação inline malformada
RED:     checkpoint_capability_emite_o_mesmo_warning() — o warning storage-metadata dispara igual
RED:     subAgents_capability_conflito_tipado() — filho duplicado com defs diferentes lança igual
GREEN:   5 classes
REFACTOR: None expected
VERIFY:  cd packages/agents && npx vitest run
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] As 5 são classes; `grep -nE "^export const (skills|contextWindow|checkpoint|subAgents|skillsOptions) =" packages/agents/src/capability/*.ts` retorna vazio
- [ ] Equivalência no waist verde para as 5: `npx vitest run` sai 0, incluindo um caso que asserta o warning de `checkpoint` e um que asserta o conflito tipado de `subAgents`
- [ ] Pass: lint — `npx eslint --max-warnings=0 $(git diff --name-only HEAD | grep '\.ts$')` sai 0

#### DoD
- [ ] Suíte verde; `tsc --noEmit` limpo
- [ ] Commit atômico referenciando T2.1

---

## Phase T3 — `agent()` e `contextualTool()` → OO

### T3.1 — `AgentBuilder` construível + `contextualTool` OO

#### Objective
Eliminar os 2 builders livres.

#### Why this step (action + reasoning — ReAct discipline)
`agent()` não é usado na produção interna (medido) — a conversão é isolada. `AgentBuilder` vira construível (`new AgentBuilder()` ou `.create()`), delegando ao `makeBuilder` interno para não quebrar o fluent chain.

#### Evidence
`bridge/agent-builder.ts:239` (`agent()`), `:70` (`contextualTool`).

#### Files to edit
- `packages/agents/src/bridge/agent-builder.ts`
- `packages/agents/src/bridge/index.ts` (barril)

#### Tasks
1. `agent()` → construtor público de `AgentBuilder` (ou `AgentBuilder.create()`); delega a `makeBuilder`.
2. `contextualTool()` → `ContextualTool.of(...)` (estático — sem estado, Q1).
3. Atualizar o barril.

#### TDD
```
RED:     agent_builder_construivel() — new AgentBuilder().model(...).build() ≡ agent().model(...).build()
RED:     contextualTool_oo() — ContextualTool.of(...) produz o mesmo que contextualTool(...)
GREEN:   construtor + estático
REFACTOR: None expected
VERIFY:  cd packages/agents && npx vitest run tests/unit/agent-builder-mcp.test.ts
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `grep -nE "^export function (agent|contextualTool)" packages/agents/src/bridge/agent-builder.ts` retorna vazio
- [ ] `new AgentBuilder()` (ou `.create()`) funciona no fluent chain; teste de builder verde
- [ ] Pass: lint — `npx eslint --max-warnings=0 $(git diff --name-only HEAD | grep '\.ts$')` sai 0

#### DoD
- [ ] Suíte verde; `tsc --noEmit` limpo
- [ ] Commit atômico referenciando T3.1

---

## Phase T4 — Repontar consumidores + deletar as 12 funções

### T4.1 — Repontar os 27 testes + produção interna; deletar as funções

#### Objective
Nenhum consumidor chama as funções antigas; elas não existem mais.

#### Why this step (action + reasoning — ReAct discipline)
As classes já existem (T1-T3). Agora os consumidores migram de `x(a)` para `new XCapability(a)`, e as 12 funções são deletadas no mesmo milestone (sem deprecation window). O repointing é mecânico; a suíte verde sem editar asserção é a prova de zero-behavior.

#### Evidence
27 arquivos de teste (`grep -rlnE "\b(skills|memory|…)\(" packages/agents/tests`).

#### Files to edit
- `packages/agents/tests/**` (27), produção interna que use as funções.

#### Tasks
1. Repontar cada call-site: `skills(a)` → `new SkillsCapability(a)`, etc. Mecânico.
2. Deletar as 12 `export const`/`export function` (já feito nas fases anteriores por remoção — confirmar zero resíduo).
3. Rodar a suíte sem editar nenhuma asserção.

#### TDD
```
RED:     (nenhum teste novo — a prova é a suíte existente verde APÓS repointing, sem asserção alterada)
GREEN:   repointing mecânico
REFACTOR: None expected
VERIFY:  cd packages/agents && npx vitest run
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `grep -rnE "\b(skills|memory|mcpServers|guardrails|checkpoint|humanInTheLoop|subAgents|contextWindow|projectContext|skillsOptions|contextualTool)\(" packages/agents/src packages/agents/tests --include='*.ts'` só casa `new XCapability` / definições de classe — nenhuma chamada de função-sugar
- [ ] `grep -nE "^export (function|const) (agent|contextualTool|skills|memory|mcpServers|guardrails|checkpoint|humanInTheLoop|subAgents|contextWindow|projectContext|skillsOptions)\b" packages/agents/src --include='*.ts'` retorna vazio
- [ ] Suíte verde **sem editar nenhuma asserção** (`git diff` nos `*.test.ts` só troca a chamada, não o `expect`)
- [ ] **agent-builder repontado:** `agents/chat.ts` e `agents/lib/hooks-wiring.test.ts` migram `agent()` → o novo construtor; suíte do agent-builder verde; `grep -rn "\bagent()" agents/ --include=*.ts` retorna vazio
- [ ] Pass: lint (`npx eslint --max-warnings=0` nos tocados sai 0) e knip (`npx knip` sai 0)

#### DoD
- [ ] Suíte de `packages/agents` verde; `tsc --noEmit` limpo; knip limpo
- [ ] Commit atômico referenciando T4.1

---

## Phase T5 — ADR + CHANGELOG

### T5.1 — ADR da reversão do ADR-0001 + CHANGELOG (major)

#### Objective
Registrar a reversão consciente e o breaking.

#### Why this step (action + reasoning — ReAct discipline)
Reverter um ADR aprovado sem registro é o pior anti-pattern de governança. O ADR novo cita o ADR-0001 e dá os 3 motivos; o CHANGELOG marca o major (as 12 funções somem).

#### Files to edit
- `knowledge-base/adrs/0005-sugar-to-oo.md` (novo)
- changeset (major)

#### Tasks
1. ADR com os 3 motivos da reversão, citando ADR-0001.
2. Changeset `major` listando as 12 funções removidas + as classes que as substituem.

#### TDD
```
RED:     (documentação)
GREEN:   ADR + changeset
VERIFY:  grep -c "0001" knowledge-base/adrs/0005-sugar-to-oo.md  → ≥ 1 (cita o ADR revertido)
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] ADR cita o ADR-0001 e dá os 3 motivos: `grep -c '0001' knowledge-base/adrs/0005-sugar-to-oo.md` ≥ 1 e o ADR lista 3 bullets de motivo
- [ ] Changeset é `major` e lista as 12 funções → classes

#### DoD
- [ ] Commit atômico referenciando T5.1

---

## Coverage Matrix

| # | Gap / Requirement (DoD do M57) | Task(s) | Resolução |
|---|---|---|---|
| 1 | 10 capabilities-função + 2 builders viram classes | T1.1, T2.1, T3.1 | classes por família |
| 2 | (GATE) zero-behavior: `new X(a) ≡ x(a)` no waist; suíte sem editar expectativa | T1.1, T2.1, T3.1, T4.1 | equivalência no waist |
| 3 | Funções deletadas no mesmo milestone | T4.1 | sem deprecation window |
| 4 | ADR registrando a reversão do ADR-0001 | T5.1 | 3 motivos + citação |
| 5 | Gates verdes + CHANGELOG major | T4.1, T5.1 | knip/tsc/lint |

**Coverage: 5/5 (100%)**

## Dependencies

### Existing
| Dep | Uso | Rule 9 |
|---|---|---|
| `zod` | validação em `skills`/`contextWindow` | já instalado |
| `vitest` | RED/GREEN + equivalência | já instalado |

### New
Nenhuma.

### Removed
As 12 factory functions (código do próprio pacote, não dependências).

## Failure scenarios (when I/O external)

(none — no external I/O touched)

Todas as capabilities são transformação pura de `CompiledAgentOptionsDraft`; nenhuma toca rede/disco.

## Global Definition of Done

- [ ] T1..T5 completas
- [ ] `cd packages/agents && npx vitest run` verde, **sem asserção existente editada**
- [ ] `npx tsc --noEmit` na raiz sem erro
- [ ] `npx eslint --max-warnings=0` nos arquivos tocados
- [ ] `pnpm knip` verde
- [ ] `grep -nE "^export (function|const) (agent|contextualTool|skills|memory|mcpServers|guardrails|checkpoint|humanInTheLoop|subAgents|contextWindow|projectContext|skillsOptions)\b" packages/agents/src` → vazio (sugar eliminado)
- [ ] Teste live no tmux `agentbuilder`: um agente autorado com `new XCapability(...)` responde de provider real
- [ ] `/code-quality` ∈ {PASS, PASS_WITH_CAVEATS}; `/review` READY_TO_MERGE
- [ ] `@theokit/agents` publicado (major); flip do M57 em ROADMAP-v2.md
- [ ] CHANGELOG + ADR 0005

## Followups

Nenhum aberto. **Verificado (baseline agent-builder):** o agent-builder NÃO usa as capability-funções soltas (`skills()`/`memory()` etc — usa `applyCapabilities` + classes `ModelCapability`/`ToolboxCapability`). Usa apenas `agent()` em `agents/chat.ts:152` (`const base = agent()`, fluent chain com `.mcp(...)`) e `agents/lib/hooks-wiring.test.ts`. O repointing desses 2 call-sites (`agent()` → o novo construtor) é parte de T4 — o major não deixa o agent-builder quebrado.

## Related

- Milestone: `ROADMAP-v2.md` § `### M57`
- Blueprint: `knowledge-base/discoveries/blueprints/layered-oo-boundary-blueprint.md`
- ADR revertido: `knowledge-base/adrs/0001-capability-patterns-budget.md`
- Regras: `.claude/rules/parsimony-ladder.md`, `.claude/rules/testing.md`, `.claude/rules/error-handling.md`
