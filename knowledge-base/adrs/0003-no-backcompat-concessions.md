# ADR 0003 — Remover toda concessão de retrocompatibilidade do M55

**Status:** Accepted
**Date:** 2026-07-24
**Milestone:** M56
**Diretriz do owner:** *"NÃO IMPORTA O ESFORÇO, NÃO VAMOS TER RETROCOMPATIBILIDADE"*
**Antecede:** ADR 0002 (M55), que deixou as concessões que este remove.

## Contexto

O M55 fechou com seis compromissos, cada um motivado por **não quebrar quem já consome**. Duas
dessas concessões eram a **mesma patologia que o M55 existiu para corrigir**, deixada de pé: um
método público sem chamadores (código morto — o defeito que o milestone caçava) e um gate de código
morto ligado só para um dos seis workspaces (deixando os outros cinco com a cegueira que fez "knip
limpo" passar com órfão presente). O owner removeu a restrição de compatibilidade; este ADR registra
o que foi feito e por quê, aceitando o custo: **major bump** de `@theokit/agents`.

## Decisões

### D1 — `ToolboxCapability.compile()` DELETADO (breaking de API)

Método público com **zero** chamadores em todo o monorepo (verificado por grep). Mantido no M55 só
porque remover método público quebra consumidor. `apply()` é o único caminho. A prova de binding que
o M55 criou contra `compile()` migrou para o caminho de `apply()`.

**Alternativa considerada:** deprecar com aviso e remover depois — é retrocompatibilidade, exatamente
o que a diretriz proíbe.

### D2 — Remover o reexport interno DUPLICADO de `ConfigurationError` (sem quebrar a API pública)

`capability/capabilities.ts` reexportava `ConfigurationError` — um segundo caminho de import para uma
classe que já vinha da definição em `src/errors.ts`. Dentro do pacote, todos os ~20 consumidores
passam a importar de `errors.ts`.

**Correção de um erro que este ADR primeiro cometeu (honestidade):** a primeira versão de D2 removeu
o reexport interno **e**, por efeito colateral, derrubou `ConfigurationError` do **barril público** —
o barril reexporta `capability/index.js → capabilities.js`, então a classe chegava aos consumidores
por essa cadeia. `ConfigurationError` é contrato (consumidores fazem `catch (e) { if (e instanceof
ConfigurationError) … }`), não detalhe interno. A regressão foi pega de duas formas independentes (o
próprio dono verificando a API buildada em runtime, e o agente de review adversarial, com uma sonda
`import { ConfigurationError } from '@theokit/agents'`). Correção: o **barril** (`src/index.ts`) passa
a exportar `ConfigurationError` direto de `errors.ts`, e um teste `public-api-surface.test.ts` trava a
garantia. O único deep-import interno (`capability/capabilities.js`), nunca um entry point
documentado, é o que muda.

### D3 — `knip.json` real com `exports` e `types` em `error`; override deletado

O M55 ligou o detector só para `packages/agents`, via `knip-exports.json`. Agora a política vale para
o repositório inteiro; `knip-exports.json` e o script `knip:exports` foram removidos. A limpeza cobriu
**195 símbolos em 110 arquivos** (`theo` 95, `agents` 6, `http` 5, `create-theokit` 4).

**Estratégia em dois passos, deliberada:** primeiro remover o `export` (seguro, reversível, não muda
runtime), depois deixar o compilador e o linter apontarem o que ficou de fato morto. 10 símbolos
caíram nessa segunda peneira e foram deletados. Isso separa "não é superfície pública" de "é código
morto" — duas afirmações diferentes, provadas por ferramentas diferentes.

**`types: "error"` — decidido com o número na mão (era o risco 2 do grill).** Após a limpeza, o gate
fica verde e estável, sem categoria recorrente de tipo público legitimamente sem consumidor interno
que forçasse allowlist em massa. Logo `types` **permanece** em `error`. Se um dia essa categoria
aparecer, a saída registrada é voltar `types` a `off` com ADR — não allowlistar em massa.

### D4 — Falso positivo do knip tratado no escopo mínimo

`@theokit/agents` é `optional peerDependency` referenciada em `packages/http`. A opcionalidade é
deliberada: o import é **dinâmico**, só ocorre quando `agents[]` é passado, com erro claro se o pacote
faltar. Silenciado via `ignoreDependencies` **do workspace `packages/http`**, nunca global.

### D5 — 8 devDependencies não usadas removidas

`@types/pg`, `autocannon`, `pg`, `unplugin-swc`, `wrangler` (raiz) e `@types/pg`, `pg`, `pg-mem`
(`packages/theo`). Verificado por grep de import real (não substring); nenhum script ou CI as usa.

### D6 — `check:direction` corrigido para o invariante real, não o proxy

O item do DoD estava com a **premissa errada** — eu supus que `packages/tauri` declarava `theokit`
por resíduo. Não é: o tauri **importa** de `theokit/server/agent` e `theokit/client/core`. Remover
quebraria código real.

O ADR 0030 existe por causa de um **ciclo concreto** (`theokit → @theokit/http → theokit`) que fazia
todo minor do principal cascatear MAJOR nas libs via changesets. Mas o principal **não consome**
`@theokit/tauri` — o tauri é um adapter **acima** do principal (ADR-0055, *"Core theokit stays
Tauri-agnostic"*), exatamente como as fixtures que o script já isentava. Proibir `tauri → theokit`
era enforçar o **proxy** (`nenhuma dependência de volta`) em vez do **invariante** (`aciclicidade`),
e produzia um gate permanentemente vermelho — e um gate que ninguém consegue deixar verde é um gate
que ninguém lê.

O checker passa a **ler o conjunto consumido do manifesto do principal** e só proíbe a dependência de
volta a partir desses. Sem allowlist para envelhecer. Provado nos dois sentidos: verde agora
(32 pacotes checados), vermelho sob mutação (quando `agents` declara `theokit`).

**Alternativa considerada:** remover `theokit` de `packages/tauri` — quebraria o adapter desktop, que
é código funcional. A premissa do item do DoD estava errada; corrigir o checker é a correção de raiz.

## Consequências

- **`@theokit/agents` sai em major** (2.0.0) — duas remoções de API pública (D1, D2).
- O gate de código morto passa a valer para o monorepo inteiro e **pode falhar** (provado).
- O gate de direção passa a enforçar aciclicidade real, verde e estável.
- Erros tipados em `compileTools` (herdado do achado F-arch-4 do review do M55, também fechado aqui).

## Cross-references

- Grill: `knowledge-base/grills/no-backcompat-concessions-feature-grill.md`
- ADR antecessor: `knowledge-base/adrs/0002-tool-name-single-source.md`
- ADR 0030 (direção de dependência), ADR-0055 (tauri como adapter acima do principal)
- Regras: `.claude/rules/error-handling.md` § 2, `.claude/rules/parsimony-ladder.md`
