# Plan: TheoKit Architectural Gaps Implementation

> **Version 1.2** — Implementa as recomendações concretas do blueprint `.claude/knowledge-base/discoveries/blueprints/theokit-arch-gaps-investigation-blueprint.md` (cycle-discover concluído 2026-06-06, SHIPPABLE 96.4). Fecha os 3 críticos (C1 plugin scope encapsulation, C2 error envelope migration completeness, C3 runtime portability — pendente decisão humana R3a vs R3b) + 4 mecânicos (M1 sub-package exports, M2 config schemas split, M3 devtools sub-organization, M4 CLI commands layout) + boy-scout do `vite-plugin/index.ts` 632 LOC. Outcome: TheoKit sobe de **3.5/5** para **4.0+/5** (per `architecture-output/consolidated_final_report.md`).
>
> **Changelog v1.0 → v1.1 (2026-06-06):** Absorve 3 MUST FIX + 5 SHOULD TEST + 2 DOCUMENT do edge-case review.
>
> **Changelog v1.1 → v1.2 (2026-06-06):** Adiciona `## Dependencies` section formal (era ausente, disparava `plan_dependencies_section_missing` hard cap). Lista 3 NEW deps (`ts-morph`, `publint`, `wrangler`) com Rule 9 evaluation; lista 7 existing deps tocadas pelo plan; documenta 1 CRITICAL CVE pendente (vitest <4.1.0 — UI server arbitrary file read/exec) + 3 HIGH (minimatch ReDoS via eslint-plugin-sonarjs) + 4 MODERATE. Phase 0 ganha T0.2 obrigatória para bump vitest ≥4.1.0 antes de Phase 1 RED tests iniciarem.

## Context

Cycle de discovery completo em 2026-06-05/06 produziu 3 artefatos auditáveis:
- `architecture-output/consolidated_final_report.md` (revisão arquitetural + análise manual comparativa, 56+8 findings, nota 3.5/5)
- `.claude/knowledge-base/discoveries/blueprints/theokit-arch-gaps-investigation-blueprint.md` (1038 LOC, 45 unique paths cited, SHIPPABLE 96.4)
- `architecture-output/plugin-feedback.md` (bugs do plugin `loop-architecture-review` documentados — fora do escopo deste plan)

O blueprint sintetizou 5 ADRs (D1-D5) baseadas em código real de **Fastify 5.x** (`plugin-utils.js`, `plugin-override.js`, `decorate.js`, `errors.js`), **Hono** (`hono-base.ts`, `compose.ts`, `http-exception.ts`, `adapter/`), **Nitro** (`presets/_resolve.ts`), **Astro** (`packages/astro/src/core/config/schemas/`, `dev-toolbar/`), e **Next.js** (`packages/next/package.json`, stub-files pattern, `src/cli/`). Todas as recomendações têm citação `file:line` rastreável.

**Estado atual mensurado (do report consolidado):**
- 42 arquivos em `packages/theo/src/server/` importam `node:*` diretamente
- 29 classes `Error` custom, 6 arquivos usam `TheoErrorEnvelope` (20% adoption do G5 declarado SHIPPED)
- `server/index.ts` re-exporta 18 sub-domains via `export *` wildcards (zero ISP boundary)
- `config/schema.ts` 504 LOC com 14 Zod schemas monolíticos
- `devtools/` com 13 loose files no root mistura 5 concerns
- `cli/commands/start-*` 7 arquivos flat (sibling `migrate/` JÁ é subfolder — inconsistência interna)
- `vite-plugin/index.ts` 632 LOC com `T2.1-T2.3 architecture-medium-deferrals` admitindo refactor incompleto
- `react-query/`, `services/schema/` são lonely folders (1 arquivo cada)

## Objective

**Done = TheoKit chega a nota arquitetural ≥4.0/5** quando re-revisado pelo `loop-architecture-review` (mode=full), com:

- C1: `TheoPlugin` ganha encapsulation scope via `Object.create(parent)` pattern (Fastify-shape — blueprint D1)
- C2: 29 Error classes drenam para `TheoError` flat com stable code field (blueprint D2); adoption rate sobe de 20% → 100%
- C3: decisão humana R3a vs R3b documented em ADR-0028 (NOVO); Phase 5 implementa o caminho escolhido
- M1: `server/index.ts` wildcards substituídos por `package.json#exports` field Hono-shape (blueprint D4)
- M2: `config/schema.ts` 504 LOC → `config/schemas/<concern>.ts` × N + composer fino <100 LOC
- M3: `devtools/{dom,state,bridge,format}/` sub-organization (blueprint D5)
- M4: `cli/commands/start/<sub>.ts` subfolder (mirror sibling `migrate/`)
- M5: lonely folders eliminados
- M6: `vite-plugin/index.ts` <400 LOC + 3+ extracted siblings (continua deferral existente)

**Medidas observáveis:**
- [ ] `pnpm test` exit 0 (vitest)
- [ ] `pnpm typecheck` exit 0 (tsc --noEmit)
- [ ] `pnpm lint` exit 0 (zero warnings)
- [ ] `pnpm depcruise` exit 0 (zero violations preservadas)
- [ ] `dogfood full` health ≥70, zero CRITICAL
- [ ] Re-run `loop-architecture-review --mode=full` retorna ≥4.0/5

## ADRs

### D1 — Adopt Fastify `Object.create(parent)` pattern para TheoPlugin scope

**Decision:** TheoApp.register(plugin) cria child instance via `Object.create(parentApp)` antes de chamar `plugin.register(childApp)`. Mutations em `childApp.decorateRequest` ficam isoladas do parent. Reply/Request builders são reconstruídos por scope.

**Rationale:** Blueprint Q1 confirmou empiricamente em `references/fastify/lib/plugin-override.js:38` que toda a "magia" do scope encapsulation Fastify é literalmente UMA linha (`const instance = Object.create(old)`). Custo de implementação: 80-120 LOC + sem dependency externa (Fastify usa `avvio`, mas TheoKit pode implementar boot lifecycle in-house). Custo de não fazer: comunidade futura de 5+ plugins coexistindo terá decoration leak silenciosa (vide C1 risk no consolidated report).

**Alternatives considered:**
- (a) Continuar como hoje (no scope) — rejeitado: blueprint Q1 mostrou que Hono explicitamente assume "plugins share `app` mutably" e funciona porque Hono tem ZERO ecosystem de plugin-coordinate-state; TheoKit prevê 19+ plugins na Onda 2-3 (CLAUDE.md root)
- (b) Hybrid (scope opcional via flag) — rejeitado em blueprint Q1: "Do not ship a third hybrid — the two are mutually-exclusive design centers and a halfway implementation will mislead plugin authors"

**Consequences:** Plugin authors podem confiar que decoração não vaza. Plugin contract gains `decorateReply` + `decorateRequest` com scope. Breaking change para plugins existentes — migration guide obrigatório.

### D2 — Error envelope: flat `TheoError` class + stable code field, NOT 91-class hierarchy

**Decision:** Drenar as 29 `Error` classes restantes para `TheoError` com `code: TheoErrorCode` discriminated union. Codemod `scripts/migrations/envelope-0-2-to-0-4.mjs` (já existe) é o veículo. Test integration roundtrip valida wire-format consistency.

**Rationale:** Blueprint Q2 mostrou que Fastify ships 91 `createError()` factory calls em `errors.js:528 LOC` — TheoKit migrar para esse pattern seria over-engineering. Recommendation explícita do Q2: "TheoKit C2 should NOT replicate Fastify's 91-error hierarchy". Hono prova com `http-exception.ts:78 LOC` que flat class + status code basta.

**Alternatives considered:**
- (a) Fastify-style createError factory por sub-system — rejeitado: complexidade desproporcional ao tamanho do TheoKit
- (b) Manter 29 classes Error custom (status quo) — rejeitado: viola promessa cross-layer G5 SHIPPED com 20% adoption real

**Consequences:** Single TheoError class com discrimination via `code` field. Wire-format envelope se mantém. 23 classes deletadas. Breaking change para consumer code que faz `instanceof SpecificError` — migration codemod cobre.

### D3 — Multi-runtime portability: DECISION REQUIRED em Phase 0 (R3a vs R3b)

**Decision:** PENDENTE de decisão humana. Plan inclui Phase 0 BLOCKING que documenta trade-off matrix do blueprint Q3 e exige escolha registrada em `docs/adr/0028-multi-runtime-strategy.md` antes de Phase 5 (C3 implementation) iniciar.

**Rationale (do blueprint):** R3a (Hono Web standards) e R3b (Nitro Strategy presets) são modelos arquiteturais **opostos**, não variants. Decisão tem implicação direta em invariante 2 (`core` depende de nada) e invariante 3 (public API via barrels). Blueprint Q3 emitiu trade-off matrix:

| Dimension | R3a Hono-shape | R3b Nitro-shape | TheoKit-today hybrid |
|---|---|---|---|
| Blast radius (LoC) | High (42 node:* removals + Request/Response baked) | Medium (presets/ folders + dep-cruiser rule) | Zero (status quo) |
| Plugin compat | Plugins ganham Web standards naturalmente | Plugins ganham presets via opt-in | Plugins não rodam non-Node |
| Bundle size | Smaller core (no Node bindings shipped) | Same core + per-preset overhead | Same core but adapters non-Node são opt-in dead code |
| Time-to-1.0 | Maior (refactor cascata) | Médio (additive) | Zero |
| Honesty cost | "TheoKit runs anywhere" verdadeiro | "TheoKit ships presets" verdadeiro | "TheoKit runs anywhere" falso (vide C3) |

**Alternatives considered:** (a) Continuar status quo — rejeitado em blueprint como "hybrid não é válido". (b) Hybrid R3a+R3b — rejeitado em blueprint EC-2: "no third hybrid".

**Consequences:** Phase 5 fica BLOCKED até ADR-0028 ser escrita. Phases 1-4 + 6 são independentes e podem prosseguir em paralelo.

### D4 — Adopt `"exports"` field Hono-shape para sub-package exports

**Decision:** Substituir 16 `export *` wildcards em `packages/theo/src/server/index.ts` por `package.json#exports` field com 18 sub-paths (`theokit/server/auth`, `theokit/server/jobs`, etc.). Adicionar `publint` no CI gate.

**Rationale:** Blueprint Q4 comparou Next.js (47 stub files pattern com runtime branching) vs Hono (74-key `"exports"` field). Recomendou Hono-shape para TheoKit porque: (a) TheoKit tem fewer entry points que Next.js, então maintenance burden de `exports` field é menor; (b) strict typing via `types` key importa mais para framework consumers que para Next.js; (c) é o pattern npm-ecosystem-padrão moderno.

**Alternatives considered:** (a) Next.js stub-files com runtime branching — rejeitado por overhead de ship 18+ stub `.js` files; (b) Continuar wildcards — rejeitado por violar ISP a nível de package surface (vide M1 no consolidated report).

**Consequences:** Consumer code ganha autocomplete preciso (`import {} from 'theokit/server/auth'`). Tree-shaking melhora. CI adiciona `publint` step. Breaking change para imports atuais `from 'theokit/server'` (todos os 18 sub-domains arrastados juntos) — migration guide + codemod.

### D5 — Sub-organization heuristic: promote to sub-folder when ≥2 conceptual siblings exist

**Decision:** Aplicar a heurística (blueprint Q5/Q6 sintetizada): quando uma família de N ≥ 2 arquivos compartilha prefix conceitual (e.g., `start-*`, `config/schemas/*-csrf`), promove para sub-folder. Aplica a M2 (config/schemas/), M3 (devtools sub-org), M4 (cli/commands/start/).

**Rationale:** Astro `config/schemas/{base,refined,relative}.ts` + Nitro `cli/commands/<verb>/` provam o pattern. EC-10 do edge-case review documentou honestamente que Astro `base.ts` ainda é 613 LOC — split não precisa ser perfeito, precisa ser **conceitual**.

**Alternatives considered:** (a) Manter flat (status quo) — rejeitado por inconsistência interna (sibling `migrate/` JÁ usa subfolder); (b) Sub-folder agressivo a partir de 1 sibling — rejeitado por criar lonely folders.

**Consequences:** `cli/commands/start/{bootstrap,handlers,...}.ts`. `config/schemas/{auth,csrf,cors,...}.ts`. `devtools/{dom,state,bridge,format}/`. Imports internos atualizados via codemod.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `typescript` | `^5.0.0` | npm | TS strict compile do framework. Plan toca todas as files .ts/tsx (não bumpa typescript em si). |
| `vite` | `^6.0.0` | npm | Plan T2.6 refactor vite-plugin/index.ts; T1.1/T1.2 fixtures via vite test runtime (vitest). |
| `vitest` | `^3.x` (current) → **bump to ≥4.1.0 OBRIGATÓRIO em T0.2** | npm | Plan tem 12 TDD sections com `npx vitest run`. **CRITICAL CVE GHSA-5xrq-8626-4rwp** affects vitest <4.1.0 UI server (arbitrary file read/exec). Plan NÃO usa vitest UI mode mas DEP é direct — `plan_dep_critical_cve` aplica até bump. |
| `zod` | `^3.24.0` | npm | Plan T2.3 split config schemas Zod. Latest 4.4.3 disponível mas sem CVE em 3.24; bump opcional. |
| `tsx` | `^4.19.0` | npm | Plan scripts/migrations/ usam tsx. Sem CVE. |
| `eslint-plugin-sonarjs` | (transitivo) | npm | **3 HIGH CVE minimatch** (GHSA-3ppc-4f35-3m26, GHSA-7r86-cg39-jmmj, GHSA-23c5-xmqv-rm74) via transitive — não toca direto. Mitigation: `pnpm dedupe` ou upgrade da própria ESLint plugin. |
| `dependency-cruiser` | `^17.x` | npm | Plan acceptance criteria requer `pnpm depcruise exit 0`. Sem CVE. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| `ts-morph` (NEW) | `^28.0.0` | npm | Evaluated: (a) `jscodeshift` — rejected: recast-based, weaker TS type-aware; (b) `@babel/types` — rejected: invasive Babel setup, perde TS types; (c) regex sed — rejected em EC-3 por perder cause chain | T4.1 codemod precisa AST-aware transform que preserve `cause` chain em error class migration. ts-morph é TypeScript-native via Compiler API. |
| `publint` (NEW) | `^0.3.21` | npm | Evaluated: (a) `arethetypeswrong/cli` — rejected: complementar, valida types resolution mas não exports field shape completo; (b) Custom Node script — rejected: reinventaria roda (Rule 9 violation) | T2.5 valida `package.json#exports` field correctness ao adicionar 18 sub-paths. publint é tool standard (TanStack, tRPC, Vite usam). |
| `wrangler` (NEW dev) | `^4.98.0` | npm | Evaluated: (a) `miniflare` — rejected: lower-level, requires manual server setup; (b) `workerd` standalone — rejected: produção runtime, não dev tool | T1.2 EC-5 acceptance estendida exige `wrangler dev` smoke (não apenas vitest Node). T5a.1 R3a path também requer wrangler smoke. wrangler é tool oficial Cloudflare. |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (Plano N/A — não remove deps existentes; T2.5 deprecates barrel mas não package) | | |

### Audit verdict snapshot (2026-06-06)

**FAIL_INSECURE** — 1 CRITICAL CVE em direct dep (vitest <4.1.0) bloqueia gate até bump.

- **Hard cap:** `plan_dep_critical_cve` (vitest GHSA-5xrq-8626-4rwp)
- **Mitigation path:** Phase 0 T0.2 (NEW) bumpa vitest ≥4.1.0 antes de Phase 1 iniciar
- **Outros findings:** 3 HIGH (minimatch transitive via eslint-plugin-sonarjs) + 4 MODERATE (esbuild, vite, postcss, uuid — todos transitive). Audit report: `docs/audits/theokit-arch-gaps-implementation-deps-audit-2026-06-06.md`

### D6 — Phase order: mecânicos (Phase 2) ANTES dos críticos (Phase 3, 4, 5)

**Decision:** Mecânicos M1-M5 + boy-scout M6 vão para Phase 2 (paralelizável). Críticos C1/C2/C3 vão para Phase 3/4/5 (sequenciais).

**Rationale:** Mecânicos têm risco baixo + alto valor de housekeeping. Críticos exigem TDD baseline (Phase 1) primeiro. Mecânicos descongestionam o file tree, facilitando refactor críticos depois.

**Consequences:** Phase 2 pode rodar em paralelo (5 tasks independentes). Phase 3/4 sequenciais. Phase 5 bloqueado em Phase 0.

## Dependency Graph

```
Phase 0 (HUMAN DECISION)
   │
   ▼
Phase 1 (TDD baseline — Q7 boundary tests)
   │
   ├──▶ Phase 2 (mecânicos M1-M6, paralelizável)
   │        │
   │        ▼
   │     Final Phase (Dogfood QA)
   │
   ├──▶ Phase 3 (C1 plugin scope)
   │        │
   │        ▼
   │     Final Phase
   │
   ├──▶ Phase 4 (C2 envelope migration)
   │        │
   │        ▼
   │     Final Phase
   │
   └──▶ Phase 5 (C3 multi-runtime — BLOCKED em Phase 0)
            │
            ▼
         Final Phase
```

Phase 1 é blocker comum. Phases 2/3/4 paralelizáveis após Phase 1. Phase 5 paralelizável após Phase 0 + Phase 1.

---

## Phase 0: Human Decision Required (BLOCKING)

**Objective:** Registrar decisão humana R3a (Hono Web standards) vs R3b (Nitro Strategy presets) em ADR antes que Phase 5 (C3) inicie.

### T0.1 — Escrever ADR-0028 multi-runtime strategy

#### Objective
Produzir `docs/adr/0028-multi-runtime-strategy.md` (NOVO) escolhendo R3a OU R3b, com rationale e consequences explícitos.

#### Evidence
- Blueprint Q3 trade-off matrix (linhas 562-577)
- `architecture-output/consolidated_final_report.md` C3 (linhas 90-97)
- Empirical validation: 42 arquivos em `packages/theo/src/server/` importam `node:*` (medido 2026-06-05)

#### Files to edit
```
docs/adr/0028-multi-runtime-strategy.md — NEW
docs/adr/README.md — append entry to index (if exists)
CHANGELOG.md — entry under [Unreleased] § Changed referencing the chosen strategy
```

#### Deep file dependency analysis
- Nenhum código produção depende deste ADR ainda. Mas Phase 5 inteira lê ele para decidir implementation path.
- ADRs anteriores 0001-0027 são o template de format.

#### Deep Dives
**Recommendation default (caso não haja preferência explícita):** R3a (Hono Web standards) — racional:
1. Blueprint Surprise #3 mostrou que Hono adapters são literalmente shims de 7 linhas. O custo de adoption não vem dos adapters; vem do `server/` core.
2. Web standards é a direção universal moderna (Cloudflare Workers, Deno, Bun, edge runtimes em geral).
3. TheoKit já declara "TheoCloud é único deploy validado E2E" — TheoCloud roda Node, mas R3a permite expandir para CF Workers/Bun/Deno SEM manter código de adapter.
4. Invariante 2 (`core` depende de nada intra-monorepo) — R3a respects; R3b requer reorganização (`presets/` sibling de `core/`).

**Trade-off não óbvio:** R3a tem maior blast radius (rewrite cascata), mas paga em "honesty cost": claim "TheoKit runs anywhere" passa a ser verdade.

#### Tasks
1. Reler blueprint Q3 (linhas 510-580) e trade-off matrix
2. Reler `architecture-output/consolidated_final_report.md` C3 section
3. Decidir R3a OU R3b (humano)
4. Escrever ADR-0028 com Context / Decision / Consequences MADR 3.0
5. Adicionar entry em CHANGELOG `[Unreleased] § Changed`

#### TDD + BDD
NÃO se aplica — ADR é documento, não código. Marcar explicitly N/A com rationale: "ADRs documentam decisões; código de Phase 5 que implementa a decisão herda TDD+BDD."

#### Acceptance Criteria
- [ ] `docs/adr/0028-multi-runtime-strategy.md` existe
- [ ] ADR cita R3a OU R3b explicitly
- [ ] Section "Consequences" lista impacts em invariants 1, 2, 3
- [ ] CHANGELOG entry adicionada
- [ ] PR aprovada por humano antes de Phase 5 iniciar
- [ ] **EC-1 Sunset:** Decisão registrada em ADR-0028 dentro de **30 dias após Phase 1 completar**. Se o prazo expirar sem decisão registrada, default = **R3a (Hono Web standards)** é assumido per Deep Dives recommendation, ADR-0028 é escrita pelo último maintainer com timestamp do fallback, e Phase 5a inicia automaticamente.

#### DoD
- [ ] ADR commited em branch develop
- [ ] Reference adicionada em `docs/adr/README.md` se existir
- [ ] Phase 5 fica unblocked
- [ ] Sunset date registrada em `.claude/active_plan.md` OR equivalent tracker

### T0.2 — Bump vitest ≥4.1.0 (CRITICAL CVE mitigation)

#### Objective
Resolver CRITICAL CVE GHSA-5xrq-8626-4rwp (vitest UI server arbitrary file read/exec) bumpando vitest direct dep para ≥4.1.0 ANTES de Phase 1 RED tests iniciarem.

#### Evidence
- `docs/audits/theokit-arch-gaps-implementation-deps-audit-2026-06-06.md` (audit run, vide section abaixo)
- GHSA-5xrq-8626-4rwp: "When Vitest UI server is listening, arbitrary file can be read and executed"
- TheoKit `packages/theo/package.json` lista `vitest` como direct dep

#### Files to edit
```
packages/theo/package.json — bump vitest range para "^4.1.0" ou superior
pnpm-lock.yaml — regenerate via `pnpm install`
package.json (root, se vitest aparecer) — verificar e bumpar consistência
```

#### Deep file dependency analysis
- vitest 3.x → 4.x é major bump. Pode ter breaking changes em API (e.g., test helpers, pool config).
- TheoKit já configura `vitest.config.ts` com `singleFork` per CLAUDE.md root (test suite cleanup 2026-06-01).
- Risk: vitest 4.x mudanças na pool config podem quebrar singleFork.

#### Deep Dives
**Vitest 3.x → 4.x major changes (research required):** consultar `https://vitest.dev/guide/migration.html` (não pode ser fabricated — deve verificar versão real). Antes de bump, rodar full test suite atual para baseline.

**Alternative considered:** Allowlist o CRITICAL CVE com sunset 30d + nota "vitest UI mode não é usado em TheoKit dev workflow". Rejected porque allowlist de CRITICAL exige sunset ≤30d (golden rule § Anti-pattern 10) E porque o gate `plan_dep_critical_cve` baixa só uma severity (CRITICAL → MEDIUM ainda cap em 70). Bump é caminho mais limpo.

#### Tasks
1. `pnpm view vitest version` → confirmar latest stable ≥4.1.0
2. Read vitest migration guide (3 → 4)
3. Update `packages/theo/package.json#devDependencies.vitest` para `^4.1.0` ou range com major
4. `pnpm install` regenera lockfile
5. `pnpm test` em packages/theo — verificar zero regression
6. Se test failures: identificar e fix migration issues
7. Commit T0.2

#### TDD + BDD

```
RED:     N/A — bump dependency, not new behavior. Existing tests serve as regression spec.
GREEN:   Bump + pnpm install
REFACTOR: Fix any v4 migration issues
VERIFY:  pnpm test packages/theo && pnpm audit --json | jq '.advisories | length' (deve cair de 8 → ≤7)
```

#### Acceptance Criteria
- [ ] `packages/theo/package.json` lista `vitest@^4.1.0` ou superior
- [ ] `pnpm install` exit 0
- [ ] `pnpm test packages/theo` exit 0 (zero regression em tests existentes)
- [ ] `pnpm audit | grep vitest` retorna 0 matches (CVE gone)
- [ ] Pass: tsc, eslint
- [ ] CHANGELOG entry mencionando vitest bump

#### DoD
- [ ] Commit T0.2
- [ ] CRITICAL CVE eliminado do audit output
- [ ] Phase 1 unblocked

---

## Phase 1: TDD Baseline — Boundary Tests (Q7)

**Objective:** Criar test infrastructure que valida (a) cross-plugin decoration leak prevention (testa C1 antes de implementar) e (b) Web-standards Request/Response roundtrip via adapter (testa C3 antes de implementar). Per `testing.md` Inquebrável: RED tests precedem GREEN code.

### T1.1 — Plugin scope leak prevention test (RED)

#### Objective
Test fixture que prova que decoração em plugin B não vaza para parent app nem para plugin A irmão. Test FALHA hoje (TheoPlugin não tem scope); GREEN vem em T3.1.

#### Evidence
- Blueprint Q7 Fastify `encapsulated-error-handler.test.js` linhas 18-67 (referência empírica do pattern)
- Fastify `plugin.1.test.js` cross-plugin isolation
- Consolidated report C1 risk: "vai estourar quando comunidade tiver ≥5 plugins"

#### Files to edit
```
tests/integration/plugin-scope-encapsulation.test.ts — NEW
tests/fixtures/plugin-scope-A/index.ts — NEW (fixture plugin A)
tests/fixtures/plugin-scope-B/index.ts — NEW (fixture plugin B)
```

#### Deep file dependency analysis
- Novo. Sem dependência reversa. Será consumido por Phase 3 (T3.1) como GREEN target.

#### Deep Dives
**Algorithm (BDD style):**
1. Given parent TheoApp registers plugin A com `decorateRequest('userKey', valueA)`
2. And parent TheoApp registers plugin B com `decorateRequest('userKey', valueB)`
3. When request enters scope of plugin A
4. Then `req.userKey === valueA`
5. And quando request enters scope de plugin B, `req.userKey === valueB`
6. And NEITHER override the parent app's request (parent não tem decoração)

**Invariant test:** `parentApp.decorations.userKey === undefined` mesmo após plugin A e B se registrarem.

#### Tasks
1. Criar fixture plugins A e B
2. Escrever test usando `defineTheoApp().register(pluginA).register(pluginB)`
3. Assert isolation
4. Assert NO leak para parent
5. Verify test is RED (fails today)

#### TDD + BDD (⛔ OBRIGATÓRIO)

```
RED:     test_plugin_a_decoration_isolated_from_b — Given plugins A/B decorate request with same key but diff values, When req enters plugin A scope, Then sees value A. (MUST fail before T3.1)
RED:     test_decoration_does_not_leak_to_parent — Given plugin decorates request, When parent app handles request without plugin, Then decoration is undefined. (MUST fail before T3.1)
RED:     test_sibling_plugins_isolated — Given plugin A and plugin B decorate same key, When req traverses A then B, Then each sees its own value. (MUST fail before T3.1)
RED:     test_register_returns_child_scope — Given app.register(plugin), When plugin.register(scope), Then scope !== app and Object.getPrototypeOf(scope) === app. (MUST fail before T3.1)
GREEN:   Implementation em T3.1 (Phase 3)
REFACTOR: None expected nesta fase — só RED tests
VERIFY:  npx vitest run tests/integration/plugin-scope-encapsulation.test.ts
```

BDD scenarios:
- **Happy path:** plugin A decorates → consumer sees only A's decoration in A's scope
- **Validation error:** plugin tenta decorar key inválido (não-string) → error em register-time
- **Edge case (EC-4):** plugin decora com objeto mutável `{count: 0}`; plugin A muta `count++` → **assertar que parent's count também muta** (Object.create proto-chain shares object refs by design). Documentar invariant: decorations DEVEM ser values primitivos OR `Object.freeze`'d. Test serve como spec do invariant.
- **Error scenario:** plugin throws em register → parent recovery is clean (no half-mounted state)

#### Acceptance Criteria
- [ ] Tests escritos em `tests/integration/plugin-scope-encapsulation.test.ts`
- [ ] `npx vitest run tests/integration/plugin-scope-encapsulation.test.ts` retorna FAIL (RED state)
- [ ] Fixtures `tests/fixtures/plugin-scope-{A,B}/` existem
- [ ] Pass: tsc --noEmit
- [ ] Pass: eslint zero warnings
- [ ] **EC-4 documented invariant:** "decorations DEVEM ser primitives OR Object.freeze'd antes de decorate" registrado em `packages/theo/src/server/plugin-types.ts` JSDoc

#### DoD
- [ ] 4 RED tests no arquivo
- [ ] Fixtures funcionais
- [ ] Commit referenciando T1.1

### T1.2 — Multi-runtime boundary test (RED, conditional em Phase 0)

#### Objective
Test que prova handler TheoKit pode rodar em Web standards (Request → Response) sem `node:*`. RED hoje. GREEN vem em Phase 5 (depende ADR-0028 chosen path).

#### Evidence
- Blueprint Q7 `theo-adapter-cloudflare-workers.test.ts` proposal (linha 902)
- Blueprint surprise: Hono `hono-base.ts:479-485` `fetch(): Response | Promise<Response>` é o canonical Web standards signature

#### Files to edit
```
tests/integration/handler-web-standards.test.ts — NEW
tests/fixtures/handler-web-standards/route.ts — NEW (simple route)
```

#### Deep file dependency analysis
- Novo. Será consumido por Phase 5 (R3a path) OR adaptado (R3b path).

#### Deep Dives
Test usa `new Request('http://localhost/api/test')` (Web standards) e espera que o handler retorne `Response`. Hoje vai falhar porque `server/http/execute.ts` consumes `node:IncomingMessage`.

#### Tasks
1. Criar fixture route handler simples
2. Test invoca handler com Web Request
3. Assert Response.status, Response.text()
4. Verify RED

#### TDD + BDD

```
RED:     test_handler_accepts_web_request — Given Request via Web API, When handler executes, Then returns Response. (MUST fail before Phase 5)
RED:     test_handler_does_not_require_node_imports — Given test runs in env where node:http is unavailable, When handler executes, Then no ReferenceError. (MUST fail before Phase 5)
RED:     test_handler_response_is_native_web_response — Given handler returns body, When asserted, Then response instanceof Response. (MUST fail before Phase 5)
RED:     test_handler_streams_response — Given handler returns ReadableStream, When consumer reads, Then chunks arrive correctly. (MUST fail before Phase 5)
GREEN:   Implementation em Phase 5 (R3a path) OR adapted for R3b
REFACTOR: None expected
VERIFY:  npx vitest run tests/integration/handler-web-standards.test.ts
```

BDD scenarios:
- **Happy path:** GET request com Web API → Response 200 com JSON body
- **Validation error:** POST com Zod schema mismatch → Response 400
- **Edge case:** empty body request → handler trata sem crash
- **Error scenario:** handler throws → Response 500 com TheoError envelope (post-T4.1)

#### Acceptance Criteria
- [ ] Test escrito
- [ ] FAIL (RED state)
- [ ] Pass tsc + eslint
- [ ] **EC-5:** Acceptance criterion estendido — T1.2 GREEN é satisfeito **apenas com `wrangler dev tests/fixtures/handler-web-standards/`** retornando 200 com Response shape correto. Vitest test em Node é necessário mas NÃO suficiente porque vitest Node tem `node:*` disponível (RED state é artificial). Wrangler dev é o real proof.

#### DoD
- [ ] 4 RED tests
- [ ] Fixture funcional (consumível via wrangler dev)
- [ ] Commit T1.2

---

## Phase 2: Mecânicos M1-M6 (Paralelizável)

**Objective:** Fechar os 6 mau cheiros mecânicos identificados na revisão arquitetural. Risco baixo, valor alto de housekeeping.

### T2.1 — M5 Lonely folders eliminados

#### Objective
Inline `react-query/` (1 arquivo, 48 LOC) e `services/schema/` (1 arquivo) para os modules apropriados.

#### Evidence
- Consolidated report M5 — anti-padrão universal
- Blueprint Q5 D5: "lonely folders são over-folding"

#### Files to edit
```
packages/theo/src/react-query/index.ts — DELETE
packages/theo/src/client/react-query.ts — NEW (conteúdo movido)
packages/theo/src/services/schema/<file>.ts — MOVE para packages/theo/src/services/<inline>.ts
packages/theo/src/index.ts — atualizar barrel se houver re-export
packages/theo/src/client/index.ts — adicionar re-export se necessário
```

#### Deep file dependency analysis
- `react-query/` é leaf (cited em consolidated report como single-file). Mover para `client/react-query.ts` agrupa com sibling logical (`client/` já contém TanStack Query bridge concerns).
- `services/schema/` precisa de inspect — se for o único arquivo schema-related, inline para `services/`.

#### Tasks
1. `mv packages/theo/src/react-query/index.ts packages/theo/src/client/react-query.ts`
2. Atualizar imports consumidores via grep
3. Deletar pasta `react-query/`
4. Idem para `services/schema/`
5. Run tsc + lint + vitest

#### TDD + BDD

```
RED:     N/A — refactor sem behavior change. Tests existentes devem continuar passando (GREEN sem RED step).
GREEN:   Apenas reorganização de paths
REFACTOR: As próprias mudanças são o refactor
VERIFY:  pnpm test && pnpm typecheck && pnpm depcruise
```

Pure structural refactor. Tests pre-existentes (vitest) validam que nenhum behavior quebrou.

#### Acceptance Criteria
- [ ] `packages/theo/src/react-query/` não existe
- [ ] `packages/theo/src/services/schema/` não existe
- [ ] `pnpm test` exit 0 (no regressions)
- [ ] `pnpm typecheck` exit 0
- [ ] `pnpm depcruise` exit 0

#### DoD
- [ ] 0 lonely folders no `packages/theo/src/`
- [ ] Commit T2.1

### T2.2 — M4 `cli/commands/start/` subfolder

#### Objective
Mover `cli/commands/start-*.ts` (7 arquivos flat) para `cli/commands/start/<sub>.ts` mirror do sibling `migrate/`.

#### Evidence
- Consolidated report M4: inconsistência interna (sibling `migrate/` JÁ é subfolder)
- Blueprint Q6 D5: heurística "promote subfolder when ≥2 conceptual siblings exist"
- Nitro `references/nitro/src/cli/commands/` confirma pattern

#### Files to edit
```
packages/theo/src/cli/commands/start.ts — MOVE para start/index.ts
packages/theo/src/cli/commands/start-bootstrap-stages.ts — MOVE para start/bootstrap-stages.ts
packages/theo/src/cli/commands/start-graceful-shutdown.ts — MOVE para start/graceful-shutdown.ts
packages/theo/src/cli/commands/start-handlers.ts — MOVE para start/handlers.ts
packages/theo/src/cli/commands/start-manifest-loader.ts — MOVE para start/manifest-loader.ts
packages/theo/src/cli/commands/start-request-handler.ts — MOVE para start/request-handler.ts
packages/theo/src/cli/commands/start-ssr-setup.ts — MOVE para start/ssr-setup.ts
packages/theo/src/cli/commands/start-websocket-handler.ts — MOVE para start/websocket-handler.ts
packages/theo/src/cli/index.ts — atualizar imports
(consumidores em vite-plugin/ e elsewhere) — atualizar imports
```

#### Deep file dependency analysis
- 7+1 files. Imports cross-package vão precisar de update.
- Codemod via `find packages/theo/src -type f -name '*.ts' -exec sed -i ...` é seguro porque path é único.

#### Tasks
1. **EC-6 pre-flight:** `grep -nE "from ['\"]\./start-" packages/theo/src/cli/commands/start*.ts` — listar imports relativos intra-família ANTES do mv. 7 files se importam mutuamente.
2. `mkdir packages/theo/src/cli/commands/start/`
3. `git mv` cada arquivo (preserva history)
4. Rename intra-pasta (e.g., `start-bootstrap-stages.ts` → `bootstrap-stages.ts`)
5. **EC-6 codemod com 2 patterns:** (a) cross-folder imports `from '../start-bootstrap-stages.js'` → `from '../start/bootstrap-stages.js'`; (b) intra-folder imports `from './start-bootstrap-stages.js'` → `from './bootstrap-stages.js'` (mesmo subfolder agora — prefix `start-` removido).
6. Atualizar `cli/index.ts` se houver re-export
7. Run typecheck + test

#### TDD + BDD

```
RED:     N/A — pure refactor.
GREEN:   Moved files preserve behavior; imports updated
REFACTOR: Já é o próprio refactor
VERIFY:  pnpm test && pnpm typecheck && pnpm depcruise
```

#### Acceptance Criteria
- [ ] `cli/commands/start/` existe com 8 arquivos
- [ ] `cli/commands/start-*.ts` NÃO existe na raiz
- [ ] `pnpm test` exit 0
- [ ] `pnpm typecheck` exit 0

#### DoD
- [ ] Commit T2.2

### T2.3 — M2 `config/schemas/<concern>.ts` split

#### Objective
Dividir `config/schema.ts` 504 LOC em `config/schemas/{auth,csrf,cors,csp,plugins,openapi,security-headers,rate-limit,services,adapters,dev,build,runtime,hmr}.ts` + `schemas/index.ts` barrel + composer fino em `config/schema.ts` <100 LOC.

#### Evidence
- Consolidated report M2
- Blueprint Q5 Astro pattern: `references/astro/packages/astro/src/core/config/schemas/{base,refined,relative}.ts`
- EC-10 honest framing: Astro `base.ts` ainda é 613 LOC — split não precisa ser perfeito

#### Files to edit
```
packages/theo/src/config/schema.ts — REWRITE (vira composer fino)
packages/theo/src/config/schemas/index.ts — NEW (barrel)
packages/theo/src/config/schemas/auth.ts — NEW
packages/theo/src/config/schemas/csrf.ts — NEW
packages/theo/src/config/schemas/cors.ts — NEW
packages/theo/src/config/schemas/csp.ts — NEW
packages/theo/src/config/schemas/plugins.ts — NEW
packages/theo/src/config/schemas/openapi.ts — NEW
packages/theo/src/config/schemas/security-headers.ts — NEW
packages/theo/src/config/schemas/rate-limit.ts — NEW
packages/theo/src/config/schemas/services.ts — NEW
packages/theo/src/config/schemas/adapters.ts — NEW
packages/theo/src/config/schemas/dev.ts — NEW
packages/theo/src/config/schemas/build.ts — NEW
packages/theo/src/config/schemas/runtime.ts — NEW
packages/theo/src/config/schemas/hmr.ts — NEW
```

#### Deep file dependency analysis
- `config/schema.ts` exporta `theoConfigSchema` consumido em ~30 lugares. Composer mantém export estável.
- Cada sub-schema é importado pelo composer; consumer code não precisa mudar.

#### Tasks
1. **EC-9 pre-flight cross-references:** `grep -nE "z\.lazy\|extends" packages/theo/src/config/schema.ts` + identificar cross-references entre os 14 schemas (e.g., `csrf` schema importa shapes de `security-headers`). Documentar dependency graph.
2. Identificar os 14 Zod schemas no arquivo atual
3. **EC-9 ordem topológica:** processar split na ordem least-dependent primeiro (e.g., `security-headers` → `csrf` → `csp` → outros). Circular imports são detectados imediatamente por tsc, mas evitar tentativa.
4. Para cada, criar `config/schemas/<concern>.ts` com schema + types relevantes
5. Criar `config/schemas/index.ts` re-exportando todos
6. Reescrever `config/schema.ts` como composer (importa de schemas/index.ts, monta `theoConfigSchema` final)
7. Validar tsc + tests

#### TDD + BDD

```
RED:     test_theoConfigSchema_parses_full_config — Given a complete config object, When parse, Then result.success=true. (DEVE passar antes E depois — proof de non-regression)
RED:     test_each_subschema_isolated — Given each sub-schema file, When imported isolated, Then exports its Zod schema. (NEW test — pre-T2.3 falha, post-T2.3 passa)
GREEN:   Composer integration
REFACTOR: Composer fica <100 LOC
VERIFY:  pnpm test packages/theo/tests/unit/config/
```

BDD scenarios:
- **Happy path:** full theo.config.ts parsed correctly
- **Validation error:** invalid CSRF mode → error referenciando sub-schema correto
- **Edge case:** empty config → defaults applied
- **Error scenario:** missing required field → typed error message

#### Acceptance Criteria
- [ ] 14 sub-schema files em `config/schemas/`
- [ ] `config/schema.ts` < 100 LOC
- [ ] `theoConfigSchema` export inalterado (consumer code não muda)
- [ ] All existing tests pass

#### DoD
- [ ] Commit T2.3

### T2.4 — M3 `devtools/{dom,state,bridge,format}/` sub-org

#### Objective
Organizar os 13 loose files em `devtools/` em 4 sub-pastas conceituais.

#### Evidence
- Consolidated report M3
- Blueprint Q6 Astro `dev-toolbar/{apps,helpers.ts,settings.ts,toolbar.ts,ui-library}` pattern

#### Files to edit
```
packages/theo/src/devtools/Overlay.tsx → devtools/dom/Overlay.tsx
packages/theo/src/devtools/entry.tsx → devtools/dom/entry.tsx
packages/theo/src/devtools/shadow-portal.tsx → devtools/dom/shadow-portal.tsx
packages/theo/src/devtools/reducer.ts → devtools/state/reducer.ts
packages/theo/src/devtools/actions-row-state.ts → devtools/state/actions-row-state.ts
packages/theo/src/devtools/persistence.ts → devtools/state/persistence.ts
packages/theo/src/devtools/dispatcher.ts → devtools/bridge/dispatcher.ts
packages/theo/src/devtools/install-global.ts → devtools/bridge/install-global.ts
packages/theo/src/devtools/hmr-bridge.ts → devtools/bridge/hmr-bridge.ts
packages/theo/src/devtools/pii-mask.ts → devtools/format/pii-mask.ts
packages/theo/src/devtools/csrf-readiness-classify.ts → devtools/format/csrf-readiness-classify.ts
packages/theo/src/devtools/shared.ts — KEEP (genuinely shared)
packages/theo/src/devtools/index.ts — atualizar barrel
```

#### Tasks
1. `mkdir` 4 sub-pastas
2. `git mv` arquivos
3. Codemod imports
4. Verify

#### TDD + BDD

```
RED:     N/A — refactor sem behavior change
GREEN:   Files moved, imports updated
REFACTOR: Já é o refactor
VERIFY:  pnpm test devtools/ && pnpm typecheck && depcruise
```

#### Acceptance Criteria
- [ ] 4 sub-pastas existem
- [ ] devtools root tem ≤2 loose files (Overlay/entry foram para dom/; shared.ts pode ficar OR vai para shared.ts em outro lugar)
- [ ] All tests pass
- [ ] depcruise zero violations
- [ ] **EC-7 Chrome DevTools smoke:** open `dogfood-app` no Chrome, verify TheoKit Devtools tab populates com Actions/Requests data (React Context bug catch). Vitest sozinho NÃO prova porque Context provider reference identity é runtime-only concern; tree-shaking ou path mismatch pós-mv quebra Context silenciosamente sem TS error.

#### DoD
- [ ] Commit T2.4
- [ ] Chrome MCP screenshot evidence anexado

### T2.5 — M1 Sub-package exports via `package.json#exports`

#### Objective
Substituir 16 `export *` wildcards em `packages/theo/src/server/index.ts` por entries no `package.json#exports` field (Hono-shape, blueprint D4).

#### Evidence
- Consolidated report M1
- Blueprint Q4: Hono `package.json` tem 74-key `"exports"` field

#### Files to edit
```
packages/theo/package.json — adicionar/expandir "exports" field
packages/theo/src/server/index.ts — REWRITE (slim down OR delete em favor de sub-paths)
packages/theo/src/server/auth/index.ts — confirm exists
packages/theo/src/server/jobs/index.ts — confirm exists
(... mesmo para os 16 sub-domains)
CHANGELOG.md — entry sob [Unreleased] § Changed marcando BREAKING
docs/migration/0.x-to-0.y-server-exports.md — NEW migration guide
```

#### Deep file dependency analysis
- Mudança BREAKING para consumer code que faz `import { foo } from 'theokit/server'` quando `foo` está em sub-domain. Codemod ajuda mas consumers precisam atualizar.

#### Tasks
1. Listar 18 sub-domains em `server/`
2. Para cada, garantir `<subdomain>/index.ts` é válido entry-point
3. Adicionar entries em `package.json#exports` (`./server/auth`, `./server/jobs`, ...)
4. Adicionar `"types"` condition em cada entry
5. **EC-2:** Manter `server/index.ts` como **deprecated barrel** que re-exporta os 18 sub-domains MAS adiciona runtime warning na primeira import call: `console.warn('[theokit] umbrella import "theokit/server" is deprecated. Use sub-paths: theokit/server/<domain>. Removal scheduled for 0.x+2.')`. Warning fires once per process via flag.
6. Adicionar `publint` no CI
7. Codemod para imports internos do framework (`from '../server/index.js'` → `from '../server/auth/index.js'`)
8. Migration guide DOCUMENTA: "Deprecated barrel mantido durante 1 minor cycle (0.x → 0.x+1). Removal final em 0.x+2."
9. **EC-2 followup:** Criar issue de tracking "Remove deprecated theokit/server umbrella barrel — target 0.x+2"

#### TDD + BDD

```
RED:     test_export_field_is_complete — Given package.json#exports, When publint runs, Then exits 0. (NEW — pre-T2.5 falha porque exports field falta)
RED:     test_consumer_can_import_subpath — Given consumer imports 'theokit/server/auth', When TS compiles, Then types resolve. (NEW)
GREEN:   Expand exports field + sub-domain index.ts files
REFACTOR: Slim server/index.ts
VERIFY:  pnpm test && npx publint packages/theo && pnpm typecheck
```

BDD scenarios:
- **Happy path:** consumer imports `from 'theokit/server/auth'` → types + runtime resolve
- **Validation error:** consumer imports `from 'theokit/server/nonexistent'` → TS error
- **Edge case:** consumer continues `from 'theokit/server'` → backward-compat se sub-set de exports continua disponível durante deprecation period
- **Error scenario:** publint detecta missing types entry → CI fails

#### Acceptance Criteria
- [ ] `package.json#exports` tem ≥18 sub-paths
- [ ] `npx publint` exit 0
- [ ] Consumer test passa importando sub-paths
- [ ] Migration guide existe
- [ ] CHANGELOG entry

#### DoD
- [ ] Commit T2.5
- [ ] Breaking change documented

### T2.6 — M6 `vite-plugin/index.ts` 632 LOC refactor (boy-scout)

#### Objective
Reduzir `vite-plugin/index.ts` para <400 LOC extraindo siblings adicionais.

#### Evidence
- Consolidated report M6
- File comment "T2.1-T2.3 (architecture-medium-deferrals)" admite refactor incompleto

#### Files to edit
```
packages/theo/src/vite-plugin/index.ts — REWRITE slim entry
packages/theo/src/vite-plugin/<3+ NEW sibling files> — extracted concerns
```

#### Tasks
1. Audit `vite-plugin/index.ts` — identificar 3+ concerns extraíveis
2. Extract cada concern para sibling file
3. Reescrever `index.ts` como orchestrator
4. Verify

#### TDD + BDD

```
RED:     N/A — refactor sem behavior change
GREEN:   Extracted concerns, slim entry
REFACTOR: Já é o refactor
VERIFY:  pnpm test vite-plugin/ && pnpm typecheck && depcruise
```

#### Acceptance Criteria
- [ ] `vite-plugin/index.ts` < 400 LOC
- [ ] ≥3 new sibling files
- [ ] All tests pass
- [ ] **EC-10 Vite hook ordering preserved:** acceptance estendida — `dogfood-app dev` boot + HMR roundtrip + `theokit build` + `theokit start` full cycle reproduzem comportamento idêntico ao pre-T2.6 (mesma sequence de hook invocations capturada via Vite plugin debug log). Hook ordering bugs (configResolved/resolveId/load/transform side effects) manifestam em runtime, não em unit tests — vitest sozinho NÃO prova.

#### DoD
- [ ] Commit T2.6
- [ ] dogfood-app dev/build/start full cycle smoke evidência

---

## Phase 3: C1 Plugin Scope Encapsulation

**Objective:** Implementar `Object.create(parent)` pattern em `TheoApp.register()` per blueprint D1. RED tests de T1.1 viram GREEN.

### T3.1 — Implementar `TheoApp` scope via `Object.create(parent)`

#### Objective
Modificar `TheoApp.register(plugin)` para criar child instance isolado, mirror Fastify `plugin-override.js:38`.

#### Evidence
- Blueprint D1 + Q1 Fastify reference
- T1.1 RED tests aguardando

#### Files to edit
```
packages/theo/src/server/plugin-types.ts — REWRITE
packages/theo/src/server/plugins/register.ts — NEW (lifecycle helper)
packages/theo/src/server/plugins/plugin-runner.ts — UPDATE
packages/theo/src/server/index.ts (OR sub-path post-M1) — re-export
```

#### Deep file dependency analysis
- `plugin-types.ts` define `TheoPlugin`/`TheoApp` interfaces — breaking change.
- Plugin authors precisam atualizar — migration guide cobre.

#### Deep Dives
```ts
// packages/theo/src/server/plugins/register.ts
export async function register(parent: TheoApp, plugin: TheoPlugin): Promise<TheoApp> {
  const child: TheoApp = Object.create(parent)  // ← THE encapsulation primitive
  child.decorations = Object.create(parent.decorations ?? null)
  child.hooks = { onRequest: [...parent.hooks.onRequest], /* ... */ }
  await plugin.register(child)
  return child
}
```

Hot path: `Object.create()` é cheap (V8 hidden class share). Per `v8-jit` patterns, mantém monomorphic.

#### Tasks
1. **EC-8 pre-flight bypass detection:** `grep -rEn "\.decorations\." packages/theo/src/ ../theokit-plugins/packages/*/src/ ../theokit-sdk/packages/*/src/` para identificar plugins que acessaram `app.decorations.foo = bar` direto (bypass do API canônico). Listar em PR description.
2. Reescrever `TheoApp` interface com `decorations` + `hooks` shape (decorations get/set via `Object.create()` proto-chain — vide T1.1 EC-4 invariant)
3. Implementar `register()` helper
4. Atualizar `plugin-runner.ts` para usar register helper
5. **EC-8:** Migrar TODOS os bypasses identificados em (1) para API canônica `decorateRequest()` ANTES do Object.create() ship. Sem isso, plugins quebram silenciosamente em runtime.
6. Migrar testes T1.1 de RED para GREEN
7. Migration guide para plugin authors existentes (auth-google, plugin-cors, etc.)
8. Add codemod se necessário (`decorate` → `decorateRequest`)

#### TDD + BDD

```
RED:     (Já feitos em T1.1 — viram GREEN aqui)
GREEN:   Implement register + Object.create pattern
REFACTOR: Move `decorateRequest` from raw assignment to API
VERIFY:  npx vitest run tests/integration/plugin-scope-encapsulation.test.ts
```

BDD scenarios (já em T1.1):
- Happy path: isolation works
- Validation error: invalid decoration key
- Edge case: zero decorations
- Error scenario: register throws

#### Acceptance Criteria
- [ ] T1.1 tests passam GREEN
- [ ] Plugins existentes (auth-google, etc.) migram com codemod
- [ ] `pnpm test` exit 0
- [ ] Migration guide existe
- [ ] CHANGELOG entry marcando BREAKING

#### DoD
- [ ] Commit T3.1
- [ ] Plugin migration validada

---

## Phase 4: C2 Envelope Migration Completeness

**Objective:** Drenar as 23 Error classes restantes para `TheoError` flat (blueprint D2). Adoption rate 20% → 100%.

### T4.1 — Run codemod existente + verify migration completeness

#### Objective
Aplicar `scripts/migrations/envelope-0-2-to-0-4.mjs` nas 23 classes Error pendentes; adicionar test integration roundtrip.

#### Evidence
- Codemod já existe (CLAUDE.md root cita)
- Consolidated report C2: 20% adoption
- Blueprint D2 + Q2

#### Files to edit
```
packages/theo/src/<23 files> — Error classes migradas
scripts/migrations/envelope-0-2-to-0-4.mjs — UPDATE se necessário
tests/integration/envelope-wire-format-roundtrip.test.ts — NEW
CHANGELOG.md — entry
```

#### Deep file dependency analysis
- 23 Error classes identificadas via grep `^export class \w*Error` minus os 6 que já usam envelope.

#### Deep Dives
Strategy: codemod produz `throw new TheoError({code: 'FOO_ERROR', message: '...'})` from `throw new FooError('...')`. Test integration prova que wire-format JSON é IDÊNTICA para pre/post migration (backward compat).

**EC-3 Critical: cause chain preservation.** Errors aninhados (`new FooError('msg', {cause: prevError})`) precisam preservar `cause` no resultado (`new TheoError({code, message, cause: prevError})`). Codemod regex-based simples **PODE PERDER** isso silenciosamente em padrões edge:
- `cause` em segundo argumento positional vs. options bag
- Async stack contexts onde `cause` foi adicionado em catch block
- Cause chain de profundidade ≥2 (`error.cause.cause`)

**Implementation mandate:** codemod DEVE usar **AST-based transform via ts-morph** (`@ts-morph/bootstrap`), NÃO regex. ts-morph permite visit explícito de ThrowStatement nodes e preservation de argument shapes. Estimated cost: +1 dev day vs regex codemod, mas elimina entire class of cause-loss bugs.

#### Tasks
1. Identificar 23 classes (grep)
2. Run codemod
3. Manual review of edge cases
4. Add integration test
5. Delete legacy class definitions
6. CHANGELOG

#### TDD + BDD

```
RED:     test_all_29_errors_serialize_to_envelope — Given each of 29 historical error types, When thrown via handler, Then JSON response matches envelope schema. (NEW — pre-T4.1 fails for 23, post passes for 29)
RED:     test_legacy_classes_no_longer_referenced — Given codebase grep, When count of FooError-style classes, Then 0 results outside legacy folder. (NEW)
RED:     test_cause_chain_preserved_through_codemod (EC-3) — Given FooError('outer', {cause: barError}), When codemod runs, Then resulting TheoError.cause === barError (identity check). (NEW — MUST PASS)
RED:     test_cause_chain_depth_2_preserved (EC-3) — Given new FooError('a', {cause: new BarError('b', {cause: new BazError('c')})}), When codemod runs, Then chain depth 2 traversable. (NEW)
GREEN:   Codemod run via ts-morph AST transform (NOT regex)
REFACTOR: Delete legacy class files
VERIFY:  pnpm test tests/integration/envelope-wire-format-roundtrip.test.ts
```

BDD scenarios:
- Happy path: thrown TheoError → serialized envelope
- Validation error: invalid code → typed error
- Edge case: error com cause chain → cause preserved no envelope
- Error scenario: handler throws non-Error → wrapped em UnknownError envelope

#### Acceptance Criteria
- [ ] `grep -rEn "^export class \w*Error" packages/theo/src/` retorna ≤6 (apenas envelope-related)
- [ ] `grep -rln "TheoErrorEnvelope\|TheoError" packages/theo/src/` retorna ≥25 (cobertura cross-cutting)
- [ ] Integration test passa para 29 error types
- [ ] Migration guide

#### DoD
- [ ] Commit T4.1
- [ ] Adoption rate 100% verificada empirically

---

## Phase 5: C3 Runtime Portability (BLOCKED em Phase 0)

**Objective:** Implementar caminho escolhido na ADR-0028 (R3a OR R3b). Phase 5a OR Phase 5b dependendo da decisão.

### Phase 5a — IF R3a (Hono Web standards)

### T5a.1 — Migrar `server/http/` para Web Request/Response

#### Objective
Substituir 42 imports `node:*` em `server/` por Web standards. Server handler accepts `Request`, returns `Response`.

#### Evidence
- ADR-0028 decision = R3a
- Blueprint Q3 R3a recommendation + Hono `hono-base.ts:479-485`
- T1.2 RED tests aguardando

#### Files to edit
```
packages/theo/src/server/http/execute.ts — REWRITE (accept Request, return Response)
packages/theo/src/server/http/execute-context.ts — REWRITE (no IncomingMessage)
packages/theo/src/server/http/cookies.ts — use Web cookie standards
packages/theo/src/server/http/cors.ts — use Headers API
packages/theo/src/server/security/csrf.ts — replace node:crypto with Web Crypto
packages/theo/src/server/body-parser.ts — accept ReadableStream
(... outros 36 files)
packages/theo/src/adapters/node.ts — wrap Web Request in IncomingMessage shim (boundary)
packages/theo/src/adapters/{cloudflare,deno-deploy,bun}.ts — passam direto sem shim
```

#### Deep file dependency analysis
- Massivo. Blast radius alto. ADR-0028 documenta.
- Node adapter vira o ÚNICO ponto onde `node:*` aparece (boundary).

#### Tasks
1. Run audit script: `grep -rln "from 'node:" packages/theo/src/server/`
2. Para cada file, identificar API node:* usado → equivalente Web standards
3. Refactor em ordem de dependência (leaves primeiro: serialization, body-parser; depois http/execute)
4. Update Node adapter para shim `IncomingMessage` ↔ `Request`
5. T1.2 RED tests viram GREEN
6. Test CF Workers adapter (real wrangler dev)

#### TDD + BDD

```
RED:     (T1.2 já criados — viram GREEN aqui)
RED:     test_42_node_imports_zero — Given grep "from 'node:" packages/theo/src/server, When counted, Then 0 results.
GREEN:   Refactor
REFACTOR: Slim adapters
VERIFY:  pnpm test && wrangler dev tests/fixtures/handler-web-standards/
```

BDD scenarios:
- Happy path: Web Request → Response no Node
- Validation error: same body em CF Workers
- Edge case: ReadableStream body
- Error scenario: TheoError envelope preserved

#### Acceptance Criteria
- [ ] 0 imports `node:*` em `server/`
- [ ] Node adapter mantém compat
- [ ] CF Workers smoke test passa (real wrangler dev)
- [ ] All existing tests pass

#### DoD
- [ ] Commit T5a.1
- [ ] BREAKING change documented

### Phase 5b — IF R3b (Nitro Strategy presets)

### T5b.1 — Criar `presets/` sibling de `server/`

#### Objective
Mover runtime-specific code para `packages/theo/src/presets/<runtime>/` com `_resolve.ts` orchestrator (mirror Nitro).

#### Evidence
- ADR-0028 decision = R3b
- Blueprint Q3 R3b recommendation + Nitro `presets/_resolve.ts:118 LOC`

#### Files to edit
```
packages/theo/src/presets/_resolve.ts — NEW
packages/theo/src/presets/node/index.ts — NEW
packages/theo/src/presets/cloudflare/index.ts — NEW
packages/theo/src/presets/deno/index.ts — NEW
packages/theo/src/presets/bun/index.ts — NEW
packages/theo/src/server/http/ — extrair runtime-specific bits para presets
packages/theo/.dependency-cruiser.cjs — adicionar rule "presets MUST NOT import from server/* exceto contracts"
```

(... mesma estrutura: Tasks, TDD+BDD, Acceptance, DoD adaptados para preset model)

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | C1 plugin scope encapsulation | T1.1, T3.1 | Object.create(parent) pattern (Fastify-shape) |
| 2 | C2 envelope migration 20% → 100% | T4.1 | Codemod run + integration test |
| 3 | C3 multi-runtime portability | T0.1, T1.2, T5a.1 OR T5b.1 | ADR-0028 + chosen path implemented |
| 4 | M1 sub-package exports field | T2.5 | Hono-shape exports + publint CI |
| 5 | M2 config schemas split | T2.3 | 14 sub-schemas + composer fino |
| 6 | M3 devtools sub-organization | T2.4 | 4 sub-pastas {dom,state,bridge,format} |
| 7 | M4 CLI commands start subfolder | T2.2 | cli/commands/start/<sub>.ts mirror migrate/ |
| 8 | M5 lonely folders | T2.1 | react-query/ + services/schema/ inlined |
| 9 | M6 vite-plugin/index.ts 632 LOC | T2.6 | <400 LOC + extracted siblings |

**Coverage: 9/9 gaps covered (100%)**

## Global Definition of Done

- [ ] All Phases (0-5) completed
- [ ] `pnpm test` exit 0 (vitest unit + integration)
- [ ] `pnpm typecheck` exit 0 (tsc --noEmit)
- [ ] `pnpm lint` exit 0 (zero warnings)
- [ ] `pnpm depcruise` exit 0 (zero new violations)
- [ ] `npx publint packages/theo` exit 0 (post-T2.5)
- [ ] Backward compatibility preserved OR breaking changes documentadas em migration guide
- [ ] CHANGELOG `[Unreleased]` atualizado para cada task com BREAKING
- [ ] **Re-run `loop-architecture-review --mode=full` retorna nota ≥4.0/5**
- [ ] **Dogfood QA PASS** — `dogfood full` health score ≥70, zero CRITICAL
- [ ] **Fixture proof** — `tests/fixtures/plugin-scope-{A,B}/` + `tests/fixtures/handler-web-standards/` existem

## Final Phase: Dogfood QA (MANDATORY)

> Roda AFTER todas as phases 0-5 completas.

**Objective:** Validar que mudanças funcionam como usuário real experimentaria, não apenas como unit tests assertam.

### Execution

```
dogfood full
```

### Acceptance Criteria

- [ ] Health score ≥ 70/100
- [ ] Zero CRITICAL issues introduzidos por este plan
- [ ] Zero HIGH issues em commands/features modificados (auth, plugins, CLI start, config schemas, devtools, server boundary)
- [ ] Pre-existing issues documentadas (não causadas por este plan)

### If Dogfood Fails

1. Identify issues caused by this plan vs pre-existing
2. Fix all plan-caused CRITICAL + HIGH antes de declarar complete
3. Re-run `dogfood full`
4. Pre-existing logged mas não bloqueiam

## Post-Plan: Edge Case Review (per `/to-plan` SKILL.md)

Após salvar este plan, rodar:

```
/edge-case-plan theokit-arch-gaps-implementation
```

Plan v1.0 → v1.1 absorvendo MUST FIX.

## Post-Implementation: Cross-Validation

Antes de `dogfood`:

```
/cross-validation theokit-arch-gaps-implementation
```

Gate mais rigoroso da pipeline. Verifica plan ↔ código linha-a-linha.

- APROVADO → proceed `dogfood`
- REPROVADO → fix divergences, re-run
- APROVADO COM RESSALVAS → fix CRITICALs, proceed

Report em `docs/reviews/cross-validation/theokit-arch-gaps-implementation-xval-{YYYY-MM-DD}.md`.

---

## Honest limitations of this plan

1. **Phase 0 bloqueia Phase 5 por design** — decisão R3a vs R3b é estratégica e exige humano com visão de roadmap. Não posso decidir sozinho. Recomendação default registrada nas Deep Dives de T0.1.
2. **T2.5 (M1 sub-package exports) é BREAKING** — consumer code que faz `from 'theokit/server'` puxando 18 sub-domains vai precisar migrar. Codemod ajuda mas não cobre 100% dos casos edge.
3. **T3.1 (C1 plugin scope) também é BREAKING** — plugins existentes precisam migrar contract. Migration guide obrigatório.
4. **T5a.1 (R3a path) tem blast radius alto** — 42 arquivos reescritos. Pode levar 1-2 sprints. Plan NÃO estima time/effort; isso é decisão de roadmap do time.
5. **Não inclui** investimentos extras descobertos durante a revisão arquitetural mas fora dos 9 gaps mapeados (e.g., agent registry singleton com `__resetForTests` escape — DEFERRED para discovery futuro).
