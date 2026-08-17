---
type: ADR
title: ADR 0002: single-source tool naming at the agents/SDK boundary
description: Moving tool-name validation into the single place that mints the name, covering all three SDK rules.
tags: [adr, tools, naming]
status: stable
generated: { by: theokit-agent/unrecorded, at: 2026-07-24T00:00:00Z }
migrated: { by: claude-opus-5/okf-skill, at: 2026-08-06T00:00:00Z, from: knowledge-base/adrs/0002-tool-name-single-source.md }
sources:
  - id: origin
    resource: knowledge-base/adrs/0002-tool-name-single-source.md
    title: Original document in the pre-wiki tree, preserved verbatim
    last_modified: 2026-07-24
---

# ADR 0002 — Nome de tool com fonte única na fronteira `@theokit/agents` ↔ `@theokit/sdk`

**Status:** Accepted
**Date:** 2026-07-24
**Milestone:** M55
**Plano:** `plans/tool-name-single-source.md`
**Blueprint:** `blueprints/tool-name-single-source.md`
**Contexto de origem:** revisão de System Design + Design Pattern do fix de usetheodev/theokit#145

## Contexto

O fix do #145 (`@theokit/agents@1.0.1`) trocou o separador de namespace de `.` para `_` porque o
`@theokit/sdk` rejeita o ponto. A revisão desse fix achou 6 defeitos residuais — dois deles
introduzidos pela própria correção — e a discovery seguinte achou mais dois, ambos medidos:

- `validateToolName` do SDK impõe **três** regras; a nossa cópia replicava **uma**. `namespace: 'mcp'`
  mintava `mcp_*`, passava na nossa validação de autoria e era **rejeitado pelo `Agent.create`**.
  Mesma classe do #145, viva em produção.
- `knip.json` tem `rules.exports: "off"`; o critério "knip limpo" do DoD **não** detectaria o órfão
  `compileHitlGates`.

O diagnóstico é que o problema nunca foi o separador: foi **a regra do provider ter sido copiada por
amostragem** e **a identidade da tool viver replicada em duas estruturas**.

## Decisões

### D1 — Espelhar as TRÊS regras do SDK numa função nomeada, com versão declarada e gatilho

`toolRuntimeName` valida contra as três regras de `@theokit/sdk@4.1.0 › validateToolName`
(não-vazio, charset, reservado), com o comentário declarando o espelho e a versão espelhada.

**Alternativas consideradas:**
- *Validar só o charset* — é o status quo, e é o defeito vivo.
- *Chamar `Agent.create` na autoria para delegar a validação* — acopla autoria a um construtor de
  runtime e exigiria uma apiKey.
- *Abrir issue pedindo o export e esperar* — deixaria o defeito em produção por tempo indeterminado.

**Consequências:** dívida consciente **com alarme**. O alarme é o teste de contrato não-mockado
(`tests/integration/tool-name-sdk-contract.test.ts`), que exercita o validador real do SDK e não uma
cópia da cópia.

**Gatilho de revisão:** se o SDK exportar `TOOL_NAME_PATTERN` ou `validateToolName`, consumir e
apagar a cópia.

### D2 — Uma derivação, dois consumidores (mantendo o `Map`)

`ToolboxCapability` deriva o `ToolboxWalkResult` uma vez (`#walk()`) e passa **o mesmo objeto** para
`compileTools` e `compileHitlGates`.

**Alternativas consideradas:**
- *Deletar `compileHitlGates` e manter o laço na capability* — fecharia a orfandade mas **preservaria
  a duplicação de conhecimento**, que é a causa-raiz do #145.
- *Trocar `hitl: Map` por um campo em `CompiledTool`* (a forma do `opencode`) — elimina o segundo
  mapa de vez, mas muda o waist e o contrato do plugin HITL: é outro milestone.

**Consequências:** a propriedade "o gate e a tool não podem discordar de nome" passa a ser
**estrutural**, não convencional. O órfão fecha por **reconexão**, não por remoção — parcimônia rung
4 (reusar) antes do rung 6 (escrever).

**Evidência de prior art:** o `opencode` resolve o acoplamento análogo tool↔permissão filtrando o
próprio `Record<string, Tool>` em vez de manter mapa paralelo, com o autor declarando o motivo:
*"so the two cannot drift"* (`knowledge-base/references/opencode/packages/opencode/src/permission/index.ts:223`).

### D3 — Reversibilidade do nome: documentada como condicional, não implementada

`ns_tool` **é** reversível desde que exista o registro de namespaces — a técnica é o **prefixo mais
longo vencendo** (`opencode .../src/tool/code-mode.ts` § `groupByServer`: *"a server named `a_b` beats
`a` for the key `a_b_tool`"*). O que não é reversível é o split ingênuo.

**Alternativas consideradas:**
- *Implementar o parse reverso agora* — YAGNI: `grep "split('.')\|split('_')" packages/agents/src`
  retorna vazio; ninguém faz parse reverso hoje.
- *Ficar em silêncio sobre a propriedade perdida* — foi o achado (5) da revisão, e silêncio é
  exatamente o que o achado condena.

**Consequências:** se o parse virar necessidade, o caminho está citado e pronto. O `opencode`
inclusive separa conscientemente **nome para o LLM** (charset restrito → `_`) de **chave interna**
(`:` com escape) — se algum dia precisarmos de uma chave interna, esse é o precedente.

### D4 — A prova de código morto é um override de config do knip, não mudança de política

`knip-exports.json` + script `knip:exports`, escopado a `packages/agents`. O `knip.json` do repo
**não** muda.

**Alternativas consideradas:**
- *Comando ad-hoc no DoD sem arquivo* — não é re-executável por outra pessoa nem por CI.
- *Ligar `exports:"error"` globalmente* — atinge 6 workspaces com número desconhecido de achados;
  vira milestone próprio e atrasaria a correção do defeito vivo.
- *Um teste unitário assertando "compileHitlGates é chamado"* — não existe asserção honesta para
  isso: se alguém re-inlinar o laço, um teste de comportamento continua verde. Só o detector de
  exports pega.

**Consequências:** o gate **pode falhar** — e falhava: no baseline `271124d5` acusava
`agent-compiler.ts:107 compileHitlGates` e `run-reflective-loop.ts:450 ceilingRoundFactory`.

**Gatilho de revisão:** quando alguém medir quantos órfãos existem fora de `packages/agents`, abrir
o milestone de ligar `exports:"error"` no monorepo.

### D5 — Value Object `ToolName`: RECUSADO

Não introduzir um VO para o nome de tool.

**Alternativas consideradas:**
- *Introduzir o VO* — com D1 + D2 o nome só pode nascer de `toolRuntimeName`, que valida: o estado
  ilegal já fica inalcançável **sem** mudar tipo em API pública. Nenhuma das três fontes estudadas
  usa VO para nome de tool (`opencode`: `string` + função de mintagem; `@theokit/sdk`: `string` +
  validador; `ai@7.0.14`: chave de tipo `keyof TOOLS & string`). Parcimônia rungs 1 e 5.

**Consequências:** se surgir um segundo minter legítimo com postura diferente — por exemplo nomes
vindos de servidor MCP, onde a postura correta é **coagir** e não lançar (é o que o `opencode` faz em
`sanitize`, porque a entrada vem de terceiro) — o VO volta à mesa.

**Gatilho de revisão:** o aparecimento desse segundo minter.

## Desvios do DoD do M55 (registrados, não editados no ROADMAP)

`cycle-roadmap` proíbe editar milestone em voo. Os dois desvios:

- **"`pnpm knip` limpo" foi substituído** por `pnpm knip:exports` sem achado + `npx knip
  --workspace packages/agents` limpo. O critério novo é **mais forte**, não mais fraco: falha no
  baseline. Ver D4.
- **Escopo ampliado pela discovery:** o DoD falava em validar "o nome"; passou a cobrir as **três**
  regras do SDK, porque a cópia parcial era um defeito vivo. Ampliação dentro do mesmo objetivo.
- **Uma expectativa pré-existente foi editada**, contrariando a redação literal do Global DoD. O
  teste `'the generated name matches the SDK charset'` re-declarava o regex — a terceira cópia da
  regra que este milestone elimina — e virou asserção de comportamento (`toBe('ops_deploy')`), mais
  forte que o `toMatch` anterior. Desvio **achado pelo agente de cross-validation do `/review`**, não
  declarado por mim no momento da mudança. A promessa de "zero expectativa editada" é o oráculo de
  T0.1 (refactor estrutural puro) e foi restatada sem qualificador no nível global — erro de redação.

## Dívida reportada, não mascarada

- `npx knip` no **repo inteiro** sai 1 por 8 devDependencies não usadas (`@types/pg`, `autocannon`,
  `pg`, `unplugin-swc`, `wrangler` na raiz; `@types/pg`, `pg`, `pg-mem` em `packages/theo`) —
  pré-existentes, fora de `packages/agents`, sem relação com nome de tool.
- `pnpm audit` reporta 10 CVEs HIGH em dev-tooling transitivo (`brace-expansion`, `js-yaml`,
  `shell-quote`, `immutable`, `fast-uri`, `sharp`) — pré-existentes; `--prod` tem só 1 low. Nenhuma
  entrada foi adicionada ao allowlist: o correto é corrigir, não isentar.
- `pnpm check:direction` falha por `packages/tauri` declarar dependência em `theokit` —
  pré-existente, verificado como não relacionado a este trabalho.
- O gate `/discover-plan-confidence` pontuou `reference_citations` 100 com **zero citações
 detectadas** (o regex do checker exige o prefixo e o theokit
  usa `knowledge-base/references/`). As citações foram verificadas manualmente em disco.

## Cross-references

- Regras consumidas: ar tipado),
.1 (caso negativo asserta tipo **e** mensagem),
 (rungs 1, 4 e 5),
  (direção de dependência — motivo de `src/errors.ts` existir)
- ADR precedente de formato: `decisions/0001-capability-patterns-budget.md`

# Related
* [tool-name-single-source](/grills/tool-name-single-source.md) — the scope questions.
* [tool-name-single-source-discovery](/plans/tool-name-single-source-discovery.md) — the discovery plan.
* [tool-name-single-source](/blueprints/tool-name-single-source.md) — the research blueprint.
* [tool-name-single-source](/plans/tool-name-single-source.md) — the implementation plan.
* [tool-name-single-source-edge-cases-2026-07-24](/reviews/tool-name-single-source-edge-cases-2026-07-24.md) — edge cases on the discovery.
* [tool-name-single-source-edge-cases-plan-2026-07-24](/reviews/tool-name-single-source-edge-cases-plan-2026-07-24.md) — edge cases on the plan.
* [tool-name-single-source-deps-audit-2026-07-24](/reviews/tool-name-single-source-deps-audit-2026-07-24.md) — the dependency audit.
* [tool-name-single-source-2026-07-24](/reviews/tool-name-single-source-2026-07-24.md) — the merge review.
* [m55-tool-name-single-source](/milestones/m55-tool-name-single-source.md) — the milestone record.

