# Discovery Plan: Declarative Agent Orchestration — dar runtime ao `@MainLoop` (builder + strategy)

> **Version 1.1** (edge-cases absorvidos 2026-06-23: EC-1 rebalanceou budget; EC-2 cross-check do tool-loop-agent; EC-3/EC-4 viraram halt-loop checkpoints — ver `reviews/declarative-agent-orchestration-edge-cases-2026-06-23.md`) — Investiga como Spring AI (`ChatClient.builder()` + Advisors como strategy + Spring Boot starters/auto-config) e Mastra (`tool-loop-agent` multi-round + workflow stream tipado em TS) implementam **construção fluente (builder)** + **comportamento variável (strategy)** + **loop multi-round** para agentes — a fim de informar como dar RUNTIME ao `strategy` do `@MainLoop` do `@theokit/agents` (hoje metadata-only) como `ReflectionStrategy`/`LoopStrategy` + `AgentRunner` builder, compilando para o factory core do SDK (ADR 0031), no padrão Spring Boot (decorator OU builder). Saída: blueprint que vira o ADR de V4-B..V4-D do [`ROADMAP-v4`](../../../../../../theokit-sdk/docs/gap-audit/ROADMAP-v4.md).

**Slug:** `declarative-agent-orchestration`
**Owner:** paulo
**Created:** 2026-06-23
**Time budget:** 7h (Spring AI 4h, Mastra 2h, in-repo agents 1h — ver ADR D1; rebalanceado por EC-1)

## Context

O V4-A ([`V4A-adoption-gap-diagnosis.md`](../../../../../../theokit-sdk/docs/gap-audit/V4A-adoption-gap-diagnosis.md)) provou empiricamente que o `@theokit/agents` declara orquestração mas não a executa: `@MainLoop({ strategy: 'simple-chat' | 'plan-act-reflect' | 'react' })` é obrigatório (`packages/agents/src/bridge/walk-agent-metadata.ts:5`) e compilado (`packages/agents/src/bridge/agent-compiler.ts`), mas o orquestrador (`packages/agents/src/bridge/agent-orchestrator.ts`) é single-shot e nunca faz branch em `strategy` — é o anti-pattern "decorator-without-runtime" que o **ADR 0031** + a regra **`sdk-runtime.md`** mandam fechar (decorator descreve, bridge compila, SDK executa, sem IoC). O M8 (`m8-decorator-runtime-plan.md`) fechou isso para `@ContextWindow`/`@Skills`; falta o `@MainLoop`. Antes de dar runtime, precisamos de prior-art sólido em DOIS eixos genuinamente abertos: o **builder fluente** (gêmeo imperativo do decorator) e a **strategy nomeada** (loop/reflexão swappável). Spring AI e Mastra são os SOTA de cada eixo (ver `ROADMAP-v4` §8). A patterns-skill `theokit-http-decorators-pattern-from-nestjs` já cobriu os decorators de superfície; este discovery cobre só a ORQUESTRAÇÃO.

## Objective

Produzir um blueprint que permita decidir **como dar runtime ao `strategy` do `@MainLoop` como `ReflectionStrategy`/`LoopStrategy` + `AgentRunner` builder, compilando para `Agent.create()`/`Run.stream()`, sem IoC e sem partir o on-ramp imperativo.**

- [ ] Todas as research questions respondidas com citações a `.claude/knowledge-base/references/`
- [ ] Tabela de comparação cross-cutting (Spring AI vs Mastra vs `@theokit/agents` atual) populada
- [ ] ≥1 proposta de decisão concreta por research question (ex: "LoopStrategy expõe `shouldContinue(outcome)` like Mastra's tool-loop-processor")
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/spring-ai/` | `spring-ai-client-chat/src/main/java/org/springframework/ai/chat/client/` (builder + `advisor/api/`), `auto-configurations/models/chat/client/` | SOTA de builder→runtime + Advisor-as-strategy + starter/auto-config |
| `.claude/knowledge-base/references/mastra/` | `packages/core/src/tool-loop-agent/`, `packages/core/src/agent/`, `packages/core/src/stream/` | SOTA de loop multi-round + workflow/strategy tipado em TS (mesmo ecossistema do `@theokit/agents`) |
| `theokit/packages/agents/` (in-tree — alvo, não referência) | `src/bridge/`, `src/decorators/main-loop.ts`, `src/types.ts` | Anchor: o que existe hoje (metadata-only) que o blueprint precisa estender (ver ADR D3) |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/spring-ai/models/*` | Adapters de provider — não é a camada de orquestração |
| `.claude/knowledge-base/references/spring-ai/spring-ai-rag/` (exceto 1 advisor de exemplo) | RAG é outro domínio; só o `RetrievalAugmentationAdvisor` serve de exemplo de strategy concreta |
| `.claude/knowledge-base/references/mastra/` (todos os packages exceto `core`) | Integrations/deployers/cli fora do escopo de orquestração |
| `.claude/knowledge-base/references/*/{build,dist,node_modules,target,.venv}/` | Build artifacts |
| Decorators de DECLARAÇÃO (`@Agent`/`@Tool`/`@Skills`) | Já existem + já têm runtime (M8); cobertos pela patterns-skill http-decorators. Este discovery é só ORQUESTRAÇÃO. |
| `@theokit/di` / IoC container | Proibido por ADR 0031 / D431 — restrição, não objeto de pesquisa |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** Spring AI 4h · Mastra 2h · in-repo agents 1h (total 7h). *(Rebalanceado por EC-1: Spring tem 4 questões verbosas em Java — Q1/Q2/Q4/Q7 — e Mastra só 2 em TS — Q3/Q5; budget igual deixaria Spring sub-orçado.)*

**Rationale:** Spring AI e Mastra são igualmente load-bearing (um é o SOTA de builder+advisor+starter, o outro de loop+strategy em TS, o ecossistema-alvo), mas Spring concentra mais questões e Java é mais verboso de ler — daí 4h vs 2h. O in-repo é leitura de grounding (já mapeado no V4-A), por isso 1h.

**Alternatives considered:** deep-dive só no Mastra (mesmo stack) — rejeitado: o Spring AI é o melhor modelo de builder+advisor+starter (o "Spring Boot" que o owner citou); equal split — adotado.

**Stop condition — per question (mandatory):** quando a Fase A de uma questão retorna vazio após 3 retries com variantes de query, marcar BLOCKED com motivo "Fase A exhausted" e seguir. NUNCA preencher com hotspots de outra questão.

**Stop condition — per project (mandatory):** orçamento esgotado → marcar questões pendentes do projeto BLOCKED ("budget exhausted") e avançar. Se todas as restantes estão `done`/`blocked`, emitir `<promise>BLUEPRINT_BLOCKED</promise>` (não `BLUEPRINT_COMPLETE`).

**Anti-pattern:** NUNCA fabricar respostas de Fase B para fechar questão com Fase A esgotada (Unbreakable Rule 3).

**Consequences:** o halt-loop para por projeto ao esgotar orçamento; questões bloqueadas viram seed do próximo discovery.

### D2 — Investigation depth

**Decision:** Ler end-to-end os arquivos-âncora (`DefaultChatClient.java`, `Advisor.java`/`CallAdvisor.java`/`BaseAdvisor.java`, `tool-loop-processor.ts`, `MastraWorkflowStream.ts`); usar ast-grep/grep para mapear hotspots (builder methods, advisor `aroundCall`, loop terminals) antes de cada Read.

**Rationale:** os arquivos-âncora são a spec executável do padrão; os demais são lidos só nos hotspots que a Fase A apontar (KISS — não ler o monorepo inteiro).

**Consequences:** profundidade nos contratos (builder/strategy/loop), amplitude só onde o hotspot-map justificar.

### D3 — In-repo `@theokit/agents` é citável como anchor in-tree (não como referência clonada)

**Decision:** O blueprint cita `theokit/packages/agents/src/...` como anchor do estado atual (o que estender), além das referências em `.claude/knowledge-base/references/`. Espelha o que a patterns-skill `theokit-http-decorators-pattern-from-nestjs` fez ao citar `packages/theo/src/...`.

**Rationale:** o objeto do discovery é COMO estender um pacote in-tree; ignorar o estado atual produziria recomendações desancoradas. As citações in-tree são verificáveis (`file:line`) tanto quanto as de referência.

**Consequences:** o `discover-confidence` valida citações de referência (`.claude/knowledge-base/references/`); as citações in-tree são validadas por leitura humana no `/review` downstream (mesma convenção do http-decorators blueprint).

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — ast-grep/grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | Como o `DefaultChatClient` do Spring AI implementa o padrão **builder→executável** (o builder coleta config e produz um objeto que executa)? Mapeia para `AgentRunner.builder(...).build()`. | techniques | `.claude/knowledge-base/references/spring-ai/spring-ai-client-chat/src/main/java/org/springframework/ai/chat/client/` | `grep -nE "Builder|build\(\)|\.advisors\(|\.tools\(" DefaultChatClient.java` para mapear métodos fluentes + ponto de `build()` | Ler `DefaultChatClient.java` end-to-end: como o builder acumula estado e materializa o request; onde o "compile→execute" acontece | Diagrama builder→runtime + tabela de métodos fluentes → efeito, com `path:line` |
| Q2 | Como o **Advisor** do Spring AI implementa Strategy (comportamento around-the-call, ordenado, com short-circuit)? Mapeia para `ReflectionStrategy`/`LoopStrategy` nomeada+swappável. | techniques | `.claude/knowledge-base/references/spring-ai/spring-ai-client-chat/src/main/java/org/springframework/ai/chat/client/advisor/api/` | `grep -nE "interface |aroundCall|aroundStream|getOrder|nextAroundCall" Advisor.java CallAdvisor.java BaseAdvisor.java` | Ler as 3 interfaces + `RetrievalAugmentationAdvisor.java` (impl concreta): contrato, ordenação, encadeamento, como uma advisor decide continuar/parar | Contrato da Strategy (métodos + ordem + short-circuit) + 1 impl exemplo, com `path:line` |
| Q3 | Como o `tool-loop-agent` do Mastra implementa o **loop multi-round** (terminais, max-steps, re-prompt) e o **stream**? Mapeia para `LoopStrategy`/`strategy:'react'`. | techniques | `.claude/knowledge-base/references/mastra/packages/core/src/tool-loop-agent/`, `.../stream/`, `.../agent/index.ts` | **(EC-2 cross-check)** primeiro `grep -nE "tool-loop|tool-loop-agent" .../agent/index.ts` para confirmar se `tool-loop-agent` é o loop canônico (não experimento alpha); se for experimental, ler `agent/index.ts` como fonte primária. Depois `grep -nE "while\|for \|maxSteps\|stepCount\|finishReason\|shouldContinue\|terminal" tool-loop-agent/index.ts tool-loop-processor.ts` | Ler `tool-loop-processor.ts` + `index.ts` (+ `agent/index.ts` se canônico) + `MastraWorkflowStream.ts`: como decide próximo round vs terminar; como emite eventos | Máquina de estados do loop (round→outcome→{continue,terminate}) + modelo de stream + nota se é canônico ou alpha, com `path:line` |
| Q4 | Como o Spring AI **testa um Advisor** isolado e composto na cadeia do ChatClient (sem LLM real)? Informa como testar `ReflectionStrategy`/`LoopStrategy`. | tests | `.claude/knowledge-base/references/spring-ai/spring-ai-client-chat/src/test/java/org/springframework/ai/chat/client/` | `grep -nE "@Test|mock|Mockito|when\(|verify\(" ChatClientAdvisorTests.java advisor/SimpleLoggerAdvisorTests.java` | Ler os 2 testes: como mockam o model, como asseguram ordem/short-circuit da strategy | Tabela: teste → o que mocka → o que asserta, com `path:line` |
| Q5 | Como o Mastra **testa o loop multi-round** do `tool-loop-agent` (model mockado retornando vários rounds)? Informa teste determinístico do `LoopStrategy` sem LLM real. | tests | `.claude/knowledge-base/references/mastra/packages/core/src/tool-loop-agent/__tests__/` | `grep -nE "it\(|describe\(|mock|vi\.fn|maxSteps|rounds?|toolCall" tool-loop-agent.test.ts` | Ler `tool-loop-agent.test.ts`: setup do model mock multi-round, asserts de terminação/iterações | Receita de teste (mock multi-round → assert terminais/maxIterations), com `path:line` |
| Q6 | Que **deps de runtime** a camada de orquestração exige em cada ref, e o builder/strategy requer o container DI do framework ou é standalone? Valida "sem IoC novo" (ADR 0031). | deps | `.claude/knowledge-base/references/mastra/packages/core/package.json`, `.claude/knowledge-base/references/spring-ai/pom.xml`, `.../client/DefaultChatClient.java` | `grep -nE "dependencies|@ai-sdk|ttlcache" packages/core/package.json`; `grep -nE "spring-context|ApplicationContext|@Autowired|spring-boot" DefaultChatClient.java pom.xml` | Ler deps + checar se o `DefaultChatClient`/builder instancia sem `ApplicationContext` (standalone) ou exige DI | Lista de deps por ref + veredito "builder/strategy é standalone vs precisa de DI", com `path:line` |
| Q7 | Como o Spring Boot **starter/auto-configuration** empacota um agente opinativo default (o modelo V4-H "starter"), e que tooling de build o habilita? | tools | `.claude/knowledge-base/references/spring-ai/auto-configurations/models/chat/client/`, `.../models/spring-ai-autoconfigure-model-anthropic/` | `grep -nE "@AutoConfiguration|@ConditionalOn|@Bean|Properties" AnthropicChatAutoConfiguration.java`; Glob por `AutoConfiguration.imports`, `pom.xml` do módulo autoconfigure | Ler `AnthropicChatAutoConfiguration.java` + `ChatClientAutoConfigurationTests.java`: como o starter auto-wira um default + como é testado/empacotado | Modelo de starter (auto-wire condicional + properties + build) → mapeável a `@theokit/starter-*`, com `path:line` |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q4, Q5 | Covered |
| Dependencies | Q6 | Covered |
| Tools | Q7 | Covered |
| Techniques | Q1, Q2, Q3 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | path declarado na Fase A existe | marcar Qx BLOCKED ("path not found"), seguir |
| Per-question Fase A budget | Fase A retornou ≥1 hotspot OU 3 retries tentados | após 3 retries vazios, BLOCKED ("Fase A exhausted"); seguir |
| After answering Qx | seção do blueprint sob Qx tem ≥1 citação `path:line` | re-iterar Qx (1 retry) |
| Mid-loop sanity | citações a `.claude/knowledge-base/references/` ≥ 1 / 200 palavras de prosa | adicionar citações (1 retry) |
| Per-project time budget | orçamento do projeto não esgotado | ao esgotar, BLOCKED ("budget exhausted") nas pendentes; avançar projeto |
| Before promising complete | os 4 corners têm seção populada | recusar promise, continuar |
| **(EC-3) Spring AI portabilidade** | Fase B das questões Java (Q1/Q2/Q4/Q7) capturou o **contrato language-agnostic** e marcou mecanismos Java-only (anotações/`ApplicationContext`/overloading) como NÃO-portáveis | re-iterar a questão flagando o que não traduz para TS |
| **(EC-4) Advisor≠Strategy multi-round** | Q2 registrou explicitamente **onde a analogia Advisor→LoopStrategy quebra** (Advisor = interceptor per-call; LoopStrategy = decisão entre rounds) | re-iterar Q2 adicionando a nota de divergência |

## Acceptance Criteria

- [ ] Todas as research questions respondidas OU BLOCKED com motivo
- [ ] Os 4 corners com seções populadas no blueprint
- [ ] Toda citação aponta para path real (`.claude/knowledge-base/references/{...}` ou anchor in-tree `packages/agents/...` por ADR D3)
- [ ] ≥1 seção ADR no blueprint sintetizando as decisões (incl. proposta de contrato `LoopStrategy`/`ReflectionStrategy` + shape do `AgentRunner.builder()`)
- [ ] Time budget respeitado por projeto
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint salvo em `.claude/knowledge-base/discoveries/blueprints/declarative-agent-orchestration-blueprint.md`

## Global Definition of Done

- [ ] Todas as fases (plan → edge-cases → execute → confidence → improve se preciso → confidence re-score)
- [ ] Verdict final do `/discover-confidence` no header do blueprint
- [ ] Zero citação fabricada
- [ ] Coverage Matrix 100%
- [ ] ADRs referenciam ≥1 princípio/regra do projeto — aqui: `architecture.md` (INVARIANT #3 barrels + direção `agents → sdk`, ADR 0030), `sdk-runtime.md` (bridge compila / SDK executa / sem IoC, ADR 0031), `type-safety.md` (Zod SSoT para schemas de strategy), KISS/YAGNI (strategy só com ≥2 impls reais)
