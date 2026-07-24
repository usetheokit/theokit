---
slug: loop-strategy-seam
milestone_id: M54
created_at: 2026-07-24
goal: Abrir AgentRunnerBuilder.loopStrategy(custom) por composição (Strategy), movendo o teto de terminação do shouldContinue de cada estratégia para o runner, de modo que uma custom nunca cause loop infinito.
---

# Plan: abrir o seam de `LoopStrategy` — critério de parada injetável (OCP)

## Goal

Fechar a assimetria de OCP do `AgentRunner`: o critério de parada (`shouldContinue`) passa a ser injetável por composição, como já são reflexão, compactação e produção do round. E — o coração do milestone — o teto de terminação deixa de ser convenção de cada estratégia e passa a ser **garantia do runner**, para que uma custom `shouldContinue: () => true` pare no `maxIterations` em vez de rodar para sempre.

## Context

O grill (`knowledge-base/grills/loop-strategy-seam-feature-grill.md`) mapeou a assimetria de OCP. A discovery (`knowledge-base/discoveries/blueprints/loop-strategy-seam-blueprint.md`, `SHIPPABLE` 99.7) achou que abrir o seam expõe dois defeitos que hoje ficam escondidos porque o critério de parada é interno:

1. **Não há teto duro no runner.** O loop é `while (!signal?.aborted)` (`run-reflective-loop.ts:493`) e só termina quando `shouldContinue` devolve `false` (`:532`). As 3 built-in embutem `round < maxIterations` **dentro** do `shouldContinue`. Uma custom não é obrigada a isso. Abrir o seam sem mover o teto para o runner seria o workaround que o goal proíbe.
2. **A re-resolução per-run quebra uma custom.** `agent-runner.ts:243` re-resolve `resolveLoopStrategy(this.loopStrategy.name, opts.maxIterations)` pelo **nome** via `z.enum` — uma custom crasharia.

Prior art `opencode` (`packages/opencode/src/session/prompt.ts:1178`): `step >= maxSteps` aplicado **no runner**, não na estratégia — valida o design.

## Baseline Context (deep review of current state)

**Git sha:** `498f71ae` (branch `develop`).

### Files that will be touched

| Arquivo | LoC | Papel hoje | O que muda |
|---|---|---|---|
| `packages/agents/src/loop/loop-strategy.ts` | 102 | Define `LoopStrategy` (`name: MainLoopMeta['strategy']`), `loopStrategyConfigSchema` (`z.enum`), `resolveLoopStrategy` | `LoopStrategy.name` relaxa para `string`; o `z.enum` **permanece** (resolução interna) |
| `packages/agents/src/loop/agent-runner.ts` | 356 | Builder (`.reflection()`/`.compaction()`) + runner (`stream()` re-resolve em `:243`) | ganha `.loopStrategy(custom)` + `loopStrategyOverride`; `:243` deixa de crashar custom |
| `packages/agents/src/loop/run-reflective-loop.ts` | 567 | O loop `while(!aborted)`; termina em `:532` via `shouldContinue` | teto duro: `&& round < loop.maxIterations` entra na condição de `:532` |

### Current callers / dependents

- `resolveLoopStrategy` — 2 chamadores de produção: `agent-runner.ts:337` (build, nome do spec) e `:243` (stream per-run). Um terceiro: `agent-orchestrator.ts:173` (delegate). **Todos passam um dos 3 nomes internos** — nenhum passa custom. ~30 usos em testes, todos com nomes válidos.
- `loop.name` — lido em `run-reflective-loop.ts:471` (`agentName` fallback), `:521` e `:539` (`finalize(..., loop.name)`). Os três tratam como **string** — relaxar o tipo não os quebra.
- `.loopStrategy` — não existe ainda; será o novo método do builder.

### Domain glossary

| Termo | Significado |
|---|---|
| **LoopStrategy** | `{ name, maxIterations, shouldContinue(outcome): boolean }` — o critério de parada |
| **teto duro** | `round < maxIterations` imposto pelo runner, independente do que `shouldContinue` devolva |
| **seam** | ponto de injeção por composição (Strategy); o oposto de herança/subclasse |
| **built-in** | as 3 estratégias resolvidas por nome (`simple-chat`/`plan-act-reflect`/`react`) |
| **zero-behavior** | a suíte atual passa sem editar nenhuma expectativa |

### Architecture boundaries affected

`packages/agents/src/loop/` apenas. Sem novo pacote, sem novo módulo. O seam é composição dentro do builder existente (ADR-0001 recusa Template Method/herança).

### Estado do guardrail no baseline (medido)

O loop `run-reflective-loop.ts:493` é `while (!signal?.aborted)`. A única saída por teto é `shouldContinue` devolver `false` (`:532`). As 3 built-in embutem `round < maxIterations`:
- `simple-chat`: `() => false` (para no round 1).
- `plan-act-reflect`: `(o) => o.round < cfg.maxIterations`.
- `react`: `(o) => o.finishReason === 'tool-calls' && o.round < cfg.maxIterations`.

**Não há teste que prove o runner parando uma estratégia que ignora o teto** — porque hoje nenhuma pode ignorá-lo (o construtor as tranca via `resolveLoopStrategy`).

## Prior Art & Related Work

| Fonte | O que aporta | Onde |
|---|---|---|
| Blueprint desta discovery | as 4 decisões (D1 teto no runner; D2 name string + zod intacto; D3 padrão .compaction; D4 re-resolução) | `knowledge-base/discoveries/blueprints/loop-strategy-seam-blueprint.md` |
| `opencode` | teto de passos aplicado **no runner** (`step >= maxSteps`), não na estratégia | `knowledge-base/references/opencode/packages/opencode/src/session/prompt.ts:1178` |
| Padrão existente do builder | `.reflection()`/`.compaction()` — `this.override ?? default` | `agent-runner.ts:311,327,335` |
| Grill | a assimetria de OCP e os 2 riscos | `knowledge-base/grills/loop-strategy-seam-feature-grill.md` |

## Objective

Ao fim: (a) `AgentRunnerBuilder.loopStrategy(custom)` existe e vence sobre a estratégia do spec; (b) o teto de terminação é imposto pelo **runner**, provado por uma custom `() => true` que para no teto; (c) as 3 built-in resolvem idênticas — suíte passa sem editar expectativa; (d) o override per-run de `maxIterations` não crasha uma custom.

## ADRs

### D1 — Teto duro no runner, adicionado à condição de `:532` (a chave do zero-behavior)

`&& round < loop.maxIterations` entra na condição de continuação existente:

```ts
// hoje:  if (!(reflectionResult.continue && loop.shouldContinue(outcome)))
// M54:   if (!(reflectionResult.continue && loop.shouldContinue(outcome) && round < loop.maxIterations))
```

**Rationale:** para as 3 built-in, `round < maxIterations` já está no `shouldContinue`, então o novo termo é **redundante** — a expressão tinha o mesmo valor, e `terminalReason(...)` recebe os mesmos argumentos → mesmo `step_limit`/`stop`. Zero-behavior por construção. Para uma custom `() => true`, o termo do runner é o que força a parada.

**Alternativas consideradas:** (a) branch novo `if (round >= max) finalize` antes do `shouldContinue` — muda a ordem de avaliação e arrisca um `finishReason` diferente para as built-in num caso de teto; (b) confiar que toda custom embuta o teto — é o workaround que o goal proíbe. **Consequência:** o teto vira propriedade do runner; o teste do guardrail para no teto.

### D2 — `LoopStrategy.name: string`; `loopStrategyConfigSchema.name` permanece `z.enum`

Contrato relaxado; resolução interna intacta. A custom entra por `.loopStrategy(obj)`, nunca por `resolveLoopStrategy(name)`.

**Alternativas consideradas:** relaxar o zod também — rejeitada: abriria a resolução por nome a qualquer string, e o DoD exige que a custom entre pelo seam. **Consequência:** breaking de tipo para quem lê `.name` esperando a union (os 3 leitores internos tratam como string, então não quebram) — declarado no CHANGELOG.

### D3 — `.loopStrategy(custom)` segue o padrão de `.compaction()`/`.reflection()`

`this.loopStrategyOverride ?? resolveLoopStrategy(strategy, spec.maxIterations)` em `build()`.

**Alternativas consideradas:** herança/subclasse de `AgentRunner` — recusada (ADR-0001). **Consequência:** reuso do padrão, zero invenção (parcimônia rung 4).

### D4 — Override per-run: não re-resolver custom por nome; sobrepor o teto do runner

`agent-runner.ts:243` passa a discriminar built-in de custom via um flag `loopStrategyIsCustom` no state:

```ts
const loop =
  opts.maxIterations == null
    ? this.loopStrategy
    : this.loopStrategyIsCustom
      ? { ...this.loopStrategy, maxIterations: opts.maxIterations } // custom: só o teto do runner muda
      : resolveLoopStrategy(this.loopStrategy.name, opts.maxIterations) // built-in: re-resolve (zero-behavior)
```

**Rationale:** o teto duro do runner (D1) lê `loop.maxIterations`, então sobrescrever só esse campo aplica o override per-run à custom **sem** tocar no `shouldContinue` dela (que mantém sua closure). Para built-in, a re-resolução por nome é preservada (zero-behavior).

**Alternativas consideradas:** (a) ignorar `opts.maxIterations` para custom — o override per-run não teria efeito, comportamento surpreendente; (b) detectar custom por "nome fora do enum" — frágil, uma custom pode se chamar `react`. O flag explícito é honesto. **Consequência:** o state ganha um `boolean`; superfície mínima.

## Drawbacks & Risks

| # | Risco | Por que é real | Mitigação |
|---|---|---|---|
| R1 | Custom `shouldContinue: () => true` queima orçamento | sem o teto no runner, o loop não para | D1 — teto no runner; teste do guardrail é gate do DoD |
| R2 | Relaxar `.name` para `string` quebra quem lê a union | um `switch` exaustivo externo perderia exaustividade | os 3 leitores internos tratam como string; breaking declarado no CHANGELOG, absorvido pelo major do M53 |
| R3 | O teto duro muda o `finishReason` de uma built-in | quebraria o zero-behavior | D1 é redundante para as 3 (já embutem o teto) — provado pela suíte sem editar expectativa |
| R4 | A re-resolução per-run crasha custom | `z.enum` rejeita nome custom | D4 — não re-resolve custom por nome |

## Unresolved Questions

- Q1 — O `.name` de uma custom deve aparecer em `finalize`/logs? **Resolução em T3:** sim, `loop.name` já é passado a `finalize` como string; uma custom com `name: 'my-stop'` aparece nos logs sem tratamento especial. Sem trabalho extra.
- Q2 — Precisa de guardrail contra `maxIterations` ausente numa custom? **Resolução em T2:** o tipo exige `maxIterations: number`; uma custom sem ele não compila. Se vier `0`/negativo via JS não-tipado, o teto `round < 0` termina no round 1 (fail-safe, nunca infinito). Coberto por teste.

## Dependency Graph

T1 (teto no runner) é independente e vem primeiro — é o guardrail que torna seguro abrir o seam. T2 (`.loopStrategy()` no builder + D2 name) depende de T1 estar no lugar (o teste do seam custom só é seguro com o teto). T3 (D4 re-resolução per-run) depende de T2 (precisa do flag `loopStrategyIsCustom`). T4 (doc + CHANGELOG) fecha.

---

## Phase T1 — Teto duro no runner

### T1.1 — `maxIterations` vira teto imposto pelo runner

#### Objective
Fazer o runner parar no `maxIterations` independentemente do que `shouldContinue` devolva.

#### Why this step (action + reasoning — ReAct discipline)
Este é o guardrail que torna seguro abrir o seam. Fazê-lo **primeiro** e isoladamente permite provar zero-behavior (as 3 built-in) antes de introduzir qualquer estratégia custom — separa "o teto migrou para o runner" de "o seam abriu", duas afirmações verificáveis independentemente.

#### Evidence
`run-reflective-loop.ts:532` — `if (!(reflectionResult.continue && loop.shouldContinue(outcome)))`. As 3 built-in embutem `round < maxIterations` (`loop-strategy.ts:83,92,97`).

#### Files to edit
- `packages/agents/src/loop/run-reflective-loop.ts`

#### Tasks
1. Adicionar `&& round < loop.maxIterations` à condição de continuação em `:532`.
2. Verificar que `terminalReason(...)` recebe os mesmos argumentos (nenhuma mudança de assinatura).

#### TDD
```
RED:     runner_para_no_teto_quando_shouldContinue_sempre_true() — custom { name:'always', maxIterations:3, shouldContinue:()=>true } + streamFactory que sempre devolve tool-calls → o loop termina em EXATAMENTE 3 rounds (hoje: TRAVA / loop infinito — o teste prova que o gate pode falhar)
RED:     finishReason_no_teto_e_step_limit() — a mesma custom termina com finishReason 'step_limit'
GREEN:   adicionar `&& round < loop.maxIterations` à condição
REFACTOR: None expected
VERIFY:  cd packages/agents && npx vitest run tests/unit/main-loop-runtime.test.ts && npx vitest run
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Uma custom `shouldContinue: () => true` para em exatamente `maxIterations` rounds — `npx vitest run <novo teste>` sai 0 com o caso verde
- [ ] **Zero-behavior:** `cd packages/agents && npx vitest run` sai 0, e `git diff --stat` não mostra nenhum arquivo de teste com expectativa alterada (só adições)
- [ ] Pass: lint — `npx eslint --max-warnings=0` no arquivo tocado sai 0
- [ ] Pass: size — o arquivo já excede 500 (567, pré-existente); o diff adiciona ≤ 2 linhas, medido por `git diff --stat`

#### DoD
- [ ] Suíte de `packages/agents` verde sem expectativa editada
- [ ] `npx tsc --noEmit` na raiz sem erro
- [ ] Commit atômico referenciando T1.1

---

## Phase T2 — Abrir o seam no builder

### T2.1 — `.loopStrategy(custom)` + `LoopStrategy.name: string`

#### Objective
Permitir injetar a estratégia de parada por composição, vencendo sobre a derivada do spec.

#### Why this step (action + reasoning — ReAct discipline)
Com o teto já no runner (T1), abrir o seam é seguro: qualquer custom injetada aqui está bounded pelo runner. Seguir o padrão exato de `.compaction()` mantém a superfície consistente e evita inventar semântica de precedência nova.

#### Evidence
`agent-runner.ts:327,335` (`.compaction()` — `this.override ?? spec`); `loop-strategy.ts:44` (`name: MainLoopMeta['strategy']`).

#### Files to edit
- `packages/agents/src/loop/loop-strategy.ts` — `LoopStrategy.name: string`
- `packages/agents/src/loop/agent-runner.ts` — `.loopStrategy()`, `loopStrategyOverride`, `loopStrategyIsCustom` no state

#### Pseudo-code / Signatures
```ts
// loop-strategy.ts
export interface LoopStrategy { readonly name: string; readonly maxIterations: number; shouldContinue(o: LoopOutcome): boolean }
// loopStrategyConfigSchema.name PERMANECE z.enum([...]) — resolução interna intacta

// agent-runner.ts (builder)
loopStrategy(custom: LoopStrategy): this { this.loopStrategyOverride = custom; return this }
// build():
const loopStrategy = this.loopStrategyOverride ?? resolveLoopStrategy(strategy, spec.maxIterations)
// state carrega: loopStrategyIsCustom: this.loopStrategyOverride !== undefined
```

#### Tasks
1. Relaxar `LoopStrategy.name` para `string` em `loop-strategy.ts` (o `z.enum` fica).
2. Adicionar `loopStrategyOverride?: LoopStrategy` + método `.loopStrategy()` ao builder.
3. `build()` resolve `this.loopStrategyOverride ?? resolveLoopStrategy(...)` e passa `loopStrategyIsCustom` ao state.

#### TDD
```
RED:     loopStrategy_custom_vence_sobre_o_spec() — fromSpec({strategy:'react'}).loopStrategy(custom).build() → runner.loopStrategy é a custom, não a react
RED:     loopStrategy_ausente_mantem_a_do_spec() — sem .loopStrategy(), a estratégia é a resolvida por nome (zero-behavior)
RED:     name_string_aceito() — uma custom com name:'my-stop' compila e o runner a expõe com esse nome
GREEN:   implementar .loopStrategy() + relaxar o tipo
REFACTOR: None expected
VERIFY:  cd packages/agents && npx vitest run tests/unit/agent-runner.test.ts && npx vitest run
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `.loopStrategy(custom)` existe e a custom vence sobre a derivada do spec — teste RED→GREEN
- [ ] `LoopStrategy.name` é `string`; `grep -n "z.enum" packages/agents/src/loop/loop-strategy.ts` ainda retorna a linha (resolução interna intacta)
- [ ] **Zero-behavior:** `cd packages/agents && npx vitest run` sai 0; `git diff` nos arquivos `*.test.ts` mostra só adições, nenhuma expectativa existente alterada
- [ ] Pass: lint — `npx eslint --max-warnings=0 $(git diff --name-only HEAD | grep '\.ts$')` sai 0

#### DoD
- [ ] Suíte verde; `tsc --noEmit` limpo
- [ ] Commit atômico referenciando T2.1

---

## Phase T3 — Override per-run seguro para custom

### T3.1 — `:243` deixa de crashar uma custom

#### Objective
Garantir que passar `opts.maxIterations` com uma estratégia custom não crasha nem descarta a custom.

#### Why this step (action + reasoning — ReAct discipline)
A discovery (Q6) achou que `:243` re-resolve por nome via `z.enum` — uma custom crasharia. Deixar esse caminho quebrado seria um defeito conhecido não tratado, o oposto de "sem workaround". Como o teto duro (T1) lê `loop.maxIterations`, sobrescrever só esse campo aplica o override à custom sem tocar em sua lógica.

#### Evidence
`agent-runner.ts:242-244`.

#### Files to edit
- `packages/agents/src/loop/agent-runner.ts`

#### Tasks
1. Reescrever a re-resolução de `:243` conforme D4 (discrimina custom via `loopStrategyIsCustom`).

#### TDD
```
RED:     override_maxIterations_com_custom_nao_crasha() — runner com custom (name:'my-stop') + opts.maxIterations:2 → não lança, e o teto efetivo é 2
RED:     override_maxIterations_com_custom_aplica_o_teto() — a custom { shouldContinue:()=>true } + opts.maxIterations:2 → para em 2 rounds
RED:     override_maxIterations_com_builtin_inalterado() — 'react' + opts.maxIterations:5 re-resolve por nome como hoje (zero-behavior)
GREEN:   implementar o discriminador de D4
REFACTOR: None expected
VERIFY:  cd packages/agents && npx vitest run tests/unit/runner-maxiterations-override.test.ts && npx vitest run
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Custom + `opts.maxIterations` não lança e aplica o override como teto — teste RED→GREEN
- [ ] Built-in + `opts.maxIterations` re-resolve por nome inalterado — zero-behavior
- [ ] Pass: lint — `npx eslint --max-warnings=0 $(git diff --name-only HEAD | grep '\.ts$')` sai 0

#### DoD
- [ ] Suíte verde; `tsc --noEmit` limpo
- [ ] Commit atômico referenciando T3.1

---

## Phase T4 — Doc + CHANGELOG

### T4.1 — Doc de extensão + CHANGELOG do breaking de tipo

#### Objective
Documentar como injetar uma estratégia de parada custom, e declarar o breaking de tipo.

#### Why this step (action + reasoning — ReAct discipline)
O DoD exige doc de extensão e a entrada de CHANGELOG marcando o breaking de `LoopStrategy.name`. Sem a doc, o seam existe mas ninguém sabe usá-lo; sem o CHANGELOG, o breaking de tipo é silencioso.

#### Files to edit
- `packages/agents/CHANGELOG` (via changeset) OU um doc de extensão no pacote
- `knowledge-base/adrs/0004-loop-strategy-seam.md` (novo)

#### Tasks
1. Escrever o ADR 0004 com D1..D4.
2. Changeset declarando o seam (`minor`) + o breaking de tipo de `LoopStrategy.name` (nota).
3. Um bloco de doc ("como injetar sua própria estratégia de parada") no JSDoc de `.loopStrategy()`.

#### TDD
```
RED:     (documentação — sem teste; a asserção é o ADR conter D1..D4 e o changeset existir)
GREEN:   escrever ADR + changeset + JSDoc
REFACTOR: None expected
VERIFY:  grep -c "^### D" knowledge-base/adrs/0004-loop-strategy-seam.md  → 4
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] ADR contém D1..D4: `grep -c '^### D' knowledge-base/adrs/0004-loop-strategy-seam.md` retorna 4 e `grep -c 'Alternativas consideradas' ...` retorna 4
- [ ] Changeset existe: `ls .changeset/*loop-strategy*.md` retorna 1 arquivo contendo 'loopStrategy' e 'name'
- [ ] `.loopStrategy()` tem JSDoc mostrando um exemplo de custom

#### DoD
- [ ] Commit atômico referenciando T4.1

---

## Coverage Matrix

| # | Gap / Requirement (do DoD do M54) | Task(s) | Resolução |
|---|---|---|---|
| 1 | `.loopStrategy(custom)` existe e vence sobre o spec | T2.1 | padrão de `.compaction()` |
| 2 | `LoopStrategy.name` relaxado para `string`; `z.enum` valida os 3 nomes | T2.1 | D2 — contrato relaxado, resolução intacta |
| 3 | Zero-behavior: suíte passa sem editar expectativa | T1.1, T2.1, T3.1 | D1 redundante para built-in |
| 4 | (GATE) Guardrail: `shouldContinue:()=>true` para no teto | T1.1 | D1 — teto no runner |
| 5 | Override per-run não crasha custom | T3.1 | D4 |
| 6 | Doc de extensão + CHANGELOG do breaking de tipo | T4.1 | ADR + changeset + JSDoc |

**Coverage: 6/6 (100%)**

## Dependencies

### Existing
| Dependência | Uso | Rule 9 |
|---|---|---|
| `zod` | `loopStrategyConfigSchema` (resolução interna intacta) | já instalado |
| `vitest` | RED/GREEN | já instalado |

### New
Nenhuma.

### Removed
Nenhuma.

## Failure scenarios (when I/O external)

(none — no external I/O touched)

O runner orquestra `streamFactory`, mas todas as tarefas deste plano são lógica pura de controle de loop; o teste do guardrail injeta um `streamFactory` fake (sem rede).

## Global Definition of Done

- [ ] T1..T4 completas
- [ ] `cd packages/agents && npx vitest run` verde, **sem expectativa editada**
- [ ] `npx tsc --noEmit` na raiz sem erro
- [ ] `npx eslint --max-warnings=0` nos arquivos tocados
- [ ] `pnpm knip` verde no repo
- [ ] Teste do guardrail (`shouldContinue:()=>true` para no teto) verde — o gate do DoD
- [ ] Teste live no tmux `agentbuilder`/direto contra provider real: um agente com estratégia de parada custom responde e termina
- [ ] `/code-quality` ∈ {PASS, PASS_WITH_CAVEATS}
- [ ] `/review` READY_TO_MERGE
- [ ] CHANGELOG `[Unreleased]` + ADR 0004
- [ ] `@theokit/agents` publicado (minor)

## Followups

Nenhum previsto — o escopo é cirúrgico e fechado pelo DoD.

## Related

- Milestone: `ROADMAP.md` § `### M54`
- Blueprint: `knowledge-base/discoveries/blueprints/loop-strategy-seam-blueprint.md`
- Grill: `knowledge-base/grills/loop-strategy-seam-feature-grill.md`
- Regras: `.claude/rules/error-handling.md`, `.claude/rules/testing.md`, `.claude/rules/parsimony-ladder.md`; ADR-0001 (Template Method recusado)
