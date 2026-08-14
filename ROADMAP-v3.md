# ROADMAP v3 — absorver o que o consumidor ainda reconstrói

> **Terceira geração.** O `ROADMAP.md` (v1, M0–M56) e o `ROADMAP-v2.md` (M57–M63, M66) estão completos.
> Esta iniciativa nasce de uma medição, não de uma intuição: a cross-validation de 2026-08-12 entre o
> TheoKit e o **TheoCode** — um produto real, em produção, construído sobre `@theokit/agents ^7.5.0`
> com 71 sites de import — inventariou linha a linha **o que o TheoCode ainda teve que escrever
> sozinho**. Numeração **global e contínua** (M67…M86) para que run-files e traceability permaneçam
> únicos entre v1, v2 e v3. O flip de checkbox usa `--roadmap ROADMAP-v3.md`.
>
> Evidência: `cross-validation-output/final_report.md`, `baseline/{target,reference}/architecture_map.md`,
> `structure/structural_comparison.md` e o banco `cross-validation-output/cross-validation.db`
> (16 dimensões pontuadas, 25 findings, cada um com `file:line` nos dois repositórios).

## Vision

A pergunta que originou a iniciativa: **se um cliente construir o "EmpresaCode" dele — um produto de
agente com todas as capacidades do TheoCode — sobre TheoKit + `@theokit/sdk` + `@theokit/ui` +
`theokit-plugins`, o que ele será obrigado a reconstruir?**

A resposta medida: **≈ 6.900 LOC de mecanismo sem nenhuma política de produto dentro**. Motor de hooks,
GC de transcript, ciclo de vida de sessão, engine de config em camadas, canal de pergunta ao humano,
fila de aprovação, árvore de instruções, roteador de comandos, doctor. Nada disso é específico do
TheoCode; tudo isso é infraestrutura que o próximo consumidor vai reescrever — e, como os comentários
in-file do TheoCode documentam, vai reintroduzir os mesmos bugs no caminho.

A v3 move essa massa para dentro do framework, mantendo a linha que já está desenhada: **o SDK executa,
o TheoKit é a casa**. Nenhum milestone aqui reimplementa runtime; todos absorvem *mecanismo* e deixam
*vocabulário* no produto.

## In scope (V1 desta iniciativa)

- **must-have:** todo item da tabela §4.2 do mapa de referência cuja coluna "quão pouco é específico do
  produto" diz *mecanismo* vira primitiva do framework, com o produto reduzido a um adaptador fino.
- **Fechar a fronteira em camadas** — nenhum consumidor deveria precisar declarar `@theokit/sdk` como
  dependência direta para alcançar `foldLayers` / `resolveTrustPosture` / `recordWiring`.
- **Fechar a assimetria de segurança** do `settingSources(['project'])` antes de qualquer coisa
  cosmética: hoje é execução de comando arbitrário do repositório sob um threat model que não vale para
  agentes de código.
- **Provar cada absorção pelo mesmo teste de aceitação:** a primitiva absorve um *invariante* que o
  produto segurava na mão, deixa o *vocabulário* no produto, e reduz o arquivo do produto a um
  adaptador que nomeia a versão em que migrou. É exatamente a forma que fez `foldTurnLifecycle`,
  `routeThroughLayers`, `Toolset` e `ApprovalPosture` funcionarem.

### Explicitly out of scope

- **Possuir transcript store, provider client ou tool-dispatch loop.** A regra G2 (`sdk-runtime.md`)
  continua intacta e é grep-gated no CI. A v3 absorve o **ciclo de vida acima do store**, não o store.
  Possuir o store e possuir o vocabulário de ciclo de vida são coisas separáveis — a v3 só faz a segunda.
- **Um segundo runtime de agente.** ADR-0031 (v1) preservado.
- **Implementações concretas de provider OAuth** (Google, GitHub…). O lock AUTH-DELEGATION de
  2026-05-19 continua valendo; a v3 mexe apenas em *resolução* de credencial, não em providers.
- **Um pacote TUI próprio dentro deste repo.** O `@theokit/ui` / `@theokit/tui` é o dono da chrome e dos
  widgets. M83 absorve o *mecanismo* de superfície terminal (roteador de comandos, coalescing, watchdog)
  e explicita para onde cada peça vai — não abre um app Ink aqui.
- **Reescrever o dialeto de eventos do TheoCode.** O vocabulário Codex-compatível é política de produto
  por ADR 0007 do próprio TheoCode e permanece lá.

## Constraints

| Categoria | Constraint |
|---|---|
| Stack | TypeScript, Node ≥ 22.12, pnpm workspace, zod. `@theokit/sdk` continua o único runtime. |
| Direção | `SDK → @theokit/agents → theokit → app`. Nenhum milestone inverte a direção nem adiciona ciclo. |
| Parcimônia | Absorver só mecanismo. Se a peça carrega vocabulário do produto, absorver a *forma* e deixar os *nomes* fora (Rung 9 + `parsimony-ladder.md`). |
| Prova | Toda absorção precisa de um consumidor real no repo (G7/knip) **e** de uma deleção correspondente no TheoCode registrada em M86. |
| Segurança | Nenhum milestone pode ampliar a superfície de execução de comando sem um gate de confiança explícito. M68 vem antes de M75 por isso. |

## North-star

Ao fim de M85, um `EmpresaCode` com paridade funcional ao TheoCode escreve **apenas política**: quais
tools, quais comandos, qual persona, qual dialeto de evento, quais checks de doctor. A medida é
mecânica — o TheoCode em M86 deleta **≥ 4.500 LOC** e passa a declarar **uma** dependência `@theokit/*`
de runtime, não duas:

```
# em usetheo-labs/TheoCode
grep -rn "from '@theokit/sdk" packages/*/src --include='*.ts' | grep -v node_modules   # → 0
```

---

### M67 — [x] Fechar a fronteira em camadas: pass-through da família config/trust/wiring

**Objective:** `packages/agents/src/index.ts:53-58` declara a doutrina — "o consumidor importa as
primitivas core do SDK a partir de `@theokit/agents`, nunca de `@theokit/sdk`" — e o M63 chamou isso de
"fronteira fechada". A porta omite uma família inteira: `foldLayers`, `verifyLayerOrdering`,
`applySecurityFloor`, `resolveTrustPosture`, `auditEnvReachability`, `recordWiring`, `WiredEntity`,
`ToolResultContentBlock`. Grep no target retorna zero para todas. A omissão sobreviveu porque o gate de
paridade (`tests/unit/subpath-coverage.test.ts`) exige veredito in/out para os **28 subpaths** do SDK, e
essas primitivas vivem na **barra root**, que nenhum gate enumera. Custo de correção: re-export puro.

**Definition of done:**
- [ ] As 8 símbolos acima re-exportados de `packages/agents/src/index.ts` (ou de um `/config` entry no mesmo formato dos `*-entry.ts` existentes), sem wrapper.
- [ ] `tests/unit/subpath-coverage.test.ts` ganha uma tabela de veredito **ROOT-BAR** com a mesma disciplina in (verificado) / out (com motivo > 20 chars) já aplicada aos subpaths — de modo que a próxima omissão de barra root falhe o teste.
- [ ] `pnpm test` / `typecheck` / `lint --max-warnings=0` / `knip` verdes; entrada no CHANGELOG.

> **Correção medida (2026-08-12, DISCOVER do M67).** O parágrafo acima dizia "custo de correção:
> re-export puro". **Estava errado.** Sete dos oito símbolos **não existiam** no `@theokit/sdk@4.40.0`
> que consumíamos; o re-export era inexpressável. Medido por download e `grep` no `dist/` de cada
> tarball publicado: 4.40.0 → 0/7, 4.45.0 → 1/7, 4.46.0 → 3/7, 4.47.0 → 4/7, 4.48.0 → 6/7,
> **4.49.0 → 7/7**. O milestone passou a ter duas metades — elevar o piso da dependência, e só então
> re-exportar — e absorveu o trabalho que os gates de paridade geraram ao reagir aos símbolos novos.
> A fronteira não estava mal desenhada: para nós era **intransponível**. Ver ADR 0060 e
> `.claude/knowledge-base/discoveries/blueprints/m67-layered-boundary-passthrough-blueprint.md`.

**Efeito no TheoCode:** deleta os **6 sites de import direto de `@theokit/sdk`** (`config/layers.ts:10`,
`config/config.ts:1`, `config/trust-posture.ts:8-11`, `config/security-floor.ts:22`,
`wired-capabilities.ts:22`, `tools/view-image.ts:15`) e remove `@theokit/sdk` do
`packages/agent/package.json`. O consumidor quebrou a própria regra de fronteira 6 vezes em vez de
reimplementar — é o sinal mais forte de que as primitivas são desejadas e a porta é que falta.

**Dependencies:** nenhuma.

**Top risks:**
1. Re-export cego arrasta símbolo que o SDK ainda vai mover. Mitigação: enumeração explícita (nunca `export *` sem lista) + o gate root-bar prova o que entrou.
2. Duas funções homônimas divergentes no SDK (o motivo declarado para reter `resolveCredential`). Mitigação: cada símbolo entra com um teste que fixa a assinatura; homônimos ficam de fora com motivo escrito, e viram trabalho do M79.

---

### M68 — [x] `settingSources(['project'])`: exigir evidência de confiança antes de carregar hook do repositório

**Objective:** A JSDoc de `packages/agents/src/bridge/define-agent.ts:79-81` justifica o risco: "habilitar
`project` habilita hooks que executam shell a partir de `.theokit/hooks.json` — é opt-in porque
`.theokit/` é o repo do próprio app (consentimento informado)". Isso vale para um app web cujo cwd é o
próprio deploy. **Não vale** para a classe de produto que o framework endereça — um agente cujo cwd é um
repositório arbitrário que o usuário acabou de clonar. Ali "o repo do próprio app" é controlado pelo
atacante, e habilitar `project` é execução remota de código no primeiro `build()`. O framework não
oferece trust posture, aprovação por hook nem store de fingerprint para mediar isso.

**Definition of done:**
- [ ] A assinatura torna o risco irrepresentável: `settingSources({ user: true, project: { trustedBy: TrustDecision } })` — habilitar o source do repositório exige um **valor**, não um literal de string.
- [ ] `TrustDecision` é um tipo do framework com pelo menos `{ scope: 'directory', decidedAt, decidedBy }`; não existe construtor implícito ("assumeTrusted()" sem argumento é proibido).
- [ ] A JSDoc passa a declarar a pré-condição real: "seguro apenas quando `cwd` é código que você controla; para um agente operando sobre repositórios fornecidos pelo usuário, isto exige uma decisão de confiança explícita".
- [ ] Teste negativo: um `.theokit/hooks.json` presente + `project` sem `trustedBy` → nenhum hook instalado, e o motivo aparece no canal de aviso (não silenciosamente).
- [ ] Entrada no CHANGELOG marcando o **breaking** (major de `@theokit/agents`), com o codemod ou a linha de migração.

**Efeito no TheoCode:** o gate manual em `chat.ts:386`
(`projectSourceAllowed(posture.allows) ? ['project','user'] : ['user']`, comentário B-008) deixa de ser
compensação e passa a ser a forma suportada — o TheoCode passa a `trustedBy` a decisão que já tem.

**Dependencies:** nenhuma.

**Ordem:** precede o M75 deliberadamente — o motor de hooks não pode aterrissar antes do gate de confiança.

**Top risks:**
1. Breaking change numa API de autoria muito usada. Mitigação: é `@theokit/agents`, versionado por major; o valor de segurança justifica, e o milestone é pequeno o bastante para caber num único release.
2. Time trata `TrustDecision` como carimbo e sempre passa "confiado". Mitigação: M73 entrega o trust store real com decisão persistida por diretório; até lá, o tipo já força a decisão a existir num lugar auditável.

---

### M69 — [x] Ergonomia do `AgentBuilder`: `.tools()`, `.when()` e `AgentShape` publicado

**Objective:** O builder expõe só `.tool(tool, ...guard)` singular — sem `.tools([...])`, sem
`.when(cond, fn)`. `.use(preset)` compõe uma sub-cadeia inteira mas não permite pular um elo no meio.
A consequência para qualquer produto real: um conjunto de tools computado em runtime — o caso normal,
já que quais tools o agente tem depende de sandbox mode, perfil de superfície e trust — **não pode ser
expresso na cadeia**. Além disso, `applyCapabilities` devolve um draft interno, não um valor que os três
sites de construção (`AgentBuilder`, `Agent.create`, roles vindos de disco) consigam consumir.

**Definition of done:**
- [ ] `tools(list: readonly ContextualTool[])` acumulando a união de nomes, e `when(condition, fn)` preservando o type-state, ambos na interface do `AgentBuilder`.
- [ ] `declareAgentShape(name, members)` publicado na camada de capability, devolvendo `{ tools, model, reasoningEffort, provenance }` — consumível pelos três sites de construção.
- [ ] Um helper de formatação de `GoalEvent` exaustivo-seguro, **ou** a união marcada como aberta no tipo publicado, de modo que o consumidor não precise escrever o branch default de evento desconhecido.
- [ ] Testes de type-state: `.tools([a,b]).tool(c)` produz a mesma união que `.tool(a).tool(b).tool(c)`; `when(false, …)` é no-op tipado.

**Efeito no TheoCode:** deleta `composition/agent-spec.ts` (112 LOC) inteiro, o fold
`allTools.reduce((acc, tool) => acc.tool(tool), chain)` (`chat.ts:142`) e a montagem fora da cadeia
documentada em `chat.ts:390-396`; `goal/goal.ts` perde o branch de evento desconhecido.

**Dependencies:** nenhuma.

**Top risks:**
1. `.when()` vira porta para lógica de negócio dentro da cadeia de autoria. Mitigação: assinatura recebe `boolean` já computado, não um predicado com acesso a contexto.

---

### M70 — [x] `fromWireChunk` — tornar o `@theokit/presenter` alcançável a partir do wire

**Objective:** O presenter normaliza saída de agente num `AgentOutputEvent` canônico e entrega três
presenters mais um registry. Mas seus **únicos** tradutores de origem consomem mensagens cruas do
`@theokit/sdk`. Todo consumidor embarcado dirige `streamAgentTurnInProcess` / um transport, que produz
`WireChunk` — já traduzido. Não existe porta `WireChunk → AgentOutputEvent`, então a superfície que
realmente recebe o stream nunca entra no evento canônico. É a explicação mecânica para o presenter ter
**um** import site no TheoCode e nenhum na TUI dele. E é estrutural, não idiossincrasia do consumidor:
o **nosso** `render-terminal.ts:92` faz o switch na mão e nunca toca no `TerminalPresenter`.

**Definition of done:**
- [ ] `fromWireChunk(chunk: WireChunk): AgentOutputEvent[]` em `packages/presenter/src/source/`, exportado do índice — o inverso do mapeamento já escrito em `bridge/present-ui-message-stream.ts:19-37`.
- [ ] `packages/theo/src/server/agent/render-terminal.ts` reescrito como `WireChunk → fromWireChunk → TerminalPresenter`; o switch manual sai.
- [ ] `TerminalPresenter`, `JsonPresenter` e `PresenterRegistry` passam a ter consumidor de produção (knip/G7 verde sem allowlist).
- [ ] `foldTurnLifecycle` + tipos de lifecycle re-exportados de `@theokit/agents`, e os tipos de wire de `client-entry.ts` — do jeito que `theokit/client` já faz e documenta.
- [ ] `packages/presenter/package.json`: devDependency de `@theokit/sdk` alinhada ao range do peer (`^4.40.0`), acabando com a divergência declarado-vs-testado.

**Efeito no TheoCode:** `ChunkLike` + `toContentChunk` (`cli/runtime/events.ts:17-27,130-150`) viram
`toContentChunk(fromWireChunk(chunk))`; o `packages/cli/package.json` deixa de precisar declarar
`@theokit/presenter` só para alcançar uma função.

**Dependencies:** nenhuma.

**Top risks:**
1. O mapeamento inverso perde informação (chunks sem evento canônico correspondente). Mitigação: a função devolve `AgentOutputEvent[]` (0..n) e o teste de round-trip enumera cada membro de `WIRE_CHUNK_TYPES`, falhando em membro não mapeado.

---

### M71 — [x] Módulo de ciclo de vida de sessão (`@theokit/agents/session`)

**Objective:** O store está totalmente suprido (29 pass-throughs em `/persistence`). O **vocabulário de
ciclo de vida acima dele** não tem casa: listar, deletar com proteção de sessão viva, forkar,
voltar-antes-de-um-turno, ponteiro de sessão retomável. Grep por `Agent.archive|rename|compact|planSessionGC`
no target retorna um único hit — o framework nunca exercita um verbo de ciclo de vida. Pior, duas
assimetrias do lado do framework transformam a lacuna em armadilha: `Agent.delete` limpa a **entrada do
registry** e nunca toca no arquivo (o consumidor teve que descobrir medindo), e `encodeProjectDir` é
exportada como via de mão única sem decodificador, forçando um DFS no filesystem para responder "este
projeto ainda existe?".

**Definition of done:**
- [ ] `listSessions`, `deleteSession(id, opts)` devolvendo `{ registryRemoved, transcriptRemoved }`, `protectedTranscripts(cwd)` (ponteiro + mais recente + writer lease) e `forkBeforeUserTurn(srcId, newId, nth)` publicados em `packages/agents/src/session/`.
- [ ] Primitiva de ponteiro de sessão (`loadOrCreateSessionId` / `persistSessionId`) atômica e que **nunca rejeita** — a garantia hoje deixada a cada chamador de `atomicWriteText`.
- [ ] Uma das duas: índice reverso para `encodeProjectDir` (sidecar `projects/<hash>/cwd` escrito na criação do transcript) **ou** um oráculo `classifyProject(name)` — a lacuna que custa 188 LOC de DFS ao consumidor.
- [ ] `Agent.delete` documentado no re-export estreitado (`index.ts:120`) com a mesma profundidade da nota já existente sobre `list`, **ou** tornado inalcançável pelo `deleteSession` acima.
- [ ] Teste negativo: deletar sessão com writer lease ativo falha com erro tipado, não silenciosamente.

**Efeito no TheoCode:** `session/session-ops.ts` (174), `session/backtrack.ts` (175),
`session/liveness-oracle.ts` (188) e `tui/persistence/session-store.ts` (~80) reduzem a adaptadores —
alvo de deleção ≈ 500 LOC.

**Dependencies:** nenhuma.

**Ordem:** bloqueia o M72 — o sweep de disco inteiro é inconstruível sem resolução projeto→cwd não-lossy.

**Top risks:**
1. Absorver ciclo de vida é lido como violação de G2 ("não possuímos o store"). Mitigação: registrar em ADR que possuir o *store* e possuir o *vocabulário* são separáveis; nenhum arquivo novo de transcript é escrito por este módulo.

---

### M72 — [x] Retenção e GC de transcript (plan/apply) + `theokit agent sessions gc`

**Objective:** O TheoKit embarca o código que **cria** estado de disco ilimitado (`transcriptPath`,
`appendJsonl`, `forkTranscript`) e **nenhum** código que o limita. A única máquina de retenção no target
é o buffer de replay SSE em memória do `RunEventCache` — quadros de stream, não JSONL em disco. Um
EmpresaCode ou reconstrói 857 LOC ou cresce transcripts para sempre.

**Definition of done:**
- [ ] `planTranscriptGC({ cwd, keepLast, maxAgeDays })` → candidatos + mantidos + **motivo** de proteção, e `runTranscriptGC(plan, { apply })` → `{ dryRun, removed, errors }`, em `packages/agents/src/session/gc/`.
- [ ] Os quatro invariantes portados **verbatim** — não são política: recusa por FLOOR em vez de normalização silenciosa; **sem mtime ⇒ nunca coletar**; guarda de writer lease; backstop TOCTOU na fase apply re-checando ponteiro e lease entre plan e apply.
- [ ] `classifyTranscriptArtifact(name, isDirectory)` cobrindo transcript / lock-file / lock-directory / tmp — uma definição, não uma por consumidor.
- [ ] Erro por candidato acumulado (fail-open) e ENOENT tratado como sucesso, ambos com teste.
- [ ] Comando `theokit agent sessions gc [--apply] [--all-projects]`; sem `--apply` é dry-run e **imprime o plano**.
- [ ] O sweep de disco inteiro só é exposto depois que M71 entregar a resolução projeto→cwd.

**Efeito no TheoCode:** alvo de deleção `session/gc/**` = **857 LOC** (per-session 180, all-sessions 442,
filesystem 192, pointer 43), o maior bloco único da iniciativa.

**Dependencies:** M71.

**Top risks:**
1. GC apaga transcript vivo de alguém. Mitigação: os quatro invariantes acima são condição de merge, não recomendação; `--apply` nunca é default; teste de concorrência escreve durante o apply e prova a recusa.
2. Diretórios de projeto na casa das dezenas de milhares (medido: 13.269). Mitigação: budget de nós DFS compartilhado, portado junto com o oráculo.

---

### M73 — [x] Configuração em camadas + primitiva de confiança por diretório

**Objective:** O módulo de config do TheoKit resolve "carregue o arquivo de config do meu framework".
Não publica engine de camadas, não deixa a engine do SDK passar, e não tem nada sobre confiança de
diretório. A evidência de que é lacuna real e não decisão de escopo: um repo cujo README proíbe importar
`@theokit/sdk` direto quebrou a própria regra **6 vezes**, e todas as 6 são primitivas de
config/trust/wiring. O vocabulário (quais chaves, quais capacidades, TOML vs TS) é legitimamente política;
a máquina de cadeia, o merge de profile, o relatório de precedência, o floor e o trust store são
idênticos em todo produto de agente.

**Definition of done:**
- [ ] `LayeredConfig` em `packages/theo/src/config/`: recebe cadeia de camadas declarada + chaves acumulativas + schema Zod, devolve `{ value, provenancePerKey, precedenceReport }`.
- [ ] O relatório expõe divergência **medida vs declarada** de precedência (a checagem que o consumidor escreveu como `measuredPrecedenceChain`).
- [ ] Primitiva de confiança por diretório: `resolveTrustPosture` re-exportado (M67) + store em disco atômico sobre `atomicWriteJson`/`withFileLock` já exportados, com permissão do arquivo checada na leitura.
- [ ] `TrustDecision` do M68 passa a ser produzido/consumido por esse store — o carimbo vira decisão persistida e auditável.
- [ ] Teste: ordenação de camadas verificada em tempo de carga falha alto quando o módulo é importado fora de ordem.

**Efeito no TheoCode:** `config/layers.ts` (77) cai para ~40 LOC de declaração; `config/trust-store.ts`
(145) some; a metade fold/report de `config/config.ts` (365) some. Alvo ≈ 350 LOC.

**Dependencies:** M67 (pass-through), M68 (o tipo `TrustDecision`).

**Top risks:**
1. Generalizar cedo demais e engessar o vocabulário de outro produto. Mitigação: a cadeia de camadas é **parâmetro**, não constante; nenhum nome de camada do TheoCode entra no framework.

---

### M74 — [x] Árvore de instruções: `loadInstructionTree` + `composeInstructions` + `contextPressure`

**Objective:** `compileProjectContext` parece adjacente mas não substitui: lê um `THEO.md` fixo pelo SDK,
sem budget de profundidade/arquivos, sem frontmatter, sem guarda de ciclo, sem política de truncamento e
sem canal de aviso. Um produto que queira instruções com escopo de projeto escreve ~720 LOC de
mecanismo. E `compileContextWindow` reporta honestamente **quatro knobs inertes**
(`compactionStrategy`, `preserveLastN`, `preserveToolResults`, `preserveSystemPrompt`) — honesto, mas o
consumidor continua sem nada. Pressão de contexto não tem contraparte alguma: embarcamos o denominador
(`resolveEffectiveContextWindow`) e o numerador (usage) e nunca os juntamos.

**Definition of done:**
- [ ] `loadInstructionTree({ cwd, roots, budget: { maxDepth, maxFiles, maxChars }, onWarn })` → `{ blocks, truncated, count }`, com quebra de ciclo por inode e tetos explícitos.
- [ ] **Containment por realpath** portado — o bug que ele corrige é vetor de prompt-injection e qualquer consumidor o reintroduz.
- [ ] Parsing de frontmatter com escopo `paths:` e *skip do arquivo* quando o frontmatter não fecha (falha por arquivo, não por árvore).
- [ ] `composeInstructions(base, sources[], { maxChars, onWarn })` com a escada de truncamento por fonte; a **ordem** de descarte é mecanismo e entra, os **nomes** das fontes são política e ficam fora.
- [ ] `contextPressure(usedTokens, effectiveWindow)` → `'ok' | 'warn' | 'critical'` com limiares configuráveis, ao lado de `resolveEffectiveContextWindow`.
- [ ] Os quatro knobs metadata-only: **implementados** (threading para `resolveCompactionStrategy`) **ou removidos** de `ContextWindowOptions`. Um knob permanentemente inerte é superfície que ensina errado.

**Efeito no TheoCode:** `context/rules.ts` + `context/agents-md.ts` + `context/instructions.ts` (602) e
`formatting/context-pressure.ts` reduzem a declaração de fontes + copy. Alvo ≈ 550 LOC.

**Dependencies:** nenhuma.

**Top risks:**
1. Absorver a escada de truncamento junto com a ordem "certa" que na verdade é gosto do TheoCode. Mitigação: a ordem é parâmetro (`sources[]` já vem ordenado pelo produto); o framework entrega o mecanismo de corte, não a preferência.

---

### M75 — [x] Motor de hooks: spec, runner, trust por fingerprint, budgets

**Objective:** O TheoKit publica um seam bem tipado (`HookHandlers`, 8 eventos, `pre_tool_call` como
único veto) e para. Todo o caminho entre "o usuário escreveu um comando num arquivo de config" e "esse
comando roda, limitado, confiável, e a saída dele volta com segurança para o modelo" é do consumidor —
828 LOC importando **um único símbolo** do framework. E cada parte difícil é infraestrutura genérica que
o próximo consumidor vai reaprender do jeito ruim: o cap de saída, a corrida drain-vs-exit, o kill de
process group, os budgets de cadeia e de continuação, a defesa de injeção por fence com nonce, a
assimetria fail-closed no Pre / fail-open no Post.

**Definition of done:**
- [ ] `HookSpec` parseado por zod com **falha alta em evento desconhecido**, e `buildHookHandlers(specs, { trusted, approved })` devolvendo o `HookHandlers` existente. `approved` é **obrigatório** — ausência é negação.
- [ ] Runner de subprocesso como primitiva separada, com os caps como constantes nomeadas: `MAX_OUTPUT_BYTES` (1 MiB), `DRAIN_BUDGET_MS` (2 s) **liquidando em `close`, não em `exit`**, SIGKILL no **process group**.
- [ ] `ContinuationBudget` (default 3) e budget de cadeia (4× timeout) publicados com o motor.
- [ ] Saída do hook cercada por fence com nonce, com escape do fechamento — teste de injeção incluído.
- [ ] `hookFingerprint` (SHA-256 sobre `{command, event, matcher, timeout_ms}`) + store de aprovados com permissão checada, consultado pelo source `project` do M68.
- [ ] Split explícito e testado: PreToolUse **fail-closed**, PostToolUse **fail-open**.

**Efeito no TheoCode:** alvo de deleção `hooks/**` = **847 LOC**.

**Dependencies:** M68 (o gate de confiança precede o motor), M73 (store de confiança).

**Top risks:**
1. Framework passa a executar comando arbitrário do usuário — superfície de segurança grande. Mitigação: entra **depois** do M68; default é negação; o fingerprint muda a cada edição do comando, então aprovação não é herdável por mutação.
2. Portar os budgets errados quebra hooks de quem já usa. Mitigação: os valores viram constantes exportadas e configuráveis, com os defaults medidos do consumidor.

---

### M76 — [x] Loader de comandos customizados para `.theokit/commands/`

**Objective:** Isto é pior que ausente: o framework **é dono** da convenção `.theokit/` e carrega
`skills/`, `agents/` e `hooks.json` de lá — mas `commands/`, o único diretório que toda superfície de
agente voltada a produto quer, não tem loader. O consumidor reimplementou varredura de markdown com
frontmatter **contra o diretório do próprio framework**.

**Definition of done:**
- [ ] `loadCustomCommands({ projectDir, homeDir, projectTrusted })` lendo `.theokit/commands/*.md` com frontmatter, gate de confiança e aviso de **shadow de builtin** e de duplicata.
- [ ] Precedência projeto-sobre-usuário explícita e testada; comando de projeto só carrega sob diretório confiável (mesma decisão do M68).
- [ ] Documentado na mesma página que descreve `.theokit/skills/` e `.theokit/agents/`, para que a convenção deixe de ter um buraco.

**Efeito no TheoCode:** `tui/commands/custom-commands.ts` (122 LOC) vira chamada única.

**Dependencies:** M68 (confiança), M73 (store).

**Top risks:**
1. Nome de comando colide com builtin do produto. Mitigação: o loader **avisa** e não decide — quem resolve o shadow é o roteador do M83, que é do produto.

---

### M77 — [x] HITL completo: auto-approve com evidência de sandbox, ledger de pendências, canal de pergunta

**Objective:** A metade de aprovação-de-tool está perto de 5 e já absorveu feedback deste consumidor.
Duas coisas a seguram. **(a)** `auto-approve` é promessa sem evidência: o tipo exige uma `string` de
motivo, não uma `SandboxPosture` — a decisão mais consequente de um agente de código ("rode comandos sem
perguntar") é inverificável no seam, e por isso o consumidor implementa a recusa **duas vezes**
(`shouldAutoApprove` na TUI e `resolveHeadlessApproval` no headless), com a regra idêntica: posture
ausente conta como não confinado. **(b)** "Pausar o turno para um humano" só existe para aprovação de
tool; o caso irmão — o agente **pergunta** algo no meio do turno — tem tool (`createQuestionTool` aceita
um callback `askUser`) e não tem canal.

**Definition of done:**
- [ ] `ApprovalPosture['auto-approve']` passa a exigir evidência: `{ kind: 'auto-approve'; confinedBy: SandboxPosture; reason: string }`, e `applyPosture` **recusa** quando `confinedBy.enforced === false`.
- [ ] Ledger de pendências como primitiva de cliente (ingest / settle / findNext, poda por índice de mensagem) — 87 LOC de lógica pura, sem política, que hoje existe porque a busca do lado do framework é stateless (o card dispensado volta; uma segunda resposta é enviada para uma aprovação já respondida).
- [ ] `AskBridge` em `packages/agents/src/ask/`, modelado no `ApprovalRegistry` que já existe: `ask` / `answer` / `abandon` / `setListener` com chave por thread, **recusa de segundo listener**, e erros tipados descendentes de `TheokitAgentError` (`ConcurrentQuestionError`, `ConcurrentListenerError`, `QuestionAbandonedError`).
- [ ] `createQuestionTool` passa a ter o `AskBridge` como `askUser` default — a tool fica usável sem encanamento.
- [ ] Teste: `abandon()` rejeita a promessa capturada (o bug que travou o turno por 5 min até o timeout do builtin).

**Efeito no TheoCode:** `ask/**` (204) + `consent/pending-approvals.ts` (87) + a duplicata de
`config/approval-policy.ts` (52) somem. Alvo ≈ 340 LOC, mais a eliminação da regra de segurança duplicada.

**Dependencies:** nenhuma.

**Top risks:**
1. Exigir `SandboxPosture` quebra quem usa `auto-approve` hoje. Mitigação: é exatamente o ponto — quem não consegue provar confinamento **não deveria** estar em auto-approve; major com nota de migração explícita.

---

### M78 — [ ] Binder de escopo de tool: `bindToolScope` com `sandbox` não-opcional

**Objective:** O framework embarca os ingredientes (`createSandboxBackend`, `resolveSandboxPosture`) e
nenhum **binder**: um valor que amarre `{ projectRoot, writeRoot, sandbox }` uma vez e entregue as
factories já ligadas, de modo que **um shell não-confinado seja irrepresentável**. Hoje cada consumidor
redescobre por tool qual root a factory aceita, e o modo de falha é silencioso — o consumidor documenta
que "um escopo construído sem sandbox produziu um shell NÃO-CONFINADO sem erro e sem aviso".

**Definition of done:**
- [ ] `ToolScope` como tipo-valor + `bindToolScope({ projectRoot, writeRoot, sandbox })` devolvendo as factories de `@theokit/sdk-tools` já escopadas, com `sandbox` **obrigatório** no tipo.
- [ ] `sandboxWritePolicy(mode) → { writes, allowAbsolute }` ao lado de `resolveSandboxPosture`, para que a derivação de writeRoot não seja reinventada por produto.
- [ ] `createViewImageTool` adicionada ao `@theokit/sdk-tools` e re-exportada — a única tool que o consumidor teve que escrever do zero (89 LOC), e cuja forma `handler` + `toModelOutput` já é a canônica para multimodal.
- [ ] Teste de tipo: construir um escopo sem `sandbox` **não compila**.

**Efeito no TheoCode:** `tools/tool-scope.ts` + `config/sandbox-policy.ts` (29) e `tools/view-image.ts`
(89) somem; `tools/registry.ts` volta a ser só o mapa declarativo de 10 entradas que deveria ser.

**Dependencies:** nenhuma.

**Top risks:**
1. Binder engessa quem quer uma tool com root diferente das outras. Mitigação: o binder devolve factories e aceita override por tool; o que ele proíbe é a **ausência** de sandbox, não a variação.

---

### M79 — [ ] Resolução pública de credencial + proveniência; matar o resolvedor de provider duplicado

**Objective:** A metade genuinamente difícil está suprida (device flow RFC 8628, refresh sob lock
cross-process, persistência, extração de account id). Falta a metade que todo consumidor encontra
primeiro: "dado um env, um home e um modelo, **qual** credencial eu uso, e **de onde** ela veio?". O
TheoKit responde isso **duas vezes** internamente e não expõe nenhuma: `resolveProvider()` é completo mas
trancado atrás de `internal-api.ts` ("Do NOT re-export these"), e `/auth` retém `resolveCredential`
declarando-o "política do app". A moldura "política do app" se defende para **quais** providers; a cadeia
de precedência, a checagem de consistência prefixo/provider e o registro de proveniência são mecanismo.
Bônus: `provider-resolver.ts` é o único lugar de `packages/` que acende o gate G2 com URLs literais de
vendor.

**Definition of done:**
- [ ] `resolveCredential({ env, home, providers })` público em `@theokit/agents/auth`, recebendo a lista de descritores como **parâmetro** (quais providers continua política do app), devolvendo `{ kind, provider, apiKey, source, inferred }`.
- [ ] `source` é uma união estruturada `SourceOrigin` (`{kind:'env',varName}` | `{kind:'file',path}` | `{kind:'oauth',provider}`), e o leitor de nome de variável de `.env` vai junto — para que proveniência seja formatação, não parsing.
- [ ] Checagem de consistência prefixo↔provider incluída (o consumidor a tem; o framework não).
- [ ] Decisão registrada em ADR e executada: **ou** `resolveProvider`/`registerProvider`/`ProviderDescriptor` viram públicos em `theokit/server/agent`, **ou** `provider-resolver.ts` é deletado e CLI/vite-plugin passam a chamar o caminho público. Um segundo resolvedor inalcançável é o que garante que o consumidor escreva o terceiro.
- [ ] Se a segunda opção: as URLs literais de vendor saem de `packages/`.

**Efeito no TheoCode:** `auth/credentials.ts` (390) cai para a tabela de providers; `auth/credential-provenance.ts`
(70, um parser de dotenv escrito só para responder "shell ou .env?") some. Alvo ≈ 380 LOC.

**Dependencies:** M67 (a família de pass-through resolve os homônimos divergentes que motivaram a retenção).

**Top risks:**
1. Duas funções homônimas divergentes no SDK reaparecem no público. Mitigação: o framework publica **a sua** assinatura com o descritor como parâmetro; o símbolo do SDK não é re-exportado com o mesmo nome.

---

### M80 — [ ] Invariante da taxonomia de erros + registro na fronteira HTTP

**Objective:** A base está certa e deliberada — `index.ts:166-167` re-exporta `@theokit/sdk/errors` e
`/retry` inteiros, com o motivo escrito (sem isso o consumidor foi empurrado para uma hierarquia
**paralela** de cinco classes). Mas o framework **não come o próprio contrato**: 11 de 13 classes de erro
em `packages/agents/src` estendem `Error` puro, e `isTransientError` é definida sobre
`TheokitAgentError` — então as 11 são invisíveis para ela, e o único recurso do consumidor é o
casamento de string que a regra proíbe (um regex sobre uma cadeia de `cause` de 8 níveis). Duas das 11
só foram corrigidas **depois** de o consumidor reportar. Separado disso, `theokit` tem uma segunda
hierarquia (`TheoError`) cuja tabela de fronteira não contém **nenhum** erro de agente: um
`GuardrailViolationError` — lançado quando um guard de prompt-injection ou PII bloqueia — atravessa como
HTTP 500, indistinguível de falha real de servidor, e middleware de retry reenvia a entrada bloqueada.

**Definition of done:**
- [ ] As 11 classes reparentadas em `TheokitAgentError` com `code` estável e `isRetryable` explícito, começando pelas que um consumidor pega na fronteira de turno (`GuardrailViolationError`, `CostBudgetExceededError`, `DelegationError`, `DelegationBudgetExceededError`, `InProcessApprovalRequiredError`, `ApprovalAbortedError`, `AgentDefinitionError`).
- [ ] Gate de CI afirmando que **não existe** `export class *Error extends Error` em `packages/agents/src` — transforma a correção reativa em invariante, do jeito que `check-auth-parity.mjs` fixa as superfícies de pass-through.
- [ ] `ERROR_NAME_TO_CODE` registra os erros de agente: `GuardrailViolationError → BAD_REQUEST`, `CostBudgetExceededError → TOO_MANY_REQUESTS`, `InProcessApprovalRequiredError → FORBIDDEN`.
- [ ] `META_EXTRACTOR` para `GuardrailViolationError` expondo `{ guardName, phase }`, para telemetria contar bloqueios por guard sem parsear mensagem.

**Efeito no TheoCode:** `formatting/turn-error.ts` perde o fallback de regex (`TRANSIENT_SHAPE`) e o
`translateError` datado de `tools/registry.ts` some.

**Dependencies:** nenhuma.

**Top risks:**
1. Reparentar muda o `name`/shape que alguém já casa por string. Mitigação: `code` estável introduzido junto, e a mudança é major anunciada; o gate impede regressão.

---

### M81 — [ ] Delegação completa: cap de relógio, ciclo de vida efêmero, scoring por porta

**Objective:** A engine de execução está suprida e funciona; os ~770 LOC que o consumidor escreveu são
majoritariamente política. Três lacunas reais restam. **(a)** Budget é só dinheiro — uma delegação que
trava queima **relógio**, não dólar, então o consumidor escreveu a própria corrida de timeout com o
próprio erro tipado. **(b)** Disposal não tem dono: `delegate()` nunca cria agentes descartáveis, então
todo site que cria (squad, reviewer efêmero) escreve acquire/dispose na mão — e os **dois** arquivos
carregam comentário de correção de bug sobre a semântica do `finally`. **(c)** A camada de delegação é
inalcançável a partir das primitivas que o consumidor de fato usa: `delegateWithScoring` recebe
`SubAgentSpec { name, compiled }` produzido pelo compilador de capability, então quem segura um
`SubAgent` ou um `Squad` do SDK não consegue alimentá-la — que é exatamente por que o loop de scoring, a
coisa de maior valor da camada, tem **zero adoção** num produto que roda um passe explícito de review.

**Definition of done:**
- [ ] `timeoutMs` em `DelegateOptions` com `DelegationTimeoutError` tipado — cap de relógio não é o mesmo guard que cap de USD.
- [ ] `withEphemeralAgent(create, fn)` descartando em `finally` com semântica `Promise.allSettled`.
- [ ] `delegateWithScoring` / `delegateBackground` aceitam uma **porta** `{ run(message): Promise<DelegationResult> }`, de modo que um `SubAgent` ou `Squad` do SDK a satisfaça.
- [ ] `listSubagentNames(cwd, { settingSources })` exportado do mesmo módulo que `discoverSubagents`, para que o inventário de subagents pare de ser um segundo oráculo sobre `.theokit/agents/*.md`.
- [ ] Prova de alcance: um teste alimenta o loop de scoring com um `Squad` do SDK, sem passar pelo compilador de capability.

**Efeito no TheoCode:** `delegation/delegation-cap.ts`, o disposal manual em `delegation/squad.ts` e
`review/create-agent.ts`, e `tui/commands/subagent-inventory.ts` reduzem a chamadas. Alvo ≈ 150 LOC.

**Dependencies:** nenhuma.

**Top risks:**
1. Porta genérica dilui os tipos do caminho de capability. Mitigação: a porta é aditiva; o overload existente com `SubAgentSpec` permanece.

---

### M82 — [ ] Saúde de MCP: sink por turno + união `RunEvent` tipada

**Objective:** MCP é a dimensão mais bem evidenciada de sucesso de extração — `loadMcpJson` é caso
documentado de primitiva que deletou código de produto, e carrega controles de segurança que o consumidor
**estruturalmente não teria como escrever** (o allowlist de campos que remove `envPolicy`, impedindo que
um `.mcp.json` versionado entregue `ANTHROPIC_API_KEY` e o resto do ambiente a um binário de terceiro).
A lacuna que resta é observabilidade: o SDK emite `mcp_server_failed` como `RunEvent`, mas nada
transforma isso em estado por-turno por-servidor — e o sink do consumidor lê o payload
**estruturalmente** para não fixar versão do SDK, ou seja, está compensando uma superfície tipada que não
alcança.

**Definition of done:**
- [ ] `createMcpHealthSink()` → `{ sink(e: RunEvent), startTurn(), current(): readonly McpFailure[] }`, com o clear por turno e a deduplicação por nome de servidor portados (as duas são decisões de correção, não gosto — sem elas um servidor recuperado é reportado como quebrado).
- [ ] A união `RunEvent` (ou ao menos o membro `mcp_server_failed`) exportada de `@theokit/agents`, para o sink ser tipado em vez de duck-checked.
- [ ] `onWarn` do `loadMcpJson` desaguando no mesmo canal, para "servidor X ignorado" e "servidor X falhou ao listar" chegarem num lugar só.
- [ ] A disciplina de allowlist replicada no bloco `env` gerado pelo `mcpRegistry`, e a exclusão de `envPolicy` documentada na página do `.mcp.json`.

**Efeito no TheoCode:** `agent-session/mcp-failure-{sink,record}.ts` (68 LOC) somem.

**Dependencies:** nenhuma.

**Top risks:**
1. Exportar `RunEvent` fixa o consumidor numa versão do SDK. Mitigação: exportar como união aberta/`readonly`, com teste de paridade no mesmo formato dos `*-entry.ts`.

---

### M83 — [ ] Camada de produto terminal: roteador de comandos, coalescing de render, watchdog de shutdown

**Objective:** A superfície terminal inteira do TheoKit é um renderer de 150 LOC + um presenter de 117 +
um comando one-shot que **exige** argumento de mensagem e sai. O consumidor escreveu 8.639 LOC. Parte
disso é chrome e widget, e é do `@theokit/ui`/`@theokit/tui` — este milestone não abre um app Ink aqui.
O que ele absorve é o **mecanismo** que hoje não tem contraparte em lugar nenhum: sistema de comandos
(registry + roteamento por prefixo mais longo + interpretador), orçamento de quadro e coalescing de
render, e o watchdog de shutdown.

**Definition of done:**
- [ ] Primitiva de comando: `defineCommand({ name, description, arg? })` + `routeCommand(input, customNames)` + a forma do interpretador (bundle de capacidades). O **mecanismo** de ordenação/prefixo entra; os ~50 nomes de comando do TheoCode ficam lá.
- [ ] Coalescing de render + orçamento de quadro promovidos para `@theokit/tui` — incluindo o uso de **relógio monotônico**, cujo bug o consumidor já documentou e todo consumidor reencontraria.
- [ ] `createShutdown` (registry de cleanup, handler de sinal, watchdog de 3 s, deps injetadas) promovido para `@theokit/agents`, preservando o contrato de exit code: Ctrl-C limpo, falha de cleanup e timeout de watchdog têm que ser distinguíveis.
- [ ] Decisão registrada sobre parsing de argumento: **ou** um helper `defineCliCommand`, **ou** documentação explícita de que está fora de escopo — para que o próximo consumidor descubra antes de escrever 470 LOC, não depois.
- [ ] `theokit agent <name>` aceita modo interativo (sem argumento de mensagem obrigatório), senão a primitiva não tem consumidor de produção no repo.

**Efeito no TheoCode:** `tui/commands/{registry,interpret-command}.ts` reduzem aos nomes;
`tui/rendering/**` (269) e `shared/shutdown.ts` (67) somem. Alvo ≈ 700 LOC.

**Dependencies:** M76 (comandos customizados alimentam o mesmo roteador).

**Top risks:**
1. Absorver "sistema de comandos" vira um mini-framework de CLI dentro do agents. Mitigação: entra o roteamento e a forma do interpretador; **não** entra rendering de ajuda, alias, nem completions — cada um exigiria ADR próprio com demanda.
2. Escopo confunde-se com o `@theokit/ui`. Mitigação: a tabela de destino por peça é condição de merge do milestone.

---

### M84 — [ ] Observabilidade e custo reempacotados runtime-neutros + `theokit doctor`

**Objective:** Dois problemas estruturais. **Empacotamento:** 1.715 LOC de observabilidade + custo vivem
sob `packages/theo/src/server/**`, e `theokit` é o framework web Vite/React. O único produto real
construído sobre a stack depende de `@theokit/agents`, `@theokit/tui`, `@theokit/presenter` e nunca de
`theokit` — grep por `from 'theokit` nele retorna zero. Nada disso é alcançável, e o que seria é
HTTP-shaped (spans nomeados `http.request` e chaveados por `requestId`; `trackAgentRun` exigindo
`userId`). **Ausência:** não existe relato de estado resolvido. `theokit info` responde "meu projeto
parseia?"; a pergunta de um produto de agente é "o que esta instalação **vai fazer**?" — credencial,
camadas, trust, sandbox, MCP, skills, hooks.

**Definition of done:**
- [ ] Metade runtime-neutra do custo movida para `@theokit/agents`: `UsageStorageAdapter`, `UsageRecord`/`ToolUsageRecord`, `InMemoryUsageStorage` e um `latestUsage` que funcione sobre uma thread do SDK. O wiring HTTP de `trackAgentRun` fica em `theokit`.
- [ ] Núcleo de `ObservabilityAdapter`/`SpanHandle` transport-neutro; `createObservabilityPlugin` (instrumentação de `http.request`) permanece em `theokit/server`.
- [ ] Primitiva de doctor em `@theokit/agents`: o quarteto `Check{name,status,detail}` / `Diagnosis{checks,failed}` / `diagnose` / `renderDiagnosis` — 44 LOC de mecanismo puro — com a **regra dura de nunca imprimir segredo** (presente/ausente/ilegível, nem truncado) e contrato de exit code não-zero. A **lista** de checks continua extensível pelo produto.
- [ ] Comando `theokit doctor` compondo os checks que o framework conhece (`resolveProvider`, `loadMcpJson`, skills, wiring via `recordWiring`).
- [ ] `installDiagnosticSink` (roteia para stderr ou arquivo por env var) ao lado do pass-through de `setDiagnosticsSink` — um seam cujo único uso são é esse deveria vir com ele.
- [ ] **Critério de aceite:** um produto terminal que dependa **só** de `@theokit/agents` consegue registrar e consultar usage sem adicionar `theokit`.

**Efeito no TheoCode:** `doctor.ts` (116) reduz à lista de checks; `shared/diagnostic-sink.ts` (33),
`formatting/last-usage.ts` (10) e parte de `wiring-panels.ts` somem. Alvo ≈ 200 LOC.

**Dependencies:** M67 (`recordWiring` alcançável), M79 (`resolveProvider` público, se essa for a decisão).

**Top risks:**
1. Mover código entre pacotes quebra consumidores de `theokit/server/cost`. Mitigação: re-export a partir do caminho antigo por uma major, com o CHANGELOG nomeando o novo lar.

---

### M85 — [ ] Reconstruir o seam de teste sobre os vocabulários reais

**Objective:** Toda a superfície publicada de teste é **uma** função, `createMockAgentStream`, e ela fala
um vocabulário que **nenhum caminho de produção do framework consome**: emite `run_started` /
`text_delta` / `tool_call`, enquanto o nosso próprio renderer de terminal faz switch sobre o conjunto
kebab-case `WIRE_CHUNK_TYPES` e o presenter fala um terceiro vocabulário. Um consumidor que adotasse a
função estaria testando contra nomes de evento que não existem em produção — um teste verde seria
evidência sobre nada. Adoção medida: **um** chamador no target inteiro (o próprio unit test dele) e
**zero** no único produto real, que registrou a recusa em prosa. Nós também não comemos essa ração.

**Definition of done:**
- [ ] `createMockWireStream(chunks: WireChunk[])` e `createMockOutputEvents(events: AgentOutputEvent[])` publicados; a forma snake_case ou é deletada ou documenta qual consumidor de produção a lê.
- [ ] **Critério de aceite mecânico:** um teste no target dirige `renderAgentStreamToTerminal` fim-a-fim a partir de `@theokit/agents/testing` **sem nenhum cast**.
- [ ] Construtores de chunk tipados (`wireChunk.error('boom')`) validados por `wireChunkSchema`, para que fixture malformada falhe na construção — hoje o consumidor escreve `{ type:'error', errorText:'boom' } as never`.
- [ ] Helper de asserção na fronteira de compilação (`inspectCompiled(definition)` → nomes de tool, tools gateadas, capabilities) — o próprio consumidor documenta que **isto**, e não o stream, é o de maior raio de impacto num produto de agente.
- [ ] Gate de paridade de wire publicado como check executável pelo consumidor (hoje ele importa `../packages/presenter/dist/...` e só guarda o espelho do framework).
- [ ] Custo do barrel endereçado: split ou documentação dos subpaths como import de teste, citando os ~420 ms por arquivo de teste medidos pelo consumidor (que subiu o `testTimeout` para 20.000 ms por causa disso).

**Efeito no TheoCode:** substitui as 90 ocorrências de `vi.mock`/`vi.fn` sobre o **barrel do framework**
(que fixam os testes a nomes de export sem nada detectar drift) e os literais com `as never`.

**Dependencies:** M70 (`fromWireChunk` é o que torna o vocabulário canônico alcançável).

**Top risks:**
1. Reescrever o mock quebra quem já o usa. Mitigação: adoção medida é **zero** fora do próprio teste; o risco real é o oposto — manter um seam que ninguém pode usar.

---

### M86 — [ ] TheoCode migra: adotar cada primitiva, deletar o que foi absorvido, publicar o ledger

**Objective:** Este é o milestone que fecha o laço e o **único** que dá evidência de que a v3 valeu. O
TheoCode já provou oito vezes que o padrão funciona — `interactive_shell`, oito tools bespoke, o fold de
camadas, o security floor, a derivação de trust posture, o wiring record, o stderr guard e a fila de
escrita, a ordenação de key layers, o fold de turn lifecycle, o veto de aprovação headless — e cada
deleção carrega comentário in-file nomeando a versão em que aterrissou. M86 faz a mesma coisa, de uma vez,
para tudo que M67–M85 absorveram, e **mede**.

O TheoCode é o sistema-teste, não a plataforma-alvo: se o EmpresaCode hipotético continua tendo que
escrever mecanismo depois de M85, é aqui que isso aparece — porque o TheoCode vai tentar deletar e não
vai conseguir.

**Definition of done:**
- [ ] Para cada milestone M67–M85, o arquivo correspondente no TheoCode é reduzido a adaptador ou deletado, e o commit cita o milestone e a versão do pacote em que a primitiva aterrissou (a convenção in-file que o repo já pratica).
- [ ] `grep -rn "from '@theokit/sdk" packages/*/src --include='*.ts' | grep -v node_modules` no TheoCode → **0**, e `@theokit/sdk` sai do `packages/agent/package.json` (norte da v3).
- [ ] **Ledger de deleção** publicado em `wiki/` do TheoKit: uma linha por primitiva, com LOC removidos no consumidor e o milestone que a entregou. Total ≥ **4.500 LOC**; abaixo disso, a v3 não cumpriu a tese e o gap remanescente é registrado como escopo v4, não silenciado.
- [ ] Suíte do TheoCode verde **sem editar expectativa** onde a mudança era de mecanismo (a mesma disciplina de zero-behavior do M57): teste repontado, asserção intacta.
- [ ] Cada primitiva que o TheoCode **não** conseguiu adotar entra com motivo escrito — "o framework não cobre o caso X" — e vira item candidato de v4. Recusar em silêncio é o único resultado proibido aqui.
- [ ] Um `EmpresaCode` mínimo (scaffold via `create-theokit --surface tui`) roda um turno com aprovação, hook, sessão retomável e GC — sem escrever nenhuma das primitivas de M67–M85.

**Dependencies:** M67…M85 (todas). É deliberadamente o último.

**Top risks:**
1. O TheoCode evolui durante a v3 e as medidas de LOC ficam obsoletas. Mitigação: o ledger mede **deleção real no commit de migração**, não o número do relatório de 2026-08-12; o relatório é a hipótese, o ledger é o resultado.
2. Migrar tudo de uma vez trava o produto por semanas. Mitigação: o milestone é executado incrementalmente — um PR por primitiva, na ordem em que os milestones aterrissam — e só o **ledger** é fechado no fim.
3. Otimizar para o TheoCode e entregar primitiva que só serve a ele. Mitigação: a regra de aceite de toda a v3 é "absorve invariante, deixa vocabulário"; o critério do scaffold `EmpresaCode` no DoD acima existe para provar que a primitiva serve a um segundo consumidor.

---

## Cobertura — cada finding e onde ele caiu

A cross-validation produziu **19 gaps** e **26 findings**, e os dois não são a mesma coisa: a tabela de
milestones acima cobre os gaps 1:1, mas findings existem que não viraram gap. Esta seção existe para que
ninguém precise confiar na memória de quem escreveu o roadmap — a auditoria foi feita por script contra
o banco (`cross-validation-output/cross-validation.db`) e está registrada aqui.

**Gaps: 19/19 cobertos.** Mapeamento 1:1 com M67…M85, verificado mecanicamente (cada gap nomeia um
milestone, e cada milestone nomeado existe no arquivo).

**Findings: 21 acionáveis, todos cobertos.**

| # | Finding | Milestone |
|---:|---|---|
| 2 | ~3.600 LOC de mecanismo hand-rolled na referência | **agregado** — M71 + M72 + M73 + M75 + M77 |
| 4 | Sem pacote de superfície terminal | M83 |
| 5 | Vocabulário de ciclo de vida reinventado por produto | M71 |
| 6 | Sem seam para hooks shell declarados pelo usuário | M75 |
| 7 | Política de aprovação existe; fila e vocabulário de modo não | M77 |
| 8 | Suporte a teste é um helper de mock-stream | M85 |
| 10 | Fronteira em camadas vaza | M67 |
| 11 | `settingSources` sem primitiva de consentimento | M68 |
| 12 | Presenter sem tradutor do próprio formato de wire | M70 |
| 13 | `createMockAgentStream` fala vocabulário que produção não consome | M85 |
| 14 | Observabilidade/custo empacotados no framework web | M84 |
| 15 | Cadeia do `AgentBuilder` sem elo set-wise nem condicional | M69 |
| 16 | `Agent.delete` é registry-only e não está documentado | M71 (DoD: documentar no re-export **ou** tornar inalcançável) |
| 17 | `createQuestionTool` sem canal | M77 |
| 18 | Erros de agente ausentes da tabela de envelope HTTP | M80 |
| 19 | `resolveProvider` trancado em `internal-api.ts` | M79 |
| 20 | `@theokit/presenter` não re-exportado + peer/dev desalinhados | M70 (DoD cobre os dois) |
| 21 | Sem primitiva de doctor | M84 |

Os dois com maior risco de terem escapado — **#16** e **#20** — estão nos DoD; confirmado por grep
(`Agent.delete` 2 ocorrências, `devDependency ... alinhada ao range do peer` 1).

**Os 5 que deliberadamente não viraram milestone:**

| # | Finding | Por quê |
|---|---|---|
| 1, 3, 9 | Contexto: o consumidor é downstream; o registro de migração dele; a taxonomia de erro já atravessa o seam | Enquadramento, não trabalho |
| 22, 23 | TARGET BETTER — a narrow de `Agent.list`; o allowlist de `envPolicy` no `loadMcpJson` | Já funcionam. Recomendam **replicar a disciplina**, não construir |
| 24, 25 | TARGET BETTER — `ApprovalPosture`/`Toolset` e as quatro primitivas que deletaram código do consumidor | Recomendam institucionalizar o padrão e manter um índice de primitivas que deletaram código downstream — isso **é** o ledger do M86 |
| 26 | Meta: os gaps viraram este roadmap | Rastreabilidade |

### Duas notas de unidade

**M68 não tem alvo de LOC, e isso não é uma lacuna do milestone.** Ele não deleta código do TheoCode
porque o TheoCode **já se defendeu sozinho** — o gate em `chat.ts:386`, comentário B-008. O efeito do
M68 é outro e é maior: transforma a compensação manual dele na forma suportada, e protege todo consumidor
que **não** descobriu o problema. É o único finding `critical` do run; LOC deletado simplesmente não é a
métrica certa para ele.

**M85 conta ~90 `vi.mock`/`vi.fn` sobre o barrel do framework, não 90 LOC.** A unidade é diferente das
demais linhas, e por isso ficou de fora da soma de 5.406 LOC dos alvos de deleção.

---

## State-of-the-art references

| Fonte | O que aporta | Onde |
|---|---|---|
| **TheoCode** (`usetheo-labs/TheoCode`) | O consumidor real medido: 71 imports de `@theokit/agents`, e o inventário do que ainda escreveu sozinho | `cross-validation-output/baseline/reference/architecture_map.md` §4.2 |
| Cross-validation 2026-08-12 | 16 dimensões pontuadas com `file:line` nos dois repos; 25 findings; 4 deles registrando onde o TheoKit é melhor | `cross-validation-output/final_report.md` + `cross-validation.db` |
| Registro de migração do TheoCode | As 8 absorções anteriores que deram certo — a prova de que "absorver e deletar" é mensurável aqui | `architecture_map.md` §4.3 |
| `rules/parsimony-ladder.md` | O critério de corte: absorver mecanismo, nunca política; nunca sacrificar teste/validação/erro/segurança | `.claude/rules/parsimony-ladder.md` |
| `rules/sdk-runtime.md` (G2) | A linha que a v3 **não** cruza: o SDK executa, o TheoKit é a casa | `.claude/rules/` |

---

## Revision protocol

- **Marcar progresso:** flip do checkbox no header via `flip_milestone_checkbox.py --roadmap ROADMAP-v3.md`,
  e somente após `/acceptance` verde (`cycle-acceptance.md` — `[x]` significa "shipou **e** foi visto funcionando").
- **Adicionar milestone pós-M86:** continuar a numeração global (M87…), aqui neste arquivo.
- **Concluir a v3:** quando M67…M86 forem `[x]`. A prova não é a contagem de checkboxes — é o ledger do
  M86: o north-star (`grep` → 0 no TheoCode) mais ≥ 4.500 LOC deletados no consumidor.
- **Reabrir escopo cortado:** exige ADR com evidência de demanda, no mesmo padrão das v1/v2.
