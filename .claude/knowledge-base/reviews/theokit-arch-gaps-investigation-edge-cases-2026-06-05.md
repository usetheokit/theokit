# Discover Edge Case Review — theokit-arch-gaps-investigation

**Date:** 2026-06-05
**Discovery plan analyzed:** `.claude/knowledge-base/discoveries/plans/theokit-arch-gaps-investigation-plan.md`
**Research questions analyzed:** 7
**Edge cases found:** 10 (MUST FIX: 3, SHOULD TEST: 5, DOCUMENT: 2)

## MUST FIX

### EC-1: Q2 sub-pergunta sobre "migration completeness strategy" não tem método declarado

- **Affected question:** Q2
- **Family:** Method
- **Scenario:** Q2 pergunta duas coisas: (a) hierarchy de Error + serialização (técnico, has source) e (b) "strategy para migration completeness (existing → envelope)". A parte (b) NÃO tem método declarado. Fastify ships estabilidade — não há código de "migração de Error hierarchy" no `lib/errors.js`. Esse conhecimento vive no histórico de PRs / CHANGELOG / releases majors. Plano declara apenas `Read end-to-end` de errors.js — vai falhar ao responder a parte (b) porque o código não contém a resposta.
- **Impact:** Q2 vai produzir blueprint section incompleta. C2 (envelope adoption 20%) não recebe recomendação de strategy. `/discover-confidence` provavelmente passa, mas a recomendação para o time TheoKit fica truncada — desperdiça discovery.
- **Suggested fix:** Adicionar à Fase A de Q2 mais um método: `git log --grep="error\|errors\|deprecat" --oneline .claude/knowledge-base/references/fastify/lib/errors.js | head -30` + Read `.claude/knowledge-base/references/fastify/CHANGELOG.md` (se existir) OU split Q2 em Q2a (hierarchy structure — techniques) + Q2b (migration history — git/CHANGELOG, com novo corner mapeado). Recomendação: ficar com 1 question, adicionar git log method, deixar resposta da sub-pergunta (b) limitada ao que git log revelar.

### EC-2: Q3 comparison entre dois modelos arquiteturais radicalmente diferentes precisa de output dual

- **Affected question:** Q3
- **Family:** Interpretation
- **Scenario:** Q3 compara Hono (Web standards FROM THE START — não tem adapter de runtime; um codebase só roda em todo lugar) com Nitro (preset resolver injeta runtime-specific code via Strategy + per-preset folders). São modelos **opostos**, não variants do mesmo padrão. Plano declara "Recomendação C3: TheoKit precisa ou (a) adotar Web standards (=remover 42 node:*) ou (b) adotar Nitro preset model". Mas pedir um ÚNICO recommendation force decisão que requer humano + outros trade-offs (custo de rewrite, compat com plugin ecosystem, etc.).
- **Impact:** Blueprint vai produzir recomendação artificial OR deixar a tabela cruzada (Q3 row) com `recommendation: undecided`. Em ambos os casos, `/discover-confidence` pode rejeitar por "soft" recommendation.
- **Suggested fix:** Adicionar à Expected answer shape de Q3: "produz 2 recomendações independentes (R3a = como TheoKit adotaria Hono-shape, R3b = como TheoKit adotaria Nitro-shape) + ADR no blueprint diferindo decisão final para humano com matriz de trade-offs (blast radius, plugin compat, perf overhead)". Não força escolha; documenta as duas paths honestamente.

### EC-3: Q7 depende conceitualmente de Q1 e Q3 mas plan não declara ordem

- **Affected question:** Q7
- **Family:** Dependency
- **Scenario:** Q7 pede "test patterns para plugin scope (do Fastify) + multi-runtime (do Hono)". Q1 estabelece o **contract de plugin scope** que Q7 vai testar. Q3 estabelece o **contract de multi-runtime** que Q7 vai testar. Se Q7 rodar ANTES de Q1+Q3, vai capturar test patterns sem entender o contract que eles testam — output fica disconectado de C1 e C3.
- **Impact:** Q7 blueprint section pode ficar como "lista de assertions" sem mapping pra TheoKit C1/C3. Recomendação "quais boundary tests TheoKit DEVE escrever" perde rigor.
- **Suggested fix:** Adicionar a `## Halt-loop Checkpoints` nova linha: `Order constraint | Q7 NÃO pode iniciar antes que Q1 E Q3 emitirem ao menos 1 citation each | If Q7 starts early, pause Q7 e advance Q1/Q3 primeiro`. Alternativa simples: adicionar explicit nota em Q7 description: "DEPENDS ON: Q1, Q3 (execute order)".

## SHOULD TEST

### EC-4: Q1 time budget 2h é apertado para 5 files / 411+ LOC

- **Affected question:** Q1
- **Suggested halt-loop checkpoint:** Adicionar a `## Halt-loop Checkpoints`: `Per-question time budget Q1 | Q1 executou ≤2h; se exceder, mark Hono-side partial OK (Fastify-side deve completar PRIMEIRO porque Fastify é o subject canônico do scope pattern, Hono é o counter-example) | After 2h, save Fastify-side analysis full + Hono-side abbreviated (compose.ts only)`

### EC-5: Q2 errors.js tem 91 createError — Read end-to-end + capturar TODOS é inviável

- **Affected question:** Q2
- **Suggested halt-loop checkpoint:** Adicionar a `## Halt-loop Checkpoints`: `Per-question scope Q2 | Q2 capturou ≤7 errors representativos de Fastify errors.js (não 91); seleção: pegar 2 4xx codes + 2 5xx codes + 2 que mencionam plugin/decorate + 1 que mencione hooks | If trying to capture all 91, halt e reduza ao subset representativo`

### EC-6: Q3 Hono tem 9 adapters; plano cita só 3

- **Affected question:** Q3
- **Suggested halt-loop checkpoint:** Adicionar a `## Halt-loop Checkpoints`: `Per-question scope Q3 (Hono side) | Q3 fez Read end-to-end de cloudflare-workers + deno + bun (3 declarados); restantes 6 adapters (cloudflare-pages, aws-lambda, lambda-edge, netlify, service-worker, vercel) são apenas ENUMERATED no blueprint (lista de paths), sem Read | If tempted to Read all 9, halt e enumere os restantes`

### EC-7: Q6 split entre 3 refs (Astro+Nitro+Next.js) sem stop criterion por ref

- **Affected question:** Q6
- **Suggested halt-loop checkpoint:** Adicionar a `## Halt-loop Checkpoints`: `Per-ref scope Q6 | Q6 ler ≤2 files Astro dev-toolbar (entrypoint.ts + 1 app de apps/) + ≤1 file representative Nitro cli/commands/ + ≤2 files Next.js cli (next-start.ts + next-build.ts) | If trying to enumerate all 11 next-*.ts files OR all Astro dev-toolbar files, halt`

### EC-8: Q4 Read full dos 3 package.json totaliza 1303 LOC de JSON

- **Affected question:** Q4
- **Suggested halt-loop checkpoint:** Adicionar a `## Halt-loop Checkpoints`: `Per-question scope Q4 | Q4 extrair APENAS `"exports"` field de cada package.json (Read full mas focus prose em exports section); restante (scripts/deps/peerDeps/etc) é referenciado mas não analisado | If trying to comparar npm scripts ou deps versions, halt — está fora do escopo Q4`

## DOCUMENT

### EC-9: Q1 comparação assimétrica Fastify-vs-Hono (shapes radicalmente diferentes) é estrutural, não falha

- **Accepted risk:** Fastify TEM encapsulation scope (avvio + plugin-override). Hono **não tem** scope — usa compose middleware. Não é "Hono falta feature"; é arquitetura diferente. Tabela cruzada lado-a-lado vai ter cells "N/A — não aplicável" no lado Hono. Isso É a resposta. Blueprint section Q1 deve ter 2 sub-sections (Fastify-shape capture, Hono-shape capture) + comparison ANALYSIS section em vez de comparison TABLE. Rationale: ADR D4 (invariant check) já obriga sub-seção "Compatibility com TheoKit invariants" — naturalmente acomoda 2 análises separadas. Não há fix; é design intended.

### EC-10: Q5 Astro `schemas/base.ts` é 613 LOC — Astro NÃO é o exemplo perfeito que o plano sugeria

- **Accepted risk:** Validação extra revelou que `astro/packages/astro/src/core/config/schemas/base.ts` tem **613 LOC** — maior que o próprio `packages/theo/src/config/schema.ts` (504 LOC) que estamos critique-ando. Astro divide config em 3 schemas (base 613 + refined 43 + relative 152 = 808 LOC split em 3 files), mas base.ts continua sendo um god-file. Recomendação para TheoKit M2 precisa de honestidade: "Astro divide em 3 com base.ts ainda god — TheoKit pode fazer split mais granular OR aceitar 1 god + 2 cross-cutting (refined validation, relative path)". Não invalida Q5; precisa ser refletido na recommendation. Não força edit do plano — apenas honest framing no blueprint quando Q5 for respondida.

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|---|---|---|---|---|
| Q1 | 2 | 0 | 1 (EC-4) | 1 (EC-9) |
| Q2 | 2 | 1 (EC-1) | 1 (EC-5) | 0 |
| Q3 | 2 | 1 (EC-2) | 1 (EC-6) | 0 |
| Q4 | 1 | 0 | 1 (EC-8) | 0 |
| Q5 | 1 | 0 | 0 | 1 (EC-10) |
| Q6 | 1 | 0 | 1 (EC-7) | 0 |
| Q7 | 1 | 1 (EC-3) | 0 | 0 |
| **Total** | **10** | **3** | **5** | **2** |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT (3 MUST FIX)

## Adjustment instructions (para o humano absorber no plan v1.1)

1. **Q2** — adicionar `git log --grep` method à Fase A para cobrir sub-pergunta de migration history (EC-1)
2. **Q3** — modificar Expected answer shape para "produz 2 recomendações independentes (R3a Hono-shape, R3b Nitro-shape) + ADR diferindo decisão final" (EC-2)
3. **Q7** — adicionar a `## Halt-loop Checkpoints` constraint de ordem: "Q7 NÃO inicia antes que Q1 E Q3 emitirem ao menos 1 citation each" (EC-3)
4. **Halt-loop Checkpoints** — adicionar 5 novos checkpoints (EC-4 a EC-8) sob `## Halt-loop Checkpoints`
5. **Q5 + Q1** — não alterar plano; honest framing fica responsibility do `/discover-execute` quando produzir blueprint sections (EC-9, EC-10)

Após absorption, bump o plano para v1.1 e invoque `/discover-plan-confidence theokit-arch-gaps-investigation` para validar score.
