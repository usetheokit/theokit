# ADR 0004 — Abrir o seam de `LoopStrategy` (critério de parada injetável)

**Status:** Accepted
**Date:** 2026-07-24
**Milestone:** M54
**Plano:** `knowledge-base/plans/loop-strategy-seam-plan.md`
**Blueprint:** `knowledge-base/discoveries/blueprints/loop-strategy-seam-blueprint.md`

## Contexto

O `AgentRunner` tinha três dos quatro eixos de comportamento abertos para injeção (reflexão, compactação, produção do round) e um trancado: o **critério de parada**. `resolveLoopStrategy` validava `z.enum(['simple-chat','plan-act-reflect','react'])` e não havia `.loopStrategy()` no builder. A interface `LoopStrategy` já era aberta (`{ name, maxIterations, shouldContinue }`); só o construtor a fechava.

A discovery (`SHIPPABLE` 99.7) achou que abrir o seam **expõe dois defeitos** que ficavam escondidos porque o critério de parada era interno, e que o `opencode` (peer) já resolve aplicando o teto **no runner**.

## Decisões

### D1 — Teto duro no runner, adicionado à condição de continuação existente

`&& round < loop.maxIterations` entrou na condição de `run-reflective-loop.ts` (antes: `if (!(reflectionResult.continue && loop.shouldContinue(outcome)))`).

**Rationale:** o loop era `while (!signal?.aborted)` e só parava quando `shouldContinue` devolvia `false`. As 3 built-in embutiam `round < maxIterations` no próprio `shouldContinue` — o teto era **convenção de cada estratégia, não garantia do runner**. Uma custom `() => true` rodaria para sempre. Para as 3 built-in o novo termo é **redundante** (a expressão tinha o mesmo valor — provado por simulação exaustiva no plano e pela suíte passando sem editar expectativa), então zero-behavior; para uma custom, é o que força a parada.

**Alternativas consideradas:** (a) branch novo `if (round >= max) finalize` antes do `shouldContinue` — mudaria a ordem de avaliação e arriscaria um `finishReason` diferente para as built-in; (b) confiar que toda custom embuta o teto — é o workaround que a diretriz proíbe.

**Evidência de prior art:** `opencode` (`packages/opencode/src/session/prompt.ts:1178`) — `const isLastStep = step >= maxSteps`. O teto é do runner, não da estratégia.

### D2 — `LoopStrategy.name: string`; `loopStrategyConfigSchema.name` permanece `z.enum`

Contrato relaxado; resolução interna intacta. Uma custom entra por `.loopStrategy(obj)`, nunca por `resolveLoopStrategy(name)` (que continua rejeitando nomes fora do enum em runtime, fail-fast).

**Alternativas consideradas:** relaxar o zod também — rejeitada: abriria a resolução por nome a qualquer string, e o seam exige que a custom entre por composição, não por nome. **Consequência:** breaking de tipo para quem lê `.name` esperando a union; os 3 leitores internos (`run-reflective-loop.ts:471,521,539`) já tratam como string.

### D3 — `.loopStrategy(custom)` segue o padrão de `.compaction()`/`.reflection()`

`this.loopStrategyOverride ?? resolveLoopStrategy(strategy, spec.maxIterations)` em `build()`. A custom vence sobre a derivada do spec.

**Alternativas consideradas:** herança/subclasse de `AgentRunner` — recusada (ADR-0001 recusa Template Method). Strategy por composição é a escolha locked.

### D4 — Override per-run: não re-resolver custom por nome; sobrepor o teto do runner

O `AgentRunner` ganhou `loopStrategyIsCustom` no state. `resolvePerRunLoop(maxIterations)`:
- `maxIterations == null` → a estratégia como está;
- custom → `{ ...loop, maxIterations }` (só o teto muda; o `shouldContinue` da custom sobrevive);
- built-in → `resolveLoopStrategy(name, maxIterations)` (re-resolução por nome, zero-behavior).

**Rationale:** o compilador **forçou** esse fix — com `.name: string` (D2), a re-resolução por nome em `stream()` deixou de tipar, exatamente o ponto de quebra que a discovery (Q6) previu. Como o teto duro do runner (D1) lê `loop.maxIterations`, sobrescrever só esse campo aplica o override per-run à custom sem tocar sua lógica nem passar pelo `z.enum`.

**Correção pós-review (F-2):** a primeira implementação usava `{ ...this.loopStrategy, maxIterations }`. O spread copia só **own enumerable props** — uma custom implementada como **instância de classe** (o shape idiomático do Strategy) carrega `shouldContinue` no **prototype**, que o spread descarta, crashando a run com `loop.shouldContinue is not a function`. O review adversarial pegou isso (todos os testes usavam object literal, que escondia o bug). Corrigido com `Object.assign(Object.create(Object.getPrototypeOf(base)), base, { maxIterations })` — preserva a cadeia de prototype, sobrescreve só o teto. Teste de regressão com custom baseada em classe.

**Guardrail adicional (F-1):** uma custom bypassa o `z.number().int().min(1)` das built-in. `maxIterations: Infinity` torna `round < maxIterations` sempre true — loop infinito. `.loopStrategy()` valida o teto na autoria (`assertValidCustomLoopStrategy`, mesma regra SSoT das built-in), fail-fast, typed.

**Alternativas consideradas:** (a) ignorar `opts.maxIterations` para custom — override sem efeito, surpreendente; (b) detectar custom por "nome fora do enum" — frágil, uma custom pode se chamar `react`. O flag explícito é honesto.

## Consequências

- `@theokit/agents` sai em **minor** (novo método + relaxamento de tipo aditivo — nenhuma API removida). O breaking de tipo de `LoopStrategy.name` é anotado no changeset.
- O teto de terminação passa a ser propriedade do runner, provado pelo teste `shouldContinue: () => true` que para no teto (`loop-runner-hard-ceiling.test.ts` — travava 90s antes, passa em 4ms depois).
- Uma custom com override per-run de `maxIterations` respeita o teto per-run sem crashar (`loop-strategy-seam.test.ts`).

## Cross-references

- Grill: `knowledge-base/grills/loop-strategy-seam-feature-grill.md`
- Prior art: `knowledge-base/references/opencode/packages/opencode/src/session/prompt.ts:1178`
- ADR-0001 (Template Method recusado), ADR-0031 (SDK owns model call, no second runtime)
- Regras: `.claude/rules/error-handling.md` § 2, `.claude/rules/parsimony-ladder.md`, `.claude/rules/testing.md` § 4.1
