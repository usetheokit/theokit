# Discovery Plan: TheoKit architectural gaps vs canonical references

> **Version 1.1** — Este discovery investiga, em 5 frameworks de referência clonados localmente (Fastify, Hono, Nitro, Astro, Next.js), as soluções canônicas para os 3 críticos (C1 plugin encapsulation, C2 error envelope hierarchy, C3 multi-runtime portability) e os 4 mecânicos de maior impacto (M1 sub-package exports, M2 config schemas split, M3 devtools sub-organization, M4 CLI commands layout) identificados no `architecture-output/consolidated_final_report.md`. Output: blueprint comparativo que sustenta decisões arquiteturais antes de tocar código do framework.
>
> **Changelog v1.0 → v1.1 (2026-06-05):** Absorve 3 MUST FIX + 5 SHOULD TEST do edge-case review (`knowledge-base/reviews/theokit-arch-gaps-investigation-edge-cases-2026-06-05.md`). Mudanças: Q2 ganha método `git log --grep` (EC-1); Q3 Expected answer shape vira "2 recomendações independentes + ADR diferindo" (EC-2); Q7 ganha dependency explícita de Q1+Q3 (EC-3); 5 novos halt-loop checkpoints (EC-4 a EC-8). DOCUMENT items EC-9/EC-10 ficam no edge-case report como honest framing para `/discover-execute` aplicar.

**Slug:** `theokit-arch-gaps-investigation`
**Owner:** paulohenriquevn
**Created:** 2026-06-05
**Last updated:** 2026-06-05 (v1.1)
**Time budget:** 22h total — Fastify 4h, Hono 4h, Nitro 4h, Astro 5h, Next.js 5h (breakdown em D1)

## Context

Em 2026-06-05 foi executada revisão arquitetural completa do framework TheoKit (`architecture-output/consolidated_final_report.md`, 319 linhas). Veredito **3.5/5**. Foram identificados:

- **3 críticos de design** (C1/C2/C3) NÃO capturados pela revisão automatizada `loop-architecture-review` mas detectados em análise manual comparativa:
  - **C1** — TheoPlugin é Mediator com 4 hooks + `decorateRequest`, classificado erroneamente como Composite. **Não tem encapsulation scope** (`packages/theo/src/server/plugin-types.ts:39-43`). Vai estourar quando comunidade tiver ≥5 plugins coexistindo.
  - **C2** — Error envelope G5 declarado SHIPPED end-to-end tem **20% de adoção real** (6 arquivos usam `TheoErrorEnvelope` vs 29 classes `Error` custom). Codemod existe (`scripts/migrations/envelope-0-2-to-0-4.mjs`) mas não foi aplicado.
  - **C3** — 42 arquivos em `packages/theo/src/server/` importam `node:*` diretamente, mas 6 adapters non-Node coexistem no in-tree (`packages/theo/src/adapters/{cloudflare,deno-deploy,bun,aws-lambda,vercel,netlify}.ts`). Incoerência entre estrutura declarada e runtime real.

- **4 mecânicos de alto impacto** (M1/M2/M3/M4) onde `loop-architecture-review` apontou o sintoma mas não comparou com referências:
  - **M1** — `packages/theo/src/server/index.ts` re-exporta 18 sub-domains via `export *` wildcards. Frameworks modernos (Next.js, Hono) usam **sub-package exports estritos** via `package.json#exports` field.
  - **M2** — `packages/theo/src/config/schema.ts` 504 LOC com 14 schemas Zod num arquivo. Astro divide por concern em `packages/astro/src/core/config/schemas/`.
  - **M3** — `packages/theo/src/devtools/` com 13 loose files no root mistura 5 concerns. Astro `dev-toolbar/apps/` tem sub-organização clara.
  - **M4** — `packages/theo/src/cli/commands/start-*.ts` 7 arquivos flat enquanto sibling `migrate/` JÁ é subfolder. Inconsistência interna.

Decisões locked aplicáveis (`.claude/rules/architecture.md` v3.1):
- Invariant 1: `core` depende de NADA intra-monorepo. **Tudo borrowed deve respeitar.**
- Invariant 2: 0 ciclos. **Toda solução proposta NÃO pode introduzir ciclo.**
- Invariant 3: public API flows through barrels — mas M1 questiona o **shape** desses barrels.

Foundation existente em `.claude/knowledge-base/reference/`:
- `devtools.md` (cobre TanStack/Astro/Next devtools — pode ter contexto pra M3)
- `oauth-oidc-delegation.md` (cobre delegation pattern — analogia para C2 envelope delegation)
- `polyglot-services-orchestration.md` (cobre runtime split via external processes — relacionado a C3)

Esses docs cobrem **decisões já tomadas**. Este discovery cobre os **gaps ainda em aberto**.

## Objective

Produzir um blueprint comparativo que permita ao time TheoKit decidir, antes de tocar código, **qual estratégia canônica adotar** para cada um dos 7 gaps (3 críticos + 4 mecânicos), respeitando os 3 invariantes de `architecture.md` v3.1.

Success criteria do blueprint:
- [ ] All research questions in this plan answered with citations to `.claude/knowledge-base/references/`
- [ ] Cross-cutting comparison table populated for every in-scope reference project
- [ ] Recommendations section provides at least one concrete decision proposal per in-scope research question
- [ ] Cada recomendação cita explicitamente compatibilidade vs invariantes de `architecture.md` v3.1
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/theokit-arch-gaps-investigation-blueprint.md`

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/fastify/` | `lib/plugin-utils.js`, `lib/plugin-override.js`, `lib/decorate.js`, `lib/errors.js`, `lib/error-handler.js`, `lib/error-serializer.js`, `lib/server.js`, `lib/hooks.js`, `package.json` | C1 plugin encapsulation canônica; C2 error tree hierarchy; M1 exports field |
| `.claude/knowledge-base/references/hono/` | `src/compose.ts`, `src/hono-base.ts`, `src/hono.ts`, `src/http-exception.ts`, `src/adapter/`, `package.json` | C1 alternative (sem scope, via compose); C3 Web-standards multi-runtime; M1 exports field |
| `.claude/knowledge-base/references/nitro/` | `src/presets/`, `src/presets/_resolve.ts`, `src/cli/`, `src/cli/commands/`, `src/runtime/`, `src/config/` | C3 Strategy de presets; M4 CLI commands sub-organization |
| `.claude/knowledge-base/references/astro/` | `packages/astro/src/core/config/`, `packages/astro/src/core/config/schemas/`, `packages/astro/src/runtime/client/dev-toolbar/`, `packages/astro/src/runtime/client/dev-toolbar/apps/` | M2 config schemas split; M3 devtools sub-organization |
| `.claude/knowledge-base/references/next.js/` | `packages/next/package.json`, `packages/next/src/cli/` | M1 sub-package exports field canonical; M4 CLI layout |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/*/docs/`, `*/website/`, `*/scripts/release*` | Marketing docs, website builds — não são SoT de design |
| `.claude/knowledge-base/references/*/test/`, `*/tests/` (exceto Q7) | Investigação primária é design; tests só entram via Q7 |
| `.claude/knowledge-base/references/*/types/`, `*/dist/`, `*/.github/` | Build artifacts + CI infra |
| `.claude/knowledge-base/references/next.js/packages/next/src/server/` | Next.js server runtime é enorme (~1000 files); fora do escopo dos 7 gaps |
| `.claude/knowledge-base/references/astro/packages/astro/src/core/build/` | Build pipeline não tem analog em TheoKit |
| NestJS, tRPC, TanStack Start, SvelteKit, Vite | Não clonados nesta janela; trade-off em D2 |
| Qualquer projeto NÃO presente em `.claude/knowledge-base/references/` | Cross-Project Rule: nunca afirmar feature de projeto sem ler source local |

## ADRs

### D1 — Time budget + stop conditions

**Decision:**
- Fastify: 4h (Q1 + Q2 share = 2h cada)
- Hono: 4h (Q1 alt + Q2 + Q3 alt share)
- Nitro: 4h (Q3 + Q5 split)
- Astro: 5h (Q4 + Q6 split — Astro é o ref mais largo)
- Next.js: 5h (Q4 + Q6 — mono enorme requer mais tempo de orientação)

**Rationale:** Astro e Next.js são monorepos grandes (99MB + 343MB) — leitura demanda mais wall time. Fastify+Hono+Nitro são repos focados, custam menos.

**Alternativas consideradas:** (a) Split igualitário 4.4h cada — descartado porque ignora tamanho real do repo; (b) Deep-dive single ref por gap — descartado porque perde poder comparativo.

**Stop condition — per question (mandatory):** Quando Fase A retorna empty matches após 3 retries com query variants diferentes (e.g., regex → alternate term → broader scope), marca question BLOCKED com reason "Fase A exhausted — no hotspots found" e continua. **NÃO** preencher Fase B com hotspots não relacionados.

**Stop condition — per project (mandatory):** Quando budget do project é esgotado com N questions pendentes, marca pendentes BLOCKED com reason "budget exhausted" e segue. Blueprint surfaces blocked explicitamente.

**Anti-pattern:** NUNCA fabricar respostas Fase B para fechar question que Fase A esgotou (Unbreakable Rule 3).

**Consequences:** halt-loop para de iterar quando budget esgota; blueprint pode ter sub-questions BLOCKED — viram seed do próximo discovery plan.

### D2 — Why only 5 refs (not NestJS / tRPC / TanStack Start)

**Decision:** Discovery cobre Fastify, Hono, Nitro, Astro, Next.js. NestJS, tRPC, TanStack Start, SvelteKit, Vite ficam fora desta janela.

**Rationale:**
- **NestJS** seria útil para C1 (módulos + DI scope) e C2 (exception filters). Mas NestJS é decorator-based — TheoKit fez decisão consciente (ADR ausente, mas locked no Roadmap macro) de NÃO usar decorators. Análise comparativa traria pouca decisão acionável.
- **tRPC** seria útil para C2 (TRPCError class hierarchy) e M1 (sub-package exports). Mas Fastify+Hono já cobrem ambos com material mais profundo (Fastify tem 528-LOC `errors.js`; Next.js tem 376-LOC `package.json` com exports completo).
- **TanStack Start** é jovem, surface API instável. Comparação seria volátil.
- **SvelteKit** tem adapters como packages independentes — pattern já citado em `architecture.md` v3.1 como alternativa rejeitada (TheoKit escolhe in-tree).
- **Vite** seria útil para M6 (plugin entry LOC) — mas M6 não está neste discovery (cortado por question budget).

**Alternativas consideradas:** (a) Incluir NestJS+tRPC adicionais — descartado por question budget (já no limite com 7 questions); (b) Substituir Fastify por NestJS — descartado porque Fastify é referência declarada do próprio TheoPlugin (`docs/adr/0008-theoplugin-is-the-canonical-sdk.md` cita "Fastify-style").

**Consequences:** análise não cobre decorator-shaped solutions (Nest) nem TRPCError-shaped hierarchies. Risco aceito: TheoKit já decidiu NÃO seguir esses caminhos.

### D3 — Investigation depth

**Decision:** Para questions de techniques (Q1/Q2/Q3): **Read end-to-end** de cada hotspot identificado em Fase A. Para questions de deps/tools (Q4/Q5/Q6): **grep + Read parcial** (estruturas e exports, não implementações inteiras). Para integration tests (Q7): **Read fixture + setup completo**.

**Rationale:** techniques exigem entender intent + edge cases — só leitura completa captura. Deps/tools são mais estruturais — grep + leitura parcial suficiente. Tests precisam de setup completo senão a fixture vira citação sem contexto.

**Consequences:** Q1/Q2/Q3 demandam mais tempo por hotspot; Q4/Q5/Q6 são mais rápidos. Distribuição de budget reflete.

### D4 — Invariant compatibility check obrigatório

**Decision:** Para cada question, blueprint output DEVE conter sub-seção "Compatibility com TheoKit invariants" cruzando a solução observada com os 3 invariantes de `architecture.md` v3.1 (zero cycles, `core` depende de nada intra-monorepo, public API via barrels).

**Rationale:** Princípio Inquebrável (CLAUDE.md root) §13.1 SRP + §13.5 DIP — solução borrowed só é útil se sobrevive aos invariantes locked.

**Consequences:** algumas questions podem revelar que a solução canônica seria INCOMPATIBLE com invariantes — isso vira `architectural_finding` no blueprint, não desbloqueia.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — grep/find map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | Como Fastify implementa encapsulation scope para plugins e como Hono evita o problema sem ter scope? Quais primitives são expostas (`avvio`-style `register()` vs `app.use()` chain)? | techniques | `.claude/knowledge-base/references/fastify/lib/plugin-utils.js` (169 LOC); `.claude/knowledge-base/references/fastify/lib/plugin-override.js` (90 LOC); `.claude/knowledge-base/references/fastify/lib/decorate.js` (152 LOC); `.claude/knowledge-base/references/hono/src/compose.ts`; `.claude/knowledge-base/references/hono/src/hono-base.ts`; `.claude/knowledge-base/references/hono/src/hono.ts` | `grep -nE "register\|avvio\|encapsulat\|scope" .claude/knowledge-base/references/fastify/lib/plugin-utils.js .claude/knowledge-base/references/fastify/lib/plugin-override.js` para mapear hotspots de scope; `grep -nE "compose\|middleware\|use\|fire" .claude/knowledge-base/references/hono/src/compose.ts .claude/knowledge-base/references/hono/src/hono-base.ts` para chain semantics | Read end-to-end dos 3 files Fastify (plugin-utils, plugin-override, decorate); Read end-to-end de compose.ts + hono-base.ts; capturar shape do contract + edge cases + comments justificando design | Comparison table: Fastify scope mechanics (avvio call sequence, decorate isolation, decoration leak prevention) vs Hono chain mechanics (compose flatten, no scope, manual isolation via context); recomendação se TheoKit deve adotar Fastify-shape OR aceitar Hono-shape OR híbrido; compat com invariantes |
| Q2 | Como Fastify estrutura hierarquia de Error + serialização entre layers? Qual é a estratégia para migração completeness (existing → envelope)? | techniques | `.claude/knowledge-base/references/fastify/lib/errors.js` (528 LOC, **91 createError**); `.claude/knowledge-base/references/fastify/lib/error-handler.js` (174 LOC); `.claude/knowledge-base/references/fastify/lib/error-serializer.js` (134 LOC); `.claude/knowledge-base/references/hono/src/http-exception.ts` (78 LOC). **Migration history sources DESCOBERTOS via método (d) abaixo — não citados como paths fixos** porque `CHANGELOG.md` na raiz Fastify não existe (validation 2026-06-05); release notes podem viver em `docs/`, GitHub releases, ou not at all | (a) `grep -nE "class.*Error\|createError\|setErrorHandler\|FST_" .claude/knowledge-base/references/fastify/lib/errors.js` para mapear hierarchy; (b) `grep -nE "throw new\|HTTPException\|status" .claude/knowledge-base/references/hono/src/http-exception.ts` para Hono shape; (c) **NEW (EC-1):** `git -C .claude/knowledge-base/references/fastify log --grep="error\|errors\|deprecat\|FST_" --oneline -- lib/errors.js \| head -30` para mapear migration history via git; (d) **NEW (EC-1):** `find .claude/knowledge-base/references/fastify -maxdepth 3 \( -iname 'CHANGELOG*' -o -iname 'UPGRADING*' -o -iname 'MIGRATION*' \)` para descobrir release notes (paths não pré-conhecidos) | Read fastify/lib/errors.js capturando ≤7 errors representativos (2× 4xx + 2× 5xx + 2× plugin/decorate + 1× hooks — ver EC-5); Read error-handler.js end-to-end para handler chain; Read error-serializer.js end-to-end (134 LOC); Read hono http-exception.ts inteiro (78 LOC); Read CHANGELOG sections de releases majors que tocaram errors | Diagrama de hierarchy Error: Fastify (FastifyError base + createError factory + FST_ codes) vs Hono (HTTPException simples). Strategy de retrocompat extraída via git log + CHANGELOG: Fastify ships ambos pre/post via `createError(code, message, statusCode)` + deprecation cycle de N releases. Recomendação para TheoKit C2: drenar 23 Error classes via codemod baseado em FST_-style naming OR híbrido. Se git log/CHANGELOG não revelam migration story, declarar honest "migration strategy não documentada no source — sub-pergunta BLOCKED com método exhausted" |
| Q3 | Como Hono ship código multi-runtime mantendo um único codebase (Web standards) e como Nitro resolve preset via Strategy para diferentes runtimes? Qual é a invariância garantida em cada modelo? | techniques | `.claude/knowledge-base/references/hono/src/adapter/cloudflare-workers/`; `.claude/knowledge-base/references/hono/src/adapter/deno/`; `.claude/knowledge-base/references/hono/src/adapter/bun/`; (Hono tem **9 adapters total** — outros 6 apenas enumerated, ver EC-6); `.claude/knowledge-base/references/nitro/src/presets/_resolve.ts` (118 LOC); `.claude/knowledge-base/references/nitro/src/presets/node/`; `.claude/knowledge-base/references/nitro/src/presets/cloudflare/`; `.claude/knowledge-base/references/nitro/src/runtime/` | `find .claude/knowledge-base/references/hono/src/adapter -type f -name '*.ts' | head -15` + `grep -nE "Request\|Response\|fetch\|globalThis" .claude/knowledge-base/references/hono/src/adapter/cloudflare-workers/*.ts` para Web standards usage; `grep -nE "resolvePreset\|preset.*=" .claude/knowledge-base/references/nitro/src/presets/_resolve.ts` para Strategy mechanics | Read 3 Hono adapter files end-to-end (cloudflare-workers + deno + bun — ver EC-6 stop); Read nitro presets/_resolve.ts inteiro (118 LOC); Read 2 sample presets (node + cloudflare); identificar `node:*` import patterns | **(REVISED EC-2)** Comparison NÃO é tabela cruzada forçada com recomendação única — são **dois modelos opostos** (Web standards FROM-THE-START vs Strategy preset). Output OBRIGATÓRIO: (i) **R3a — Hono-shape recommendation**: como TheoKit migraria para Web standards (passos concretos, impacto nos 42 node:* + bundle size + plugin compat); (ii) **R3b — Nitro-shape recommendation**: como TheoKit isolaria node:* em adapter-specific files com preset Strategy (passos concretos, impacto na hierarchia atual); (iii) **ADR-no-blueprint Q3-decision-deferred** diferindo escolha final para humano com matriz de trade-offs (blast radius, plugin ecosystem compat, perf overhead, time-to-1.0). NÃO force single recommendation |
| Q4 | Como Next.js e Hono mapeiam `exports` field do package.json para sub-package paths estritos? Quais são as 5+ chaves típicas usadas? | deps | `.claude/knowledge-base/references/next.js/packages/next/package.json` (376 LOC); `.claude/knowledge-base/references/hono/package.json`; `.claude/knowledge-base/references/fastify/package.json` (controle) | SKIP Fase A — text-shape question (JSON). Glob direta por `package.json` em cada ref + Read full | Read `next.js/packages/next/package.json` inteiro (376 LOC); Read `hono/package.json`; capturar shape do `exports` field — quantas keys, condição (types/import/require/browser), wildcards permitidos | Tabela: Next.js exports (`./*` patterns? typed exports? subdirectory listing?) vs Hono (mais minimal? per-adapter exports?). Decisão proposal: TheoKit M1 — substituir `export *` wildcards em `server/index.ts` por `package.json#exports` field com 18 sub-paths (`theokit/server/auth`, `theokit/server/jobs`, etc.). Estimar quantas keys + complexidade vs ganho ISP |
| Q5 | Como Astro divide config schemas em arquivos por concern? Qual é o pattern de composição final via `merge.ts` / `validate.ts`? | tools | `.claude/knowledge-base/references/astro/packages/astro/src/core/config/schemas/base.ts`; `.claude/knowledge-base/references/astro/packages/astro/src/core/config/schemas/refined.ts`; `.claude/knowledge-base/references/astro/packages/astro/src/core/config/schemas/relative.ts`; `.claude/knowledge-base/references/astro/packages/astro/src/core/config/schemas/index.ts`; `.claude/knowledge-base/references/astro/packages/astro/src/core/config/merge.ts`; `.claude/knowledge-base/references/astro/packages/astro/src/core/config/validate.ts` | `grep -nE "z\.\|extends\|merge" .claude/knowledge-base/references/astro/packages/astro/src/core/config/schemas/*.ts` para mapear Zod patterns; `grep -nE "import.*schemas" .claude/knowledge-base/references/astro/packages/astro/src/core/config/*.ts` para tracking de composição | Read 3 schemas (base, refined, relative) end-to-end + index.ts barrel; Read merge.ts + validate.ts para entender composition contract | Diagrama de composição Astro: schemas/{base, refined, relative} → schemas/index.ts → config/validate.ts → config/index.ts. Tabela: o que vai em CADA schema file (base = pure shape, refined = with cross-field validation, relative = path resolution). Decisão proposal: TheoKit M2 — sub-pasta `packages/theo/src/config/schemas/{auth,csrf,cors,csp,plugins,openapi,rate-limit,services,security-headers,...}.ts` + `schemas/index.ts` barrel + `config/schema.ts` vira composer fino (esperado <100 LOC) |
| Q6 | Como Astro organiza `dev-toolbar` internamente em sub-folders (apps/ui-library/utils) e como Nitro+Next.js organizam `cli/commands` em sub-pastas vs flat files? | tools | `.claude/knowledge-base/references/astro/packages/astro/src/runtime/client/dev-toolbar/`; `.claude/knowledge-base/references/astro/packages/astro/src/runtime/client/dev-toolbar/apps/audit/`; `.claude/knowledge-base/references/nitro/src/cli/commands/`; `.claude/knowledge-base/references/next.js/packages/next/src/cli/` (entradas top-level) | `find .claude/knowledge-base/references/astro/packages/astro/src/runtime/client/dev-toolbar -type d` para mapear estrutura completa; `find .claude/knowledge-base/references/nitro/src/cli/commands -type f` para layout flat-vs-folder | Read 1 file de cada sub-folder Astro dev-toolbar (entrypoint.ts + apps/audit/ + ui-library); ls (não Read) de nitro/src/cli/commands/; Read 1 nitro command file representative + comparar com next.js `next-start.ts` shape | Comparison: Astro `dev-toolbar/{apps,ui-library,utils,helpers.ts}` (concern-based sub-folders + 1-2 root files de orquestração) vs Nitro `cli/commands/<verb>/<subverb>.ts` (subfolder por comando complexo) vs Next.js `cli/next-<verb>.ts` (flat). Decisão proposal M3: TheoKit `devtools/{dom,state,bridge,format}/` mirror Astro; M4: TheoKit `cli/commands/start/` (subfolder mirror sibling `migrate/`) + cobertura para "quando subfolder vale a pena" |
| Q7 | Como Fastify testa plugin scope encapsulation (cross-plugin leak prevention) e como Hono testa multi-runtime adapters? Quais primitives de test boundary expõem? **DEPENDS ON: Q1, Q3 (execute order — ver EC-3 halt-loop checkpoint)** | tests | `.claude/knowledge-base/references/fastify/test/` (132 files; filter por plugin/scope/decorate/encapsul — ver below); `.claude/knowledge-base/references/hono/src/adapter/*/` (test files in-source — `bun/server.test.ts`, `vercel/handler.test.ts`, etc.) | `find .claude/knowledge-base/references/fastify/test -type f \( -name '*plugin*.js' -o -name '*decorate*.js' -o -name '*scope*.js' -o -name 'encapsulated-*.test.js' \) | head -10` para hotspots (9 files encontrados na validação: plugin.{1,2,3,4}.test.js, plugin.helper.js, plugin.name.display.js, encapsulated-child-logger-factory.test.js, encapsulated-error-handler.test.js, internals/plugin.test.js); `find .claude/knowledge-base/references/hono/src/adapter -name '*.test.ts' | head -10` para test files (10+ encontrados) | Read 2 fastify scope tests end-to-end (recomendado: `encapsulated-error-handler.test.js` + `plugin.1.test.js`); Read 1 hono adapter test end-to-end (`bun/server.test.ts` ou `cloudflare-pages/handler.test.ts`) | Tabela com 4-6 assertion patterns observados: Fastify "plugin A decorate X; plugin B decorate X; expect divergent values per scope"; Hono "fetch handler runs in Worker context; assert Request/Response are native". Decisão proposal: quais boundary tests TheoKit DEVE escrever ANTES de tocar C1 (plugin scope) e C3 (multi-runtime) — TDD-first per `testing.md` Inquebrável. **Cross-ref obrigatório com R3a/R3b de Q3** (test patterns devem cobrir o caminho escolhido) |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| tests (integration) | Q7 | Covered |
| deps | Q4 | Covered |
| tools | Q5, Q6 | Covered |
| techniques | Q1, Q2, Q3 | Covered |

**Coverage: 4/4 corners covered (100%)** — vocabulário alinhado com `discover-plan-confidence` checker (`tests` / `deps` / `tools` / `techniques`).

Distribuição por corner respeita max 3 / min 1. Total: 7 questions (dentro do budget 5-10).

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Q1-Q7 | `.claude/knowledge-base/references/{project}/{path}` declarado em Fase A existe (`Path.exists()`) | Mark Qx BLOCKED com reason "path not found"; continue para próxima |
| Per-question Fase A budget | Fase A retornou ≥1 hotspot OR 3 query-variant retries tentadas | Após 3 retries empty, mark Qx BLOCKED com reason "Fase A exhausted"; continue |
| After answering Qx | Sub-seção do blueprint para Qx tem ≥1 citation `file:line` | Re-iterate Qx (1 retry max) |
| Mid-loop sanity | Total citations a `.claude/knowledge-base/references/` ≥ 1 / 150 palavras de prose | Adicionar citações em paragraphs sub-cited (1 retry max) |
| Per-project time budget | Project budget não esgotado | Quando esgotado, mark remaining Qx BLOCKED com reason "budget exhausted"; advance ao próximo projeto |
| Invariant check (D4) | Cada Qx answer contém sub-seção "Compatibility com TheoKit invariants" | Re-iterate Qx para adicionar (1 retry max) |
| Before promising complete | Todos os 4 coverage corners têm seções populadas | Refuse promise; continue iterando |
| **EC-3 Order constraint (Q7 depends on Q1+Q3)** | Q7 NÃO inicia antes que Q1 E Q3 emitam ≥1 citation each | If Q7 starts early, pause Q7 e advance Q1/Q3 primeiro até cada emitir ≥1 citation |
| **EC-4 Per-question time Q1** | Q1 execução ≤2h. Fastify-side É PRIORITY (canonical subject); Hono-side é counter-example | Se exceder 2h: save Fastify-side analysis full + Hono-side abbreviated (compose.ts only) e advance |
| **EC-5 Per-question scope Q2** | Q2 captura ≤7 errors representativos de Fastify errors.js (NÃO 91 createError); seleção: 2× 4xx codes + 2× 5xx codes + 2× plugin/decorate-related + 1× hooks-related | If trying to capture all 91, halt e reduza ao subset representativo |
| **EC-6 Per-question scope Q3 (Hono side)** | Q3 fez Read end-to-end de cloudflare-workers + deno + bun (3 declarados); restantes 6 adapters (cloudflare-pages, aws-lambda, lambda-edge, netlify, service-worker, vercel) são apenas ENUMERATED no blueprint (lista de paths), sem Read | If tempted to Read all 9, halt e enumere os restantes em prose com 1-line cada |
| **EC-7 Per-ref scope Q6** | Q6 lê ≤2 files Astro dev-toolbar (entrypoint.ts + 1 app de apps/) + ≤1 file representative Nitro cli/commands/ + ≤2 files Next.js cli (`next-start.ts` + `next-build.ts`) | If trying to enumerate all 11 next-*.ts files OR all Astro dev-toolbar files, halt — está fora do escopo Q6 |
| **EC-8 Per-question scope Q4** | Q4 extrai APENAS `"exports"` field de cada package.json (Read full mas focus prose em exports section); restante (scripts/deps/peerDeps/etc) é referenciado mas não analisado | If trying to comparar npm scripts ou deps versions, halt — está fora do escopo Q4 |

## Acceptance Criteria

- [ ] All 7 research questions answered OR explicitly marked BLOCKED com reason
- [ ] All 4 coverage corners têm seções populadas no blueprint
- [ ] Cada citation no blueprint aponta para path real `.claude/knowledge-base/references/{...}`
- [ ] Cada Qx answer contém sub-seção "Compatibility com TheoKit invariants" cruzando com `architecture.md` v3.1 (D4)
- [ ] At least one ADR no blueprint sintetiza decisão tomada (ADR-style: Context / Decision / Consequences)
- [ ] Time budget respeitado per project (Fastify ≤4h, Hono ≤4h, Nitro ≤4h, Astro ≤5h, Next.js ≤5h)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint salvo em `.claude/knowledge-base/discoveries/blueprints/theokit-arch-gaps-investigation-blueprint.md`

## Global Definition of Done

- [ ] Todas as fases completadas (plan → edge-cases → execute → confidence → improve if needed → confidence re-score)
- [ ] Verdict final de `/discover-confidence` registrado no header do blueprint
- [ ] Zero fabricated citations (todo `Path.exists()` resolve)
- [ ] Coverage Matrix 100% covered
- [ ] ADRs referenciam ≥1 princípio das project rules:
  - `architecture.md` v3.1 invariants (zero cycles / `core` depends on nothing / barrels)
  - `backend.md` `defineRoute`/`defineAction` contract shape
  - `testing.md` TDD-first (Q7 deve enabilitar TDD para C1/C3)
  - CLAUDE.md root §9 (não reinvente a roda — solução borrowed > custom) ou §10 KISS ou §13 SOLID
