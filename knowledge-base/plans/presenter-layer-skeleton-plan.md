---
slug: presenter-layer-skeleton
milestone_id: M49
created_at: 2026-07-23
goal: criar o pacote @theokit/presenter (evento canônico AgentOutputEvent + contrato Presenter Strategy + registry) e mover o tradutor web UIMessageStream para trás do contrato com ZERO mudança de comportamento
---

# Plan: presenter-layer-skeleton (M49) — @theokit/presenter (walking skeleton)

## Goal

theokit já é "adapter sobre o SDK" com formato canônico web (`UIMessageStream`), mas os tradutores são
web-cêntricos e o terminal re-implementa tudo (dogfood do agent-builder). Este milestone estabelece a
**camada de apresentação** como fronteira nomeada e reutilizável: um pacote `@theokit/presenter` com (a) o
evento canônico `AgentOutputEvent` (a cintura estreita), (b) o contrato `Presenter` (Strategy) + registry,
e (c) `UIMessageStreamPresenter` — o tradutor web atual movido para trás do contrato com **ZERO mudança de
comportamento**. É o skeleton que prova a cintura contra os consumidores web reais (publicados).

## Baseline Context (deep review do estado atual)

**Achado (discover 2026-07-23):** o tradutor web `translateToUIMessageStream` (`packages/agents/src/bridge/ui-message-stream-translator.ts:181`) converte `AgentStreamEvent → UIMessageStream`; o normalizador `translateSdkEvent`/`translateInteractionUpdate` (`packages/agents/src/bridge/event-translator.ts:153,181`) converte `SDKMessage → StreamEvent`. O terminal traduz em paralelo (`@theokit/tui/src/messages-to-events.ts`) — sem contrato compartilhado. `check:direction` do theokit enforce a direção de dependência.

### Files that will be touched

| Arquivo | LoC | Papel | file:line-chave |
|---|---|---|---|
| `packages/presenter/` | NOVO | o pacote da camada de apresentação | package.json + src/{agent-output-event,presenter,source/from-sdk,presenters/ui-message-stream}.ts |
| `packages/agents/src/bridge/ui-message-stream-translator.ts` | ~230 | tradutor web atual → substituído por import do presenter | `translateToUIMessageStream` (`:181`) |
| `packages/agents/src/bridge/event-translator.ts` | ~200 | lógica SDK→evento reusada por `from-sdk` | `translateSdkEvent` (`:153`), `translateInteractionUpdate` (`:181`) |
| `packages/agents/src/bridge/agent-sse-handler.ts` | — | caller do tradutor web (passa a usar o presenter) | consome `translateToUIMessageStream` |

### Current callers / dependents

- `agents/bridge/agent-sse-handler.ts` (+ demais callers de `translateToUIMessageStream`) → passam a chamar `UIMessageStreamPresenter`.
- Teste E2E do M1 (`@ai-sdk/react useChat` + assistant-ui) → o oráculo de zero-behavior-change.
- `check:direction` → valida a seta `@theokit/sdk → @theokit/presenter → @theokit/agents`.

### Domain glossary

- **AgentOutputEvent** = a DU canônica normalizada (text/reasoning/tool-call/tool-result/error/finish/status) — a cintura estreita entre fontes (SDK) e presenters (surfaces).
- **Presenter (Strategy)** = `AgentOutputEvent → SurfaceOutput`; uma implementação por surface (web/terminal/json).
- **zero-behavior-change** = o `UIMessageStream` emitido é byte-idêntico pré/pós (snapshot + E2E do M1).
- **check:direction** = gate do theokit que valida a direção das dependências entre pacotes (DIP).

### Architecture boundaries affected

- **Novo pilar interno:** `@theokit/presenter` depende SÓ dos types do `@theokit/sdk`; `agents` depende de `presenter` (não o contrário). DIP; SRP de pacote (apresentação ≠ orquestração).
- Nenhuma dep externa nova (reusa `@theokit/sdk` + o shape `UIMessageStream` do ai-sdk já presente).

**Baseline de segurança:** `pnpm test`/`typecheck`/`lint` do theokit verdes hoje; o E2E do M1 é a rede do refactor. develop, tree limpo (pós-lock do roadmap).

## ADRs

### ADR-1 — Novo pacote `@theokit/presenter`, não estender `@theokit/agents`

- **Decisão:** a camada vive num pacote próprio que depende só dos types do SDK.
- **Alternativas:** deixar em `agents/bridge` (onde os tradutores estão) — mas aí o **tui não pode consumir sem puxar o framework web** (o caso matador do M50). Rejeitada.
- **Rationale:** SRP de pacote + o tui/agent-builder consomem o presenter sem o framework. `check:direction` garante a seta. DIP.

### ADR-2 — Evento canônico novo `AgentOutputEvent` (cintura estreita), não reusar SDKMessage nem AgentStreamEvent

- **Decisão:** definir uma DU normalizada derivada dos discriminantes do SDK (source-side).
- **Alternativas:** SDKMessage (cru demais — payloads `unknown`); AgentStreamEvent (UI-acoplado). Rejeitadas.
- **Rationale:** evita N×M tradutores (o mess atual). UMA fonte, N presenters. DRY estrutural. Hourglass narrow-waist.

### ADR-3 — Clean break do tradutor inline (sem retrocompat)

- **Decisão:** mover `translateToUIMessageStream` para `UIMessageStreamPresenter` e DELETAR o inline; callers importam do presenter.
- **Rationale:** o owner dispensou retrocompat; DRY (uma implementação). O E2E do M1 garante zero-behavior.

## Tasks

### Phase 0 — skeleton + web via contrato

### T0.1 — Scaffold do pacote `@theokit/presenter`

Criar `packages/presenter/` espelhando um pacote-folha existente (package.json, tsconfig estendendo base, biome, vitest). Dep: só `@theokit/sdk`. Registrar no workspace (glob `packages/*` já cobre).

##### Why this step
Sem o pacote, não há fronteira. É o rung 4 (reusa a convenção do monorepo, não reinventa scaffold).

##### TDD
- `test_package_builds_and_exports_barrel`: `pnpm --filter @theokit/presenter build` + import do barrel resolve.
- `check:direction` verde: presenter não importa agents/http/theo/tui.

#### Concurrency tests
- `(none — build/scaffold)`.

### T0.2 — `AgentOutputEvent` (DU canônica) + `Presenter` contract + registry

`agent-output-event.ts`: a DU (text/reasoning/tool-call/tool-result/error/finish/status) + type-guards. `presenter.ts`: `interface Presenter<TOut> { present(e: AgentOutputEvent): TOut[] }` + `PresenterRegistry` (resolve por surface key).

##### Why this step
A cintura estreita (ADR-2) — a peça load-bearing. Testável isolada.

##### TDD
- `test_agent_output_event_variants`: cada variante constrói + o type-guard discrimina (RED→GREEN por variante).
- `test_presenter_registry_resolves_by_key`: registrar + resolver um presenter fake por key.

#### Concurrency tests
- `(none — tipos puros)`.

### T0.3 — `fromSdk` (source translator) reusando a lógica do event-translator

`source/from-sdk.ts`: `SDKMessage | InteractionUpdate → AgentOutputEvent`, portando a lógica de `translateSdkEvent`/`translateInteractionUpdate` (`event-translator.ts:153,181`).

##### Why this step
A fonte única SDK→canônico; o que alimenta TODOS os presenters. Reusa lógica testada (Don't-Reinvent).

##### TDD
- `test_from_sdk_covers_each_discriminant`: text/tool-input/tool-result/reasoning/error/finish → a variante canônica certa (RED→GREEN por discriminante).

#### Concurrency tests
- `(none — tradução pura por evento)`.

### T0.4 — `UIMessageStreamPresenter` + clean break do inline (zero-behavior)

`presenters/ui-message-stream.ts`: `AgentOutputEvent → UIMessageStream` (comportamento de `translateToUIMessageStream`). `agents/bridge` importa do presenter; deletar o tradutor inline; callers ajustados.

##### Why this step
Prova a cintura no path web publicado (ADR-3). Zero-behavior é o gate.

##### TDD
- `test_ui_message_stream_snapshot_identical`: snapshot do `UIMessageStream` emitido para um run representativo é byte-idêntico ao do tradutor atual (golden capturado antes do delete).
- E2E do M1 (`useChat` + assistant-ui) permanece verde.

#### Concurrency tests
- `(none — stream sequencial por turno)`.

### T0.5 — Validação: gates verdes + CHANGELOG + publint

`pnpm test`/`typecheck`/`lint`/`check:direction`/`validate:publint` verdes; CHANGELOG do `@theokit/presenter` (V1) + `[Unreleased]` do theokit.

##### Why this step
DoD do M49 (fronteira estabelecida, web via presenter, zero-behavior). Fecha o skeleton.

##### TDD
- N/A (validação). Acceptance: todas as gates verdes; snapshot idêntico; E2E M1 verde.

#### Concurrency tests
- `(none — validação)`.

## Coverage Matrix

| # | DoD claim | ADR | Tasks |
|---|---|---|---|
| 1 | Pacote `@theokit/presenter` dep só do SDK; check:direction verde | ADR-1 | T0.1, T0.5 |
| 2 | `AgentOutputEvent` DU + type-guards | ADR-2 | T0.2 |
| 3 | `Presenter` contract + registry | ADR-2 | T0.2 |
| 4 | `fromSdk` cobre cada discriminante | ADR-2 | T0.3 |
| 5 | `UIMessageStreamPresenter` + clean break do inline | ADR-3 | T0.4 |
| 6 | Zero-behavior no path web (snapshot + E2E M1) | ADR-3 | T0.4, T0.5 |

## Failure scenarios

| Cenário | Task cobre |
|---|---|
| Mover o tradutor quebra `useChat`/assistant-ui | T0.4 (snapshot idêntico + E2E M1 = oráculo; delete só após verde) |
| `AgentOutputEvent` não generaliza p/ terminal (M50) | T0.2 (DU derivada de discriminantes do SDK, não de UIMessageStream); M50 valida |
| Import reverso (presenter→agents) fura a direção | T0.1 (`check:direction` falha o gate) |
| publint reprova o pacote novo | T0.5 (`validate:publint`) |

## Drawbacks & Risks

| # | Risco | Impacto | Mitigação |
|---|---|---|---|
| 1 | Refactor do path web publicado | Quebra consumidores reais | zero-behavior atrás do contrato; snapshot + E2E M1; clean-break só após verde |
| 2 | Scaffold de pacote novo no monorepo (tsconfig/build order) | Fricção de build | espelhar pacote-folha existente (rung 4); `check:direction`/`publint` como gates |
| 3 | DU canônica mal-dimensionada | Retrabalho no M50/M51 | derivar dos discriminantes do SDK; 2 presenters seguintes validam a generalidade |

## Unresolved Questions

(none — every decision is resolved at plan time) — o discover mapeou os tradutores atuais com file:line, as 7
decisões de arquitetura estão travadas (novo pacote, evento canônico novo, clean break), e o E2E do M1 é o
oráculo do zero-behavior. As assinaturas estão fixadas.

## Prior Art

- theokit: `packages/agents/src/bridge/ui-message-stream-translator.ts` (o tradutor web a mover), `event-translator.ts` (a lógica SDK→evento a portar), `loop/loop-strategy.ts` (Strategy já usado no loop). ROADMAP M1 (UIMessageStream canônico), M4 (harness-adapter).
- @theokit/tui: `src/messages-to-events.ts` (a duplicação terminal — alvo do M50).
- Blueprint discover: `knowledge-base/discoveries/blueprints/multi-surface-presentation-layer-blueprint.md`.
- Padrão: GoF Strategy + Presenter (Clean Architecture/MVP); narrow-waist (hourglass) para o evento canônico.

## Global Definition of Done

- [ ] `@theokit/presenter` criado, dep só do SDK, `check:direction` verde.
- [ ] `AgentOutputEvent` DU + type-guards; `Presenter` contract + registry.
- [ ] `fromSdk` cobre cada discriminante do SDK.
- [ ] `UIMessageStreamPresenter` substitui o inline (clean break); callers ajustados.
- [ ] Zero-behavior no path web: snapshot `UIMessageStream` idêntico + E2E M1 verde.
- [ ] `pnpm test`/`typecheck`/`lint`/`check:direction`/`validate:publint` verdes; CHANGELOG atualizado.
