# Blueprint: abrir o seam de `LoopStrategy` — critério de parada injetável

**Slug:** `loop-strategy-seam`
**Grill:** `knowledge-base/grills/loop-strategy-seam-feature-grill.md`
**Date:** 2026-07-24
**Verdict:** `SHIPPABLE` (99.7/100, zero caps) — /discover-confidence 2026-07-24.

**Fontes independentes:** duas — o próprio código do runner (`packages/agents/src/loop/`, o contrato que estamos abrindo) e `opencode` (peer clonado, harness de terminal em produção que já resolve o teto de passos).

## Context

O M54 abre `AgentRunnerBuilder.loopStrategy(custom: LoopStrategy)` para que o consumidor injete o critério de parada (`shouldContinue`) — o único dos quatro eixos de comportamento do runner que hoje é trancado (reflexão, compactação e produção do round já aceitam injeção). O grill (§ Q1) mapeou a assimetria de OCP; esta discovery investiga **como abrir o seam sem introduzir um loop infinito** — o risco 1 do grill, que o goal do owner proíbe tratar com workaround.

Regras consumidas: `.claude/rules/error-handling.md` § 2 (fail-fast), `.claude/rules/parsimony-ladder.md` (o seam é composição, não herança — Strategy), `.claude/rules/testing.md` § 4.1 (guardrail provado por teste, não comentário), ADR-0001 (Template Method recusado).

## Objective

Decidir, com evidência do código atual e de um peer em produção: **onde o teto de terminação deve ser aplicado** quando o critério de parada passa a ser injetável, e **como o override per-run de `maxIterations` interage com uma estratégia custom** — para que o M54 seja implementado sem re-trabalho e sem workaround.

## Sumário executivo

Abrir o seam é ~10 linhas (o builder já tem o padrão exato em `.reflection()`/`.compaction()`). O que **não** é trivial, e é o coração do milestone, são **dois defeitos que só ficam expostos quando o critério de parada deixa de ser interno**:

1. **Não existe teto duro no runner.** O loop é `while (!signal?.aborted)` (`run-reflective-loop.ts:493`) e só termina quando `shouldContinue` retorna `false` (`:532`). As três estratégias built-in embutem `round < maxIterations` **dentro** do próprio `shouldContinue` — então o teto é convenção de cada estratégia, não garantia do runner. Uma custom `shouldContinue: () => true` roda até o orçamento estourar (ou para sempre, com `budget` infinito). **Abrir o seam sem mover o teto para o runner É o workaround que o goal proíbe.**

2. **A re-resolução per-run quebra uma custom.** `agent-runner.ts:242-244`: quando o caller passa `opts.maxIterations`, o runner faz `resolveLoopStrategy(this.loopStrategy.name, opts.maxIterations)` — re-resolvendo pelo **nome** via `z.enum`. Uma custom (nome fora do enum) **crasha** aqui, e mesmo que não crashasse, a lógica custom de `shouldContinue` seria jogada fora e substituída pela built-in de mesmo nome.

O peer `opencode` confirma o design correto: aplica o teto **no runner**, não na estratégia.

## Coverage Corner 1 — Integration tests

### Q5 — Como o guardrail de terminação é provado hoje, e o que falta?

**Fontes:** repo local (1) — `SINGLE-SOURCE` (é o nosso contrato).

Hoje o teto é provado **indiretamente**: as três estratégias built-in têm `round < maxIterations` no `shouldContinue`, e os testes existentes exercitam esse caminho. **Não há um teste que prove que o runner para uma estratégia que ignora o teto** — porque hoje nenhuma estratégia pode ignorá-lo (o construtor as tranca).

O DoD do M54 exige exatamente esse teste: `shouldContinue: () => true` DEVE parar no `maxIterations`. Ele só é escrevível **depois** que o teto vive no runner. É o teste RED que dirige a implementação: hoje ele **trava** (loop infinito), e o fix é o que o faz passar.

**Decisão proposta:** o teste do guardrail injeta uma custom `{ name: 'always', maxIterations: 3, shouldContinue: () => true }` via um `streamFactory` que sempre devolve `tool-calls`, e asserta que o loop terminou em exatamente 3 rounds com `finishReason: 'step_limit'`. Sem o teto no runner, ele nunca termina — é a prova de que o gate pode falhar.

## Coverage Corner 2 — Dependencies

### Q4 — O `resolveLoopStrategy` e o `z.enum` são compatíveis com um nome custom?

**Fontes:** repo local (1).

Não. `loopStrategyConfigSchema` (`loop-strategy.ts:54`) valida `name: z.enum(['simple-chat','plan-act-reflect','react'])`. O DoD pede relaxar `LoopStrategy.name` de `MainLoopMeta['strategy']` para `string`. Mas `resolveLoopStrategy` é chamado em **dois** lugares (`agent-runner.ts:337` no build, `:243` no stream per-run) sempre pelo **nome** — e o `z.enum` **deve continuar** validando os 3 nomes internos (o DoD é explícito: "uma custom NUNCA passa pelo enum — ela entra pelo seam, não pela resolução por nome").

Delta: relaxar `LoopStrategy.name` para `string` (contrato) **sem** relaxar `loopStrategyConfigSchema` (resolução interna). A custom entra por `.loopStrategy(obj)`, nunca por `resolveLoopStrategy(name)`.

**Decisão proposta:** `LoopStrategy.name: string`; `loopStrategyConfigSchema.name` permanece `z.enum`. Os dois chamadores de `resolveLoopStrategy` só recebem os 3 nomes internos — a custom desvia deles por construção (ver Q6).

## Coverage Corner 3 — Tools

### Q7 — Qual gate prova o zero-behavior das 3 estratégias existentes?

**Fontes:** repo local (1).

A suíte atual de `packages/agents` (593 testes). O DoD exige que ela passe **sem editar uma expectativa**. O risco de regressão está em como o teto duro é adicionado: se ele mudar o `finishReason` de uma das 3 built-in num caso de teto, quebra o zero-behavior.

**Decisão proposta (a chave do zero-behavior):** o teto duro é adicionado **à condição de continuação existente**, não como um branch novo:

```ts
// hoje (:532):
if (!(reflectionResult.continue && loop.shouldContinue(outcome))) { … finalize … }
// M54:
if (!(reflectionResult.continue && loop.shouldContinue(outcome) && round < loop.maxIterations)) { … finalize … }
```

Para as 3 built-in, `round < maxIterations` **já está** embutido no `shouldContinue`, então o novo `&& round < loop.maxIterations` é **redundante e não muda nada** — a expressão tinha o mesmo valor. O `terminalReason(...)` (`:532-537`) recebe os mesmos argumentos e devolve o mesmo `step_limit`/`stop`. Zero-behavior por construção. Para uma custom `() => true`, o `&& round < loop.maxIterations` do runner é o que força a parada — o teto passa a ser do **runner**, não da estratégia.

Isso é provável de ser verificável mecanicamente: rodar a suíte sem editar expectativa (gate do DoD) + o teste de guardrail novo.

## Coverage Corner 4 — Techniques

### Q1 — Qual o padrão de precedência que `.loopStrategy()` deve seguir?

**Fontes:** repo local (1).

Idêntico a `.reflection()` e `.compaction()` (`agent-runner.ts:311,327`): um campo `#override` no builder, resolvido em `build()` como `this.override ?? <default derivado do spec>`. Para loopStrategy:

```ts
loopStrategy(custom: LoopStrategy): this { this.loopStrategyOverride = custom; return this }
// em build():
const loopStrategy = this.loopStrategyOverride ?? resolveLoopStrategy(strategy, spec.maxIterations)
```

A custom **vence** sobre a estratégia derivada do spec, com a mesma semântica de `.compaction()` ("builder override WINS", `:335`). Parcimônia: reuso do padrão existente, não invenção.

### Q6 — Como o override per-run de `maxIterations` (`agent-runner.ts:243`) lida com uma custom?

**Fontes:** repo local + `opencode` (2).

O ponto de quebra. Hoje: `opts.maxIterations != null ? resolveLoopStrategy(this.loopStrategy.name, opts.maxIterations) : this.loopStrategy`. Re-resolver pelo nome **descarta** a custom e crasha no `z.enum`.

**Decisão proposta:** re-resolver por nome **apenas** quando a estratégia é uma das built-in; para uma custom, aplicar o `opts.maxIterations` como o **novo teto** sem tocar no `shouldContinue`. Como o teto duro passa a viver no runner (Q7), a forma mais limpa e sem workaround é o runner usar `opts.maxIterations ?? loop.maxIterations` como teto efetivo — mas isso alarga o escopo. A alternativa mínima (KISS), que o plano deve decidir: um discriminador barato — se `loop` veio do override (custom), não re-resolver por nome; senão, manter o comportamento atual (zero-behavior para built-in). O plano escolhe entre "teto efetivo no runner" e "guardar a re-resolução por um flag de origem" com o trade-off medido.

**Evidência de prior art (`opencode`):** `packages/opencode/src/session/prompt.ts:1178-1179` — `const maxSteps = agent.steps ?? Infinity; const isLastStep = step >= maxSteps`. O teto é aplicado **no runner**, comparando o contador de passos contra o limite, independente de qualquer lógica de continuação. O `isLastStep` injeta o `MAX_STEPS_PROMPT` (`:1282`) — exatamente o padrão que o theokit já espelha em `STEP_LIMIT_HINT` (`run-reflective-loop.ts` § buildPrompt). O peer valida: **o teto é do loop, não da estratégia de parada.**

## Cross-cutting Comparison

| Eixo | `theokit` hoje | `opencode` (peer) | `theokit` alvo (M54) |
|---|---|---|---|
| Critério de parada | trancado (`z.enum` de 3 nomes) | `stopWhen`-style por passo | **injetável** via `.loopStrategy(custom)` |
| Onde o teto vive | dentro do `shouldContinue` de cada estratégia | no runner (`step >= maxSteps`) | **no runner** (`round < loop.maxIterations` na condição) |
| Custom pode ignorar o teto? | n/a (não há custom) | não — o runner impõe | **não** — o runner impõe |
| Nome da estratégia | `MainLoopMeta['strategy']` (union) | string livre | `string` (contrato); `z.enum` só na resolução interna |
| Override per-run de teto | re-resolve por nome (crasha custom) | teto é um número, não um nome | não re-resolve custom por nome |

Leitura transversal: as duas diferenças que importam — teto no runner e nome livre — são as que o `opencode` já tem e o theokit ainda não. O M54 alinha a esse desenho.

## ADRs

### D1 — Teto duro no runner, adicionado à condição existente (zero-behavior)

`&& round < loop.maxIterations` entra na condição de continuação de `run-reflective-loop.ts:532`. Redundante para as 3 built-in (que já o embutem no `shouldContinue`), determinante para uma custom. **Alternativas:** (a) branch novo `if (round >= max) finalize` antes do `shouldContinue` — muda a ordem de avaliação e arrisca um `finishReason` diferente para as built-in; (b) confiar que toda custom embuta o teto — é o workaround que o goal proíbe. **Consequência:** o teto passa a ser propriedade do runner; o teste `shouldContinue: () => true` para no teto (gate do DoD).

### D2 — `LoopStrategy.name: string`, `loopStrategyConfigSchema.name` permanece `z.enum`

Contrato relaxado; resolução interna intacta. **Alternativa:** relaxar o zod também — rejeitada, abriria a resolução por nome a qualquer string, e o DoD exige que a custom entre pelo seam, não pela resolução. **Consequência:** breaking de tipo (quem lê `.name` esperando a union) — declarado no CHANGELOG.

### D3 — `.loopStrategy(custom)` segue o padrão de `.compaction()`/`.reflection()`

`this.loopStrategyOverride ?? resolveLoopStrategy(...)` em `build()`. **Alternativa:** herança/subclasse de `AgentRunner` — recusada (ADR-0001 recusa Template Method; Strategy por composição é a escolha locked). **Consequência:** reuso do padrão, zero invenção (parcimônia rung 4).

### D4 — Re-resolução per-run: decisão deferida ao plano com trade-off medido

O ponto Q6 (`agent-runner.ts:243`) tem duas saídas mínimas; o plano escolhe com o número na mão (linhas tocadas, superfície de teste). Registrado aqui para não ser esquecido, não resolvido aqui — a discovery pergunta, o plano decide.

## Recommendations — para o M54 (por risco)

| # | Ação | Fecha | Evidência |
|---|---|---|---|
| 1 | Teto duro no runner (`&& round < loop.maxIterations` na condição) | risco 1 (loop infinito) + guardrail do DoD | Q7, D1, prior art opencode |
| 2 | `.loopStrategy(custom)` no builder, padrão `.compaction()` | seam do milestone | Q1, D3 |
| 3 | `LoopStrategy.name: string`; zod intacto | DoD item 2 | Q4, D2 |
| 4 | Tratar a re-resolução per-run para não crashar custom | Q6 (ponto de quebra secundário) | Q6, D4 |
| 5 | Teste `shouldContinue: () => true` para no teto | gate do DoD | Q5 |
| 6 | Zero-behavior: suíte passa sem editar expectativa | gate do DoD | Q7 |

## Blocked questions

Nenhuma. As 7 questões respondidas com evidência de código, dentro do escopo cirúrgico do milestone.
