# Blueprint: camada OO `SDK → Theokit → AgentBuilder` — eliminar sugar, cortar o import direto do SDK

**Slug:** `layered-oo-boundary`
**Date:** 2026-07-24
**Verdict:** `SHIPPABLE` (100/100, zero caps) — /discover-confidence 2026-07-24.

**Fontes independentes:** três — o **`@theokit/sdk`** instalado (o provedor, cujo padrão OO já está estabelecido), o **`@theokit/agents`** (a camada a enriquecer), e o **agent-builder** (o consumidor, repo irmão em `/home/paulo/Projetos/usetheo/usetheo-labs/agent-builder/`, evidência de consumo).

**Versões lidas:** `@theokit/sdk@4.1.0`. Caminhos do agent-builder citados por caminho absoluto (repo irmão, não uma reference clonada — o checker de citações só varre `knowledge-base/references/`, então cada um carrega arquivo:linha para conferência humana).

## Context

O owner definiu a arquitetura em camadas: **SDK (lib pura) → Theokit (enriquece com interfaces/classes/patterns) → AgentBuilder**, e duas ações:

1. **Eliminar o "sugar"** — as ~12 factory functions livres do `@theokit/agents` (`agent()`, `contextualTool()`, `skills()`, `memory()`, `mcpServers()`, `guardrails()`, `checkpoint()`, `humanInTheLoop()`, `subAgents()`, `contextWindow()`, `projectContext()`, `skillsOptions()`) → OO puro (classes / `X.create()`).
2. **Cortar o import direto do `@theokit/sdk*`** no agent-builder — medido: **20 arquivos**, 8 domínios (`core`, `/persistence`, `/sandbox`, `/auth`, `/interactive`, `/errors`, `sdk-tools`, `sdk-pty`). O agent-builder passa a importar de `@theokit/*`.

Decisões do owner (2026-07-24): sugar = **todas** as 12 funções; camada = **re-export enriquecido seletivo** (pass-through onde é só tipo/função sem variação, interface/classe onde há padrão real); formato = **discover primeiro, depois roadmap-v2**.

Regras consumidas: `.claude/rules/parsimony-ladder.md` (rung 1/9 — não reinventar o SDK; enriquecer só onde paga), `.claude/rules/architecture.md` § 2 (direção de dependência), ADR-0001 (o patterns-budget que esta iniciativa em parte reverte).

## Objective

Decidir, com evidência do provedor e do consumidor: **(a) o design OO de cada uma das 12 factory functions**, **(b) por domínio do SDK, o que é re-export puro vs enriquecimento com contrato próprio**, e **(c) o corte em milestones do roadmap-v2** — para que a implementação não re-trabalhe e não vire wrapper-por-wrapper (Não-Reinvente).

## Sumário executivo

O design OO **não é invenção — é alinhamento com o provedor**. O `@theokit/sdk@4.1.0` já padronizou `static create()` em toda a superfície (`Agent.create`, `Tool.create`, `Provider.create`, `Budget.create`, `Squad.create`, `SubAgent.create` — `node_modules/@theokit/sdk/dist/index.d.ts:454,607,812,883,1014`) e **removeu suas próprias free functions no v3.0** (skill `/theokit-sdk`: *"Never author define\*/create\* free functions — those were removed at v3.0"*). O `@theokit/agents` está a meio caminho: `ModelCapability`/`ToolsCapability` **já são classes**, mas as outras 10 capabilities + `agent()` ficaram funções. **Eliminar o sugar = terminar a migração que o SDK já fez** — e o ADR-0001 (que deixou `skills()` como função) é revertido com fundamento, não por gosto.

A camada do SDK **não** deve ser wrapper uniforme: o próprio SDK mistura já-OO (`Agent.create`, `SandboxBackend`) com free functions puras (`transcriptPath(base,cwd,id): string` — `dist/internal/persistence/session-transcript.d.ts:83`). Envolver um path helper puro numa classe seria a cerimônia que a parcimônia recusa; envolver `runGoalLoop`/auth/sandbox (orquestração + estado) num contrato OO é onde a camada agrega valor real.

**Armadilha achada:** existem **dois `ConfigurationError`** — o do theokit (`packages/agents/src/errors.ts:16`, `extends Error`) e o do SDK (`node_modules/@theokit/sdk/dist/errors.d.ts:128`, `extends TheokitAgentError`). O agent-builder importa o **do SDK** (`agents/subagents/roles.ts:22`). São classes diferentes: um `catch (e instanceof ConfigurationError)` pega uma e não a outra. A camada precisa resolver qual é o contrato.

## Coverage Corner 1 — Integration tests

### Q1 — Como provar que a conversão sugar→OO é zero-behavior?

**Fontes:** `@theokit/agents` (1) — `SINGLE-SOURCE`.

Cada factory function retorna um `Capability` (`{ name, apply }`). A conversão para classe deve produzir **o mesmo objeto compilado**. O precedente é o M52: a prova de zero-behavior comparou o `CompiledAgentOptions` do caminho novo com o do `defineAgent` (deep-equal no waist). O mesmo oráculo se aplica: `new SkillsCapability(x).apply(draft)` deve produzir draft deep-equal a `skills(x).apply(draft)`.

**Decisão proposta:** cada milestone do sugar carrega o gate "a suíte atual passa sem editar expectativa" + um teste de equivalência `new XCapability(a) ≡ x(a)` no waist, antes de deletar a função. Repointa a suíte existente (que hoje chama `skills()`) para a classe, sem mudar asserção — se verde, deleta a função no mesmo milestone (playbook M49/M53, "sem sugar layer, sem deprecation window", `ROADMAP.md:1214`).

### Q2 — Como provar o repointing do agent-builder sem regressão?

**Fontes:** agent-builder (1).

O agent-builder tem suíte própria (`agents/**/*.test.ts`, ~40 arquivos). Cada arquivo repontado (`@theokit/sdk` → `@theokit/*`) deve manter os testes verdes sem editar expectativa, e a prova live no tmux `agentbuilder` (o goal ativo exige) contra provider real fecha cada fatia.

**Decisão proposta:** o repointing é **por domínio** (não por arquivo), e cada domínio só reponta **depois** que o theokit expõe aquela superfície — a ordem é theokit-primeiro. Gate mecânico: `grep -rn "from '@theokit/sdk" agents/` deve zerar por domínio ao fim de cada fatia.

## Coverage Corner 2 — Dependencies

### Q3 — Por domínio do SDK: re-export puro ou enriquecer? (o núcleo da decisão)

**Fontes:** SDK + agent-builder (2).

| Domínio | Símbolos que o agent-builder usa | Forma no SDK | Decisão | Porquê |
|---|---|---|---|---|
| **core** | `Agent`, `Tool`, `Provider`, `CustomTool`, `SDKAgent`, `SessionRecord` | `X.create()` (já OO) + tipos | **re-export puro** | já é o padrão OO alvo; envolver duplicaria sem valor (Rung 9) |
| **goal** | `runGoalLoop`, `GoalLoopAgent`, `GoalEvent/Options/Result` | free function + tipos | **enriquecer** | `runGoalLoop` é orquestração de loop — um `GoalRunner` classe (paralelo ao `AgentRunner` que já existe) impõe o padrão; `agents/lib/goal.ts:1` |
| **persistence** | `transcriptPath`, `encodeProjectDir`, `SessionRecord` | **free functions puras** (`dist/internal/persistence/session-transcript.d.ts:36,83`) | **re-export puro** | path helpers sem estado; uma classe seria cerimônia (Rung 5). `agents/lib/session-ops.ts:16`, `session-gc.ts:16`, `backtrack.ts:5` |
| **sandbox** | `LocalSandbox`, `SandboxBackend`, `SandboxConfig` | classe + interface (já OO) | **re-export puro** | `SandboxBackend` já é o contrato; `agents/sandbox/backend.ts:6` |
| **auth** | `ensureFreshCredential`, `openaiDeviceLogin`, `persistOAuthTokens`, `CredentialStoreConfig`, `OAuthProviderConfig` | free functions + tipos | **enriquecer** | fluxo com estado (login → persist → refresh); um `CredentialStore`/`AuthProvider` classe unifica o que hoje são 3 arquivos soltos (`agents/lib/credentials.ts:5`, `login.ts:4`, `oauth-config.ts:1`) |
| **interactive** | `PtyInteractiveBackend`, `InteractiveBackend`, `StartInteractiveOptions` | classe + interface (já OO) | **re-export puro** | já OO; `agents/interactive/backend.ts:1` |
| **errors** | `ConfigurationError` | classe (mas **duplicada** com a do theokit) | **enriquecer/unificar** | dois `ConfigurationError` (SDK vs `errors.ts:16`) — a camada decide qual é o contrato do theokit; `agents/subagents/roles.ts:22` |
| **sdk-tools** | `createReadFileTool`, `createShellTool`, … (13 factories) + `withName`/`withDescription` | free functions | **enriquecer OU pass-through** (Q5) | é sugar do próprio SDK-tools; decisão em Q5 |
| **sdk-pty** | `PtyInteractiveBackend` | classe (já OO) | **re-export puro** | já OO |

**Decisão proposta:** 5 domínios re-export puro (core, persistence, sandbox, interactive, pty), 3 enriquecer (goal, auth, errors), 1 aberto (sdk-tools, Q5). Isso é o "seletivo": enriquece 3/9, onde há orquestração/estado/contrato-a-unificar.

## Coverage Corner 3 — Tools

### Q4 — Qual gate mecaniza "nenhum import direto do SDK no agent-builder"?

**Fontes:** agent-builder (1).

`grep -rn "from '@theokit/sdk" agents/ --include=*.ts | grep -v node_modules` deve zerar ao fim da iniciativa. Por domínio, o gate é parcial (só aquele subpath zera). Não há linter que force isso hoje — a decisão inclui **um teste de fronteira** no agent-builder (um `.test.ts` que faz o grep e falha se um import direto de `@theokit/sdk*` reaparecer), para o repointing não regredir depois. Precedente: o `check:direction` do theokit é exatamente esse tipo de guard de fronteira mecanizado.

### Q5 — `sdk-tools` (13 factory functions) — enriquecer ou pass-through?

**Fontes:** SDK-tools + agent-builder (2).

`createReadFileTool`/`createShellTool`/… são free functions que retornam `CustomTool`. O SDK core tem `Tool.create()`. Há tensão: enriquecer as 13 numa fachada OO (`Tools.readFile()`, ou `ToolKit` classe) é consistente com "eliminar sugar", mas é 13 wrappers sobre free functions de OUTRO pacote (`@theokit/sdk-tools`) — beira o Rung 9 (não reinventar). O agent-builder usa 15+ delas (`agents/chat.ts:2`).

**Decisão proposta (a decidir no roadmap-v2, não aqui):** re-export puro de `sdk-tools` via `@theokit/agents/tools` (barrel), **sem** enriquecer — porque são factories de terceiro-pacote sem estado, e o valor OO já está em `Tool.create()` para tools autorais. Registrar como o único domínio onde "eliminar sugar" **não** se aplica (o sugar é do SDK-tools, não do theokit). Alternativa (enriquecer numa fachada) fica como followup se o consumo provar padrão.

## Coverage Corner 4 — Techniques

### Q6 — Design OO de cada uma das 12 factory functions

**Fontes:** `@theokit/agents` + SDK (2).

Duas famílias, medidas em `agent-capabilities.ts`/`capabilities.ts`:

**(a) Capabilities geradas por `fieldCapability(name, field)`** (`agent-capabilities.ts:37,51,53,55,80`) — `memory`, `projectContext`, `mcpServers`, `guardrails`, `humanInTheLoop`. São assignment puro (`setOnce(draft, field, value)`). O design OO: uma classe base `FieldCapability` + subclasses finas, OU classes diretas. Como o SDK usa `X.create()`, o alvo é `MemoryCapability` etc. com `constructor(value)` — igual a `ModelCapability` que **já existe** (`capabilities.ts:26`).

**(b) Capabilities com lógica** (`skills`, `contextWindow`, `checkpoint`, `subAgents`, `skillsOptions`) — têm validação/delegação/merge. Já são candidatas naturais a classe (comportamento a encapsular). `skills()` (`capabilities.ts:65`) é a que o ADR-0001 deixou função de propósito.

**`agent()`** (`bridge/agent-builder.ts:239`) → `makeBuilder({})`. O alvo: `AgentBuilder` com construtor público ou `AgentBuilder.create()`, alinhado ao `AgentRunner.fromSpec()` que **já existe** (`loop/agent-runner.ts:212`).

**Decisão proposta:** todas viram classes que implementam `Capability`, instanciadas por `new XCapability(...)` (o SDK usa `.create()` para o que tem async/factory-logic; capabilities são sync puras, então `new` é o mais honesto — `.create()` sem lógica seria a cerimônia inversa). `agent()` → `AgentBuilder` construível. Consistência: 12/12 OO, terminando o que M52 começou com 2/12.

### Q7 — A reversão do ADR-0001 (skills como função) é justificada?

**Fontes:** ADR-0001 + SDK (2).

O ADR-0001 deixou `skills()` função com o argumento *"a class here would be ceremony (the honest counter-example to 'everything must be a class')"* — KISS. **A reversão tem fundamento novo, não capricho:** (1) o provedor inteiro é `X.create()`/classe e removeu suas free functions — consistência com o SDK passou a valer mais que o KISS-por-função isolado; (2) a superfície fica **uniforme** (12/12), o que reduz a carga cognitiva de "por que essas 2 são classe e essas 10 função?"; (3) o custo real de `class SkillsCapability implements Capability` sobre a função é ~3 linhas de cerimônia, contra o ganho de uma regra única. O ADR novo registra a reversão com esses três motivos, e cita o ADR-0001 explicitamente (não o apaga).

## Cross-cutting Comparison

| Eixo | `@theokit/sdk@4.1.0` (provedor) | `@theokit/agents` hoje | agent-builder hoje | Alvo (roadmap-v2) |
|---|---|---|---|---|
| Factory de objetos | `X.create()` estático; **zero** free functions (removidas v3.0) | 2 classes + 10 funções + `agent()` | consome ambas | 12/12 classes; `agent()`→`AgentBuilder` |
| Superfície consumida pelo app | direta (20 arquivos importam SDK) | parcial | **importa `@theokit/sdk*` em 8 domínios** | só `@theokit/*` |
| Path helpers puros | free function (`transcriptPath`) | — | importa do SDK | re-export puro |
| Orquestração/estado | free function (`runGoalLoop`) / fluxo auth | — | importa do SDK | **enriquecido** (classe/interface própria) |
| `ConfigurationError` | `extends TheokitAgentError` | `extends Error` (próprio) | importa o **do SDK** | um contrato único (Q3 errors) |

Leitura transversal: o alvo **não** é envolver tudo — é terminar o padrão OO que o SDK já impõe (o sugar), e enriquecer só os 3 domínios com orquestração/estado/duplicação, deixando os 5 já-OO ou puros em pass-through.

## ADRs

### D1 — Eliminar o sugar convertendo as 12 factory functions em classes `Capability` (termina a migração do SDK)

**Decisão:** cada factory function vira uma classe que implementa `Capability`, instanciada por `new` (sync puras) — `agent()` vira `AgentBuilder` construível. Alinha com o `X.create()`/classe que o SDK padronizou e que `ModelCapability`/`ToolsCapability`/`AgentRunner.fromSpec` já seguem.

**Alternativas consideradas:** manter as capabilities-função (status quo) — rejeitada pela decisão do owner (OO puro) e pela inconsistência 2-classes/10-funções; usar `.create()` estático em vez de `new` — rejeitada: capabilities são sync sem factory-logic, `.create()` seria a cerimônia inversa (o SDK reserva `.create()` para o que tem construção async/validada).

**Consequência:** reverte o ADR-0001 (skills-como-função) — registrado com os 3 motivos de Q7. Breaking de API (as funções somem) → major do `@theokit/agents`.

### D2 — Camada seletiva: re-export puro em 5 domínios, enriquecer em 3, 1 aberto

**Decisão:** conforme a tabela Q3 — pass-through para core/persistence/sandbox/interactive/pty (já-OO ou puros), enriquecer goal/auth/errors (orquestração/estado/duplicação). sdk-tools decidido no roadmap-v2 (Q5, provável pass-through).

**Alternativas consideradas:** enriquecer tudo — rejeitada (Rung 9: wrapper sobre path helper puro é cerimônia); pass-through tudo — rejeitada (não seria "enriquecer", e deixaria `runGoalLoop`/auth soltos sem contrato).

**Consequência:** o theokit ganha um `GoalRunner`, um `CredentialStore`/`AuthProvider`, e resolve o `ConfigurationError` duplicado; os demais domínios são um barrel.

### D3 — agent-builder importa só de `@theokit/*`; gate de fronteira mecanizado

**Decisão:** repointing por domínio, theokit-primeiro; um teste de fronteira no agent-builder que falha se `from '@theokit/sdk*'` reaparecer (precedente: `check:direction`).

**Consequência:** o import direto do SDK vira um erro de CI, não uma convenção.

### D4 — Corte do roadmap-v2 (uma fatia por domínio, sugar primeiro)

**Decisão:** o roadmap-v2 corta ~9 milestones: **M(v2)0 sugar→OO** (o pré-requisito — o agent-builder consome o theokit OO), depois um por domínio de re-export/enriquecimento (goal, auth, errors, core+persistence+sandbox+interactive+pty agrupados por serem pass-through, sdk-tools), cada um com repointing + prova live. A ordem respeita dependências: sugar antes (a superfície OO existe), enriquecimentos antes do repointing daquele domínio.

**Alternativas consideradas:** roadmap-v2 direto sem discover (o owner rejeitou); um milestone gigante (viola a fatia-fina do Cycle).

## Recommendations — corte sugerido do roadmap-v2

| # | Milestone | Tipo | Fecha |
|---|---|---|---|
| 1 | Sugar → OO: 12 capabilities viram classes; `agent()`→`AgentBuilder` | breaking (major) | D1, Q6, Q7 |
| 2 | Domínios já-OO/puros: barrel `@theokit/agents` re-exporta core/persistence/sandbox/interactive/pty; repointa o agent-builder | aditivo | D2, Q3 |
| 3 | Goal enriquecido: `GoalRunner` classe sobre `runGoalLoop`; repointa | aditivo | D2, Q3 |
| 4 | Auth enriquecido: `CredentialStore`/`AuthProvider`; repointa os 3 arquivos de auth | aditivo | D2, Q3 |
| 5 | `ConfigurationError` unificado: um contrato; repointa | breaking-de-tipo | D2, Q3 errors |
| 6 | sdk-tools: barrel `@theokit/agents/tools`; repointa `chat.ts` | aditivo | Q5 |
| 7 | Gate de fronteira: teste que proíbe `from '@theokit/sdk*'` no agent-builder | guard | D3, Q4 |

## Blocked questions

Nenhuma. As 7 questões respondidas com evidência do SDK, do theokit e do agent-builder.

## Nota de escopo (honestidade)

Esta iniciativa toca **dois repos** e reverte um ADR aprovado. O owner pediu discover-primeiro exatamente para revisar este design antes de committar escopo. **O entregável desta fase é este blueprint** — nenhum código de produção foi tocado, nenhum milestone cortado. O corte do roadmap-v2 (Recommendations) é proposta, não decisão.
