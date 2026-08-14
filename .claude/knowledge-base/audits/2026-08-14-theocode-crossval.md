---
type: audit
date: 2026-08-14
subject: TheoKit ↔ TheoCode cross-validation
promoted_from: cross-validation-output/final_report.md
---

> **Provenance.** Promoted verbatim out of `cross-validation-output/`, which `.gitignore:21` keeps
> local. Without this copy every citation the `crossval-absorption-gaps` plan makes to the report
> would be unresolvable in a fresh clone — the fabricated-citation failure this ecosystem's golden
> rules cap at INVALID. The raw evidence (SQLite DB, per-agent architecture maps, 89 reference-file
> records) stays local by design; this is the consolidated finding.

# Cross-validation TheoKit ↔ TheoCode

**Data:** 2026-08-14
**Alvo:** TheoKit — `/home/paulo/Projetos/theo/theokit-framework/theokit` (1.547 arquivos em escopo, 182.046 LOC)
**Referência:** TheoCode — `/home/paulo/Projetos/theo/usetheo-labs/TheoCode` (286 arquivos, 32.942 LOC)
**Método:** 6 fases, 6 sub-agentes, banco SQLite como fonte da verdade
**Evidência:** 87 componentes · 15 dimensões · 27 comparações · 12 lacunas · 58 achados · 89 arquivos de referência citados
**Média ponderada: 3,11/5**

---

## 1. Sumário executivo

### A pergunta

> Se um cliente construir um "EmpresaCode" com todas as capacidades do TheoCode, o que ele teria que reconstruir do zero que já deveria estar no TheoKit?

O TheoCode não é um análogo hipotético: ele **depende de `@theokit/agents ^8.6.0`** — o pacote deste repositório — e de `@theokit/sdk ^4.49.0`. É o melhor proxy existente do cliente da pergunta, com a vantagem de que cada linha que ele escreveu é evidência medível de uma capacidade que o framework não entregou de forma utilizável.

### A resposta, em uma frase

O framework **absorve bem quando é acionado, e quase nunca é acionado** — e quando absorve, o resultado frequentemente não chega ao consumidor, ou chega numa forma que o caso de uso original não consegue usar.

### As três categorias que emergiram

O desenho inicial supunha uma divisão binária: ou a capacidade existe, ou falta. A medição produziu **três** categorias, e a do meio e a terceira são as caras:

| Categoria | O que é | Custo para o cliente |
|---|---|---|
| **Ausente** | Nunca foi construído | Ele reconstrói — o custo esperado |
| **Presente mas inalcançável** | Existe, atrás de porta interna ou depreciada | Ele procura, encontra um aviso de remoção, reconstrói mesmo assim — e paga a busca |
| **Absorvido com o formato errado** | Foi construído *e publicado*, e o caso que o originou não consegue consumir | Custo dobrado: o framework gastou para construir, o cliente gasta para reconstruir |

### Top 3 lacunas

**1. O gate que impediria tudo isso existe — e cobre 1 de 19 subpaths** (G7, crítica)
`scripts/check-auth-parity.mjs` implementa a regra certa: todo símbolo que o SDK expõe precisa de uma **decisão escrita** no layer `@theokit/agents` (`covered`, `re-exported`, ou fora-com-motivo); símbolo novo sem decisão quebra o CI. O cabeçalho do script narra por que nasceu (`:9-13`): quando `@theokit/agents/auth` exportava 1 valor contra 19 do SDK, *"reimplementar era a única saída legal"* — e custou ~120 linhas de mecânica de credencial duplicada. O `DECISIONS` tem **uma única chave: `auth`**. Toda lacuna que este loop mediu em `session`, `tools`, `hooks`, `ask` e `sandbox` é um caso que esse gate teria detectado antes de virar código no cliente.

**2. Capacidades essenciais só têm porta atrás de um barrel que anuncia a própria remoção** (G8, crítica)
`LayeredConfig`, `TrustStore`, `loadInstructionTree`, `composeInstructions`, `loadCustomCommands`, `contextPressure`, `loadEnv` são alcançáveis **somente** via `theokit/server`, que emite aviso de `DEPRECATED` na primeira importação e diz sobreviver por um ciclo minor (`packages/theo/src/server/index.ts:1-15`). Não existe subpath `theokit/config`. Pior: estão no pacote `theokit`, que nenhum package do consumidor de agentes sequer instala.

**O dano já se materializou.** O TheoCode reescreveu 533 LOC de árvore de instruções e, ao fazê-lo, **reintroduziu a falha de contenção de symlink** que o `assertNoSymlinkEscape` do framework existe para fechar: com `rootDir='/'`, qualquer arquivo da máquina virava legível para dentro do system prompt (`packages/agent/src/context/agents-md.ts:121-125`, registrado como B-042). Um consumidor com o mesmo mantenedor, registro formal de lacunas upstream e 487 casos de teste reconstruiu uma primitiva e reintroduziu a vulnerabilidade que ela existia para prevenir.

**3. O pacote publicado não tem por onde comunicar nada** (G9, crítica)
O tarball de `@theokit/agents` entrega **apenas `dist/`, `LICENSE` e `package.json`** — sem README, sem CHANGELOG. `@theokit/presenter` não leva nem README nem LICENSE. O `CHANGELOG.md` da raiz tem **8.1.0** como último cabeçalho de versão, com 8.2.0 a 8.6.0 encalhadas em `[Unreleased]` — uma entrada ainda chama a 8.6.0 de não publicada. `grep -c "U-[0-9]"` retorna **0**. As notas estão em pt-BR contra um consumidor com gate de lint *english-only*. O `packages/agents/CHANGELOG.md` está correto e não é enviado no tarball.

Resultado medido: **cinco absorções reais e verificadas** (U-1, U-3, U-4, U-6 e o M79 `resolveCredential`) e o `BACKLOG.md` do consumidor continua listando quatro delas como abertas (`:429-438`), com três reimplementações vivas no código.

---

## 2. Placar

Cada score responde **"o framework entrega esta capacidade a ponto de o cliente não a reconstruir?"** — não "quem escreve código melhor".
`0` ausente · `1` só ingredientes · `2` parcial ou atrás de porta interna/depreciada · `3` metade difícil entregue · `4` entregue com lacunas pequenas · `5` entregue e descobrível.

| # | Dimensão | Score | Peso | Barra |
|---|---|---:|---:|---|
| 15 | Discoverability & Migration Signal | **1,5** | 2,0 | `██████░░░░░░░░░░░░░░` |
| 4 | Permissions, Approval & Sandboxing | **2,33** | 2,0 | `█████████░░░░░░░░░░░` |
| 8 | Delegation & Subagents | **2,5** | 1,3 | `██████████░░░░░░░░░░` |
| 14 | Testing Support & Fixtures | **2,5** | 1,5 | `██████████░░░░░░░░░░` |
| 3 | Session Persistence, Fork & GC | **2,67** | 2,0 | `███████████░░░░░░░░░` |
| 7 | Agent Runtime Composition | **2,75** | 1,8 | `███████████░░░░░░░░░` |
| 9 | Interactive Shell & PTY | **3,0** | 1,3 | `████████████░░░░░░░░` |
| 1 | Auth & Credential Resolution | **3,17** | 2,0 | `█████████████░░░░░░░` |
| 5 | Config Layering & Trust | **3,5** | 1,8 | `██████████████░░░░░░` |
| 11 | Terminal Surface (TUI) Primitives | **3,5** | 1,5 | `██████████████░░░░░░` |
| 13 | Error Model | **3,5** | 1,8 | `██████████████░░░░░░` |
| 6 | Hooks & Extensibility | **3,75** | 1,5 | `███████████████░░░░░` |
| 2 | Tool Registry & Scoping | **4,0** | 2,0 | `████████████████░░░░` |
| 12 | Headless / Wire Protocol | **4,0** | 1,3 | `████████████████░░░░` |
| 10 | Human-in-the-loop / Ask Bridge | **4,5** | 1,5 | `██████████████████░░` |

**As duas piores têm peso máximo**, e não é acaso: são as que decidem se o investimento nas outras treze chega ao cliente.

**As três melhores compartilham uma propriedade** — em todas, o framework absorveu a partir deste mesmo consumidor. O docstring do `Toolset` cita `agents/tools/registry.ts` pelo nome como a razão da primitiva existir. **O ciclo de absorção funciona quando é acionado.**

---

## 3. Lacunas priorizadas

### Críticas

| ID | Lacuna | Evidência (referência) | Onde no alvo |
|---|---|---|---|
| G7 | Gate anti-reconstrução cobre 1/19 subpaths | `packages/agent/src/auth/credentials.ts:8` | `scripts/check-auth-parity.mjs` |
| G8 | Config/contexto/comandos atrás de barrel com aviso de remoção | `packages/agent/src/context/agents-md.ts:121` | `packages/theo/src/server/index.ts` |
| G9 | Tarball sem README nem CHANGELOG | `BACKLOG.md:429` | `packages/agents/package.json` |
| G1 | `forkBeforeUserTurn` publicado quebrado | `packages/agent/src/session/backtrack.ts` | `packages/agents/src/session/` |
| G2 | Nenhuma regra de permissão persistida | `packages/agent/src/hooks/hook-trust.ts:24` | `packages/theo/src/server/agent/approval-registry.ts` |
| G3 | Membro delegado não herda veto de hooks do pai | `packages/agent/src/delegation/hooks-for-member.ts:7` | `packages/agents/src/` |

**G1 — `forkBeforeUserTurn` publicado com a assinatura e sem a capacidade.** A implementação conta `record.role === 'user'` e `SessionRecord` não tem campo `role` (tem `type` + `message.content`). Não há caminho em que a contagem seja diferente de zero: **sempre lança** `"fewer than N user turns"`. Sem teste, sem chamador. É pior que ausente — a assinatura correta faz o cliente acreditar que o erro é dele, e ele gasta depuração antes de concluir que precisa reconstruir. O consumidor construiu `backtrack.ts` (175 LOC) + teste (75) + `tui/backtrack/` (335 LOC).

**G2 — Nenhuma regra de permissão persistida.** Verificado por grep em `packages/agents/src` e `packages/theo/src`: `alwaysAllow|allowRule|permissionRule|rememberDecision|always_allow` retorna **zero**. `ApprovalDecision` resolve *uma* requisição; nada persiste concessão permanente. Não existe "sempre permita `npm test`" — o usuário aprova a décima vez a mesma coisa, ou desliga tudo com `full-auto`. Nem o framework nem o consumidor têm isso **para tools** (o consumidor tem, só para hooks). É a única lacuna do loop que é absorção genuína e não migração.

**G3 — Herança de autoridade em delegação.** Grep limpo: não existe herança de hooks pelo membro delegado. O consumidor fecha com **16 linhas** que propagam o veto `pre_tool_call` do pai para o membro do esquadrão. Sem elas, um subagente executa ferramenta que o pai vetou — e o comportamento *parece* correto, então nenhum teste do cliente apontaria.

### Altas

**G6 — `resolveCredential` cobre só a metade env-only.** O M79 publicou a função e o argumento certo (o docstring em `dist/auth.d.ts:182-185` diz que *"a moldura app policy defende **quais** providers existem; não defende a cadeia de precedência, a checagem de consistência prefixo↔provider, nem o registro de proveniência: isso é **mecanismo**"*). Mas medido função a função **não é superset**. Nove mecanismos ficam com o cliente: leitura do arquivo `auth.json`; credencial `kind:'oauth'` com `expiresAt` (**variante morta** — o tipo publicado a declara e nenhum caminho de código a produz); coerência prefixo-da-chave↔provider; inferência de provider pelo prefixo da chave; `MissingCredentialError` com a lista ordenada de tentativas; override explícito com recusa a fallback; refresh com timeout e tolerância a transiente; roteamento por prefixo de modelo; validação Zod do arquivo. Além disso o parser de `.env` do framework é **estritamente mais fraco** (não trata valor multilinha entre aspas), então a proveniência atribui errado.

**G5 — O GC publicado resolve um problema menor que o real.** É real, testado (267 LOC), ligado ao CLI, com 4 invariantes — e em um ponto é **melhor** que o do consumidor (recusa piso tanto em `keepLast` quanto em `maxAgeDays`; o consumidor só põe piso em `maxAgeDays`). Mas coleta apenas os `.jsonl` de **um** projeto. Não cobre: proteção por registry, deleção no registry (só `rmSync`, deixando entradas órfãs), `.lock` órfãos, varredura de `.tmp`, modo todos-os-projetos, oráculo de liveness com orçamento de DFS, recuperação de diretório vazio, e `errors[]` na fase de plano (um diretório ilegível reporta "nada a coletar"). **Medido: 20-25% das ~857 LOC do consumidor são deletáveis hoje**; `all-sessions.ts` + `filesystem.ts` + `liveness-oracle.ts` (~834 LOC) resolvem outro problema.

**G4 — Gate de fingerprint sem produtor.** O framework **tem** o gate sha256 por hook (`hook-fingerprint.ts:5-19`), com `approved` obrigatório e deny-by-default, pelo mesmo argumento do consumidor. Falta o **store**: nada no framework persiste aprovações, então o parâmetro obrigatório não tem quem o produza. Um hook é `spawn(cmd,{shell:true,detached:true})` a cada tool call.

**G10 — Nenhum índice por capacidade.** O `wiki/` indexa por tópico, nunca por capacidade; `wiki/migration/` tem um arquivo sem entrada 7.x→8.x. Existem codemods para majors do SDK e nenhum para estas absorções. A tabela de irmãos do `CLAUDE.md` lista 5 repositórios contra **11 reais** e ~40 pacotes publicados.

### Médias

**G11** — `./testing` entrega 4 seams em 136 linhas com **zero adoção** nos 72 arquivos de teste do consumidor. O caso é diagnóstico: `inspectCompiled` foi construído a partir de uma pergunta que o consumidor declarou, e tipado sobre `AgentDefinition`, que **não é** o que as rotinas de composição dele retornam — `composition.test.ts:1-19` documenta a recusa e `:141-317` re-deriva os mesmos fatos à mão.

**G12** — Reverificação contra `@theokit/tui@0.52.1`: **U-7 fechada** (`WelcomeBannerProps.art` existe ao lado de `aside`), **U-10 meio fechada** (`hiddenBefore`/`hiddenAfter` viraram numéricos; o índice absoluto de `readJsonlTail` segue intocado), **U-8 e U-9 abertas**. E `@theokit/agents/commands` entrega `defineCommand`/`routeCommand` com casamento por prefixo mais longo — o consumidor importa esse subpath **9 vezes** e usa apenas a metade de shutdown.

---

## 4. Os dois arquivos que motivaram a análise

### `packages/agent/src/auth/credentials.ts` (390 LOC)

**A intuição estava certa no diagnóstico e desatualizada no fato — mas menos do que pareceu à primeira vista.**

O arquivo já é um wrapper: `:8-16` importa `authFilePath`, `AuthProvider`, `CredentialError`, `credentialHome`, `readAuthFile`, `writeCredential` de `@theokit/agents/auth`. O motor OAuth/device-flow é entregue de verdade (score 4,5) e o `login.ts` do consumidor é cola fina legítima.

O que o framework **também já publicou** foi o `resolveCredential` (M79) — e o docstring dele faz exatamente o argumento desta análise. Mas ele cobre a metade env-only; os nove deltas de G6 continuam do lado do cliente, três deles sendo defeitos e não escolhas.

**Veredito: não é candidato a absorção — é candidato a *completar uma absorção parcial*.** Deletar `credentials.ts` hoje quebraria o produto.

### `packages/agent/src/tools/registry.ts` (151 LOC)

**Aqui o ciclo já se fechou, e está documentado.** O docstring do `Toolset` no SDK cita este arquivo pelo nome — *"`agents/tools/registry.ts` from agent-builder, 170 LoC"* — como a razão da primitiva existir. Ele caiu de 170 para 151 LOC.

O resíduo é fino e em boa parte **irredutível**:
- `ToolScope` com `sandbox` **obrigatório** (`:19-31`) — verificado: `bindToolScope` do framework também exige (`tools/tool-scope.ts:127`), então B-006 é inalcançável pelo binder, e o consumidor fixa isso com `@ts-expect-error` no teste. Buraco residual: `@theokit/agents/tools` ainda re-exporta `createShellTool` cru, onde o SDK mantém `sandbox` opcional.
- A assertiva nome-registrado ↔ `tool.name` (`:129-136`) **não pode** subir: `Toolset.from` indexa *por* `tool.name`.
- `translateError` (`:59-68`) é **código morto** desde a 8.0 — `ToolsetError extends TheokitAgentError` (`dist/index.d.ts:969`), e o próprio comentário do consumidor manda apagá-lo no próximo bump.

**Veredito: nada a absorver. Há uma linha a deletar no consumidor e um re-export a tapar no framework.**

---

## 5. Roadmap

Ordenado por **razão impacto/custo**, não por severidade.

| # | Ação | Custo | Por quê primeiro |
|---|---|---|---|
| 1 | Incluir README + CHANGELOG no `files` do tarball; migrar 8.2.0–8.6.0 de `[Unreleased]`; notas de absorção em inglês | horas | Destrava todas as outras. Absorver sem canal é gastar duas vezes. |
| 2 | Corrigir `forkBeforeUserTurn` (contagem sobre `type`+`message.content`) + teste | 1 linha + 1 teste | Primitiva publicada quebrada; menor custo do loop |
| 3 | Herança de hooks como default de `delegate()` | ~16 linhas | Fecha um furo de autoridade silencioso |
| 4 | Índice por capacidade: capacidade → símbolo → versão em que chegou | 1 página | O artefato que teria evitado as três reimplementações vivas |
| 5 | Promover config/contexto/comandos a subpath estável em `@theokit/agents` | dias | Tem dano materializado (B-042); precisa acontecer **antes** do minor que remove o barrel |
| 6 | Generalizar o gate de paridade para os 19 subpaths | dias | **A única ação estrutural.** Não adiciona capacidade — torna detectável toda capacidade não encaminhada |
| 7 | Completar o M79: matar/implementar a variante `oauth` morta, coerência prefixo↔provider, erro tipado com tentativas, leitura de arquivo | dias | Os dois primeiros são corretude, não ergonomia |
| 8 | Publicar o store de aprovação junto do gate de fingerprint | dias | Gate sem produtor é meia capacidade |
| 9 | `PermissionStore` com concessões persistidas por (tool, escopo, assinatura) | semanas | Absorção genuína; ninguém tem |
| 10 | Tornar `protectedTranscripts` injetável; decidir se GC multi-projeto entra ou fica fora de escopo | semanas | Hoje a proteção por ponteiro é inerte, silenciosamente, dentro de um guarda de deleção |

**Os itens 1 a 4 custam menos de uma semana somados e endereçam três lacunas críticas.**

---

## 6. Onde o alvo é superior

Registrado com o mesmo rigor, porque um relatório que só acusa não é medição.

- **Modelo de erro — correção de uma alegação herdada.** O `BACKLOG.md` do consumidor afirma (U-11) que 10 de 13 classes do framework estendem `Error` puro. **Superado.** Re-medido em 2026-08-14 excluindo testes: target **20 de 21 tipadas (95%)**, só `RefreshFailure` de fora; consumidor **12 de 14 (86%)**. A correção foi aplicada ao padrão, não a uma classe. O que ainda se sustenta é a disciplina de `throw` nu: 23,2% no target contra 8,2% no consumidor — e vários dos nus estão em fronteira de I/O, onde erro tipado mais importa.
- **Disciplina de teste.** 788 arquivos de teste e um `check:all` de 9 gates, contra 72 do consumidor — que tinha **zero** na medição de 2026-08-07, sobre 12.626 LOC.
- **`createAskBridge` não carrega a forma do defeito TIP-03.** Captura `resolve` *e* `reject`; `abandon` chama `entry.fail(...)` e a promise sempre resolve; pergunta em thread sem ouvinte é rejeitada de imediato em vez de pendurar até o timeout de 5 minutos.
- **`createPendingLedger` é melhor que o ledger do consumidor** — `settle` retorna boolean, que é a guarda de duplo-envio que o consumidor deixou para o chamador.
- **O piso de retenção do GC é mais rigoroso** — recusa em `keepLast` *e* `maxAgeDays`; o consumidor só põe piso em `maxAgeDays`.
- **`ApprovalPosture` com `confinedBy: SandboxPosture` obrigatório** — a regra que o consumidor escreveu duas vezes agora tem um dono só.
- **O corte mecanismo/política no headless está correto e documentado nos dois lados**, incluindo a recusa **escrita** de fazer parsing de argv (`packages/agents/src/commands/index.ts:14-15`) — o consumidor de fato usa `node:util parseArgs`.

---

## 7. O que NÃO foi analisado

- **Nada foi executado.** Não rodei o build, os testes nem o agente de nenhum dos lados. Todo achado é por leitura de código e de superfície publicada. Achados de runtime (o `forkBeforeUserTurn` que sempre lança, o PTY que sobrevive ao aperto de sandbox) são provados por caminho de código, não por reprodução.
- **Cobertura de inspeção: 93 de 286 arquivos da referência (33%) e 58 de 1.547 do alvo (3,7%).** O pedido era revisão arquivo por arquivo do reference; o que se atingiu foi **cobertura integral dos módulos que as 15 dimensões endereçam**, não dos 286 arquivos. Ficaram sem leitura direta: a maior parte de `tui/components`, `tui/formatting`, `cli/commands` e os testes do consumidor. O baixo percentual do alvo é esperado (ele é 5× maior e só as superfícies de agente estavam em escopo), mas significa que **não posso afirmar ausência sobre o que não foi buscado** — as ausências relatadas citam a busca que as estabeleceu.
- **Um consumidor só, e de um tipo só.** O TheoCode é um agente de terminal. Um EmpresaCode web-first pesaria as dimensões de outra forma: TUI cairia, HTTP/aprovações/multi-processo subiriam — e justamente aí está a lacuna do `approval-registry` in-memory single-process, que este loop classificou como média e para um produto web seria crítica.
- **Divergência `dist` vs fonte não foi resolvida em 4 dimensões** (achado F32). Onde `.d.ts` publicado e código-fonte do repo discordam, relatei os dois; onde não verifiquei os dois, está declarado.
- **O repo `theokit-tui` não teve o código-fonte inspecionado** — só a superfície publicada `@theokit/tui@0.52.1`. A lacuna G12 aponta para lá como `target_location` sem essa leitura.
- **Duas perguntas ficaram sem resposta e estão registradas como tal** (F18, F54): se o consumidor *sabe* que `resolveCredential` e `createPendingLedger` existem — o que decide se o problema é de produto ou de comunicação — e se o roteador de comandos dele é migrável para `routeCommand` sem quebra. Nenhuma das duas se responde só pelo código.
- **As estimativas de LOC substituível (20-25% no GC) são julgamento de analista, não migração executada.**

---

## Anexos

- `baseline/reference/architecture_map.md` — 22 módulos do TheoCode classificados como infraestrutura genérica, com o motivo de cada um
- `baseline/target/architecture_map.md` — 11 ausências do TheoKit, cada uma com a busca que a estabeleceu
- `scoring/dimension_scores.md` — placar com a validação cruzada e o ajuste da dimensão 8
- `cross-validation.db` — 87 componentes, 27 comparações, 12 lacunas, 58 achados, 89 arquivos de referência
