# Backlog — defeitos rastreados fora de um milestone

Artefato durável para achados que **não** pertencem ao escopo de quem os encontrou. Existe porque a
alternativa observada é pior: um defeito classificado como "pré-existente" dentro do log de
implementação de um milestone fica preso num audit trail sujeito a rotação
(`.claude/rules/audit-trail-rotation.md`), e o próximo milestone o classifica com a mesma frase. Duas
iterações disso e "pré-existente" deixou de ser classificação e virou desculpa permanente.

Este arquivo **nunca rotaciona**. Uma entrada sai daqui de três formas: corrigida (com o commit),
promovida a milestone do `ROADMAP-v3.md`, ou fechada com motivo escrito.

> **Nota sobre tracker (corrigida 2026-08-12).** A versão anterior desta nota dizia que o `gh` não
> resolvia o host e que por isso este arquivo era o tracker. Está errada: o `gh` está autenticado
> como `usetheodev` e funciona com `--repo owner/name` explícito — o que falhava era a inferência a
> partir do remote, que usa o alias de SSH `github-usetheo`. Achados com repro e evidência **devem**
> virar issue (regra global § Issues). Este arquivo continua sendo o registro durável e o índice;
> cada entrada filada ganha o link. Ressalva medida: o `gh` é um snap e não lê arquivos sob
> `/tmp/claude-*` — passar o corpo por `--body-file -` com stdin.

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

## ~~B-M67-05~~ — FILADO UPSTREAM — [`theokit-sdk#279`](https://github.com/usetheodev/theokit-sdk/issues/279)

**Encontrado em:** `/review` do M67, 2026-08-12 · **Causa-raiz traçada e filada:** 2026-08-12

`@theokit/sdk@4.51.1` declara `isValidTaskId` e `TASK_RESERVED_PREFIXES` como **valores** no
`.d.ts` da barra root, e o `dist/index.js` não emite nenhum dos dois. Um consumidor que escreve
`import { isValidTaskId } from '@theokit/sdk'` **compila limpo** e recebe `TypeError` na chamada. É a
pior forma que um bug de empacotamento pode ter: o sistema de tipos — a coisa em que o consumidor
confia para saber o que existe — afirma ativamente a resposta errada.

**Causa-raiz (traçada, não adivinhada).** A cadeia é type-only na fonte e o bundler de `.d.ts` perde
isso:

| # | Arquivo | Linha | O que diz |
|---|---|---|---|
| 1 | `packages/sdk/src/types/task.ts` | 152 | `export function isValidTaskId(...)` — um **valor** |
| 2 | `packages/sdk/src/types/index.ts` | 21 | `export type * from "./task.js"` — **type-only** |
| 3 | `packages/sdk/src/index.ts` | 336 | `export type * from "./types/index.js"` — **type-only** |

O runtime está correto e coerente com a fonte. O `rollup-plugin-dts` achata os dois saltos e
re-emite os nomes na lista de export da raiz **sem** o modificador `type`. O `tsup.config.ts` do SDK
já carrega vários comentários sobre esse bundler tropeçando no grafo do pacote (ciclos, entradas
roteadas por `tsc`); esta parece ser mais uma instância da mesma lacuna de fidelidade.

**Consequência para este repo:** nenhuma ação além de não re-exportá-los. O gate ROOT-BAR do M67 é
cego a este caso **por construção** — ele enumera `Object.keys` do namespace, e só enxerga o que é
emitido (o ADR 0061 declara a lacuna de tipos; esta é diferente). A sugestão levada ao issue é o
complemento: afirmar que todo nome **não-`type`** na lista de export do `.d.ts` está em
`Object.keys(await import('@theokit/sdk'))`.

**Correção da nota sobre o tracker.** A nota no topo deste arquivo dizia que o `gh` desta máquina não
resolve o host. Está errada: o `gh` está autenticado como `usetheodev` e funciona quando recebe
`--repo owner/name` explícito — o que falhava era a inferência a partir do remote, que usa o alias de
SSH `github-usetheo`. Issues **podem** ser filadas. Uma ressalva medida: o `gh` é um snap e não lê
arquivos sob `/tmp/claude-*` (confinamento); usar `--body-file -` com redirecionamento de stdin.

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

## ~~B-M67-07~~ — RESOLVIDO — O estado de release do `main` não voltava para `workspace`, e o changesets recalcula sobre base velha

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

**Correção de processo — APLICADA 2026-08-12.** As duas metades, porque uma sozinha não fecha:

1. **`scripts/verify-version-not-published.mjs`**, ligado ao `pnpm version-packages` (roda depois do
   `changeset version` + `sync:templates`, antes de qualquer tag ou publish). Recusa alto quando o
   registry já tem a versão recém-computada. Escopo: **só** os pacotes cuja `version` difere do
   `HEAD` — a primeira forma varria o workspace inteiro e acusou três pacotes intocados, que estão na
   versão que publicaram por último; um gate que acusa pacote intocado é um gate que ninguém mantém.
   A lógica de decisão é pura, com o lookup do registry injetado (DIP), e testada em
   `tests/unit/verify-version-not-published.test.ts` — incluindo o caso literal do M67. Prova viva:
   com o `@theokit/agents` posto em `7.5.0` o gate sai com código 1 e nomeia o pacote (restaurado na
   mesma invocação).

   Por que **antes** do publish e não confiando no npm: o `changeset publish` **pula** uma versão que
   encontra no registry. O release reporta sucesso publicando nada, e o CHANGELOG e a tag locais
   ficam afirmando um número cujo conteúdo não é o que foi ao ar. O erro silencioso é o perigo, não a
   recusa do npm.

2. **`.github/workflows/release-backmerge.yml`** — em todo push para `main`, abre um PR
   `main → workspace` quando o `workspace` está atrás. Alvo `workspace` e não `develop` porque o
   `git-safety.md` § 1 é explícito: `develop` integra, nunca origina, e avança só pelo PR de promoção
   `workspace → develop`. PR e não push direto porque um merge pode conflitar, e um workflow que
   resolve conflito sem supervisão reescreve o trabalho de alguém sem pedir.

O gate (1) impede o dano; o back-merge (2) impede a situação. Só o (1) deixaria todo release exigindo
intervenção manual; só o (2) deixaria o dano possível sempre que o back-merge falhasse.

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

---

## ~~B-M67-09~~ — RESOLVIDO — `Postgres Jobs CI` vermelho há dias: `pg` não declarado, os 6 testes nunca rodaram

**Encontrado em:** verificação dos gates antes do PR de release #206, 2026-08-12 · **Filado:**
[`#207`](https://github.com/usetheodev/theokit/issues/207) · **Severidade: alta** — a garantia que o
workflow anuncia nunca foi coletada.

Vermelho desde pelo menos 2026-08-10, em `develop` **e** em `main`, 8 runs consecutivos observados.
`Cannot find package 'pg'` (`ERR_MODULE_NOT_FOUND`): os **6 testes ficam `skipped`** e o job sai 1. O
teste de race-safety do `SKIP LOCKED` — o único lugar onde a semântica de dequeue concorrente do
`PostgresJobBackend` é verificada contra um Postgres real — nunca chegou a executar.

`pg` não é declarado em nenhum `package.json` do workspace. O comentário no topo do teste afirma que
o import dinâmico "keeps the test loadable even when pg isn't installed … resolved from
`packages/theo` node_modules in CI" — as duas metades são falsas: o `beforeAll` explode assim que a
suíte roda (e ela roda, porque o único guarda é `skipIf(!POSTGRES_URL)` e em CI a variável está
setada), e o `packages/theo` também não declara `pg`.

**Fix aplicado.** `pg@^8.23.0` + `@types/pg` como devDeps da raiz (MIT; escada de parcimônia — nada
na árvore provia o driver), e o guarda passa a considerar as duas pré-condições, com piso
anti-vacuidade: com `POSTGRES_URL` setada, um `pg` ausente é **falha**, não skip. Pular deixaria o job
verde sem uma única asserção ter rodado — pior do que o vermelho, porque um gate verde é um gate que
ninguém relê. A falha é uma só e nomeia a causa.

**Verificado contra Postgres real**, não por inspeção: `postgres:15-alpine` em container local,
derrubado na mesma execução → **7 verdes** (as 6 originais + o piso). Que elas passassem não era
garantido: nunca tinham rodado.

---

## B-M67-10 — `main` e `develop` sem branch protection: o PR obrigatório é convenção, não restrição

**Encontrado em:** verificação dos gates antes do PR de release #206, 2026-08-12 · **Filado:**
[`#208`](https://github.com/usetheodev/theokit/issues/208) · **Severidade: alta**

`gh api repos/usetheodev/theokit/branches/{main,develop}/protection` → **404 Branch not protected**
nas duas.

O `CLAUDE.md` § 4 já descreve exatamente esta situação: o hook local garante a **origem** do trabalho;
a branch protection é o que torna o **PR obrigatório**. Um repo sem ela tem a primeira garantia e não
a segunda. Concretamente: um `git push origin main` direto funciona hoje.

Agrava-se com o B-M67-09: sem required status checks, um vermelho crônico não impede merge nenhum —
o gate não bloqueia, ninguém conserta, e o gate deixa de significar algo.

**Não apliquei nada.** Configuração de repositório é decisão do dono, não de quem encontrou. A
proposta está no issue, com a ressalva de custo: 1 aprovação obrigatória em repo de mantenedor único
cria um gate que só pode ser contornado; `required_approving_review_count: 0` + required status
checks entrega a maior parte do valor sem isso.

---

## B-M67-11 — O `pnpm audit` do projeto só mede `--prod`, e há 16 advisories `high` no toolchain

**Encontrado em:** ao verificar se o `pg` recém-adicionado trouxe CVE, 2026-08-12 · **Severidade:
baixa/média** — não é exposição de produção; é uma lacuna de medição.

Medido lado a lado no mesmo commit:

| Escopo | Resultado |
|---|---|
| `pnpm audit --prod --audit-level=high` | 6 (2 low, 4 moderate) — **zero high** |
| `pnpm audit --audit-level=high` | 25 (2 low, 7 moderate, **16 high**) |

As 16 são todas de `devDependencies` e nenhuma veio do `pg` (rastreadas: `eslint`,
`@apidevtools/swagger-parser`, `@changesets/cli`, `drizzle-kit`, `drizzle-orm`, `unstorage`,
`pg-mem`). São CVEs de complexidade algorítmica / DoS — `brace-expansion`, `fast-uri`, `immutable`,
`js-yaml`, `shell-quote`.

O número que o CHANGELOG cita (`4 high → zero`) está **correto como declarado**: ele diz `--prod`. O
problema não é a afirmação, é o escopo nunca ter sido escolhido explicitamente — um projeto que só
audita produção não sabe o que roda no seu próprio build.

Risco real é menor que o de produção, mas não é zero: são ferramentas que consomem entrada não
confiável (YAML de config, ASTs, globs) durante lint e build. A decisão a tomar é **qual escopo o
gate mede**, e registrá-la — não sair corrigindo 16 advisories de terceiros.

---

## ~~B-M67-12~~ — RESOLVIDO — Um job de CI impossível de passar, testando templates que um ADR removeu

**Encontrado em:** medição do efeito do fix de build no PR #212, 2026-08-12 · **Severidade: média** —
vermelho garantido a cada run, e gastando um serviço de banco para isso.

O job `e2e-postgres-templates` provisionava um Postgres, empurrava dois schemas e rodava specs
Playwright para as fixtures `template-postgres` e `template-saas`. O **ADR 0023** (2026-06-17,
*default-only template set*) removeu esses templates **de propósito** — e o job sobreviveu a eles.

Verificado item por item: **nenhum** artefato que ele citava ainda existia.

| Artefato citado pelo job | Existe? |
|---|---|
| `fixtures/template-postgres/` | não |
| `fixtures/template-saas/` | não |
| `playwright.postgres-templates.config.ts` | não (só o `playwright.config.ts`) |
| `docs/plans/playwright-postgres-templates-ci-plan.md` | não (a árvore `docs/` virou `wiki/`) |

O `tsconfig.json` também ainda listava o config inexistente no `include` — inofensivo para o `tsc`,
mas o mesmo apodrecimento.

**Como ele apareceu.** A correção de build-before-lint fez a falha **mudar de lugar**: o job parou de
morrer no `pnpm --filter theokit build` e passou a morrer no `Push schema — template-postgres`, com
`drizzle.config.ts file does not exist`. A primeira falha escondia a segunda — e a segunda é a real.

**Removido**, com a explicação no lugar onde ele vivia. Um gate impossível é pior que gate nenhum:
ele ensina o time a ignorar vermelho, e foi esse hábito que deixou dois releases seguidos merjarem com
12 checks vermelhos (issue #210).

---

## ~~B-M67-13~~ — RESOLVIDO — O gate de licenças chamava um script deletado, e nunca verificou nada

**Encontrado em:** varredura dos gates com artefato ausente, 2026-08-12 · **Filado:** parte do
[`#210`](https://github.com/usetheodev/theokit/issues/210); o achado de compliance virou
[`#213`](https://github.com/usetheodev/theokit/issues/213)

`scripts/check-licenses.mjs` foi deletado **dentro de `efe63edf`** ("Release v0.4.0"), um commit
grande o bastante para a perda passar despercebida. O `package.json` e o job de CI continuaram
chamando, então `License compliance` falhava com `MODULE_NOT_FOUND` desde então — um controle de
compliance vermelho por tanto tempo que ninguém lia, e que **nunca verificou uma única licença**.

A varredura que o encontrou foi sistemática, não por acaso: script que cruza todo `scripts:` do
`package.json` e todo `run:`/`--config` dos workflows contra o disco. **Uma** referência quebrada em
todo o repo, e era esta.

**Restaurado com a política original verbatim** (era bem fundamentada — pnpm-native, decomposição de
expressão SPDX, MPL-2.0 admitido com a razão escrita). O que mudou: a **decisão** virou função pura
sobre um conjunto injetado (`findLicenseViolations`), testável sem registry, rede ou processo `pnpm`.
A forma anterior embrulhava `execSync` na mesma lógica e só dava para exercitar ponta-a-ponta — por
isso um defeito no tratamento de SPDX teria sido invisível. 16 testes.

**O que ele achou assim que voltou a rodar:** quatro pacotes de produção sem licença declarada. Um
era terceiro (`khroma@2.1.0`, que traz o arquivo `license` MIT e só esquece o campo). **Os outros
três eram nossos** — ver #213. Resultado final: `OK — 567 pacotes`.

**Um teste meu pegou a minha própria implementação sendo permissiva demais.** A primeira versão da
exceção aceitava a sobreposição mesmo quando o pacote **declarava** uma licença copyleft. A exceção
existe para metadado **ausente**, nunca para contradizer o que o manifest diz — se um pacote declara
`GPL-3.0`, não há nada faltando e não há o que sobrepor. Tratar os dois casos igual transformaria a
válvula em bypass, que é exatamente o modo de falha que uma allowlist deveria evitar.

---

## ~~B-M67-14~~ — RESOLVIDO — O `Bundle budget` nunca mediu um bundle

**Encontrado em:** investigação dos vermelhos restantes do #210, 2026-08-12

O default do `BUNDLE_FIXTURE` era a **raiz do monorepo**, que não é uma app TheoKit. O
`npx theokit build` não tinha o que buildar, o `|| true` engolia a falha, e o gate saía 2 com
*"build output not found"* — um orçamento sob o qual ninguém nunca esteve.

**A lacuna que deixou isso sobreviver:** os 7 testes do script passavam `BUNDLE_FIXTURE`
explicitamente. Nenhum exercitava o **default**, que era justamente a única coisa que o CI usa. Um
teste novo fixa a propriedade — o diretório que o script escolhe sozinho tem de ser uma app real.

O script também guardava mal a evidência: descartava a saída do build e depois reportava "output not
found", que é o sintoma e não a causa. Agora imprime o log do build quando os assets faltam.

Primeira medição real: **223 KB gzipped contra orçamento de 350 KB**.

**Padrão, terceira ocorrência no mesmo dia.** `postgres-integration` (dependência não declarada),
`License compliance` (script deletado), `Bundle budget` (fixture inexistente): três gates que
reportavam vermelho havia meses sem nunca terem exercido a verificação que anunciavam. O sintoma
comum não é descuido pontual — é que **um gate vermelho por default deixa de ser lido**, e a partir
daí a causa dele para de importar para todo mundo.

