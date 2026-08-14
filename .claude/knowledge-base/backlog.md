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

> **Nota de numeração.** Não existe `B-M67-16`, e nunca existiu — verificado com
> `git log -S "B-M67-16"`, que não retorna nada. É um número pulado na criação, não uma entrada
> removida. Registrado porque um buraco numa sequência é indistinguível de uma exclusão silenciosa
> para quem chega depois, e este arquivo existe justamente para que nada saia dele sem motivo
> escrito.

---

## ~~B-M76-03~~ — RESOLVIDO — A corrida de `dist`, terceira medicao: eu fechei o B-M72-01 cedo demais

**Encontrado em:** M77, 2026-08-13 · **Resolvido em:** 2026-08-13 · **Severidade: media** — nao ha
defeito de produto; a suite mente de forma intermitente, que e o pior tipo de suite.

O B-M72-01 memoizou a decisao "dist esta usavel?" e eu escrevi, no proprio codigo, que isso fazia
"todo chamador de uma run concordar". **A frase era falsa.** O vitest roda arquivos de teste em
**processos worker separados** — um memo por PROCESSO faz todo chamador de um *worker* concordar, o
que nao e a mesma coisa.

O defeito original sobreviveu, so que mais estreito: o worker A decide que dist esta fresco e vai
le-lo; o worker B, iniciado onze minutos depois, ve o mtime fora da janela de dez minutos, decide que
esta velho e reconstroi — e o `tsup` limpa o diretorio antes de escrever.

**Medido na run completa do M77:** 7 falhas em `import-validation` e `devtools-treeshake`, todas
verdes em isolamento logo em seguida (35/35).

### A licao, que e a mesma de sempre

Eu tinha a evidencia (a corrida) e escrevi a conclusao errada sobre o **modelo de execucao**. Nao
medi quantos processos o vitest usa; assumi. O comentario que afirmava a garantia ficou no arquivo
por um milestone inteiro afirmando algo que nunca foi verdade.

### A correcao

A decisao passa a ser compartilhada ENTRE processos por um arquivo-marca que registra **qual run**
validou o dist, com a chave sendo o pid do processo pai — que todo worker de uma run do vitest
compartilha. Mesma run ⇒ confia, sem relogio nenhum. Run diferente ⇒ cai na janela de frescor, que e
para o que a janela sempre serviu: um dist de ontem.

**Nenhuma janela de tempo resolve isto sozinha** — qualquer janela pode expirar entre dois workers da
mesma run, e e exatamente esse o bug; alargar so faz um dist genuinamente velho sobreviver mais.

---

## B-M78-01 — ABERTO — Tres copias do `@theokit/sdk@4.51.1` tornam tipos com `protected` incompativeis entre pacotes

**Encontrado em:** M78, 2026-08-14 · **Severidade: baixa hoje, media adiante** — nao quebra runtime;
quebra *type tests* que cruzam a fronteira raiz↔pacote, e o erro nao se parece com a causa.

`ls node_modules/.pnpm/@theokit+sdk@*` mostra **tres** diretorios da MESMA versao 4.51.1 (mais 4.40.0
e 2.30.0), distinguidos so pelo hash de resolucao de peers. Isso e comportamento normal do pnpm.

O que nao e normal e a consequencia: `SandboxProvider` carrega um membro `protected`, entao TypeScript
o compara **nominalmente**. Um `.test-d.ts` em `tests/` resolve uma copia, `packages/agents/src`
resolve outra, e o compilador reporta:

```
Type 'SandboxProvider' is not assignable to type 'SandboxProvider'.
  Property 'config' is protected but type 'SandboxBackend' is not a class derived from 'SandboxBackend'
```

Um erro que le como uma contradicao e manda o leitor cacar um bug de tipo que nao existe.

**Contornado no M78, nao resolvido:** o type test passou a derivar o tipo da propria assinatura sob
teste (`Parameters<typeof bindToolScope>[0]['sandbox']`) em vez de importar o gemeo. Isso e mais
correto por si so — o teste fala o vocabulario que a API publica — mas nao remove a duplicata.

**O que falta decidir:** se vale forcar copia unica (`pnpm.overrides` ou `resolutions`) ou conviver.
Nao decidi sozinho porque forcar dedupe pode quebrar um peer legitimo, e a evidencia atual e um unico
type test — pouco para mexer na arvore de dependencias do repositorio inteiro.

---

## B-M76-02 — ABERTO — CodeQL roda, varre 1645 arquivos e nao consegue reportar

**Encontrado em:** M76, 2026-08-13 · **Severidade: media** — nao ha defeito de codigo; ha um gate de
seguranca permanentemente vermelho, que e pior que gate nenhum porque ensina o time a ignorar vermelho.

O job `Analyze (javascript-typescript)` falha em **todo** run. A causa nao e achado nenhum: o CodeQL
executa por completo (`CodeQL scanned 1645 out of 1645 TypeScript files`), gera o SARIF, e morre no
upload:

```
##[error]Please verify that the necessary features are enabled:
Code scanning is not enabled for this repository.
```

**Causa raiz:** `usetheodev/theokit` e privado, e code scanning em repo privado exige GitHub Advanced
Security — um item de plano/faturamento, nao de codigo.

**Por que nao decidi sozinho.** As tres saidas sao (a) habilitar GHAS, que gasta dinheiro do dono;
(b) trocar para `upload: false` e passar a gatear sobre o SARIF local, o que muda o que o gate
promete; (c) remover o workflow. Todas sao decisoes do dono do repositorio, e nenhuma delas e
"consertar um bug". Deixar o vermelho visivel e registrado e mais honesto que escolher por ele.

**Nao bloqueia merge:** o check nao esta na lista de required — o PR fica `UNSTABLE`, nao `BLOCKED`.

---

## ~~B-M76-01~~ — RESOLVIDO — O M75 mergeou com o teto de bundle estourado, e eu não medi

**Encontrado em:** M76, 2026-08-13 · **Resolvido em:** 2026-08-13 · **Severidade: média** — não
quebra runtime; deixa um gate vermelho em `main` e infla o pacote para todo consumidor.

O motor de hooks do M75 entrou no **barrel principal** do `@theokit/agents`, levando o bundle de
34,1K para **42,9K** contra um teto de 35K. Medido com `git stash`: já estava assim **no `HEAD`**,
antes do M76.

### O erro de processo, que é o que vale registrar

Eu li a **contagem de testes** (`5888 verdes`) e o **código de saída** — e não o gate de bundle, que
mora num arquivo de teste do `packages/agents` e não aparece na saída agregada da raiz quando outros
arquivos falham antes.

Isso é exatamente a lição que o **B-M74-01** tinha acabado de me dar, um milestone antes, sobre o
`@theokit/http`: uma capacidade que a maioria dos apps nunca toca não deve ser paga por todo app que
importa o pacote. Eu escrevi essa frase no CHANGELOG do M74 e não a apliquei no M75.

### A correção

`@theokit/agents/hooks` como subpath, mesmo padrão de `/session`, `/persistence` e dos três módulos
do `@theokit/http`. Bundle principal volta a **34,7K**, dentro do teto, e o motor continua
alcançável por quem o quer.

**Ressalva honesta:** o teto continua apertado (34,7K contra 35K). O próximo símbolo que entrar no
barrel principal estoura de novo. Isso não é problema deste item — é a informação de que o próximo
milestone que adicionar superfície ao barrel precisa medir **antes**, não depois.

---

## ~~B-M74-01~~ — RESOLVIDO — Três módulos com teste e sem porta, e uma camada que eu inventei fora da DAG

**Encontrado em:** M74, 2026-08-13 · **Resolvido em:** 2026-08-13

`tests/unit/architecture-guards-ci.test.ts` falhava em 3 de 14 casos. Medido com `git stash`: os
mesmos 3 já falhavam no `HEAD` — não era regressão do milestone.

### A primeira leitura estava errada

Registrei os três arquivos de `packages/http/src/` como "código morto". **Eles têm teste** — cada um
tem seu `*.test.ts` importando por caminho relativo. O código roda; o que faltava era a porta:
nenhum está no barrel (`src/index.ts`) nem é entry do `tsup`. Ninguém fora dos próprios arquivos
conseguia alcançá-los, e nada em `packages/theo` tinha reimplementado o equivalente — a capacidade
simplesmente não existia para consumidor nenhum.

**Mesma forma do defeito do M73, encontrado um milestone antes**, e é isso que faz valer registrar:
uma suíte verde prova que o código **funciona**, nunca que ele é **alcançável**. De dentro de um
arquivo de teste as duas perguntas parecem a mesma e não são.

Exportados, não deletados: são capacidades funcionando e testadas — `action-encryption` em
particular é o AES-GCM que sela argumentos de server action. Deletar cripto testada porque ninguém
a ligou é destruir trabalho para satisfazer um linter. Os tipos `ServerInsertedHTML` e `CssResource`
eram locais e foram exportados junto: um chamador que pode chamar a função e não consegue **nomear**
o tipo redeclara à mão, e uma segunda declaração de um contrato diverge da primeira em silêncio.

### O que os exports revelaram

Com os três alcançáveis, o total de violações **subiu** de 2 para 14 — com **3 erros** que antes
estavam escondidos atrás de módulos inalcançáveis. E os três erros eram **meus**, do M74:

```
error server-may-only-depend-on-core-cache-config-devtools-services:
  packages/theo/src/server/index.ts → packages/theo/src/context/instruction-tree.ts
```

Eu tinha criado `packages/theo/src/context/` como camada nova. A G1 é explícita: `server/` só pode
depender de `core / cache / config / devtools / services`. A regra estava certa e o layout errado —
os três módulos **são** configuração de agente, que é exatamente o que `config/` guarda. Movidos
para lá.

Alargar a DAG para admitir um diretório inventado cinco minutos antes seria editar o guarda para
caber o erro.

### Medido

`dependency-cruise`: **0 erros** (as 11 `info` restantes são os `tsup.config.ts`, falso-positivo do
detector — config de build é carregada pela ferramenta, não importada). O guarda de arquitetura
passa nos 14 casos pela primeira vez.

---

## ~~B-M72-01~~ — RESOLVIDO — O helper de build decidia por chamada, e a janela expirava no meio da suíte

**Encontrado em:** M69/M70/M72 — três ocorrências medidas · **Resolvido em:** 2026-08-13

`tests/unit/r3a-emitted-bundle-node-free.test.ts` e `tests/smoke/import-validation.test.ts` liam
`packages/theo/dist/` e falhavam de forma intermitente na suíte completa, sempre verdes isolados —
uma vez com `dist/cli/index.js` simplesmente **ausente**.

### A causa, capturada e não inferida

Um watcher no diretório mais um snapshot de `ps` no instante do sumiço:

```
node pnpm --filter theokit build
  sh -c tsup
    node tsup/dist/cli-default.js
```

`tests/integration/_helpers/build-theokit-package.ts` roda esse build, e o `tsup` **limpa** o
diretório de saída antes de escrever. Todo leitor em voo via um `dist/` faltando ou parcial.

### Por que o mutex que já existia não bastava

O docblock do helper **já nomeava esta corrida** — *"running `pnpm --filter theokit build` from each
one races, wiping dist/ mid-read"* — e o mutex foi escrito para ela. Ele serializa **escritores entre
si**, e essa nunca foi a falha.

`hasFreshBuild()` era avaliado **por chamada**, contra uma janela de 10 minutos, e uma run completa
leva mais ou menos isso. Então dois chamadores da **mesma** run recebiam respostas diferentes: um
cedo via um dist fresco, passava e ia ler; um tardio — passada a janela — decidia que estava velho e
reconstruía debaixo dele.

**Os quatro leitores estavam dentro do protocolo o tempo todo.** Um guarda cujo escopo é mais estreito
que a propriedade que ele aparenta proteger — a mesma forma de defeito que este ciclo encontrou de
ponta a ponta, desta vez na infraestrutura de teste.

### A correção

A decisão passa a ser **uma por processo**, memoizada. Todo chamador de uma run concorda, e a janela
volta a governar só o que ela devia governar: um processo novo. `tests/unit/build-helper-decides-once.test.ts`
prova a propriedade por mtime — um rebuild necessariamente a move — com contraprova de que é o memo
que curto-circuita, e não um filesystem rápido.

**Verificado com o mesmo instrumento que pegou o culpado:** watcher rodando durante a suíte inteira,
**zero desaparecimentos** onde antes havia um por run.

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

## ~~B-M67-03~~ — O studio migrou; e a duplicata que eu atribuí a ele nunca veio dele

**Encontrado em:** M67 (T1), 2026-08-12 · **Medido em:** 2026-08-12 · **Resolvido em:** 2026-08-13

Peer opcional de `theokit` (`packages/theo/package.json:136,162`). O `@theokit/studio@0.1.0`
publicado declarava `@theokit/agents@^0.39.0` (o workspace tem **7.6.0**) e `@theokit/sdk@^3.8.0` (o
workspace tem 4.51.1).

**O acoplamento é real** — não dava para simplesmente remover o peer.
`packages/theo/src/vite-plugin/integrate-studio.ts:47` importa `@theokit/studio/plugin`
dinamicamente, e do outro lado `packages/studio/plugin/run-endpoint.ts` e `reflection-api.ts`
importam `compileAgentModule` / `streamAgentUIMessages` de `@theokit/agents/bridge`.

### A migração

Alinhados os peers e devDeps do sibling para `@theokit/agents@^7.6.0` + `@theokit/sdk@^4.49.0`:
**192 verdes → 177 verdes e 15 vermelhos**, em 4 arquivos. Diagnosticados, um a um: todos os 15
descendem de **uma** renomeação de API, e ela está nas *fixtures de teste*, não no produto.

`agent()` deixou de ser exportado do bridge entre 0.39 e 7.x; o sucessor é `AgentBuilder.create()`,
com a mesma cadeia (`.model` / `.system` / `.tool` / `.skills` / `.build`). Três fixtures importavam
`agent`, lançavam no import, e o `compileAgentModule` degradava por item exatamente como foi
projetado — inclusive devolvendo `422` no endpoint de run. Ou seja: o `422` **não era contrato
quebrado, era o contrato funcionando**, alimentado por uma fixture morta.

Três linhas depois: **192 verdes**, `tsc --noEmit` limpo.

**A correção do meu próprio registro.** A entrada anterior dizia "o código do studio nunca foi
migrado através de sete majors" e "o contrato mudou de verdade". Eu tinha **contado** os 15
vermelhos sem **diagnosticar** nenhum, e inferi um tamanho a partir do número. A superfície de
produção que o studio consome — `compileAgentModule`, `streamAgentUIMessages` — atravessou as sete
majors intacta.

Um verde que aparece depois de três linhas, num item classificado como "sete majors", merece
desconfiança: é a forma clássica de verde pelo motivo errado. Por isso a migração vem acompanhada de
`tests/version-floor.test.ts` no sibling, que não pergunta versão — pergunta aos módulos carregados
o que eles expõem (`AgentBuilder` presente, `agent` ausente, e a família config/trust/wiring do SDK
4.49). Ele levou **quatro** tentativas, e cada tentativa errada foi o mesmo defeito: uma sonda
incapaz de detectar a condição que rastreia (`package.json` fora do `exports`; resolução CJS contra
um subpath ESM-only; `import.meta.resolve` que o transform SSR do Vite não fornece).

### A duplicata: atribuição refeita do zero

A entrada anterior afirmava que o `@theokit/studio@0.1.0` arrastava `@theokit/agents@1.0.0` e
`@theokit/http@1.0.0` para a árvore daqui. **Ele não arrasta, e nunca arrastou.** O studio publicado
declara `@theokit/agents` só como *peer*, e esse peer resolve para o workspace 7.6.0. Eu inferi a
causa por co-ocorrência e nunca a tracei — que é exatamente como uma causa plausível sobrevive dentro
de um arquivo em que todo mundo confia.

Traçada no `pnpm-lock.yaml`, a causa real é **uma aresta dentro deste repositório**:

> `packages/http` declara `@theokit/agents: ">=0.47.0"` como peerDependency, e nada no workspace o
> satisfaz — então o pnpm **auto-instala do registry**, ao lado do irmão de mesmo nome que está um
> diretório adiante. Essa cópia publicada traz os próprios `@theokit/http` e `@theokit/presenter`
> publicados junto.

O lockfile ainda pinava `1.0.0` num range aberto — resíduo de antes do 7.x existir. A reinstalação
re-resolveu para 7.6.0, o que **removeu do produto** o `@theokit/agents@1.0.0`: a cópia sem `license`
declarada que o #213 registrou como a única sem conserto por republish (tarballs npm são imutáveis).
O gate de licenças sai de 4 violações para **zero em 562 pacotes**.

O guarda `tests/unit/own-package-duplicates.test.ts` disparou nas **duas** direções durante a
medição — pediu para encolher quando as duplicatas sumiram, e acusou `@theokit/presenter` quando ele
apareceu. Foi assim que a atribuição errada acabou pega. O docblock e a lista foram reescritos com a
cadeia traçada.

**O que fica aberto, como item próprio:** o conserto canônico (`"@theokit/agents": "workspace:*"` nos
devDeps de `packages/http`) foi **medido**: funciona, o lockfile passa a linkar `../agents` e as três
duplicatas saem da árvore — e **quebra o build**, porque `packages/agents` já devDepende de
`@theokit/http`, então o link fecha um ciclo de tipos e o dts do tsup falha com `TS5055`. Quebrar
esse ciclo é mudança arquitetural em dois pacotes, não edição de manifest. Registrado abaixo como
B-M67-21 em vez de ser contrabandeado sob um guarda de duplicatas.

---

## ~~B-M67-21~~ — RESOLVIDO — O ciclo `agents ↔ http`, e a regra que ninguém checava

**Encontrado em:** 2026-08-13, ao tracear a causa real do B-M67-03 · **Resolvido em:** 2026-08-13

`packages/http` declarava `@theokit/agents: ">=0.47.0"` como peerDependency. Nada no workspace o
satisfazia, então o pnpm auto-instalava a cópia **publicada** ao lado do irmão de mesmo nome — e essa
cópia trazia `@theokit/http@1.0.0` e `@theokit/presenter@0.7.0` publicados atrás dela. Três cópias
publicadas de pacotes que este repositório constrói, na própria árvore de produção. É o defeito do
ADR 0062 generalizado: duas versões de um contrato na mesma árvore, onde os testes exercitam uma e o
consumidor pode alcançar a outra.

### A tentativa óbvia, e por que ela estava errada

`"@theokit/agents": "workspace:*"` nos devDeps de `packages/http` funciona — o lockfile passa a
linkar `../agents` e as três duplicatas saem — e **quebra o build**:

```
packages/http build: error TS5055: Cannot write file 'dist/app.d.ts' because it would overwrite input file.
```

Porque `packages/agents` já devDepende de `@theokit/http`, o link de volta fecha um ciclo de tipos, e
o `dist/app.d.ts` do http vira *entrada* do build que o escreve.

A lição está no diagnóstico, não no erro: eu estava tentando **satisfazer** o peer. O peer é que não
deveria existir.

### A regra já dizia, e nada verificava

`system-design-guardrails.md` § G1, em uma linha: *"`@theokit/http` does NOT import `@theokit/agents`
(agents depends on http, not the reverse)"*. O `packages/agents/tests/unit/dependency-direction.test.ts`
guarda a **outra** metade da mesma regra, sobre o manifest do próprio agents. A metade que restringe o
`http` não tinha oráculo nenhum — por isso a violação viveu em `src/app.ts` através de todas as
revisões que já rodaram lá.

E o time **já tinha batido nesse ciclo**: o docblock de `theoapp-agent-entry-mounting.test.ts`
registra que declarar agents como devDep de http "criou um ciclo de build" e que a saída foi **mover o
teste** para o lado de agents. Contornou-se o sintoma; a causa — o `import()` dinâmico dentro de
`TheoApp` — ficou.

### A correção: inverter, não satisfazer

`TheoAppOptions.agentRuntime` declara a fatia da camada de agentes que o `TheoApp` precisa
(`generateAgentRoutes`, e opcionalmente `createSdkAgentStream`); o chamador a fornece. É DIP
(`architecture.md` § 2) com wiring na raiz de composição (§ 1). O `import()` dinâmico saiu, o peer
saiu do manifest, e o único call site que exercitava o ramo — em `packages/agents`, o lado que
legitimamente tem a direção — passa a entregar o runtime.

**"Dinâmico" e "opcional" nunca foram escapatória.** Eles mudam *quando* o módulo é necessário, nunca
*se* o pacote depende dele: o manifest declarava o peer, e é sobre o manifest que o pnpm age.

Falha tipada quando `agents` vem sem `agentRuntime` (Regra 8): `HttpDecoratorsConfigError` com a
mensagem nomeando a opção e mostrando a linha de wiring. A alternativa seria montar zero rotas e
reportar boot bem-sucedido — 404 em toda requisição de agente, sem ninguém dizer por quê.

### Guardas novos

- `packages/http/tests/unit/dependency-direction.test.ts` — a metade da G1 que faltava. Verifica as
  **quatro** seções do manifest (o peer era o que o pnpm auto-instalava; o devDep foi o que fechou o
  ciclo de tipos) e varre `src/` por imports estáticos **e** dinâmicos.
- `packages/http/tests/unit/agent-runtime-required.test.ts` — o caso negativo (`testing.md` § 4.1):
  erro **tipado**, mensagem que nomeia a correção, e as duas contraprovas de que app sem agentes e com
  `agents: []` continuam bootando.

**O detector errou na primeira execução, e o erro vale registro.** A primeira versão era regex sobre
o texto cru e acusou `src/app.ts` — porque a mensagem de erro nova *cita* a linha de import como
documentação. Uma string não é um import. O regex não distinguia código de prosa sobre código, que é
a mesma classe de defeito que o guarda existe para pegar. Trocado por `ts.preProcessFile`, o scanner
do próprio TypeScript (rung 4 da escada — o compilador já é dependência), que ignora strings e
comentários por construção. As duas contraprovas ficaram no arquivo.

### Medido

Árvore de produção antes: `@theokit/agents`, `@theokit/http`, `@theokit/presenter` publicados.
Depois: **nenhum dos três**. `KNOWN_DUPLICATES` em `own-package-duplicates.test.ts` encolheu para
vazio — o guarda pediu isso sozinho, na direção "desapareceu" que o docblock dele prometia.

`pnpm build` exit 0 · `tsc --noEmit` exit 0 · eslint 0 · licenças OK (554 pacotes) · **5712 verdes**,
0 vermelhos.

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

## ~~B-M67-08~~ — RESOLVIDO — A janela entre `changeset version` e `changeset publish`

**Encontrado em:** limpeza do B-M67-01, 2026-08-12 · **Severidade: média** — não afeta usuário
publicado; afeta todo run de CI/local durante a janela de release.

`tests/integration/pnpm-11-compat.test.ts` está vermelho. A causa não é o pnpm 11 nem a dica
`onlyBuiltDependencies` que ele existe para guardar: `pnpm sync:templates` escreve as versões do
**workspace** no `package.json.tmpl` no momento do `changeset version`, e o `changeset publish` roda
depois. Entre os dois passos, o template pina `theokit@0.47.0` e `@theokit/agents@7.6.0` — E404 no
registry — e todo `npx create-theokit` seguido de install falha.

Hoje a janela está aberta porque o release do M67 não completou (ver B-M67-07 e o issue #209: os
tokens npm fornecidos são read-only, então o `changeset publish` recusa com `E404` no `PUT`). Ela
reabre a cada release.

**Estado em 2026-08-12, depois de fechar todas as causas internas de CI:** este é o **único teste
vermelho do repositório**, e sozinho ele derruba três checks — `Unit + Type tests (20)`, `(22)` e
`Coverage gate`, que rodam a mesma suíte. Ou seja: **um bloqueio externo é hoje a totalidade do
vermelho de teste**, e ele some no minuto em que o publish sair.

**O que foi feito agora:** o teste engolia o stderr do install (`catch {}`) e falhava com um
`expected false to be true` sem diagnóstico. Passa a nomear os pins não publicados e a dizer que a
causa é a janela de publish. O vermelho continua — ele é honesto — mas agora se lê.

**Fechado em 2026-08-12 com o publish de `theokit@0.47.0`, `@theokit/agents@7.6.0` e
`@theokit/presenter@0.7.0`.** O `pnpm-11-compat` passou a verde na mesma execução — verificado.

**A causa do bloqueio era minha, não do token, e vale registrar em detalhe porque é uma armadilha
que morde de novo.** Eu passava a credencial como variável de ambiente
`npm_config_//registry.npmjs.org/:_authToken=…`. O npm honra essa forma em **leituras** — `whoami` e
`owner ls @theokit/agents` funcionavam, e foi por isso que eu concluí "autenticado" — e **não** a
aplica no caminho de **escrita**. O `PUT` saía anônimo, e o registry responde escrita não autenticada
com **404 em vez de 403**, para não vazar se o pacote existe.

Esse 404 é o que tornou o diagnóstico errado tão fácil: **o npm devolve o mesmo status para "você não
pode" e para "você não é ninguém"**. Declarei três tokens diferentes como read-only; os três
publicavam. O usuário apontou o erro, e ele estava certo.

Publicando pela forma canônica — `_authToken` num npmrc, que é a resolução que a escrita usa — os
três pacotes subiram na primeira tentativa.

**Gate resultante (`scripts/verify-publish-credential.mjs`):** verifica se a credencial está no
caminho de **escrita**, não se ela autentica. A primeira versão que escrevi checava autoridade via
`npm access list packages <nome>` — endpoint de **org**, enquanto `usetheodev` é **usuário**, então
devolvia 403 para qualquer token. Um gate cujo oráculo não distingue a falha que ele filtra é pior
que gate nenhum: produz vereditos confiantes e errados, e este mandou três tokens para o lixo.

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

## ~~B-M67-10~~ — Branch protection: aplicada, e a primeira aplicação não protegia ninguém

**Encontrado em:** verificação dos gates antes do PR de release #206, 2026-08-12 · **Filado:**
[`#208`](https://github.com/usetheodev/theokit/issues/208) · **Severidade: alta**

`gh api repos/usetheodev/theokit/branches/{main,develop}/protection` → **404 Branch not protected**
nas duas.

O `CLAUDE.md` § 4 já descreve exatamente esta situação: o hook local garante a **origem** do trabalho;
a branch protection é o que torna o **PR obrigatório**. Um repo sem ela tem a primeira garantia e não
a segunda. Concretamente: um `git push origin main` direto funciona hoje.

Agrava-se com o B-M67-09: sem required status checks, um vermelho crônico não impede merge nenhum —
o gate não bloqueia, ninguém conserta, e o gate deixa de significar algo.

**Lado deste repositório: FEITO.** A política deixou de viver só na prosa do issue — prosa não se
compara com a realidade, então "o repo bate com o que decidimos?" não tinha resposta sem abrir uma
tela de configuração.

- `.github/branch-protection.json` — a política, versionada ao lado dos workflows que ela protege.
- `scripts/protect-branches.mjs` — compara a spec com a API e **só escreve com `--apply`**. Aplicar
  proteção de branch é mudança administrativa num repositório compartilhado; nunca pode ser efeito
  colateral de rodar uma ferramenta.
- `tests/unit/branch-protection-spec.test.ts` — 11 casos sobre a spec e sobre o comparador, incluindo
  deriva nas **duas** direções (um check exigido no servidor que ninguém pôs na spec é uma regra que
  ninguém revisou).

Medido agora: `✗ main is not protected at all` / `✗ develop is not protected at all`, saída 1.

**`required_status_checks.contexts` começa VAZIO de propósito.** Exigir um check que não passa
converte um gate **ausente** num gate **travado**, e este repositório passou um ciclo inteiro
removendo gates impossíveis por construção. Contextos entram conforme os checks ficam verdes e
*continuam* verdes — a ordem honesta é consertar, observar segurar, e só então exigir.

`workspace` fica deliberadamente fora: é onde o trabalho nasce, e protegê-la quebraria a branch que
as regras mandam todo mundo usar.

**Aplicada em 2026-08-13**, com autorização explícita. E a aplicação revelou um segundo defeito, que
é o achado que vale mais do que o item:

**A primeira aplicação não vinculava ninguém.** Passou, as duas branches voltaram protegidas, e o
comparador imprimiu `✓ main: matches the spec` / `✓ develop: matches the spec`. Só que a spec trazia
`enforce_admins: false` — e num repositório de mantenedor solo o mantenedor **é** o administrador.
A isenção cobria literalmente todo humano capaz de dar push. O gate comprado para tornar o PR
obrigatório o tornava obrigatório para ninguém.

Pior: `diffProtection` **não lia esse campo**. Por isso o `✓`. É exatamente a forma de defeito que
este ciclo perseguiu do começo ao fim — um gate cujo oráculo não mede o que o nome promete — e desta
vez ela estava dentro do gate que eu mesmo tinha acabado de escrever. Um `✓` errado é pior que um
gate ausente, porque convida todo mundo a parar de olhar.

Corrigido por TDD (RED com as duas falhas antes de qualquer edição): `enforce_admins: true` na spec,
comparação do campo no `diffProtection`, e dois casos novos — um sobre a spec, um sobre a deriva ao
vivo. O comparador então **acusou** a isenção que ele antes aprovava, e só depois disso a política
foi reaplicada.

Estado ao vivo, medido: `enforce_admins=true` nas duas, comparador `✓` nas duas. A saída de escape
continua: o admin ainda mergeia PR (zero aprovações, nenhum contexto exigido), ainda empurra tag, e
ainda pode desligar a política em Settings. O que ele não faz mais é `git push origin main` — o que
`git-safety.md` § 1 proíbe em prosa e, até hoje, **só** em prosa.

**Limite honesto do que foi medido.** O que está verificado é a *configuração* (`enforce_admins=true`
nas duas, objeto de proteção presente, comparador `✓`), não o *comportamento* sob um push real.
Tentei `git push --dry-run origin workspace:main` como sonda e ela respondeu que passaria — o que não
é evidência de falha: `--dry-run` não chega ao hook de pre-receive do servidor, que é onde a proteção
age. Ou seja, a sonda não consegue distinguir o caso que ela deveria rastrear, e usá-la como verde
teria reproduzido exatamente o defeito que este item acabou de corrigir.

Não existe teste empírico seguro aqui: o único que provaria o bloqueio é um push direto de verdade, e
o modo de falha dele **é** a coisa proibida. Um teste cujo fracasso comete a violação não é teste. A
confirmação comportamental vem de graça no próximo push que tentar — e fica registrada aqui como
pendente, em vez de assumida.

---

## ~~B-M67-11~~ — RESOLVIDO — O `pnpm audit` só media `--prod`, e a escolha nunca tinha sido feita

**Encontrado em:** ao verificar se o `pg` recém-adicionado trouxe CVE, 2026-08-12

Medido lado a lado no mesmo commit:

| Escopo | Resultado |
|---|---|
| `pnpm audit --prod --audit-level=high` | 6 (2 low, 4 moderate) — **zero high** |
| `pnpm audit --audit-level=high` | 23 (2 low, 5 moderate, **16 high**) |

As 16 são todas de `devDependencies` e nenhuma veio do `pg` — `brace-expansion` ×6, `js-yaml` ×4,
`fast-uri` ×3, `immutable` ×2, `shell-quote` ×1, todas de complexidade algorítmica / DoS dentro de
ferramenta de build.

O número que o CHANGELOG cita (`4 high → zero`) estava **correto como declarado**: ele diz `--prod`.
O problema nunca foi a afirmação — era o escopo jamais ter sido **escolhido**. Um projeto que só
audita produção não sabe o que roda no próprio build, e "não sabe" tinha virado "assume zero".

**Resolução: assimetria explícita.** Produção **bloqueia** (dep de produção viaja para todo consumidor
do framework); dev é **reportado** com o número e o motivo, via `::warning::` que o GitHub renderiza
no PR.

Por que dev não bloqueia, e por que isso não é preguiça: as 16 chegam transitivamente e não têm
correção daqui — dependem de release upstream. Bloquear deixaria o gate **permanentemente vermelho**,
que é exatamente a falha que este ciclo inteiro passou o dia desfazendo. Um gate que ninguém consegue
satisfazer é um gate que ninguém lê, e o próximo achado real chega indistinguível do ruído.

A decisão virou função pura com os dois escopos injetados (`decideAuditOutcome`), com 10 testes —
incluindo o caso que garante que um achado de produção **não é contado duas vezes** como dev, já que
o `pnpm audit` sem `--prod` cobre as duas árvores.

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

---

## ~~B-M67-15~~ — RESOLVIDO — `Dependency review`: impossível de passar **e** redundante

**Encontrado em:** investigação dos vermelhos do #210, 2026-08-12

`actions/dependency-review-action` precisa do dependency graph do GitHub, que em repositório
**privado** exige licença de Advanced Security. Medido: `security_and_analysis: null`. Todo run
terminava em *"Dependency review is not supported on this repository"* — um gate que não passava por
construção, independentemente do diff.

**O que decidiu a remoção não foi ser impossível, foi ser redundante.** As duas verificações dele já
têm equivalente funcionando aqui:

| Verificação do job removido | Equivalente que já existe |
|---|---|
| `fail-on-severity: high` | job `Dependency audit (npm audit, high+)` (`pnpm check:audit`) — **verde** |
| `allow-licenses: MIT, Apache-2.0, …` | job `License compliance` (`scripts/check-licenses.mjs`) — restaurado em B-M67-13, com allowlist **superset** da que o job declarava |

Licenciar GHAS continua sendo opção real, e traria a visão de diff transitivo que nenhum dos dois
substitutos tem. Mas isso é decisão de compra, não de CI — e até que seja tomada, um gate impossível
é pior que gate nenhum: ensina o time a ler vermelho como ruído.

---

## ~~B-M67-17~~ — CORRIGIDO — `bundle-budget.test.ts` falhava só em CI: era resolução de bin, não o build

**Encontrado em:** medição do #212 depois das cinco correções de gate, 2026-08-12 · **Estado:**
instrumentado; causa ainda desconhecida — de propósito, não por desistência.

O `beforeAll` chama `buildTemplateDefaultOnce()`, que roda `pnpm exec theokit build` dentro de
`fixtures/template-default`. Em CI falha; **localmente passa** (2 verdes, medido). Confirmado
**pré-existente**: falhava nos três runs anteriores (`f9a4ce9d`, `58160edd`, `de09e62a`), antes de
qualquer mudança minha.

**O que impedia o diagnóstico.** O helper usava `stdio: 'pipe'` e não capturava nada no erro, então
a falha chegava ao log como `Error: Command failed: pnpm exec theokit build` — e mais nada. Três runs
consecutivos em que a única informação disponível era que tinha falhado.

É o **mesmo defeito de oráculo** do `check-bundle-budget.sh` (B-M67-14) e do `pnpm-11-compat`
(B-M67-08): o gate descarta a explicação e reporta o sintoma. Três instâncias do mesmo padrão em um
dia sugere que é hábito, não coincidência — em cada uma, alguém escolheu `pipe` para manter o log
limpo no caminho feliz e não pensou no caminho infeliz.

**O que foi feito:** o helper passa a re-lançar com `stdout`/`stderr` do build anexados, e com uma
pista quando não há saída nenhuma (o `theokit` bin vem do link de workspace, então `packages/theo`
precisa estar buildado).

**O que NÃO foi feito, e por quê:** adivinhar a causa. Ela não reproduz nesta máquina, e inventar
uma correção plausível para um defeito que não se reproduz é o oposto de consertar.

**A instrumentação funcionou, e a causa apareceu no run seguinte:**

```
Error: `pnpm exec theokit build` failed in /home/runner/work/theokit/theokit/fixtures/template-default.
The build said:
 ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "theokit" not found
```

O bin `theokit` não resolve dentro da fixture no runner — exatamente a hipótese que o próprio
fallback da mensagem nomeava. A fixture **é** membro do workspace (`pnpm-workspace.yaml`) e declara
`theokit: workspace:*`, então localmente o `node_modules/.bin/theokit` existe e o build passa; no CI
não. O prefixo `RECURSIVE_EXEC` sugere que o `pnpm exec` entrou em modo recursivo em vez de resolver
o bin local.

**Hipóteses eliminadas antes de mexer**, cada uma barata:

| Hipótese | Verificação | Resultado |
|---|---|---|
| lockfile fora de sincronia derruba o install inteiro | `pnpm install --frozen-lockfile` local | **em dia** — "Already up to date" |
| versão diferente de pnpm entre local e CI | `packageManager` vs `pnpm --version` | **idêntica** — 9.15.0 nos dois |
| o shim não existe na fixture | `ls node_modules/.bin/theokit` | **existe**, criado pelo install |

Sobrou o que o próprio erro nomeia: a **resolução**. `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` é do modo
recursivo do `pnpm exec` — ele foi procurar o bin em vez de achá-lo onde estava.

**Correção:** invocar a CLI pelo **caminho resolvido** (`packages/theo/dist/cli/index.js`, o mesmo
que o campo `bin` do pacote aponta), com `node`, em vez de pedir ao gerenciador de pacotes que a
encontre. O `pnpm exec` — e o `npx` equivalente no `check-bundle-budget.sh`, corrigido junto — é uma
indireção cujo único trabalho é localizar um binário cujo caminho este repositório já conhece.
Removê-la elimina o modo de falha **por construção**, não por palpite.

A única possibilidade restante (a CLI não estar buildada) virou uma pré-condição explícita com
mensagem acionável, em vez de um `Command not found` que não diz o que fazer.

---

## ~~B-M67-18~~ — RESOLVIDO — Um guarda afirmava sobre arquivo que o `.gitignore` exclui

**Encontrado em:** medição do CI depois de fechar o B-M67-17, 2026-08-12

`tests/unit/cli-env-wiring.test.ts` afirmava que a fixture `zero-config-env` tem um `.env` com
`OPENROUTER_API_KEY`. Esse `.env` é **gitignored** (`.gitignore:24`) — e corretamente, porque um
repositório que começa a commitar `.env` perde o hábito que mantém os reais fora.

Consequência: o guarda passava **nesta máquina**, onde uma execução anterior deixara o arquivo em
disco, e falhava em **todo checkout limpo**, CI incluído. Um guarda que depende de estado não
rastreado não está verificando o repositório — está verificando a máquina.

**O `.gitignore` já dizia qual era a forma pretendida:** a linha 26 carrega a negação
`!.env.example`. O template simplesmente nunca tinha sido escrito. Criado, com valores obviamente
falsos, e o guarda passa a afirmar sobre ele.

Um segundo teste foi junto: o template é o único arquivo desta fixture que é commitado, portanto o
único lugar onde uma credencial real poderia aterrissar em silêncio. Agora todo valor dele precisa
parecer falso.

**Quarta instância do mesmo padrão em um dia** — depois de `postgres-integration` (dependência não
declarada), `License compliance` (script deletado) e `Bundle budget` (fixture inexistente). Todos
verdes localmente por acidente de estado local, vermelhos em CI por meses, e nenhum deles verificando
o que anunciava.

---

## ~~B-M67-19~~ — RESOLVIDO — A matriz de CI testava um Node que o produto recusa

**Encontrado em:** medição do `main` depois do preflight ficar verde, 2026-08-13

O job `Unit + Type tests` rodava em `[20, 22]`. Todo manifest do repositório declara
`engines.node: ">=22.12.0"`, e a CLI não apenas avisa — ela **recusa**:

```
[theokit preflight] theokit requires node >= 22.12.0 (you are running v20.20.2)
```

Ou seja: a perna Node-20 exercitava uma configuração que o produto **explicitamente não suporta**, e
todo teste que invoca a CLI falhava lá por desenho.

**Por que só apareceu agora.** Esses testes morriam mais cedo, no `pnpm exec theokit` que não
resolvia o bin (B-M67-17). Corrigir a resolução deixou a CLI de fato executar, e a camada seguinte —
o piso de engine — ficou visível. É a terceira vez neste ciclo que uma correção faz a falha **mudar
de lugar** e revelar a real; o padrão vale mais que qualquer um dos três casos.

**Removida.** Uma perna vermelha que nunca pode ficar verde é a forma que este ciclo passou o dia
desmontando. Restaurar uma segunda versão exige antes **decidir suportá-la**: baixar o piso em
`engines`, senão a perna é teatro.

**E havia um guarda segurando a decisão velha.** `tests/smoke/ci-workflow.test.ts` afirmava o literal
`[20, 22]` — nono caso do mesmo padrão nesta sessão: congelar o literal em vez da propriedade faz o
guarda sobreviver à decisão que ele registrava. Reescrito para afirmar **coerência**: nenhuma entrada
da matriz pode ficar abaixo do piso que o próprio pacote declara em `engines.node`. Adicionar Node 24
não exige edição nenhuma ali; baixar o piso legitimamente deixa uma versão mais velha voltar
sozinha.

---

## ~~B-M67-20~~ — RESOLVIDO — O `Coverage gate` media um denominador que o run nunca alcançava

**Encontrado em:** 2026-08-13, depois de o último vermelho de teste cair · **Severidade: média** —
não é defeito de gate; é o gate finalmente **medindo**.

Medição limpa, com a suíte inteira verde (**4237 testes passando, zero falhando**):

```
All files          |   61.26 |    54.41 |    58.45 |   62.73 |
ERROR: Coverage for lines      (62.73%) does not meet global threshold (80%)
ERROR: Coverage for functions  (58.45%) does not meet global threshold (80%)
ERROR: Coverage for statements (61.26%) does not meet global threshold (80%)
ERROR: Coverage for branches   (54.41%) does not meet global threshold (75%)
```

**Por que isto é diferente de tudo que este ciclo fechou.** Os outros oito gates reportavam vermelho
sem nunca terem exercido a verificação que anunciavam — dependência não declarada, script deletado,
fixture inexistente, templates apagados por um ADR, Node que o produto recusa. Este está funcionando:
ele mede cobertura, a cobertura está abaixo do limiar, e ele diz isso.

Até hoje era impossível saber, porque ele morria junto com os testes vermelhos.

**O que NÃO fazer, e o motivo.** Baixar o limiar para 62% tornaria o gate verde sem que uma única
linha a mais fosse coberta — exatamente o padrão que este ciclo passou o dia desfazendo, só que pela
mão de quem deveria estar consertando. O limiar de 80% foi uma decisão do projeto; ele não vira
mentira só porque agora incomoda.

**Amostra do que arrasta:** `agents/src/auth` inteiro em 0%, `app.ts` (110-679), `agent-runner.ts`
(218-428), `capabilities.ts`, `a2a-client.ts`, `auth-provider.ts`, `bun.ts`, `cache-signal.ts` — todos
zerados. São arquivos grandes e sem teste algum, não lacunas de ramo.

**CORREÇÃO (mesma sessão, antes de escrever um único teste).** Fui verificar `agents/src/auth`, o
pior caso da lista, e os testes **existem**: `auth-provider.test.ts`, `device-provider.test.ts`,
`auth-parity.test.ts`, `credential-resolver.test.ts`. Eles passam. A cobertura os reporta em 0% assim
mesmo.

A causa é de **medição**, e está nas duas linhas do `vitest.config.ts` da raiz:

| Linha | O que diz | Efeito |
|---|---|---|
| 8 | `include: ['tests/**/*.test.ts', …]` | o run executa **apenas** a suíte da raiz |
| 71 | `coverage.include: ['packages/*/src/**']` | a cobertura conta **todos** os fontes dos pacotes |

São incompatíveis. **216 arquivos de teste** vivem sob `packages/*/tests/**` — agents 133, http 55,
create-theokit 11, presenter 10, theo 7 — e **nenhum** executa nesse run, enquanto os fontes que eles
cobrem entram no denominador.

Ou seja: **62,73% não é a cobertura do código**. É o que a suíte da raiz sozinha alcança de um
denominador que inclui o que ela nunca roda. O número está errado nos dois sentidos — subestima o que
está testado e não diz nada sobre o que não está.

**Ainda é um gate funcionando melhor do que os oito que fechei** (ele mede algo e reporta), mas o que
ele mede não é o que o nome promete.

**Achado colateral, medido:** `packages/{agents,http,presenter}` declaram `vitest@^3.2.6` enquanto a
raiz usa `^4.1.9`. Rodar cobertura na suíte de um pacote quebra com
`TypeError: Cannot read properties of undefined (reading 'reportsDirectory')` — o provider 4.x contra
o runner 3.x. Qualquer unificação de medição esbarra nisso primeiro.

**Passo 1 FEITO: o descompasso de versão, que era o bloqueio da opção correta.**

Eu havia classificado a escolha como "decisão de projeto". Estava errado — a opção correta (unificar
o run) estava bloqueada por um obstáculo **técnico** que eu podia remover, e chamar isso de decisão
era adiar trabalho meu.

`packages/{presenter,agents,http}` subiram de `vitest@^3.2.6` para `^4.1.9`. Medido pacote a pacote,
do menor para o maior, antes de comprometer:

| Pacote | Antes | Depois |
|---|---|---|
| presenter | 95 verdes | **95 verdes, zero mudanças** |
| agents | 954 verdes | **955 verdes**, após 1 correção |
| http | 406 verdes | **411 verdes**, após 1 correção |

**Custo real da migração: dois defeitos, e os dois eram reais — o vitest 3 os mascarava.**

1. `scripts-are-importable.test.ts` estourava 5 s importando `lint-by-group.mjs` (que puxa o eslint):
   9,5 s medidos. Mesma classe do flake do `subpath-coverage` — o custo é de **import**, não de
   asserção, e o timeout deve guardar a asserção. Orçamento próprio de 30 s, com a razão escrita.
2. `swc-loader.test.ts` quebrava com `Cannot find package '@theokit/http'`. A causa:
   **`fixtures/decorator-fullstack` não tinha `package.json`** — estava no `pnpm-workspace.yaml`, mas
   o pnpm ignora diretório sem manifest, então nada linkava o que o fixture consome. O vitest 3
   escondia pelo resolver do Vite; o 4 usa o runner nativo para um `.mjs` emitido. Mesma classe do
   `pg` não declarado: **um consumidor que não declara sua dependência só funciona onde outra coisa
   por acaso a fornece.** (B-M67-21)

Mais um ajuste de tipo: o vitest 4 tipa `vi.fn()` como `Mock<Procedure | Constructable>`, que não é
chamável sem assinatura explícita.

Estado: **4236 testes verdes na raiz, zero falhando, typecheck limpo.**

**Passo 2 FEITO: o numerador alcançou o denominador.** `vitest.config.ts` passa a declarar
`projects`, agregando a suíte da raiz e as dos três pacotes numa execução só.

| | Antes | Depois |
|---|---|---|
| Testes executados | 4 236 | **5 697** |
| Linhas | 62,73% | **84,96%** |
| Ramos | 54,41% | **76,08%** |
| Funções | 58,45% | **82,17%** |
| Gate | vermelho | **exit 0** |

**Nenhum teste novo foi escrito.** Os 1 461 que faltavam já existiam — só não rodavam no run que
media a cobertura. E o número real está **acima** dos limiares de 80%/75% que o projeto tinha
escolhido: o limiar nunca esteve errado, a medição estava.

`agents/src/auth`, o "0%" que quase me fez escrever testes redundantes, aparece agora em **62,96%**.

**Residual honesto, para vigiar no CI:**

- O run ficou ~35% mais longo (5 715 testes). Ele estoura o limite de 590 s por comando desta
  sessão — não é falha, é duração.
- Numa execução local, o `r3a-emitted-bundle-node-free.test.ts` falhou lendo `packages/theo/dist`.
  Passa isolado, e havia um `pnpm lint` meu rodando concorrente naquele momento, tocando os mesmos
  artefatos.

  **Encerrado com evidência, não com suposição.** O CI rodou a suíte unificada em `main` e saiu
  **verde, com zero jobs falhando** — a mesma paralelização entre projetos, num ambiente onde nada
  meu competia pelos artefatos. Isso não prova que a corrida é impossível; prova que a falha local
  tinha uma explicação mais simples e disponível: eu mesmo, mexendo no `dist` enquanto os testes o
  liam.

  Fica registrado para quem vier: se aparecer intermitência neste arquivo, o primeiro candidato é
  algo reconstruindo `packages/theo/dist` durante o run, não o teste.

