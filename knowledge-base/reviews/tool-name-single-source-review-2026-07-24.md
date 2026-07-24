# Review: tool-name-single-source (M55)

**Date:** 2026-07-24
**Baseline:** `271124d5` → HEAD `b0ac57a1`
**Reviewers (spawned agents):** 4 — architecture, tests, wiring, cross-validation
**Findings:** 24 total (BLOCKER: 0, HIGH: 2, MEDIUM: 3, LOW: 4, INFO: 15)
**Verdict:** READY_TO_MERGE

Todos os HIGH e MEDIUM foram **corrigidos**, não mitigados. As correções estão em `b0ac57a1`.

## O achado mais valioso — encontrado por DOIS agentes independentes

`F-arch-3` (architecture) e `F-test-1` (tests) convergiram, por caminhos diferentes, no mesmo defeito — **e ele era meu, introduzido pelo próprio T2.1**:

Ao reescrever `ToolboxCapability.apply()` para usar uma única derivação, tirei a chamada `this.compile()` e **dupliquei o corpo dela inline**. Resultado: um método público sem chamador algum, e a duplicação exata que o milestone existe para eliminar — dentro do commit que alega eliminá-la.

**Provado por mutação** (não por leitura): o agente de testes quebrou o corpo de `compile()` (`new Map()` em vez do mapa de instâncias) e rodou a suíte inteira — **588/588 verdes**. O método público estava invisível para o suite inteiro *e* para o gate `knip:exports` que este milestone acabara de criar, porque o knip rastreia exports de módulo, não métodos de classe órfãos.

**Correção:** `#compileFrom(walk)` compartilhado — `compile()` e `apply()` passam a ter um caminho só — mais um teste de caracterização que chama `compile()` diretamente e asserta que o handler está *bound*. Re-executada a mesma mutação: agora **8 testes falham**.

Isso é a justificativa inteira do gate de review em um caso: um defeito que nenhum teste, nenhum linter e nenhum detector pegaria, achado por leitura adversarial e confirmado por experimento.

## HIGH (2) — ambos corrigidos

| ID | Achado | Correção |
|---|---|---|
| F-arch-3 / F-test-1 | `ToolboxCapability.compile()` órfão e duplicando a derivação que T2.1 alega unificar; invisível ao suite e ao `knip:exports` | `#compileFrom` compartilhado + teste de caracterização com asserção de *binding*. Mutação que antes passava agora derruba 8 testes |

(Os dois IDs descrevem o mesmo defeito, achados independentemente.)

## MEDIUM (3) — todos corrigidos

| ID | Achado | Correção |
|---|---|---|
| F-test-2 | Caso negativo no teste live assertava só o tipo do erro (`ConfigurationError`), não a mensagem — um `ConfigurationError` diferente ("toolbox não declara tools") satisfaria a asserção provando nada | Adicionada asserção `/mcp_/` |
| F-test-3 | Mesmo problema no caso `mcp_foo` sem namespace — o único dos casos planejados de T1.1 sem a metade da mensagem | Adicionada asserção `/mcp_/` |
| F-xval-1 | **Desvio não declarado:** uma expectativa pré-existente FOI editada em T2.1, contrariando a redação literal do Global DoD ("sem nenhuma expectativa existente editada") | Registrado como desvio 3 no plano e no ADR. A edição em si é legítima e mais forte (o teste re-declarava o regex — terceira cópia da regra); a omissão não era |

## LOW (4)

| ID | Achado | Ação |
|---|---|---|
| F-test-4 | Dois casos negativos **pré-existentes** assertavam só o tipo | **Corrigido** — mensagens adicionadas, por consistência com o arquivo endurecido |
| F-test-5 | Fronteira de comprimento cobria 64 (maior válido) e 67 (inválido folgado), mas não 65 — um off-by-one no regex (`{0,63}`→`{0,64}`) sobreviveria a ambos | **Corrigido** — caso de 65 chars adicionado |
| F-arch-2 | `toolRuntimeName` minta **e** valida — sobreposição de SRP | **Nenhuma ação.** É *smart constructor* deliberado: separar permitiria a um chamador compor sem validar, que é exatamente como o defeito residual do #145 escapou. Documentado no JSDoc; ADR D5 nomeia o gatilho para separar (segundo minter com postura diferente) |
| F-arch-4 | Dois `throw new Error` genéricos **pré-existentes** em `compileTools` ficaram inconsistentes com o `ConfigurationError` tipado que o mesmo módulo agora lança | **Followup.** Fora do escopo declarado; a mudança os tornou mais visíveis, não os criou |

## INFO (15) — verificações que confirmaram as claims

O agente de **wiring** verificou independentemente as 5 claims do milestone (não confiou no brief) e todas se sustentaram:

- `compileHitlGates`: zero chamadores no baseline (confirmado em `git grep` no SHA pré-diff), exatamente um agora.
- `ConfigurationError`: movido para o módulo folha; **nenhum** dos ~20 importadores mudou; `madge --circular` → *"No circular dependency found"*.
- `src/metadata/`: deletado com zero consumidores **já no baseline**.
- `ceilingRoundFactory`: não mais exportado, um chamador interno preservado.
- Superfície pública: `index.ts`, `bridge/index.ts`, `bridge-entry.ts`, `capability/index.ts` — **zero linhas de diff** nos quatro.
- `compileTools` não tem consumidor em nenhum outro pacote, `examples/`, `fixtures/` ou `my-test/` — o breaking de comportamento tem raio zero dentro do repo, e está declarado no CHANGELOG.

O agente de **cross-validation** rodou os comandos de verificação de cada critério de aceite (não presumiu), incluindo reproduzir o gate `knip:exports` falhando no baseline `271124d5` **em um worktree isolado** — confirmando os 2 órfãos originais.

## Gates de qualidade

| Gate | Estado |
|---|---|
| `npx vitest run` (packages/agents) | **590 passed**, 3 skipped, 89 arquivos |
| `npx vitest run` (packages/http — depende de agents) | **411 passed**, 56 arquivos |
| Live contra provider real (3 execuções) | **2/2** — tool despachada, `handler invocations: 1`, resposta com o valor que só a tool fornece |
| `npx tsc --noEmit` (raiz) | limpo |
| `npx eslint --max-warnings=0` (arquivos tocados) | 0 |
| `pnpm knip:exports` (packages/agents) | 0 achados (falhava com 2 no baseline) |
| `npx knip --workspace packages/agents` | 0 achados |
| `npm run validate:publint` | All good |
| `pnpm check:direction` | **falha pré-existente** (`packages/tauri` declara `theokit`) — verificado idêntico no baseline, sem relação com M55 |

## Cross-validation: DoD do M55 (7 bullets)

| # | Bullet | Estado |
|---|---|---|
| 1 | Validar onde se minta | SATISFEITO |
| 2 | (GATE) Código morto zerado | SATISFEITO com desvio 1 declarado (critério substituído por um mais forte) |
| 3 | (GATE) Zero-behavior | SATISFEITO com desvio 3 declarado (uma expectativa editada, agora registrada) |
| 4 | Caso negativo com tipo + mensagem | SATISFEITO |
| 5 | Documentação que não mente | SATISFEITO (`grep` vazio) |
| 6 | ADR com as decisões + gatilhos | SATISFEITO e excedido (5 decisões, não 3) |
| 7 | Gates verdes + CHANGELOG | SATISFEITO, exceto `check:direction` pré-existente, declarado |

Coverage Matrix: **10/10 gaps** rastreados a mudanças reais de código.

## Dívida reportada, nunca mascarada

- 8 devDependencies não usadas (raiz + `packages/theo`) fazem `npx knip` sair 1 no repo inteiro — pré-existente, fora do escopo.
- 10 CVEs HIGH em dev-tooling transitivo; `--prod` tem 1 low.
- `check:direction` vermelho por `packages/tauri`.
- `run-reflective-loop.ts` com 567 linhas (orçamento 500) — pré-existente (566 no baseline).
- `F-arch-4`: dois `Error` genéricos em `compileTools`.
- `F-arch-5`: `knip-exports.json` duplica ~80 linhas de `knip.json` porque o knip 5.88.1 **não tem** `extends` (verificado no schema instalado) — colapsar quando houver upgrade.

## Handoff

**READY_TO_MERGE** — zero BLOCKER, zero HIGH/MEDIUM em aberto. Segue para `/release`.
