# Backlog — defeitos rastreados fora de um milestone

Artefato durável para achados que **não** pertencem ao escopo de quem os encontrou. Existe porque a
alternativa observada é pior: um defeito classificado como "pré-existente" dentro do log de
implementação de um milestone fica preso num audit trail sujeito a rotação
(`.claude/rules/audit-trail-rotation.md`), e o próximo milestone o classifica com a mesma frase. Duas
iterações disso e "pré-existente" deixou de ser classificação e virou desculpa permanente.

Este arquivo **nunca rotaciona**. Uma entrada sai daqui de três formas: corrigida (com o commit),
promovida a milestone do `ROADMAP-v3.md`, ou fechada com motivo escrito.

> **Nota sobre tracker.** O remote é `usetheodev/theokit`, mas o `gh` desta máquina não resolve o host
> (`github-usetheo` é um alias de SSH). Enquanto o `gh` não estiver autenticado contra ele, este
> arquivo é o tracker. Quando estiver, cada entrada vira issue e a linha ganha `#NNN`.

---

## ~~B-M67-01~~ — RESOLVIDO — 15 testes vermelhos na suíte da raiz, todos anteriores ao M67

**Encontrado em:** M67 (T2), 2026-08-12 · **Resolvido em:** 2026-08-12 (`eb74a709`, `6449e5ad`,
`c004551f`, e o commit de tradução) · **Evidência:**
`.claude/knowledge-base/implementations/m67-layered-boundary-passthrough/t2-measurement.md`

Medição: antes do M67 a suíte da raiz tinha **16** vermelhos; depois, **15**. Cada um foi atribuído
individualmente — não por amostragem — e nenhum era causado pelo milestone. A verificação foi refeita
de forma independente pelo `/review` do M67.

Todos os 15 foram corrigidos. Medição final: **4168 verdes**, 1 vermelho remanescente
(`pnpm-11-compat`, promovido a B-M67-08 abaixo — causa externa, não é um destes 15).

Um padrão apareceu em **oito** dos quinze e vale mais do que a lista: o guarda congelava um
**literal** de uma era anterior, o produto avançou por decisão consciente, e o guarda passou a exigir
o passado. Vermelho por default não protege nada — treina o time a ignorar vermelho. A correção
recorrente é a mesma que o M67 aplicou ao guarda da fixture: afirmar **coerência com a fonte de
verdade**, não um literal, para que a propriedade não precise de edição quando a linha avança.

| # | Teste | Causa | Correção |
|---|---|---|---|
| 1–4 | `ui-peer-range` × 3 + `package-json-peerdep-usetheo-ui` | Literais `0.14.x`/`0.18.x`/`0.19.0`/`^1.0.0`; o `f09fbbac` estreitou o peer para `^1.1.0` e derrubou as cláusulas 0.x de propósito | Coerência com o pin do template. Expôs defeito real: template `^1.0.0` vs peer `^1.1.0` (ERESOLVE sob lockfile no piso) e uma helper de caret que aceitava `1.0.0` em `^1.1.0` — verde pelo motivo errado |
| 5 | `create-theo-default-template` piso do SDK | Literal `^2.13`–`^2.99`; o piso foi a `^4.49.0` (ADR 0060) | Coerência com o peer que o framework declara. Expôs template pinando `^4.0.1`, abaixo do peer |
| 6 | `sdk-peer-ranges` | Literal `peerDependencies['@theokit/sdk-tools'] === '^0.11.0'`; o pacote virou `dependency` e a linha andou 15 minors | Propriedade em vez de literal. Expôs `peerDependenciesMeta` órfã e `sdk-pty` em dois buckets com ranges diferentes |
| 7 | `agent-turn-in-process-parity` | `vi.mock('@theokit/agents')` não interceptava: o SUT importa de `./bridge/agent-endpoint.js` | Mock repontado ao módulo real + piso anti-vacuidade contando as chamadas do duplo |
| 8 | `consume-ui-message-stream` | Afirmava terminação limpa em chunk de erro; o theokit#136 decidiu lançar e a implementação seguiu | Teste alinhado ao contrato vigente (recusa tipada), preservando o que ele sempre protegeu: o parcial anterior ao erro chega ao consumidor |
| 9–10 | `harness-invariant-guard` | Lia `ui-message-stream-translator.ts`, deletado no M49 (`bb1f4a51`). O `ENOENT` derrubava o arquivo inteiro, deixando os **outros cinco** sem verificação | Repontado + asserção de existência que falha dizendo "a lista está velha" |
| 11 | `clean-break-grep-gate` | `messagesToAgentEvents` casava com `AgentEvent` por substring | Delimitado por `\b` |
| 12–13 | `fixtures-index` | Índice dizia `onda1-hello-theo`; o diretório é `wave1-hello-theo` | Linha corrigida |
| 14 | `task-marker` | `no-ptbr.test.ts` explica num comentário que isenta o `task-marker`, e a explicação **é** um marcador | Isenção recíproca |
| 15 | `architecture-guards-ci` | `ls-lint` levava 112 s contra timeout de 30 s — o walker desce a árvore antes de filtrar, e as zonas de estudo tinham 74.502 arquivos | Zonas no `ignore`: **2,59 s → 0,05 s** |

**Nota de conformidade.** Os comentários escritos nestas correções — e os do M68 — nasceram em
português e violavam o gate `tests/lint/no-ptbr.test.ts`, que exige inglês em `packages/` e `tests/`.
Traduzidos no mesmo ciclo. O gate pegou; a regra é anterior a mim e eu a quebrei.

**Correção de rastreabilidade.** O log do T2 do M67 afirmava que estes 15 estavam "registrados como
tasks abertas". Estavam apenas na lista de tarefas da sessão, que não é um artefato do repositório —
apontado pelo `/review`. Esta entrada é o registro durável que a afirmação prometia.

---

## ~~B-M67-02~~ — RESOLVIDO em `a330a3df` — 4 advisories `high` na árvore

**Encontrado em:** M67 (`/deps-audit`), 2026-08-12 · **Evidência:**
`.claude/knowledge-base/audits/m67-layered-boundary-passthrough-deps-audit-2026-08-12.md`

Nenhum é dependência declarada do M67; nenhum bloqueou aquele milestone.

| Sev | Pacote | Vulnerável | Corrigido em | Nota |
|---|---|---|---|---|
| high | `react-router` | `>=7.12.0 <7.18.2` | `>=7.18.2` | **O mais urgente**: bypass de CSRF em modo RSC, exploração remota, e é dependência de aplicação |
| high | `postcss` | `<=8.5.17` | `>=8.5.18` | Path traversal em source map; entra por `vitest → vite`, toolchain de teste |
| high | `nanoid` ×2 | `<3.3.16`, `<3.3.17` | `>=3.3.17` | Loop infinito; mesma cadeia do `postcss` |

Bump de `vitest`/`vite` resolve os três últimos de uma vez; o `react-router` é separado.

---

## B-M67-03 — `@theokit/studio` está sete majors atrás, e alinhar os peers é uma migração, não um bump

**Encontrado em:** M67 (T1), 2026-08-12 · **Medido em:** 2026-08-12 · **Severidade: média** —
não quebra install (peer opcional, pnpm apenas avisa); quebra a promessa do peer.

Peer opcional de `theokit` (`packages/theo/package.json:136,162`). O `@theokit/studio@0.1.0`
publicado declara `@theokit/agents@^0.39.0` (o workspace tem **7.6.0**) e `@theokit/sdk@^3.8.0` (o
workspace tem 4.51.1).

**O acoplamento é real** — não dá para simplesmente remover o peer. `packages/theo/src/vite-plugin/
integrate-studio.ts:47` importa `@theokit/studio/plugin` dinamicamente, e do outro lado
`packages/studio/plugin/run-endpoint.ts` e `reflection-api.ts` importam `compileAgentModule` /
`streamAgentUIMessages` de `@theokit/agents/bridge` e `discoverSkills` de `@theokit/sdk/skills`.

**Medição feita, e ela muda a natureza da entrada.** Alinhar os ranges no sibling
(`../theokit-studio`, branch `workspace`) para `@theokit/agents@^7.5.0` + `@theokit/sdk@^4.49.0` e
rodar a suíte de lá: **de 192 verdes para 177 verdes e 15 vermelhos**, 4 arquivos. Um deles devolve
`422` onde esperava `200` no endpoint de run — o contrato mudou de verdade entre 0.39 e 7.x.

Ou seja: os peers não estavam apenas desatualizados no manifest. O código do studio **nunca foi
migrado** através de sete majors, e o peer obsoleto era o que escondia isso — enquanto ninguém o
satisfazia, ninguém descobria. Republicar com os peers corrigidos publicaria um pacote que não
funciona.

**O que NÃO foi feito, e por quê.** A migração é um milestone do repositório `theokit-studio`, com
ciclo, CHANGELOG e release próprios — não cabe como item de backlog deste repo, e não seria honesto
fazê-la de passagem. O experimento de medição está preservado em
`git -C ../theokit-studio stash list` → `stash@{0}` (só o `package.json`; a árvore de lá está limpa e
na baseline verde).

**Próximo passo:** abrir o milestone de migração no `theokit-studio` (com esta medição como ponto de
partida), migrar os 15, e só então republicar. Enquanto isso, o peer opcional deste repo continua
declarando `^0.1.0`, que é a versão que de fato existe e funciona contra o agents 0.39 — obsoleta,
porém coerente.

---

## ~~B-M67-04~~ — RESOLVIDO — Teste flaky em `subpath-coverage`

**Encontrado em:** M67, 2026-08-12

`packages/agents/tests/unit/subpath-coverage.test.ts::test_the_symbols_of_._CROSS_the_layer` falhou
por timeout de 5000 ms numa execução e passou nas seguintes **sem mudança de código entre elas**. Pela
`.claude/rules/testing.md § 3`, teste flaky é bug — corrigir ou remover, não conviver.

**Causa confirmada e corrigida.** Cada caso do `it.each` fazia o seu próprio `await import(...)`, e o
primeiro a rodar pagava o carregamento do grafo inteiro do barrel — medido em mais de 80 s de
`collect` — contra o timeout de 5 s. Passava ou falhava conforme ordem e carga da máquina.

Elevar o timeout esconderia o sintoma: o custo é de **import**, não de asserção. Os módulos passaram a
ser resolvidos uma vez num `beforeAll` (com `Promise.all` sobre o conjunto de especificadores) e os
casos leem de um cache, síncronos. Um especificador fora do conjunto falha alto em vez de importar
tarde. Resultado medido: o arquivo saiu de 80 s+ para **1,16 s**, 40 testes verdes.

---

## B-M67-05 — O SDK declara dois valores na barra root que não emite

**Encontrado em:** `/review` do M67, 2026-08-12

`@theokit/sdk@4.51.1` declara `isValidTaskId` (`declare function`) e `TASK_RESERVED_PREFIXES`
(`declare const`) na barra root do `.d.ts`, mas `grep -c isValidTaskId dist/index.js` devolve **0**.
São valores por declaração e `undefined` em runtime.

Consequência: um re-export futuro deles **compila** e explode no import. O gate ROOT-BAR do M67 é cego
a este caso — ele enumera `Object.keys` do namespace, que só vê o que é emitido (ADR 0061 declara a
lacuna de tipos; esta é diferente).

Ação: issue upstream no `theokit-sdk` (bug de empacotamento). Nada a fazer neste repo além de não
re-exportá-los.

---

## ~~B-M67-06~~ — RESOLVIDO em `fc2e3289` — `pnpm lint` vermelho por `eslint-disable-line` mal colocado

**Encontrado em:** M67 (verificação pré-commit), 2026-08-12

`packages/agents/src/bridge/agent-sse-handler.ts:41-42`:

```
41:13  error  Unnecessary conditional, value is always truthy   @typescript-eslint/no-unnecessary-condition
42:11  error  Unused eslint-disable directive
```

A causa é mecânica: o `// eslint-disable-line` está **numa linha própria** (42), então desabilita a
linha 42 — não a 41, que é o `if (!closed) {` que ele pretendia cobrir. Resultado: a 41 acusa e a 42
fica "unused". A intenção original está no comentário (`-- mutated by safeEnqueue catch`) e é
legítima: a CFA do TypeScript não rastreia mutação de closure, então `closed` parece sempre `false`.

**Não é causado pelo M67.** O arquivo não é tocado pelo diff (último commit nele: `e91e9169`), não
importa nada do `@theokit/sdk` — `StreamEvent` é interface declarada localmente e `closed` é um `let`
local. O veredito da regra type-aware aqui não pode depender da versão do SDK.

**Consequência para o RELEASE:** o DoD do M67 exige `lint --max-warnings=0` verde. Ele está verde
para os arquivos do M67 (`eslint <13 arquivos> --max-warnings=0` → exit 0) e **vermelho no repo**.
O M67 não pode ser released enquanto isto não for resolvido, mesmo o defeito sendo anterior — CI
falha do mesmo jeito.

**Fix aplicado (`fc2e3289`):** `eslint-disable-next-line` acima do `if`, seguindo a forma que o bloco
de cima já usava. `pnpm lint` → exit 0. Corrigido dentro do M67, e não adiado, porque era o único item
deste backlog que **bloqueava o DoD do próprio milestone** — os outros cinco não bloqueiam nada e
seguem a regra de "pré-existente vira entrada, não conserto oportunista".

---

## B-M67-07 — O estado de release do `main` não volta para `workspace`, e o changesets recalcula sobre base velha

**Encontrado em:** M67 (RELEASE), 2026-08-12 · **Severidade: alta** — quase publicou artefato
diferente sob versão já existente.

O `pnpm version-packages` do M67 computou `@theokit/agents@7.5.0`. Essa versão **já estava publicada
no npm desde 2026-08-10**, com outro conteúdo.

**Causa-raiz, medida.** O commit `7ef84c56` ("Version Packages", bot, via PR #200) aterrissou em
`main` e consumiu dois changesets: `in-process-run-event-sink.md` e
`toolset-error-joins-the-hierarchy.md`. O `workspace` nunca recebeu o back-merge, então:

- os dois arquivos de changeset **continuavam lá**, já consumidos em outro lugar;
- o `package.json` do agents continuava em `7.4.2`, enquanto `main` e o npm estavam em `7.5.0`;
- o `changeset version` somou os dois changesets velhos ao meu e produziu `7.4.2 → 7.5.0`.

Publicar teria colocado o M67 sob um número que já existe. O npm recusaria — mas o CHANGELOG e a tag
locais já estariam mentindo, e o modo de falha não é detectado por nenhum gate deste repo.

**Sintoma correlato:** `@theokit/presenter` está em `0.5.1` no `main` e `0.6.0` no npm. O commit
`10688cce` ("chore(release): @theokit/presenter 0.6.0") vive no `workspace` e nunca chegou ao `main`.
Ou seja, **o problema é bidirecional** — releases publicados cujo commit de versão não está em `main`,
e versões de `main` que não voltam para `workspace`.

**Correção aplicada no M67:** back-merge de `origin/main` em `workspace`, CHANGELOG do agents
restaurado ao estado do `main`, e a versão corrigida para `7.6.0` com uma seção de CHANGELOG contendo
**apenas** o M67 — os dois changesets antigos pertencem à 7.5.0 já publicada.

**Correção de processo, ainda pendente:**
1. Back-merge automático de `main` → `develop` → `workspace` após todo release (é o passo que falta).
2. Um gate que recuse publicar uma versão que já existe no registry. `scripts/verify-published-no-workspace.mjs`
   cobre o protocolo `workspace:`, não colisão de versão. O comando é uma linha:
   `npm view <pkg>@<version> version` deve falhar antes de `changeset publish`.

---

## B-M67-08 — A janela entre `changeset version` e `changeset publish` deixa todo scaffold ininstalável

**Encontrado em:** limpeza do B-M67-01, 2026-08-12 · **Severidade: média** — não afeta usuário
publicado; afeta todo run de CI/local durante a janela de release.

`tests/integration/pnpm-11-compat.test.ts` está vermelho. A causa não é o pnpm 11 nem a dica
`onlyBuiltDependencies` que ele existe para guardar: `pnpm sync:templates` escreve as versões do
**workspace** no `package.json.tmpl` no momento do `changeset version`, e o `changeset publish` roda
depois. Entre os dois passos, o template pina `theokit@0.47.0` e `@theokit/agents@7.6.0` — E404 no
registry — e todo `npx create-theokit` seguido de install falha.

Hoje a janela está aberta porque o release do M67 não completou (ver B-M67-07). Ela reabre a cada
release.

**O que foi feito agora:** o teste engolia o stderr do install (`catch {}`) e falhava com um
`expected false to be true` sem diagnóstico. Passa a nomear os pins não publicados e a dizer que a
causa é a janela de publish. O vermelho continua — ele é honesto — mas agora se lê.

**Correção de processo, pendente:** publicar dentro da mesma execução que versiona (é o que o
`changeset publish` faz quando o release não é interrompido), ou marcar a janela explicitamente para
que a suíte saiba distingui-la. A primeira é preferível: a segunda ensina a suíte a tolerar um estado
que não deveria durar.
