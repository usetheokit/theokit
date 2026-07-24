# Review: loop-strategy-seam (M54)

**Date:** 2026-07-24
**Baseline:** `498f71ae` → HEAD (após correções)
**Reviewer:** 1 agente adversarial (m54-review), escopo em `git diff 498f71ae..HEAD`
**Findings:** 7 (BLOCKER: 1, HIGH: 1, MEDIUM: 1, LOW: 1, INFO: 3)
**Verdict inicial:** NEEDS_FIXES → **após correções: READY_TO_MERGE**

Todos os achados acionáveis foram **corrigidos**, não mitigados.

## BLOCKER — F-1: `maxIterations` não-finito numa custom (loop infinito)

Uma custom bypassa o `z.number().int().min(1)` das built-in. `maxIterations: Infinity` torna `round < maxIterations` sempre true — loop infinito, a exata classe de defeito que o M54 existe para prevenir. O agente **reproduziu ao vivo**: worker do vitest a ~100% CPU, 3.2 GB RSS, 2+ min sem output.

**Estado:** já corrigido em `91a13073` (durante o próprio ciclo, antes do review terminar) — `assertValidCustomLoopStrategy` valida na autoria com a mesma regra SSoT das built-in. O agente notou (corretamente) que o fix foi feito por processo autônomo dentro do escopo do goal `/goal`; é o comportamento esperado deste ciclo autônomo, e o fix passou pelos mesmos gates (RED→GREEN, 6 testes, tsc/lint). Registrado no ADR D4 § "Guardrail adicional (F-1)".

## HIGH — F-2: spread descarta `shouldContinue` de custom baseada em CLASSE

`resolvePerRunLoop` usava `{ ...loop, maxIterations }`. O spread copia só own enumerable props; uma custom implementada como **instância de classe** (o shape idiomático do Strategy) carrega `shouldContinue` no **prototype**, que o spread descarta — `TypeError: loop.shouldContinue is not a function`. Todos os testes usavam object literal, que escondia o bug. O ADR D4 **afirmava** que o `shouldContinue` sobrevive — era falso.

**Corrigido** (`a4d03ecc`): `Object.assign(Object.create(Object.getPrototypeOf(base)), base, { maxIterations })` preserva a cadeia de prototype. Teste de regressão com custom baseada em classe (RED: `TypeError`; GREEN: para no teto 2). ADR D4 corrigido para documentar o erro e o fix.

## MEDIUM — F-3: `.name` union→string é type-break, merecia major

Relaxar `LoopStrategy.name` de union de 3 valores para `string` é source-breaking: um `switch` exaustivo externo deixa de compilar. Não há política de semver runtime-only escrita no repo, então o rigor pede **major**.

**Corrigido** (`9daa21a4`): bump de 2.1.0 → **3.0.0**, com a nota de major explícita no CHANGELOG. O release não havia sido publicado (npm em 2.0.0), então a correção foi limpa.

## LOW — F-6: `loopStrategyIsCustom` é invariante sem enforcement de tipo

O flag defaulta correto nos 2 sítios de construção (verificado), e `delegate()` nem toca `AgentRunnerState`. Sem defeito, mas o invariante repousa em cada sítio futuro lembrar do default. **Aceito** — o hardening sugerido (derivar do parse do enum) é otimização sem problema medido; o default `?? false` no construtor já fail-safe.

## INFO confirmados

- **F-5:** o termo `&& round < loop.maxIterations` é **zero-behavior provado** para as 3 built-in — matematicamente (`A && A = A`, porque `outcome.round` é o mesmo `round` local) e empiricamente (36/36 testes de `main-loop-runtime` intactos). O agente verificou independentemente.
- **F-4:** a claim do plano Q2 "coberto por teste" para 0/negativo não era verdade nos commits revisados — os testes vieram depois (F-1 fix). Corrigido de fato pelos 6 testes de validação de teto.
- **F-7:** toolchain limpo — tsc 0, knip 0, check:direction 0, 608 testes.

## Gates finais

| Gate | Resultado |
|---|---|
| `vitest` (agents) | 608 passed, 92 arquivos |
| `vitest` (http) | 411 passed |
| Live contra provider real | custom `while-tool-calling` rodou 2 rounds, runner limitou no teto, terminou limpo |
| `tsc` / `eslint` / `knip` / `check:direction` | limpos |
| Zero-behavior | 3 built-in idênticas, zero expectativa editada (F-5 confirmado pelo agente) |

## Handoff

**READY_TO_MERGE** — BLOCKER e HIGH corrigidos e testados; MEDIUM resolvido com major bump. Segue para publish `@theokit/agents@3.0.0` + PR + merge + flip M54 → ROADMAP_COMPLETED.
