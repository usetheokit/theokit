# Edge Case Review — theokit-arch-gaps-implementation

**Date:** 2026-06-06
**Plan analyzed:** `docs/plans/theokit-arch-gaps-implementation-plan.md` (v1.0, 985 LOC)
**Tasks analyzed:** 11
**Edge cases found:** 10 (MUST FIX: 3, SHOULD TEST: 5, DOCUMENT: 2)

## MUST FIX

### EC-1: Phase 0 sem sunset → Phase 5 eternally blocked

- **Affected task:** T0.1
- **Family:** Process / blocking
- **Scenario:** Plan diz "Phase 5 fica BLOCKED até ADR-0028 ser escrita." Mas não há sunset. Se time não decidir R3a vs R3b em N semanas, Phase 5 vira tech debt invisível.
- **Impact:** C3 (42 arquivos node:*) continua hipotecado indefinidamente. Pior cenário: outros plans dependem de C3 estar fechado e ficam encadeados como zombies.
- **Suggested fix:** Adicionar ao T0.1 Acceptance Criteria: "Decisão registrada em ADR-0028 dentro de **30 dias após Phase 1 completar**. Se prazo expirar sem decisão, default = R3a (Hono Web standards) é assumido per Deep Dives recommendation, e Phase 5a inicia."

### EC-2: T2.5 BREAKING change sem deprecation period → consumer ecosystem quebra silencioso

- **Affected task:** T2.5
- **Family:** Backward compatibility
- **Scenario:** Plan diz substituir `server/index.ts` wildcards por `package.json#exports`. Consumers fora do monorepo (plugin authors, app authors em produção) que fazem `from 'theokit/server'` esperando 18 sub-domains juntos vão receber error de resolução **sem warning**.
- **Impact:** Onde TheoKit prometia "evolutions backward-compat até 1.0", a transição vira ruptura. Plugin authors podem reverter para versão anterior em massa, freezing TheoKit adoption.
- **Suggested fix:** Adicionar ao T2.5 Tasks: "Manter `server/index.ts` como **deprecated barrel** com runtime `console.warn('theokit/server umbrella deprecated; use sub-paths theokit/server/<domain>')` durante 1 minor cycle (0.x → 0.x+1). Remover apenas em 0.x+2."

### EC-3: T4.1 codemod pode perder cause chain em errors aninhados

- **Affected task:** T4.1
- **Family:** Data preservation
- **Scenario:** Codemod transforma `throw new FooError('msg', {cause: prevError})` em `throw new TheoError({code: 'FOO_ERROR', message: 'msg', cause: prevError})`. Se codemod for regex-based simples, `cause` pode ser dropped silenciosamente em padrões edge (cause em segundo argumento, cause em options bag mais complexo, throw em async com stack já alterado).
- **Impact:** Debugging em produção fica MUITO pior. Stack traces perdem upstream context — exatamente o tipo de bug que custa 4h de pager call para descobrir.
- **Suggested fix:** Adicionar ao T4.1 TDD section um RED test específico: `test_cause_chain_preserved_through_codemod — Given FooError({cause: bar}), When codemod runs, Then resulting TheoError.cause === bar`. Validar codemod com AST-based transform (ts-morph), não regex.

## SHOULD TEST

### EC-4: T1.1 decoration values compartilhados via prototype chain

- **Affected task:** T1.1, T3.1
- **Suggested halt-loop checkpoint:** Adicionar ao T1.1 BDD `Edge case` scenario: "Given parent decorates with `{count: 0}` object, When plugin A increments `count`, Then **parent's count is mutated** (because Object.create proto-chain shares object references)". Documentar invariant: "decorations devem ser values primitivos OR `Object.freeze`'d antes de decorate". Se invariant é caro de enforçar, mover para T3.1 Deep Dives como documented restriction.

### EC-5: T1.2 Web Request boundary test não prova non-Node em vitest Node runtime

- **Affected task:** T1.2, T5a.1
- **Suggested halt-loop checkpoint:** T1.2 acceptance criterion atual: "Test escrito em vitest". Mas vitest roda em Node — `node:http` está disponível para require mesmo que test não use. RED state é artificial. Adicionar: "T1.2 GREEN é satisfeito apenas com `wrangler dev tests/fixtures/handler-web-standards/` retornando 200 com Response shape correto. Vitest test é necessário mas não suficiente."

### EC-6: T2.2 imports relativos intra-subfolder não cobertos por codemod simples

- **Affected task:** T2.2
- **Suggested halt-loop checkpoint:** 7 start-*.ts files se importam mutuamente. Após mv para `cli/commands/start/`, imports relativos `from './start-bootstrap-stages.js'` precisam virar `from './bootstrap-stages.js'`. Adicionar pre-T2.2 step: "grep imports relativos intra-família ANTES do mv; gerar codemod patches incluindo path rewrites." Falha visível: tsc reporta missing module — fácil de pegar mas chato se for runtime de só alguns paths.

### EC-7: T2.4 devtools React Context perde reference quando provider muda de file path

- **Affected task:** T2.4
- **Suggested halt-loop checkpoint:** React Context é singleton-per-file-reference. Se `devtools/dispatcher.ts` → `devtools/bridge/dispatcher.ts` e consumer em `devtools/Overlay.tsx` (agora `devtools/dom/Overlay.tsx`) importa de path errado, Context vira undefined silenciosamente (sem error de TS). Acceptance criterion: "Chrome DevTools real browser smoke: open dogfood-app, verify Devtools tab populates with Actions/Requests data (não apenas vitest)".

### EC-8: T3.1 plugins que bypass API canônica (acessam `app.decorations` direto)

- **Affected task:** T3.1
- **Suggested halt-loop checkpoint:** Plugins existentes (auth-google, plugin-cors, etc.) podem ter feito `app.decorations.foo = bar` direto durante early dev — bypass do `decorateRequest()` API. Após T3.1, esses bypasses quebram silenciosamente (decoration vai para parent, vaza). Pre-T3.1 step: "grep `\.decorations\.` em packages/theo/src/server/plugins/ e em sibling repos (@theokit/auth-google, plugin-cors); migrar bypass para API canônica antes de Object.create() ship. Falha visível em runtime, não em compile."

## DOCUMENT

### EC-9: T2.3 sub-schemas podem ter cross-references requiring topological order

- **Accepted risk:** 14 sub-schemas podem ter dependências (e.g., `csrf.ts` importa shapes de `security-headers.ts`). Split em ordem arbitrária pode criar circular import. Documentar no T2.3 Deep Dives: "Identificar cross-references via grep antes do split; processar em ordem topológica (least-dependent primeiro: security-headers → csrf → csp → outros)." Risco aceitável porque tsc pega circular imports de imediato (não é bug silencioso).

### EC-10: T2.6 Vite plugin hook ordering side effects

- **Accepted risk:** Vite plugin hooks (configResolved, resolveId, load, transform, etc.) têm ordering side effects — alguns plugins assumem `hook A roda antes hook B`. Refactor de `vite-plugin/index.ts` pode mudar order silently se extracted siblings forem registered em order diferente. Documentar no T2.6: "Acceptance criterion estendida: `dogfood-app dev` boot + HMR roundtrip + build + start full cycle — não apenas `vitest run`. Hook ordering bugs manifesta em runtime, não em unit tests."

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|---|---|---|---|---|
| T0.1 | 1 | EC-1 | 0 | 0 |
| T1.1 | 1 | 0 | EC-4 | 0 |
| T1.2 | 1 | 0 | EC-5 | 0 |
| T2.1 | 0 | 0 | 0 | 0 |
| T2.2 | 1 | 0 | EC-6 | 0 |
| T2.3 | 1 | 0 | 0 | EC-9 |
| T2.4 | 1 | 0 | EC-7 | 0 |
| T2.5 | 1 | EC-2 | 0 | 0 |
| T2.6 | 1 | 0 | 0 | EC-10 |
| T3.1 | 1 | 0 | EC-8 | 0 |
| T4.1 | 1 | EC-3 | 0 | 0 |
| **Total** | **10** | **3** | **5** | **2** |

**Verdict:** PLAN NEEDS ADJUSTMENT (3 MUST FIX)

## Adjustment instructions

1. **T0.1** — adicionar sunset de 30 dias com default fallback para R3a (EC-1)
2. **T2.5** — adicionar deprecated barrel period de 1 minor cycle (EC-2)
3. **T4.1** — adicionar RED test específico para cause chain preservation; usar ts-morph não regex (EC-3)
4. **T1.1, T1.2, T2.2, T2.4, T3.1** — adicionar halt-loop checkpoints conforme EC-4 a EC-8
5. **T2.3, T2.6** — documentar accepted risks nas Deep Dives conforme EC-9 e EC-10

Após absorption, bump plan v1.0 → v1.1 e proceed para `/implement` ou `/plan-confidence` se houver.
