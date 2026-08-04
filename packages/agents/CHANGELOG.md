# @theokit/agents

## 6.4.2

### Patch Changes

- **Correção de segurança.** O release anterior repassava a entrada do `.mcp.json` como veio do arquivo,
  em vez de montá-la a partir dos campos declarados. Isso deixava o `envPolicy` atravessar — e ele é o
  campo que decide se o processo do servidor MCP herda o ambiente **com** ou **sem** as variáveis
  sensíveis do host. Um `.mcp.json` (arquivo de projeto, versionado) podia declarar `envPolicy: "all"` e
  entregar chaves de API do ambiente a um binário de terceiro.

  Agora a entrada é montada por allowlist, ramo a ramo: `command`/`args`/`env`/`cwd` no stdio,
  `url`/`type`/`headers`/`auth`/`requestTimeoutMs` no remoto. Campo desconhecido não atravessa —
  inclusive um que o SDK venha a criar. `envPolicy` fica de fora deliberadamente: é decisão de postura do
  host, e o SDK a aceita do código que constrói o agente, onde um humano revisa.

  **E o aviso deixou de poder sumir.** `onWarn` continua opcional, mas quando omitido os avisos vão para
  `stderr` em vez de para lugar nenhum — antes, um chamador que não assinasse o canal descartava entradas
  em silêncio absoluto.

## 6.4.1

### Patch Changes

- a432fda: Os tipos de configuração de servidor MCP passaram a alcançar a raiz do pacote. Estavam em `types.ts` e
  não chegavam ao `index.d.ts` — na prática, o consumidor conseguia _usar_ um servidor remoto mas não
  conseguia **nomear** o tipo do mapa que `loadMcpJson` devolve, que é metade do problema que o release
  anterior resolveu. `McpServerConfig`, `McpServersMap`, `McpStdioServerConfig`, `McpHttpServerConfig`,
  `McpAuthConfig` e `McpOAuthConfig` agora atravessam.

## 6.4.0

### Minor Changes

- f950538: Um servidor MCP que o carregador não entende deixou de derrubar os que ele entende, e o transporte
  remoto passou a atravessar.

  Antes, um `.mcp.json` com um servidor stdio perfeitamente válido e um vizinho que o parser não
  reconhecia produzia `McpFileError` — e **os dois** eram perdidos. Fail-closed no raio errado: recusar
  _uma entrada_ é correto; recusar _o arquivo_ transforma "esse servidor não é suportado" em "você não
  tem MCP nenhum".

  Agora o raio é a entrada:

  ```jsonc
  {
    "mcpServers": {
      "local": { "command": "npx", "args": ["servidor"] },
      "remoto": { "type": "http", "url": "https://…/mcp", "headers": { "Authorization": "…" } },
    },
  }
  ```

  Os dois sobem. Uma entrada inválida é **omitida e NOMEADA** pelo canal `onWarn` — o erro continua
  tipado e visível, apenas deixou de ser fatal para os vizinhos. Um arquivo **impartível** (JSON quebrado,
  `mcpServers` que não é objeto) continua lançando: ali não há entradas para separar.

  **Nenhuma dependência nova.** O transporte remoto já era do SDK — `McpServerConfig` é
  `McpStdioServerConfig | McpHttpServerConfig`, com `type`/`url`/`headers`/`auth`/`requestTimeoutMs`.
  Este pacote declarava um tipo **mais estreito** e recusava o que o runtime aceita; agora re-exporta o
  do SDK. `McpAuthConfig`, `McpHttpServerConfig`, `McpOAuthConfig` e `McpStdioServerConfig` passaram a
  atravessar junto.

  **Mudança de contrato:** `loadMcpJson` deixa de lançar em defeito de entrada. Quem dependia disso
  recebe a entrada omitida e um aviso no `onWarn` opcional; o comportamento em defeito de **arquivo** é
  o mesmo de antes.

  O valor de `headers` nunca entra num aviso — a mensagem descreve a **forma** do campo, nunca o
  conteúdo.

## 6.3.1

### Patch Changes

- 8847d94: Testes do device provider endurecidos após review: o override de `clientId` por ambiente
  (`CODEX_CLIENT_ID_ENV_VAR`) ganhou oráculo — antes era API pública documentada com zero teste, e
  remover a leitura da variável mantinha tudo verde. Um teste que não invocava nenhum símbolo de
  produção (passava com o pacote deletado) foi removido; a cobertura real do caso vive no consumidor.
  Nenhuma mudança de comportamento.

## 6.3.0

### Minor Changes

- e7d99d9: O device flow **RFC 8628** atravessa a camada, e o do Codex também.

  `@theokit/sdk` já implementava o padrão (`deviceLogin`, `requestDeviceCode`, `pollDeviceToken`,
  `DeviceOAuthConfig`), e `@theokit/agents/auth` não re-exportava nenhum deles. Como o consumidor tem
  regra inquebrável de nunca importar `@theokit/sdk*` direto, quem precisasse do padrão tinha duas
  saídas: violar a fronteira, ou reimplementar o protocolo — exatamente a situação que o M73 já
  documentou neste arquivo (_"a lacuna era daqui, não indisciplina de lá"_).

  Medido junto: `openaiDeviceLogin` era **importado** para uso interno do `AuthProvider` e nunca
  re-exportado. Consequência — o flow do Codex só era alcançável construindo um `AuthProvider` (que
  exige `config` + `store`). Ele atravessa agora também.

  As duas formas **coexistem e não são unificadas**: `DeviceOAuthConfig` tem um `deviceCodeEndpoint`
  (RFC); `OpenAIDeviceConfig` tem dois (`deviceUsercodeEndpoint` → `devicePollEndpoint`, com PKCE).
  Fundi-las quebraria o Codex.

  Pass-through **puro**, pelo critério que o M73 escreveu: são funções de I/O sem estado a segurar, e
  envolver quebraria `instanceof`. `tests/unit/auth-parity.test.ts` trava a identidade dos quatro com
  `toBe`.

- 18fa6ef: Autenticar por device flow passa a caber numa chamada, e um provider novo entra sem editar a camada.

  Antes, quem usava `@theokit/agents/auth` para autenticar no Codex precisava saber que existem **duas**
  formas de device flow, copiar o `clientId` e três URLs da OpenAI para dentro do próprio código, montar
  `{ fetch, sleep, now }`, chamar `deviceLogin` e **lembrar** de chamar `persist` — e esquecer o último
  custava um round-trip OAuth completo que não guardava nada.

  Agora:

  ```ts
  import { CODEX_PROVIDER, loginWithDevice } from '@theokit/agents/auth'

  const [metodo] = CODEX_PROVIDER.methods // rotulado, para a sua UI mostrar
  const { path } = await loginWithDevice(CODEX_PROVIDER, metodo, store, { onPrompt })
  ```

  Um provider de terceiro usa a **mesma** chamada: basta construir um `DeviceAuthProvider` com os seus
  métodos. Nada na camada muda.

  **Novos símbolos:** `CODEX_PROVIDER`, `loginWithDevice`, `CODEX_CLIENT_ID_ENV_VAR`, e os tipos
  `AuthMethod`, `DeviceAuthProvider`, `PromptHooks`, `LoginWithDeviceOptions`.

  `AuthMethod` é união discriminada — um método `type: 'oauth'` **tem** de carregar `authorize`, e o
  compilador recusa `{ label, type: 'oauth' }`. Não há discriminante de protocolo: cada método aponta
  para a sua própria função, então o RFC 8628 e a variante da OpenAI coexistem sem `switch` e sem risco
  de serem fundidas.

  `deps` é opcional; `AuthProvider.deviceLogin` e `.persist` continuam públicos para quem precisa da
  granularidade. Nenhum símbolo existente mudou de assinatura.

## 6.1.1

### Patch Changes

- M107 (review HIGH-2) — require `@theokit/sdk@^4.37.0`, not `^4.36.0`.

  `6.1.0` shipped with `^4.36.0`, so a fresh install could resolve `4.36.0` — where `Agent.list`
  **silently ignores the `cwd` it advertises**. That is not a cosmetic mismatch: a consumer that
  narrows a listing by workspace to decide which sessions are still active would get the _process_
  directory's answer instead, and this project consumes exactly that list to protect transcripts from
  deletion.

  The range now names the version that actually honours the contract. Nothing else changed; `6.1.0`
  and `6.1.1` are byte-identical apart from this field. Consumers already resolving `4.37.0` (through
  an override or a fresh install) were never affected.

## 6.1.0

### Minor Changes

- 3575c8e: Two additions: `loadMcpJson(cwd)` reads the `.mcp.json` project convention from disk, and `reasoningEffortOf(model)` reads back the reasoning effort that `buildModelSelection` writes.

  **`loadMcpJson(cwd)`** — the layer already shipped the rare MCP cases (`resolveMcpServers` for per-request selection, `mcpRegistry` for a known provider) and not the common one: reading `<cwd>/.mcp.json`, the convention Claude Code and Cursor established. Every application that wanted it wrote the loader by hand, which is why the same 120-odd lines of read-parse-validate exist in more than one consumer.

  It returns the `McpServersMap` the package already exports — no new type. An **absent** file returns `{}`, because MCP is opt-in and a project without the file is a project without MCP. A **present but broken** file throws `McpFileError` naming the path: a read failure, invalid JSON, a root that is not an object, a server without a non-empty `command`, or an `args`/`env`/`cwd` of the wrong type. A valid JSON object with no `mcpServers` key returns `{}` — that is a project declaring no server, not a malformed file. An empty (0-byte) file is invalid JSON and throws, deliberately: "absent" and "present and empty" are different situations, and treating the second as `{}` would disable MCP in silence.

  `McpFileError` descends from `TheokitAgentError`, so `isTransientError` classifies it like every other error from this package (`isRetryable` is `false` — a malformed config file does not improve on retry).

  **Scope, so it is not a surprise later:** stdio servers only. HTTP/SSE entries are not accepted in this release. Widening it later is additive and breaks nothing written against this version.

  **`reasoningEffortOf(model)`** — the inverse of `buildModelSelection`, which is documented as the single site that maps a reasoning effort onto a `ModelSelection`. Only the write half was public, so callers that needed to read the effort back re-derived the parameter key by hand. Two spellings of one key drift apart quietly; now both directions live in one module and share one constant.

  It accepts a bare model id or a full selection, and returns `undefined` when there is no effort to read — a string id, a selection without parameters, or parameters that do not include the reasoning key. None of those throw: absence is a normal answer, not a failure. A value that is present but not one of the documented levels comes back **verbatim**, and the return type is `string | undefined` for exactly that reason: validating the value stays with the caller, and typing the result as the effort union would promise a check this function does not perform.

  Both symbols are reachable from the package root and from `@theokit/agents/bridge`.

## 6.0.0

### Major Changes

- 24c8011: **BREAKING:** `Agent.list` no longer accepts `limit` or `cursor`, and its result no longer declares `nextCursor`.

  The SDK's type promises all three; the runtime references none of them — `Agent.list` reads only `options.runtime`. A caller that writes `limit: 500` against a 688-entry registry believes it asked for a bounded page and silently gets the whole set, and on the day the runtime starts honouring the parameter that _same_ line silently gets a truncated one instead. Both directions are silent, and the consumer that motivated this change feeds the result into a NEVER-delete guard of a session garbage collector: a truncated list there means deleting a transcript the guard should have protected.

  This is a type-only change — the exported value is still the SDK's `Agent`, asserted by identity in `tests/unit/agent-list-narrowed.test.ts`. Every other static (`create`, `getOrCreate`, `get`, `delete`, `archive`, `unarchive`, `rename`, `compact`, `listRuns`, `getRun`, `registry`) keeps its shape, asserted in `tests/type/agent-list-narrowed.test-d.ts`.

  Migration is one line per call site: delete the `limit`/`cursor` property. The result is the full population, which is what the runtime was already returning.

  Exit criterion, written in `src/index.ts` next to the narrowing: when the SDK runtime actually honours `limit`/`cursor`/`cwd`, delete the block and restore the plain re-export.

## 5.0.0

### Major Changes

- 6aa5b6d: **BREAKING:** `toAgentFactory` now requires an `approvals` option declaring the surface's `ApprovalPosture` — one of `interactive`, `auto-approve`, `auto-reject` or `owned-by-surface`.

  Until now the factory compiled the HITL gate map that `.approvals({…})` produces and then discarded it, so tools declared as requiring approval executed with no policy consulted — while the sibling bridge (`streamAgentTurnInProcess`) refused for the same definition. The permissive behaviour is still fully available; it just has to be named, with a written reason, instead of happening by omission. Migration is one line per call site: pass the posture that describes what your surface actually does.

  `streamAgentTurnInProcess` also accepts `approvals`, but additively — omitting it preserves today's fail-closed refusal exactly.

## 4.30.2

### Patch Changes

- O mapeamento de erro do SDK para o evento de stream ganha módulo próprio.

  Um mapeador puro, com o mesmo tratamento que a seleção de modelo já tinha. Ter casa própria também deixa óbvio que existe **um** lugar construindo o evento de erro — antes era um objeto literal dentro de um `catch`, e era exatamente ali que o código do erro se perdia.

## 4.30.1

### Patch Changes

- Re-exporta a consulta que responde se uma sessão já tem escritor, sem tomar a trava.

## 4.30.0

### Minor Changes

- O chunk de erro do stream passa a carregar o código do erro, não só o texto.

  Uma falha de runtime não sobe como exceção para quem consome o stream — é convertida num chunk de erro, e esse é o contrato. Mas o chunk levava **só a mensagem**, então um consumidor que precise distinguir a falha (por exemplo, derivar uma sessão nova quando a original já tem escritor) não tinha alternativa senão casar texto de mensagem de erro. O código sempre existiu no evento de origem; ele só não atravessava. Um erro sem código continua exatamente como antes.

## 4.29.1

### Patch Changes

- Corrige um turno que quebrava quando a janela de contexto era declarada na seleção de modelo.

  A versão anterior passou a **aceitar** a seleção completa em `AgentBuilder.model()` e parou aí: o caminho de runtime por onde todo turno passa continuava assumindo um id em texto, e aninhava a seleção dentro de si mesma. O resultado era uma falha em **todo** turno de quem declarasse a janela. Passar um id continua funcionando exatamente como antes, e a janela declarada agora sobrevive à conversão.

## 4.29.0

### Minor Changes

- `AgentBuilder.model()` aceita `ModelSelection`, não só o id cru.

  A implementação do SDK sempre aceitou as duas formas; era a fachada tipada desta camada que estreitava para `string`. O estreitamento tornava **inalcançável** qualquer campo da seleção — incluindo a janela de contexto que o SDK passou a publicar. Passar um id continua funcionando exatamente como antes.

## 4.28.0

### Minor Changes

- M94 — re-exporta os resolvedores que o SDK passou a publicar.

  - `transcriptRoot` — a raiz do estado de transcript, que honra `THEOKIT_HOME`. O consumidor a duplicava em três arquivos, e as três cópias ignoravam a variável junto com a original.
  - `TranscriptMessage` / `TranscriptBlock` — a forma do corpo de um registro de sessão, que antes era `Record<string, unknown>` e obrigava o consumidor a recuperar o tipo com cast a cada leitura.

  `Provider.forModel` já atravessa a camada pelo re-export existente de `Provider`.

## 4.27.1

### Patch Changes

- 191aef8: **Correções da revisão adversarial do M92 — dois BLOCKERs e três furos de eviction.**

  - **O `concat` que o `4.27.0` prometeu e não entregou.** O `#prefixo` era um **alias** do `#committed`
    (mesma referência) e o `#emit` continuava espalhando: byte-idêntico ao anterior, medido em ~2 µs @400.
    Agora é um `concat` único. O ganho é de constante, não de ordem — e é honesto dizer isso.
  - **O coalescing não tinha teste capaz de falhar.** Substituir o corpo inteiro de `#agendarEmit` por
    `return` deixava **580/580 verdes**: os testes instalavam timers falsos e nunca os avançavam, e só
    exercitavam `reset()`, que faz flush síncrono por decisão. Os testes novos dirigem 30 deltas por um
    transporte falso e medem a razão de emits — **32 contra 2**, e o mutante mata 2 testes.
  - **Três furos na eviction de aprovação, todos medidos:**
    - Sinal **já abortado** no `sendMessages` não dispara `addEventListener`, então uma aprovação que
      estacionasse depois ficava pendente para sempre — o travamento que o milestone existe para fechar,
      alcançável por outro caminho. Agora o sinal é consultado **no momento em que a aprovação estaciona**.
    - O turno era lido de um **campo compartilhado**, então um runner do turno 1 estacionando depois do
      `send` do turno 2 nascia etiquetado turno 2 e o abort do turno 1 não o alcançava. O turno passou a
      viver num **closure por turno** — o único lugar onde não é sobrescrito.
    - Rejeitar sem handler mata o processo em Node ≥ 15; o caminho tem teste.

## 4.27.0

### Minor Changes

- f486258: **O stream ganha coalescing opt-in, e o transporte para de vazar aprovação estacionada.**

  - **`AgentClient` cacheia o prefixo commitado.** `#committed` só muda em dois lugares (o `done` de
    `send()` e o `reset()`), então reconstruí-lo por delta de token era trabalho que a estrutura já
    garantia inútil. Honestidade sobre o tamanho: medido, o spread custa **0,0062 ms por delta @400
    mensagens** — 3,1 ms no turno inteiro. É real e é micro.
  - **Coalescing opt-in: `new AgentClient(transport, ctx, { emitIntervalMs })`.** Sem o campo, emite por
    delta como sempre. É aqui que está a ordem de grandeza: o que pende de cada emit é a derivação da
    timeline, medida em **3,274 ms por chamada** no mesmo tamanho de thread — **≈ 528×** o spread. O
    coalescing não torna o emit mais barato; faz **menos emits acontecerem**. As transições de status
    (`done`/`error`/`abort`) fazem **flush síncrono**, porque um estado final preso num timer de 16 ms é
    um estado final perdido se o processo sair antes.
  - **`InProcessTransport` evicta aprovação de turno abortado**, rejeitando com `ApprovalAbortedError`.
    Antes, `#pending` guardava só o `resolve` e nada apagava a entrada: a promessa ficava pendente **para
    sempre** e a chamada de tool do SDK pendurava com ela. Uma promessa que nunca resolve **nem** rejeita
    é a forma mais silenciosa de engolir um erro — nem stack trace existe. Rejeitar e não `resolve(false)`
    porque `false` é indistinguível de _"o usuário negou"_: negar é decisão, abortar é interrupção. As
    entradas passaram a ser chaveadas por turno, então um `send()` novo varre o anterior.

## 4.26.2

### Patch Changes

- 379e5c0: **Restaura a compatibilidade que o `4.26.0` quebrou em silêncio: `BudgetExceededError` volta a ser a
  classe de DELEGAÇÃO no barril raiz.**

  O `4.26.0` **reaproveitou** o nome — o barril passou a exportar a classe do SDK (orçamento de JANELA)
  sob `BudgetExceededError`. Medido contra os tarballs publicados:

  |                                                   | 4.25.1   | 4.26.1                                           |
  | ------------------------------------------------- | -------- | ------------------------------------------------ |
  | `new BudgetExceededError('agente', 5, 1)` da raiz | funciona | `TypeError: Cannot read properties of undefined` |
  | raiz `===` `/bridge`                              | `true`   | `false`                                          |

  Para quem estava em `^4.25` com `catch (e) { if (e instanceof BudgetExceededError) … }`, o ramo de
  orçamento de delegação **deixou de casar, em silêncio** — o modo de falha exato que o rename existia
  para matar, em espelho, e publicado como MINOR.

  Agora: `BudgetExceededError` é o alias `@deprecated` de `DelegationBudgetExceededError` — mesma
  identidade referencial de sempre, zero quebra. A classe do SDK atravessa como
  `WindowBudgetExceededError`, que fecha a lacuna original **sem redefinir o que um nome significa**.
  Travado por `tests/unit/erro-de-dominio.test.ts`, que assere `barril.BudgetExceededError` **é** a
  classe de delegação e que as duas são classes distintas.

## 4.26.1

### Patch Changes

- 228d423: Corrige o tipo de `SdkAgentHandle.send` introduzido no `4.26.0`: ele devolve
  `Promise<SdkTurnHandle>`, não `SdkTurnHandle`.

  `SDKAgent.send` é `(message, options?) => Promise<Run>`, e o `GoalLoopAgent` do SDK declara
  `send(prompt): Promise<{ wait(): … }>`. A primeira versão do tipo era síncrona — e o detalhe é que o
  `tsc` do consumidor **não teria pegado**, porque o adaptador que este milestone existe para apagar
  (`runner-facade.ts`, com um `as never` na origem) absorvia exatamente essa diferença.

  É a divergência que o docstring daquele adaptador descrevia, reencontrada ao tentar removê-lo — a
  prova de que o `unknown` não era só feio: ele desligava a checagem no ponto onde o contrato importa.

## 4.26.0

### Minor Changes

- 3fb0d9e: **Contratos de tipo honestos: a camada passa a devolver o tipo que já sabe.**

  - **`toAgentFactory` aceita um THUNK de definição** — `(sessionId) => AgentDefinition`. O parâmetro
    `apiKey` já aceitava thunk desde o M74, adicionado por exatamente esta razão; a assimetria custava
    caro: com a forma objeto, trust, hooks, skills e MCP são compilados no load do módulo e ficam
    **congelados para o processo inteiro**. Num `theokit acp` que uma IDE mantém aberto por horas, isso
    reintroduzia a obsolescência que o M67 removeu. A forma objeto continua **byte-idêntica** — projeta
    uma vez, fora do closure; só o thunk paga por sessão.
  - **`SdkAgentHandle.send` deixa de ser `=> unknown`** e passa a `(msg, opts?) => { wait(): … }`, com
    `SdkSendOptions`/`SdkTurnHandle` publicados. O `unknown` custava ao consumidor um módulo inteiro de
    38 linhas cujo único trabalho era re-estreitar este retorno — e o docstring daquele módulo registra
    que, antes dele, o chamador escrevia `as never`, sob cuja capa a superfície goal divergiu do agente
    real por vários milestones.
  - **`Toolset` é a primitiva que faltava** (`@theokit/agents` barril). Coleção nomeada e imutável com
    política de resolução que falha alto em nome **desconhecido** e em **duplicado** — nos dois casos, o
    silêncio seria uma mudança de autoridade não observável, que é o que uma whitelist existe para
    impedir. **Não prefixa namespace**: o nome de uma tool é contrato com o modelo. Não constrói tools —
    quais e com que escopo é decisão do consumidor.
  - **`BudgetExceededError` → `DelegationBudgetExceededError`**, com alias `@deprecated` por uma major.
    O nome antigo **sombreava** a classe homônima do SDK (orçamento de JANELA contra orçamento de
    DELEGAÇÃO), e como o consumidor tem regra de nunca importar `@theokit/sdk` direto, ele nunca
    alcançava a do SDK: `instanceof` casava com o domínio errado **em silêncio**. O barril agora exporta
    as duas. A `lacuna` registrada em `subpath-coverage.test.ts` saiu junto com o conflito que a criou.

## 4.25.1

### Patch Changes

- 5167910: **Corrige uma regressão de superfície introduzida no `4.25.0`: `TruncationMode` voltou a ser exportado
  por `@theokit/agents/tools`.**

  A entrada do `4.25.0` afirma _"172 símbolos, superfície preservada inteira (nada sai)"_. Isso era falso:
  o gerador de re-exports rodou contra uma cópia local de `@theokit/sdk-tools@0.26.0` (92 exports)
  enquanto o registro já publicara `0.26.1` (93, com `TruncationMode`). O peer é uma faixa flutuante
  (`>=0.24.1 <1.0.0`), então consumidores instalavam a versão nova e perdiam o símbolo: sob `export *` ele
  atravessava; enumerado a partir da cópia velha, sumiu. A entrada anterior não pode ser editada, então
  a correção fica aqui.

  O gate que deveria ter pego isso era **vacuo para `/tools` e `/pty`** — 98 dos 173 símbolos, 57% da
  superfície. Ele comparava _a fonte_ contra o snapshot, e nunca _a camada_ contra a fonte; remover
  símbolos reais desses dois entries deixava a suíte inteira verde. `tests/unit/subpath-surface.test.ts`
  passa a enumerar o `dist/*.d.ts` **emitido** e a comparar nas duas direções (nada da fonte falta na
  camada; nada na camada é inventado), e deixa de engolir a ausência de `dist/`, que o fazia passar por
  vacuidade num clone sem build.

  Superfície agora: **173 símbolos** (`tools` 93, `sandbox` 36, `persistence` 29, `pty` 6,
  `interactive` 9).

## 4.25.0

### Minor Changes

- 9aea11c: Os cinco subpaths de infra (`/tools`, `/sandbox`, `/persistence`, `/pty`, `/interactive`) deixam de ser
  alias e viram camada.

  Até aqui, o corpo inteiro de cada `*-entry.ts` era uma linha `export *`, e o `dist/*.d.ts` emitido
  carregava a mesma coisa: o pacote emprestava o nome sem interpor decisão. Um rename upstream se
  propagava verbatim, **sem erro de build aqui**, e o consumidor descobria em call site.

  Agora os cinco enumeram — **172 símbolos**, superfície preservada inteira (nada sai; reduzir seria
  breaking, e a regra do `auth-entry.ts` desde o M73 é que enriquecer nunca reduz). Medido lado a lado no
  mesmo cenário de rename: com `export *` o build passa; com lista nomeada, `tsc` reprova com `TS2724` e
  sugere o nome novo.

  Acompanham a mudança um snapshot da superfície sobre `dist/*.d.ts`
  (`tests/unit/subpath-surface.test.ts`) e a promoção dos três subpaths de SDK em
  `subpath-coverage.test.ts` de `cobertura: 'amostra'` com lista **vazia** para `'total'`.

## 4.9.1

### Patch Changes

- O retry com backoff do refresh de OAuth passa a existir de fato no caminho de execução. As funções que
  classificam a falha e calculam a espera estavam presentes e testadas, mas nenhuma era chamada — uma
  reescrita de bloco as desconectou, e os testes que existiam validavam o classificador isolado, o que
  não prova que ele está ligado. Uma falha transitória agora é repetida até três vezes; `invalid_grant`
  continua falhando na primeira, porque repetir um token revogado só atrasa a mensagem.

## 4.9.0

### Minor Changes

- `toAgentFactory` também aceita um resolvedor de credencial (`() => string | Promise<string>`), resolvido
  quando a sessão é criada.

  A 4.8.0 alargou `AgentRunnerRunOptions.apiKey`, que é um seam real — mas não é o que as superfícies de
  consumidor usam. Um cliente ACP, um loop autônomo e uma delegação de time constroem o agente por
  `toAgentFactory`, e ali a credencial continuava sendo uma string obtida antes. O alargamento sem este
  complemento não alcançava nenhuma das três.

## 4.8.0

### Minor Changes

- `AgentRunnerRunOptions.apiKey` passa a aceitar um resolvedor (`() => string | Promise<string>`) além do
  valor. Ele é chamado quando o stream começa, não quando o agente é construído.

  O ponto de injeção já era por run; o que travava era o tipo. Com `string`, quem chama precisa ter o
  valor em mãos antes — então o momento era por run, mas o valor era obtido antes e congelado, e um
  bearer OAuth de validade curta atravessava a run inteira sem ser reconsultado. Uma sessão de IDE que
  dura horas, um loop autônomo de vinte turnos e uma delegação de time longa exibem o mesmo sintoma.

  `string` continua válido e continua sendo o caminho de quem usa chave de API: ela não expira, e exigir
  um resolvedor ali seria cerimônia sem ganho.

  O refresh de OAuth passa a rodar sob lock entre processos, com releitura depois de adquiri-lo — sem a
  releitura o lock apenas serializa, e o segundo processo refresca com estado velho, invalidando o token
  que o primeiro acabou de gravar. Como o lock não é reentrante e o resolvedor agora é chamado de dentro
  do stream, há um single-flight em processo antes dele: uma execução aninhada resolve pela promise em
  voo em vez de disputar o arquivo consigo mesma.

  Falhas de refresh passam a ser classificadas: rede e 5xx são repetidos com backoff e jitter,
  `invalid_grant` falha na primeira tentativa. Repetir um token revogado só atrasa a mensagem que o
  usuário precisa ler. A mensagem de erro nunca carrega material de token.

## 4.7.0

### Minor Changes

- `@theokit/agents/auth` passa a re-exportar a mecânica de store do `@theokit/sdk/auth` como
  pass-through puro: `credentialHome`, `authFilePath`, `CredentialError`, `readAuthFile`,
  `readStoredOAuth`, `writeCredential` e o tipo `ResolveCredentialOptions`.

  O subpath exportava um valor e seis tipos contra os dezenove símbolos do SDK — nenhuma função
  atravessava. Para um consumidor que não pode importar `@theokit/sdk*` direto, reimplementar era a
  única saída legal; um deles reescreveu seis destes nomes. A camada existe para enriquecer, e enriquecer
  nunca deve reduzir.

  Pass-through puro, e não wrapper: são funções de I/O sem estado a segurar, e envolvê-las quebraria
  `instanceof` para quem captura `CredentialError`. O novo `check:auth-parity` exige decisão escrita por
  símbolo do SDK — coberto, ou fora de escopo com a razão — para que a lacuna não se repita em silêncio.

  `resolveCredential` deliberadamente não atravessa: o SDK e o consumidor têm funções diferentes com
  esse nome, e o próprio SDK declara a precedência de env e a inferência de provider como política do
  consumidor.

## 4.6.0

### Minor Changes

- M63 — close the `SDK → Theokit → AgentBuilder` boundary: the main barrel now also re-exports
  `SubAgent` (the a2a delegation primitive, `SubAgent.create()`) and the pure `path-safety` helpers
  (`assertNoSymlinkEscape`, `isForbiddenPath`, `safePathJoin`). Same PASS-THROUGH doctrine as the M58
  core re-exports (parsimony Rung 9 — already the target OO/pure shape, wrapping would be ceremony), so
  a consumer can import ITS full runtime surface from `@theokit/agents` without touching `@theokit/sdk*`
  directly. Additive only — no existing export changes.

## 4.5.0

### Minor Changes

- `@theokit/agents/tools` — pass-through of the `@theokit/sdk-tools` factory surface (M62).

  The consumer imports its ready-made built-in tools (`createReadFileTool`, `createShellTool`, … +
  `withName`/`withDescription`) from the Theokit layer instead of `@theokit/sdk-tools` directly. Pure
  re-export, never enriched (parsimony Rung 9 — the sugar is the SDK-tools' own; wrapping it would be
  reinventing, blueprint Q5). A surface test locks the 16 symbols the consumer uses. `@theokit/sdk-tools`
  stays an OPTIONAL peer (only consumers of this subpath need it) and its range moves to `>=0.20.0` —
  the newer tool factories (`createCurrentTimeTool`/`createInteractiveShellTool`/`createUpdatePlanTool`/
  `createWriteStdinTool`) live there.

## 4.4.0

### Minor Changes

- ee9fb7b: Unify `ConfigurationError` on the SDK's class (M61).

  `@theokit/agents` used to define its own `ConfigurationError extends Error` while `@theokit/sdk`
  shipped a separate `ConfigurationError extends TheokitAgentError`. A `catch (e instanceof
ConfigurationError)` caught one throw path and silently missed the other. The layer now RE-EXPORTS the
  SDK's class, so authoring throws (`@theokit/agents`) and runtime throws (`@theokit/sdk`) are the SAME
  class — `instanceof` holds across the boundary in both directions. Existing single-arg
  `new ConfigurationError('msg')` calls are unchanged (the SDK options are optional); the class stays
  `instanceof Error`. Decision in `knowledge-base/adrs/0006-configuration-error-unification.md`.

## 4.3.1

### Patch Changes

- M60 follow-up: `AuthProvider.ensureFresh(resolved, deps, env)` — the HTTP deps and `env` are now
  separate params (was a single `opts` bag). Corrects the just-shipped 4.3.0 shape before any consumer
  depends on it; behavior (delegation to `ensureFreshCredential`) is unchanged.

## 4.3.0

### Minor Changes

- `AuthProvider` — the OO OAuth-lifecycle contract at `@theokit/agents/auth` (M60).

  The SDK ships OAuth as free functions stateful across a shared config + store
  (`openaiDeviceLogin` → `persistOAuthTokens` → `ensureFreshCredential`). The Theokit layer now unifies
  them into an `AuthProvider` class that HOLDS the `config`+`store` and delegates each step, so a
  consumer authors `new AuthProvider(config, store).persist(...)` / `.ensureFresh(...)` instead of
  threading the shared state through every call. Enrich, not pass-through (auth carries state); it
  DELEGATES, never reimplements (Rung 9) — login → persist → refresh yields identical state. SECRET-SAFE
  by contract: the wrapper never logs or emits token material (pinned by a secret-safety test). The auth
  domain's types (`OAuthProviderConfig`/`CredentialStoreConfig`/`OpenAIDeviceConfig`/`ResolvedCredential`/
  `OAuthTokens`/`DeviceDeps`) are re-exported alongside it.

## 4.2.2

### Patch Changes

- fb89c9e: Fix: the goal domain types (`GoalEvent`/`GoalLoopAgent`/`GoalOptions`/`GoalResult`) are now actually
  re-exported from the top-level barrel (the M59 re-export was only reachable from the loop submodule).

## 4.2.1

### Patch Changes

- 87fa3bb: Re-export the goal domain's types alongside `GoalRunner` (M59 follow-up).

  `GoalEvent`, `GoalLoopAgent`, `GoalOptions`, `GoalResult` now travel with `GoalRunner` from
  `@theokit/agents`, so a consumer types against the goal surface entirely from the Theokit layer
  without reaching back to `@theokit/sdk`.

## 4.2.0

### Minor Changes

- 7e37347: `GoalRunner` — the OO twin of the SDK's free `runGoalLoop` (M59).

  The layered boundary continues: the SDK ships goal orchestration as a free function
  (`runGoalLoop(agent, goal, options, deps)`); the Theokit layer now imposes its OO shape with a
  `GoalRunner` class parallel to `AgentRunner`, so a consumer authors `new GoalRunner(agent).run(goal,
options)` instead of a bare call. Unlike the M58 pass-through barrels, this ENRICHES an orchestration
  primitive with a contract — but it DELEGATES, never reimplements (parsimony Rung 9): `run` forwards
  verbatim to `runGoalLoop`, so the emitted `GoalEvent` stream and the final `GoalResult` are identical.
  A parity test pins that both ways (exact forwarded tuple + identical stream/result).

## 4.1.0

### Minor Changes

- dd044c1: Pass-through barrels for the 5 already-OO / pure SDK domains (M58).

  The layered boundary `SDK → Theokit → AgentBuilder`: `@theokit/agents` now re-exports the SDK domains
  that are already object-oriented or pure helpers, so a consumer imports them from the Theokit layer
  instead of `@theokit/sdk*` directly. Re-export, never a wrapper (parsimony Rung 9) — wrapping
  `Agent.create()` or a pure `transcriptPath()` would be ceremony without value.

  - **core** (main barrel): `Agent`, `Squad`, `Tool`, `Provider` + `SDKAgent` / `CustomTool` /
    `SessionRecord` types.
  - **`@theokit/agents/sandbox`**: `LocalSandbox`, `SandboxBackend`, `SandboxConfig`.
  - **`@theokit/agents/persistence`**: `transcriptPath`, `encodeProjectDir`, `atomicWriteText`,
    `SessionRecord`.
  - **`@theokit/agents/interactive`**: `InteractiveBackend`, `StartInteractiveOptions`,
    `StartInteractiveResult`.
  - **`@theokit/agents/pty`**: `PtyInteractiveBackend` (optional peer `@theokit/sdk-pty` — only consumers
    of this subpath need it installed).

  A surface test locks each barrel's symbols so a dropped re-export fails loudly. The `@theokit/sdk`
  peer range moves to `^4.19.0` — the `/interactive` and `/sandbox` subpaths this layer re-exports live
  there. Consumers already on SDK 4.19+ are unaffected.

## 4.0.0

### Major Changes

- fcd1536: Authoring surface is now 100% object-oriented (M57) — the free "sugar" factories are gone.

  The ~14 free capability factories and the two free builders are replaced by classes and static
  factories, finishing the `X.create()` migration `@theokit/sdk` completed at v3.0. One idiom, aligned
  with the runtime this layer wraps.

  **BREAKING — mechanical 1:1 rename, no behaviour change:**

  ```ts
  // before                          // after
  memory(x)                          new MemoryCapability(x)
  skills(x)                          new SkillsCapability(x)
  contextWindow(x)                   new ContextWindowCapability(x)
  checkpoint(x)                      new CheckpointCapability(x)
  subAgents(x)                       new SubAgentsCapability(x)
  projectContext(x)                  new ProjectContextCapability(x)
  mcpServers(x)                      new McpServersCapability(x)
  guardrails(x)                      new GuardrailsCapability(x)
  humanInTheLoop(x)                  new HumanInTheLoopCapability(x)
  skillsOptions(x)                   new SkillsOptionsCapability(x)
  settingSources(x)                  new SettingSourcesCapability(x)
  plugins(x)                         new PluginsCapability(x)
  runContext(x)                      new RunContextCapability(x)
  skillsResolver(x)                  new SkillsResolverCapability(x)
  agent()                            AgentBuilder.create()
  contextualTool(t)                  ContextualTool.of(t)
  ```

  The nine pure-assignment capabilities share a `FieldCapability` base (one line each); the five that
  carry behaviour (validation / delegation / merge / storage-metadata warning) keep the exact body.
  `AgentBuilder` / `ContextualTool` are each a type (generic interface) and a value (static factory) at
  once — the fluent type-state chain is unchanged.

  Zero-behavior: the deterministic suite (608) and type suite (104) pass without editing a single
  expectation after repointing call-sites. Reverses ADR 0001 § 4; rationale in
  `knowledge-base/adrs/0005-sugar-to-oo.md`.

## 3.0.0

### Major Changes

- 0e4ea93: Inject a custom loop stop-criterion via `AgentRunnerBuilder.loopStrategy(custom)` (M54).

  **MAJOR — type-level break.** `LoopStrategy.name` changed from the `'simple-chat' | 'plan-act-reflect' | 'react'` union to `string`. A consumer doing an exhaustive `switch (strategy.name)` over the three literals (no `default`) will now fail to typecheck — `string` is not exhausted by three cases. There is no runtime-only semver policy in this repo, so a source-breaking type change takes a major bump (M54 review F-3).

  The runner already let you inject reflection, compaction, and the round stream factory; the stop
  criterion (`LoopStrategy.shouldContinue`) was the one axis locked to three built-in names. Now:

  ```ts
  const stopWhenConfident: LoopStrategy = {
    name: 'confident',
    maxIterations: 8,
    shouldContinue: (o) => !o.responseText.includes('confidence: high'),
  }
  AgentRunner.fromSpec(spec).loopStrategy(stopWhenConfident).build()
  ```

  The injected strategy WINS over the strategy the spec's name would resolve to, exactly as
  `.compaction()` outranks the spec.

  **The ceiling is now the runner's guarantee, not each strategy's convention.** Previously the three
  built-ins embedded `round < maxIterations` inside their own `shouldContinue`, so a custom that never
  returned `false` would loop forever. The runner now caps every strategy at `maxIterations` — a
  `shouldContinue: () => true` terminates at the ceiling with `finishReason: 'step_limit'`.

  **Type change (note):** `LoopStrategy.name` is now `string` (was the `'simple-chat' |
'plan-act-reflect' | 'react'` union) so a custom can name itself freely. The internal resolver still
  validates the three built-in names via Zod; a custom never passes through it. Code that reads
  `strategy.name` expecting the exhaustive union should widen to `string`.

## 2.0.0

### Major Changes

- 96c0b05: Remove the backward-compatibility concessions the previous release carried (M56).

  **BREAKING — `ToolboxCapability.compile()` deleted.** It had zero callers anywhere and was kept only
  because removing a public method breaks consumers. `apply()` is the one path an agent's tools flow
  through. If you called `compile()` directly, apply the capability instead:
  `applyCapabilities([new ToolboxCapability(...)])`.

  **`ConfigurationError` is still exported from the package root — only the internal duplicate
  re-export was removed.** It used to reach the barrel through a compat shim in
  `capability/capabilities.js`; M56 removes the shim and pins the class to the barrel directly, so
  `import { ConfigurationError } from '@theokit/agents'` keeps working. Only a deep import from the
  internal `capability/capabilities.js` path — never a documented entry point — is affected. A
  `public-api-surface` test now locks the root export in place.

  Also in this release: the two `compileTools` failure paths that threw a bare `Error` (missing toolbox
  instance, non-method handler) now throw the typed `ConfigurationError` the rest of the module uses, so
  an authoring mistake is distinguishable from an unexpected runtime failure.

## 1.1.0

### Minor Changes

- Tool names are now validated where they are minted, against all three rules the SDK enforces.

  The fix for #145 changed the namespace separator but replicated only **one** of the three rules
  `@theokit/sdk`'s `validateToolName` imposes. The rule it missed was live: a toolbox with
  `namespace: 'mcp'` minted `mcp_*`, passed authoring validation, and was **rejected by
  `Agent.create`** with `tool_reserved_name` — the same defect class as #145, on a different axis.

  Validation now lives inside `toolRuntimeName`, the only function that mints a runtime name, so no
  path can escape it — including `compileTools`, which is exported publicly. The message names the
  offending **composed** name (the parts often look valid alone) and tells "the composition overflowed
  64 characters" apart from "invalid character".

  **Behavior change:** `compileTools` now throws `ConfigurationError` at compile time for a
  namespace/tool pair that previously failed later, at `Agent.create`. No working agent breaks — a
  name that reaches this error was already being rejected downstream; it now fails earlier and says
  why.

  Also: the HITL gate map and the tool registry are derived from a **single** structure instead of
  being built twice. Building them twice is exactly how they drifted apart in #145 — the tool became
  `ns_tool` while its gate stayed `ns.tool`, silently ungating it. No observable output change.

## 1.0.1

### Patch Changes

- c2454f5: **Fix #145 — a namespaced toolbox produced a tool name the SDK rejects.**

  `toolRuntimeName` joined namespace and tool with `.`, which is outside the charset `@theokit/sdk`
  accepts (`/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/`). Every namespaced toolbox therefore failed at
  `Agent.create` — a **documented** path that never worked against a real provider, unnoticed since M4
  because the suites mock the SDK.

  - Separator is now `_` (`ops_deploy`). No consumer had the old form working, so the break is
    theoretical; update any hardcoded gate key or allow-list entry.
  - The name is validated at **authoring** time: a namespace that cannot mint a valid name throws a
    typed `ConfigurationError` instead of exploding when the model calls the tool.
  - `ToolboxCapability` no longer duplicates the HITL key construction — that duplication is what let
    the gate drift from the tool (silently ungating a gated tool when the separator changed).

  The regression test does **not** mock `@theokit/sdk`: it calls the real `Agent.create`, whose name
  validation runs before any network.

## 1.0.0

### Major Changes

- b77cf03: **Agent decorators removed — authoring is now capability composition (M53).**

  BREAKING for `@theokit/agents`: every **agent** decorator is gone. The `@theokit/http` **controller**
  decorators (`@Controller`/`@Get`/`@Post`/`@UseGuards`) are untouched.

  - **Removed:** `@Agent`, `@MainLoop`, `@Tool`, `@Toolbox`, `@HumanInTheLoop`, `@Skills`, `@Memory`,
    `@ContextWindow`, `@ProjectContext`, `@MCP`, `@Guardrails`, `@Checkpoint`, `@SubAgents`,
    `@Compaction`, `@Gateway`, `@Trace`, `@Audit`, `@RequiresApproval`, `@Mixin` — plus nine that
    wrote metadata **no production code read** (`@Artifact`, `@Hook`, `@Observable`, `@Sandbox`,
    `@EditFormat`, `@Model`, `@RequiresCapability`, `@Policy`, `@Budget`). `@Model` never set the
    model and `@Sandbox` never sandboxed anything; deleting them removes no behavior.
  - **Replacement:** `applyCapabilities([...])` composing `ModelCapability`, `AgentConfigCapability`,
    `MainLoopCapability`, `ToolboxCapability`, `skills()`, `memory()`, `mcpServers()`, `guardrails()`,
    `checkpoint()` and friends. Conflicting declarations now fail with a typed
    `CapabilityConflictError` instead of last-write-wins, and `provenance` records which capability
    contributed each field.
  - **Also removed:** `bridge/walk-agent-metadata.ts` (the metadata walk) and `compileAgent`. The
    `reflect-metadata` **required peer dependency** and `experimentalDecorators`/
    `emitDecoratorMetadata` are gone from `packages/agents` — consumers of the agent surface can drop
    all three.
  - **BREAKING for `@theokit/http`:** `TheoApp.create({ agents })` and `agentsPlugin({ agents })` take
    prepared entries (`{ name, route, compiled }`) instead of decorated classes; `delegate()` and
    `AgentRunner` take a spec instead of a class (`AgentRunner.builder(Class)` →
    `AgentRunner.fromSpec(spec)`).

  Migration guide with the full decorator→capability map: [`MIGRATION.md`](./MIGRATION.md).

  Two real defects were found and fixed while doing this: every HTTP-served agent was silently running
  the **fallback model** (`@Agent({ model })` and `llmModel` were both dropped because `walk` was
  passed where `compiled` was expected, through an untyped dynamic import), and the agents branch of
  `TheoApp` had **no test at all** — `@theokit/agents` was never declared in `packages/http`'s
  `package.json`, so nothing could link it.

## 0.47.0

### Minor Changes

- 5793ec1: Capability core for agent authoring (M52). `@theokit/agents` gains `Capability` — a two-member contract (`name`, `apply`) that enriches the EXISTING `CompiledAgentOptions` waist instead of inventing a parallel representation. Ships `ModelCapability` / `ToolsCapability` / `skills()`, a `CapabilityRegistry` (which unlocks declaring an agent from a config FILE, not only from code), `CapabilityPreset` (a preset behaves as one capability), typed fail-fast conflicts (`CapabilityConflictError`, whose message reports a value's SHAPE and never its content, since a config-built draft can carry tokens), and `provenance` so composition is auditable.

  Proven zero-behavior: the capability path is deep-equal to BOTH the `defineAgent` compiler and the decorator `compileAgent` — the artifact M53 deletes — at the waist and through the shared `Agent.create` projection, including via the file/registry route, and confirmed end-to-end against a real provider. The proof also pins the waist fields no capability expresses yet (derived from the type, with a compile-time exhaustiveness check, verified to fail on over-claim as loudly as on omission) — that list is M53's entry criterion.

  The agent decorators are untouched in this release; they are removed in M53.

## 0.45.0

### Minor Changes

- 70a4daa: Presentation layer (M49): new `@theokit/presenter` package — the canonical `AgentOutputEvent` (narrow-waist normalized event) + the `Presenter` Strategy contract + registry + `UIMessageStreamPresenter` (the web surface) + `fromSdk` source translator. `@theokit/agents` now composes its web `UIMessageStream` path over the shared presenter (`presentUIMessageStream`), replacing the inline `translateToUIMessageStream` (removed — the public export is now `presentUIMessageStream`). Behavior is byte-identical (the full existing web test corpus — unit + M1 E2E — passes unchanged against the new path). This closes the web/terminal translation duplication surfaced by dogfooding agent-builder; terminal/JSON presenters follow in M50/M51. No backward-compat shim (owner-approved clean break).

## 0.44.5

### Patch Changes

- e38db92: Fix stream event order so tool events precede the final answer text. For providers whose `onDelta` reports text but not `tool-call-started` (e.g. gpt-5.4 via OpenRouter), tool events surface only via `run.stream()` (post-completion), so live onDelta text was emitted BEFORE the tool that produced it — even though the model is tool-first (verified against the raw provider response). The SDK adapter now holds `text_delta` and flushes it after the drained stream, so the timeline order matches the model's true chronology (tool → result → answer). Non-text deltas keep their live order; duplicate text stays deduped. Trade-off: on a text-only turn the answer is emitted at generation-complete rather than token-by-token.
- 4cc200b: M35 (multimodal) — thread images through the bridge to `agent.send`. `StreamAgentOptions` and `RuntimeOverrides` gain an optional `images` field; when present the adapter sends the SDK's structured `SDKUserMessage { text, images }` form instead of a plain string, so the model receives images alongside the text. Absent ⇒ the string send path is byte-unchanged (back-compat). Zero new dependencies.

## 0.43.0

### Minor Changes

- d398561: Surface per-turn usage on the streamed assistant message. `translateToUIMessageStream` now rides the turn's authoritative totals — `usage` (input/output/total + reasoning/cache buckets), `cost`, and `durationMs` — on the ai-sdk `finish` chunk's `messageMetadata`, so they reconstruct onto the client's assistant `UIMessage.metadata` (via `readUIMessageStream`) with no extra header or store wiring. A run that ends without a `done` event (error/abort) keeps a bare `finish` (no fabricated usage). New public type `AgentTurnMetadata`. This is what lets a surface (a TUI status bar, a web cost meter) show real tokens/cost for the turn it just streamed — previously the totals stopped at the server.

## 0.42.0

### Minor Changes

- Ecosystem integration guarantee for the `@theokit/sdk` seam (M48) — the load-bearing seam (the SDK is the only agent runtime) is now drift-guaranteed to the same FAANG-grade posture as the `@theokit/ui` and TheoCloud seams.

  - **Tool handlers now see `ctx.threadId` (the run's session identity, #119) and `ctx.messages` (the turn transcript, SE12).** The local `CustomTool` type mirror is synced to the SDK and kept in sync by a `.test-d.ts` type gate, so a future SDK `ctx` change fails `tsc` instead of drifting silently — a stateful tool can scope state per session instead of leaking it.
  - **`theokit start` fails fast when the installed `@theokit/sdk` is incompatible** — a typed `SdkIncompatibleError` (found-vs-required) at boot, instead of only a per-request error. An api-only app with no SDK installed still boots (the SDK is an optional peer).
  - **Closed the SDK-family peer ranges** (`@theokit/sdk-tools` `>=0.11.0` → `^0.11.0`) and added a consumer + producer contract test plus a version-drift guard so a breaking SDK change is caught in CI or at publish, never in production.

  No action needed for apps already on `@theokit/sdk ^4.0.1`.

## 0.41.0

### Minor Changes

- Adopt `@theokit/sdk@^4.0.1`. Agent conversation history now persists **automatically** via the SDK's native Claude-shaped `.jsonl` transcript — no storage adapter to wire. The framework roots each app's transcript under `<projectRoot>/.data/agent-sessions` (git-ignore `.data/`).

  **Breaking:** the pluggable conversation-storage surface is removed (SDK 4.0 no longer ships it). `AgentBuilder.conversationStorage()` and the `@Conversation` decorator are gone. Apps that passed a storage adapter should delete that wiring — persistence is on by default. Sessions still thread by `sessionId` for resume.

## 0.40.0

### Minor Changes

- 2cfc717: Opt into `.theokit/` file-based config with `.settingSources([...])`.

  A code-created agent can now discover its skills, subagents, hooks, MCP servers, context, and cron jobs from files under `.theokit/` — config-as-git. Add `.settingSources(['project'])` to the `agent()` builder and the framework wires the SDK's `local.settingSources` + the app-root `cwd`, so the SDK discovers `<cwd>/.theokit/` (and `~/.theokit/` with `'user'`).

  ```ts
  export default agent()
    .model('openai/gpt-4o-mini')
    .system(BASE_INSTRUCTIONS)
    .settingSources(['project']) // ← discover .theokit/ from the app root
    .build()
  ```

  - `.settingSources([...])` is an Axis-A "SWAP" value (per the `agent-dynamic-config` blueprint): an explicit, non-empty list wins; `[]` is treated as unset; an agent that declares inline `.skills()` still falls back to `['project']` (back-compat). Discovery is now **decoupled from inline skills** — an agent can use `.theokit/hooks.json` / `mcp.json` / subagents / context with no inline skill.
  - The app-root `cwd` is the **framework-resolved project root** threaded through `mountAgent`, NOT `process.cwd()` (which is not guaranteed to be the app root) — so discovery reliably points at `<app>/.theokit/`.
  - The SDK owns discovery + execution (skill loading, hook shell execution, MCP launch); theokit only wires `local.settingSources` + `cwd` (G2 / ADR-0040 — no runtime reimplementation).
  - **Security:** enabling `'project'` enables shell-executing hooks from `.theokit/hooks.json`. This is opt-in because `.theokit/` is your own repo (informed consent).

  Verified end-to-end in a real browser: a showcase agent with `.settingSources(['project'])` discovered a `.theokit/skills/` skill and listed it alongside its inline skill.

## 0.39.0

### Minor Changes

- f61b77f: Adopt `@theokit/sdk@3.x` (SE36 uniform `X.create()` API).

  SDK v3.0 removed the standalone factory functions in favor of static `X.create()` namespace methods. The `@theokit/agents` bridge now binds the new names — `Tool.create` (was `defineTool`), `SkillReadTool.create` (was `defineSkillReadTool`), `Retry.create` (was `withRetry`) — and the scaffold's code-defined skill uses `Skill.create` (was `createSkill`). While migrating, the tool-handler wrapper (`withRunContext`) was fixed to forward the **full** tool `ctx` — the SE12 `messages` transcript projection was being dropped, which would have silently broken a tool that reads the turn transcript; the handler types now track the SDK's canonical `CustomTool['handler']` instead of a hand-maintained duplicate.

  **Breaking (peer requirement):** `theokit` and `@theokit/agents` now require `@theokit/sdk >= 3.5.0` (and `@theokit/sdk-tools >= 0.9.1`, the SE36-migrated build). Apps on `@theokit/sdk@2.x` must upgrade — run `npx @theokit/codemod-sdk-3-0 --write` to migrate app code that calls the old factories directly.

## 0.38.1

### Patch Changes

- d186cb1: DX: move the `.skills()` mechanism explanation from the scaffold into the API's JSDoc.

  The `agents/chat.ts` scaffold carried a 4-line inline comment explaining _how_ skills work (the `<skills>` block + the on-demand `skill_read` tool). That belongs on the API, not in the developer's first file. The explanation now lives in the `.skills()` JSDoc (discoverable on hover / cmd-click) and the scaffold keeps a one-line pointer — so a freshly scaffolded `chat.ts` reads as intent (`​.skills([dailyBriefingSkill])`) with the "how" one hover away.

## 0.38.0

### Minor Changes

- **`.skills([inlineSkill])` now auto-provisions the `skill_read` tool — one call, not two.** An inline
  `createSkill` lists in the `<skills>` block by name + description ONLY; its body is unreachable to the
  model without a `skill_read` tool, so registering an inline skill implies wanting it readable. The
  runtime (`createSkillAgentStream`, where `@theokit/sdk` is dynamically loaded) now auto-appends
  `skill_read` when the agent declares inline skills — so `agent().skills([mySkill]).build()` both
  registers the skill AND makes it readable. Dedup: an explicit `defineSkillReadTool` the app added wins
  (never duplicated). Graceful: an SDK older than `defineSkillReadTool` degrades to list-only (no crash).
  The auto-wire lives at the runtime layer so the pure compile module (`compileAgentDefinition`) keeps its
  type-only SDK dependency. `defineSkillReadTool` remains available as an escape hatch (custom skill sets).

## 0.37.0

### Minor Changes

- **`.skills([...])` now accepts inline `createSkill` objects — not just filesystem skill names.** The SDK
  has always supported code-defined skills (`SkillsSettings.inline`, auto-injected into the `<skills>`
  system-prompt block), but the builder's `.skills()` / `defineAgent({ skills })` only took `string[]`
  names, so an inline skill could only reach the model through a `skill_read` tool + persona hardcoding.
  `SkillsSelection` is widened to `readonly (string | InlineSkill)[] | resolver`; `compileSkillsSelection`
  splits a mixed list into `skills.enabled` (filesystem names) + `skills.inline` (createSkill objects).
  So `agent().skills([mySkill]).build()` registers the skill's name + description into the `<skills>`
  block — the model KNOWS the skill exists without repeating it in the system prompt. Backward-compatible:
  a pure name list still compiles to `{ enabled, autoInject }` (no `inline` key). The run path already
  forwarded `compiled.skills` to `Agent.create({ skills })`; only the builder input surface changed.

## 0.36.0

### Minor Changes

- **`.conversationStorage(adapter)` on the agent builder — control the agent's memory.** `agent()` (and
  `defineAgent({ conversationStorage })`) now accept a `ConversationStorageAdapter`, so an app declares
  WHERE the agent's conversation turns persist right where it defines the agent:
  `agent().model(...).conversationStorage(store).build()`. The adapter flows through
  `compileAgentDefinition` → the run path → `Agent.getOrCreate({ conversationStorage })`. Precedence:
  a per-run override wins over the agent-level default, which wins over the SDK's lazily-chosen default
  (byte-identical to the previous behaviour when unset). Swap `InMemoryConversationStorage` (ephemeral)
  ⇄ `FileSystemConversationStorage` (durable) ⇄ a custom adapter without touching the runtime.

## 0.35.0

### Minor Changes

- 0e01bc6: M35 — TUI terminal-only in-process surface (Model A).

  - `theokit/server` exports `streamAgentTurnInProcess(mod, apiKey, { message, awaitApproval? })`: run an
    agent turn in a SINGLE process — no HTTP loopback, no port, no CSRF — reusing `compileAgentModule` +
    `streamAgentUIMessages` (zero runtime reimplementation, G2). HITL is resolved INLINE via a caller
    `awaitApproval` callback (the Claude Code / Codex single-process shape); a gated agent run without a
    resolver throws `InProcessApprovalRequiredError` (fail-closed — the #99 lesson). Parity with the HTTP
    mount is by construction: both call the same `streamAgentUIMessages`.
  - `@theokit/agents` now publicly exports the `HitlDecision` type — the settled approval decision an
    `awaitApproval` resolver may return (bare boolean OR `{ approved, reason?, payload? }`).

## 0.31.0

### Minor Changes

- eb1b70e: Agent capabilities batch M9–M17.

  - **M9 Guardrails** — `defineAgent({ guardrails })`: input/output guards at the boundary (`promptInjectionDetector`, `piiDetector`, `unicodeNormalizer`, `costGuard`, `outputModeration`), input applied fail-fast, output moderated before reaching the client.
  - **M10 Lifecycle hooks** — `createToolHooksPlugin({ beforeToolCall, afterToolCall, beforeLLMCall, afterLLMCall })` over the SDK's native tool/LLM hooks.
  - **M11 Conversation scoping** — `deriveConversationId`/`parseConversationId` for collision-safe `{resource, thread}` isolation.
  - **M12 Delegation hooks** — `onDelegationStart`/`onDelegationComplete` on `delegate()` (+ abortSignal, docs).
  - **M13 Per-request skills resolver** — `defineAgent({ skills: (ctx) => string[] })` resolved against the run-context at mount.
  - **M14 HITL surface** — `defineAgent({ approvals })`, `GET /api/agents/:name/approvals`, `toolName` forwarded to the registry.
  - **M15 A2A** — `buildAgentCard` + served at `/.well-known/<name>/agent-card.json`; `createA2ATool` client with auth.
  - **M16 MCP** — `buildMcpToolDescriptors`/`mcpServerInfo` + served at `POST /api/agents/<name>/mcp` (JSON-RPC).
  - **M17 ACP** — `AcpMessageDecoder`/`encodeAcpMessage` framing, `AcpClient`, and `createACPTool` + `NodeAcpTransport` (subprocess) with a required `onPermissionRequest` gate.

  Governance: ADR-0040 (runtime-vs-home boundary).

## 0.30.2

### Patch Changes

- 6a91f17: Fix (#81): `defineAgent({ tools })` now type-accepts the `@theokit/sdk` `CustomTool` that `defineAgentTool` and every `@theokit/sdk-tools` factory return (previously `CustomTool` was not assignable to the internal `CompiledTool`, so the documented tool pattern failed `tsc` even though it ran). The `tools` field is typed `readonly CustomTool[]` and normalized to `CompiledTool` at compile.

  Fix (#80): the `create-theokit` default template now type-checks, builds, AND renders on a fresh scaffold. `app/page.tsx` was migrated to the `@theokit/ui@1.0.0` auto-dispatch chat API (`ChatMessage` takes a `UIMessage` and renders its parts; the old manual `Message`/`ToolCallCard` flatten is gone), the template ships `@types/node` + `experimentalDecorators`/`emitDecoratorMetadata` (so tool handlers and the `@Agent` class surface type-check), and a jsdom render test (`app/page.test.tsx`) guards against future `@theokit/ui` drift. A pristine scaffold now passes `tsc --noEmit` with 0 errors (was 7).

## 0.30.1

### Patch Changes

- 2302dcb: M6 dogfood fixes — two real V1 bugs surfaced by a live `npx create-theokit` run.

  - **Tool calls crashed** (`TypeError: ... reading 'def'`): `buildSdkTools` re-ran `defineAgentTool`'s
    already-lowered JSON-Schema tool through the SDK's `defineTool` (which expects a live Zod schema).
    It now routes by `inputSchema` shape — Zod schema → `defineTool`; already-SDK-ready `CustomTool`
    (JSON-Schema `inputSchema`) → forwarded raw. Regression test + confirmed minimal repro.
  - **Fresh scaffold failed to start** (`ERR_PACKAGE_PATH_NOT_EXPORTED` on `@theokit/sdk/compaction`):
    the default template pinned `@theokit/sdk@^1.1.0`, below the `@theokit/agents@0.30.0` peer floor
    (`>= 2.13.0`). Bumped the template + fixture pins to `^2.13.0`.

## 0.30.0

### Minor Changes

- 604bca9: Cohesive agent harness (M4, Eixo C) — make the shipped-but-dead `@HumanInTheLoop` + `@Checkpoint`
  decorators functional as an adapter over `@theokit/sdk`, with no parallel runtime (ADR 0038).

  - **`@HumanInTheLoop`** now pauses the run before a gated tool: the stream emits the ai-sdk-native
    `tool-approval-request` chunk and the run stays paused (the SDK's own awaited `pre_tool_call`
    hook) until `POST /api/agents/<name>/approve/<approvalId>` resolves it — approve runs the tool,
    deny/timeout surfaces the denial and the run continues.
  - **`@Checkpoint({ storage: 'filesystem' })`** emits a transient `data-checkpoint` part and selects
    the SDK's durable `FileSystemConversationStorage`, so a same-session follow-up request resumes.
  - The M2 file convention gathers a class agent's `@Mixin` toolboxes so a gated tool actually gates
    through the endpoint. `@theokit/agents` adds `createHitlPlugin`; `theokit` adds the approve route
    - in-process approval registry. Additive — the M2 surface is unchanged.

## 0.29.0

### Minor Changes

- a1182ae: Ship an agent by writing one file — the zero-config `agents/<name>.ts` convention (theokit-ai-first M2, Eixo B).

  Create a top-level `agents/support.ts` that default-exports `defineAgent({ input, model, system, tools })` and TheoKit auto-serves `POST /api/agents/support` at both `theokit dev` and the built server — streaming the M0/M1 canonical `UIMessageStream`. On the client, `import { useAgent } from '@theo/agents'` gives a typed React hook: `useAgent('support').send(input)` where `input` is inferred end-to-end from the agent's Zod schema via the generated `.theokit/agents.d.ts` — zero manual type wiring. The hook reconstructs the streamed assistant messages with the `ai` package's own `readUIMessageStream` (the exact reader `@ai-sdk/react`'s `useChat` runs — no reinvented parser); `theokit/client` also exports the pure `consumeUIMessageStream` and the base `useAgent(path)`.

  `@theokit/agents` gains `defineAgent` — the canonical zero-config surface (ADR 0037) — a pure normalizer to the same SDK-ready shape the `@Agent` class decorator produces, so both surfaces converge on one runtime (`@theokit/sdk` stays the sole agent runtime). New exports: `defineAgent`, `compileAgentModule`, `streamAgentUIMessages`, `AgentDefinitionError`, `InferAgentInput`.

  The build scans a top-level `agents/` directory and records each agent in the manifest; dev and prod mount through a single shared `mountAgent` point so they never drift. The request body accepts both the `useChat` shape (`{ messages }`) and a simple `{ message }`. Agent endpoints enforce CSRF (the `X-Theo-Action` header + Origin match, strict by default) at the same mode as routes/actions — a cross-origin POST that would spend LLM tokens is rejected with 403 before it reaches the SDK. A non-agent file or an unknown route fails fast with a typed error. `/api/agents/` is a reserved prefix (a manual route there is shadowed by design, like `/api/__actions/`).

  Agents live in a top-level `agents/` (sibling of `server/`) per the LOCKED naming decision (ADR 0037). Non-breaking: additive API on both packages; the existing route/action/ws scanners still ignore `agents/`.

## 0.28.0

### Minor Changes

- 2ddfab9: A theokit agent's tool calls and reasoning now render in `@ai-sdk/react`'s `useChat` — a tool-call card (name + input + result) and a reasoning block, not just text (theokit-ai-first M1).

  `translateToUIMessageStream` widens the M0 text-only mapping to emit ai-sdk tool chunks (`tool-input-available` → `tool-output-available` / `tool-output-error`) and reasoning chunks (`reasoning-start` → `reasoning-delta*` → `reasoning-end`) via an open-block state machine that closes the current text/reasoning block before switching kind. Runtime-discovered tools carry `dynamic: true`, so the ai-sdk consumer materializes a `dynamic-tool` part whose tool name survives to the rendered part; a tool result that arrives without a preceding tool call synthesizes the tool-input part first, so the consumer never throws. `UIMessageStream` stays the canonical wire (AG-UI rejected — ADR 0036). Backward-compatible: M0 text/error runs are byte-unchanged; the translator signature and barrel exports are unchanged.

## 0.27.0

### Minor Changes

- 8842bc6: Surface the SDK's `partial-tool-call` update as a typed `PartialToolCallEvent` (`type: 'partial_tool_call'`) on the `AgentStreamEvent` stream, so consumers can render tool arguments progressively as the model generates them (closes theokit-sdk#70).

  Previously `translateInteractionUpdate` dropped `partial-tool-call`, forcing downstream apps to wait for the complete `tool_call` (args committed) — visible "dead air" for large Write/Edit tool bodies. The new event is emitted at a **distinct** lifecycle point (arg-streaming) and never duplicates `tool_call`: the same `callId` correlates the partials to the later committed `tool_call` and `tool_result`. Adds `isPartialToolCall` type-guard. Non-breaking union growth — existing consumers ignore the new variant.

- 403fdd7: A theokit agent's text stream now speaks the Vercel AI SDK `UIMessageStream` protocol, so `@ai-sdk/react`'s `useChat` renders it with no custom adapter (theokit-ai-first M0 walking skeleton).

  `@theokit/agents` adds `translateToUIMessageStream(events, { textId })` — a pure mapping of the agent text stream to ai-sdk `UIMessageChunk`s (`start → text-start → text-delta* → text-end → finish`), surfacing an upstream stream error as an ai-sdk `error` chunk before a graceful `finish` (never swallowed, never thrown past the boundary). `theokit/server/define` adds `uiMessageStreamResponse(chunks)`, which serializes them to an SSE `Response` on the exact wire `useChat` parses (`x-vercel-ai-ui-message-stream: v1` header + `data: [DONE]` terminal). `ai` is an optional `peerDependency` (with a devDependency for local build/tests) — zero runtime weight on the agent path; `@theokit/sdk` stays the sole runtime. Additive and backward-compatible: the existing `AgentEvent` SSE path is untouched (its removal is the M3 clean break).

## 0.26.0

### Minor Changes

- c85145d: Add opt-in `recoverLeakedToolCalls` knob (`@Agent({ recoverLeakedToolCalls })` + per-run `AgentRunner.stream({ recoverLeakedToolCalls })`, default off). It is the execution sibling of `stripToolDialect` (theocode#32): where `stripToolDialect` only HIDES a leaked Hermes `<function=…></tool_call>` dialect from the visible text, `recoverLeakedToolCalls` makes the leaked call actually EXECUTE. When enabled, the adapter clones the per-run `providers.routes` with the SDK's `extractToolCallsFromContent` flag, so a `chat_completions` finish with ZERO native `tool_calls` has its assistant text scanned for the dialect and any recovered calls are dispatched by the loop — for models (qwen3-coder via OpenRouter) that intermittently leak tool calls as text (theokit#58 follow-up). Has effect only when a provider is routed via `providers.routes`; fail-open and default-off, so a non-leaking route is unaffected. Requires `@theokit/sdk >=2.13.0` (the per-route flag); the peer floor is bumped accordingly.

## 0.25.1

### Patch Changes

- 77672ab: Fix `tool_call` StreamEvent surfacing an empty `input` (`{}`), which blanked consumer tool cards (theokit#58).

  `event-translator.ts`'s `translateToolCallEvent` read the running tool message's args from `msg.input ?? msg.arguments`, but the real `@theokit/sdk` `SDKToolUseMessage` field is `args` (`run-D22b53SU.d.ts:486`) — both read fields were `undefined`, so `input` fell back to `{}` and the UI tool card showed no command (e.g. a blank `SHELL_EXEC`), even though the tool executed correctly. Confirmed empirically (live Node 24 + OpenRouter: `msg.args={"command":…}`, `input`/`arguments` undefined) and by the SDK type.

  The fix reads `msg.args` first — `input: msg.args ?? msg.input ?? msg.arguments ?? {}` — keeping the legacy fields as defensive cross-shape fallbacks. No new dependency, no dedup change, no behavior change for the `tool-call-started` onDelta path (already reads the correct field). Covered by 3 unit tests + 2 integration tests.

## 0.25.0

### Minor Changes

- Strip a leaked tool-call dialect out of the visible answer (theocode#32). When a model emits its Hermes `<function=NAME>…</function></tool_call>` XML as assistant TEXT instead of a native `tool_calls` (observed live with `qwen/qwen3-coder`), the raw XML used to render verbatim as the reply. A new opt-in `stripToolDialect` knob (`@Agent({ stripToolDialect: true })` or per-run `AgentRunner.run(msg, { stripToolDialect: true })`, per-run wins) wraps the agent's text stream with a streaming stripper that removes the leaked `<function=…></tool_call>` block from `text_delta`. It is chunk-straddle-safe (both the `<function=` open and the `</tool_call>` close split across stream deltas are recognized) and lossless on a truncated leak (an unclosed `<function=` at stream end is flushed back as text, never silently dropped). The leak is STRIPPED, never parsed back into a tool call — parsing a provider-broken channel would re-introduce the no-progress spin closed in #53. Off by default (zero behavior change for existing agents — a code assistant may legitimately emit a literal `<function=` in answer/code text). Sibling of `parseThinkTags`. New exports: `createToolDialectStripper`, `stripToolDialectStream`.

## 0.24.1

### Patch Changes

- 3c2bf61: Fix the reflective loop's `no_progress` detector being defeated by narration drift (theokit#53). `roundSignature` folded the assistant's text into the per-round fingerprint, so a model that re-ran identical tool calls while rephrasing its prose ("…e executá-lo." → "Agora vou executar…") produced a different signature each round and evaded `NO_PROGRESS_THRESHOLD` — the loop spun (observed live: deepseek-v3.2, 7 rounds / 12 tool-calls re-doing the same `write_file`+`shell_exec`). The signature now keys on the tool-call set ONLY (name + canonicalized input), excluding narration — mirroring opencode's `doom_loop`. Repeated identical tool calls now terminate `no_progress` within 2 rounds regardless of what the model says around them; genuinely varying tool inputs still count as progress.

## 0.24.0

### Minor Changes

- 6830737: Step-cap force-close: the reflective loop now gates tools OFF on the ceiling round (`round === maxIterations`), forcing the model to emit the closing summary the existing `STEP_LIMIT_HINT` requests instead of spinning on more tool calls. The round factory is called with `disableTools: true`, which the SDK adapter maps to `agent.send(msg, { toolChoice: "none" })` — applied per-send because a cached `getOrCreate` agent's tools cannot be un-registered. Below the ceiling, tools stay enabled; injected stream factories (tests / custom transport) ignore the optional flag (backward-compatible). Mirrors opencode's `MAX_STEPS_PROMPT` + `toolChoice:"none"`. The `@theokit/sdk` peer dependency is tightened to `>=2.11.2` (first release with `SendOptions.toolChoice`) so the force-close cannot silently no-op against an older SDK that ignores `tool_choice`.

## 0.23.0

### Minor Changes

- a4f668f: Add an opt-in `<think>`-tag reasoning middleware (M2). When `parseThinkTags` is set — declaratively via `@Agent({ parseThinkTags: true })` or per-run via `AgentRunner.run(msg, { parseThinkTags: true })` (per-run wins over compiled) — the agent's text stream is wrapped with a streaming extractor that converts inline `<think>…</think>` into `thinking` StreamEvents, so models that emit reasoning as inline tags (qwen/deepseek-class) surface it the same way native-reasoning providers do (M1's `reasoningEffort`). The extractor is chunk-straddle-safe, preserves interleaved order, flushes a truncated `<think>` at stream end, and treats a non-tag prefix like `<thinkers>` as text. Off by default — zero behavior change for existing agents. New exports: `createThinkTagExtractor`, `extractThinkTagStream`, `Segment`.

## 0.22.0

### Minor Changes

- 9c04863: Add a provider-agnostic `reasoningEffort` knob to enable extended thinking (M1). Set it declaratively via `@Agent({ reasoningEffort })` or per-run via `AgentRunner.run(msg, { reasoningEffort })` (per-run wins over compiled); it maps to the SDK `ModelSelection.params` reasoning slot (`{ id: 'thinking', value: effort }`) at the single `getOrCreate` site, so the provider emits the `thinking` StreamEvents the bridge already forwards. Accepts the common levels (`'minimal' | 'low' | 'medium' | 'high' | 'xhigh'`) plus any provider-specific string. Backward-compatible — with no effort set, the model is sent as a bare `{ id }` (byte-identical to before) and there is no static capability gate (the SDK validates against the model's catalog). New exports: `ReasoningEffort` type and `buildModelSelection` helper.

## 0.21.2

### Patch Changes

- 919e138: Fix chronological event ordering in `AgentRunner.stream()` (#44). Tool and thinking events now stream through the SDK's real-time `onDelta` callback in true arrival order, interleaved with text — instead of all text first, then all tool cards (a regression from the 0.21.1 streaming work, where tool events were pulled from the post-completion `run.stream()` buffer). The merge queue is consumed concurrently with `send()` for real-time delivery, with per-category/per-callId dedup so the `run.stream()` fallback (for providers that don't drive `onDelta`) never double-emits and never drops a tool result reported only via the stream (e.g. a tool error). No public API change.

## 0.21.1

### Patch Changes

- 2c6e03f: fix(agents): stream incremental tokens, populate tool output, emit running tool_call

  The SDK↔agents bridge (`createSdkAgentStream` + `translateToolCallEvent`) now forwards
  the streaming + tool data the SDK already produces, fixing three SSE-DX defects:

  - **#40 — token streaming.** `createSdkAgentStream` now passes `SendOptions.onDelta` to
    `agent.send` and merges the incremental `text_delta` tokens into the event stream
    (`mergeDeltaStream`), deduping the complete-assistant text (`sawDelta`) so it is not
    double-emitted. A provider that never calls `onDelta` falls back to the complete-assistant
    text (no loss). Previously the whole round was emitted at once at turn end.
  - **#41 — tool output.** `translateToolCallEvent` now serializes a non-string tool `result`
    (`serializeToolOutput` → JSON, BigInt-safe) instead of dropping it via `asString(...,'')`,
    so object tool results (`{ ok, files }`) reach consumers instead of `''`.
  - **#42 — running tool_call.** The `running` tool status now emits a `tool_call` StreamEvent
    (callId + toolName + input) so UIs can show a running card with args, instead of only the
    terminal `tool_result`.

  Bridge-only; no SDK change, no runtime re-implementation (sdk-runtime.md/G2).

## 0.21.0

### Minor Changes

- 20338f5: `AgentRunnerRunOptions.plugins` now also accepts a `readonly Plugin[]` (an array of code Plugin objects), not only `PluginsSettings` ({ enabled }). Mirrors the @theokit/sdk `AgentOptions.plugins` widen — the runtime already forwards plugin arrays. Lets consumers pass `plugins: [permissionPlugin, cachePlugin]` without an `as unknown as` cast.

## 0.20.0

### Minor Changes

- 45f229a: V4-T: `delegate()` carries the same per-run config surface as `AgentRunner.stream()`.

  `DelegateOptions` gains optional `model`/`cwd`/`plugins`/`providers`/`agents`/`budgetTracker`/`conversationStorage`/`sdkTools`/`retry`/`reflection`/`maxIterations`, and `delegate()` forwards them to `createSdkAgentStream` (the model opt wins over the sub-agent's `@Agent` model) + the reflective loop (retry; custom reflection overriding the strategy-derived ladder/noop; `maxIterations` re-resolves the loop ceiling). The two on-ramps to the shared `runReflectiveLoop` driver now expose the same per-run surface, so a sub-agent inherits the parent's runtime config (providers, mode-selected permission plugin, working dir, pre-built SDK tools). Additive + backward-compatible: absent fields ⇒ byte-identical to before (decorator model only; strategy-derived reflection; no retry). The fields were already accepted by the adapter's `RuntimeOverrides` + the loop's `RunReflectiveLoopConfig` — pure forwarding, no new dependency (Rule 9). Unblocks an app delegating to a sub-agent without losing per-run config.

## 0.19.0

### Minor Changes

- 01e9ea8: V4-S: `plan-act-reflect` defers the continuation decision to the `ReflectionStrategy`.

  `resolveLoopStrategy('plan-act-reflect')`'s `shouldContinue` is now `round < maxIterations` (instead of the `finishReason === 'tool-calls'` gate). The reflective loop ANDs `reflection.continue` with `shouldContinue`, so this lets a custom `ReflectionStrategy` extend even a terminal (`stop`) round — e.g. "you answered without editing any file; make the edit now" — within the iteration ceiling. Backward-compatible with the shipped `ladderReflectionStrategy` (which itself returns `continue: true` only on `tool-calls`, so the observable behavior with the default ladder is unchanged). `react` is unchanged (the `noop` reflection means the strategy stays the gate: continue only on `tool-calls`). Closes the last seam for an app whose reflection ladder fires on final-answer rounds (theocode's `reflect_no_edit`/`verify`/`fix`).

## 0.18.0

### Minor Changes

- 6d02c56: V4-R: `AgentRunner` accepts an injectable `RoundStreamFactory` via `run-options.streamFactory`.

  `AgentRunnerRunOptions.streamFactory?: RoundStreamFactory` drives the reflective loop with a caller-provided per-round stream INSTEAD of `createSdkAgentStream` (for tests or a custom transport). When set, the SDK-create options (`tools`/`sdkTools`/`model`/`cwd`/...) are not used for that call — the consumer owns the stream. Absent ⇒ the SDK adapter (the default runtime), byte-identical to before. `RoundStreamFactory` (`(message, sessionId) => AsyncIterable<StreamEvent>`) is now exported from the package barrel so consumers can type their factory (the loop DRIVER `runReflectiveLoop` stays internal). Lets an app adopt `AgentRunner.stream()` while keeping its existing stream-injection tests — closes the last adoption seam the theocode discover found. Additive + backward-compatible; no new dependency.

## 0.17.0

### Minor Changes

- 6ec6124: V4-Q: `AgentRunner` accepts pre-built SDK `CustomTool[]` via `run-options.sdkTools`.

  `AgentRunnerRunOptions.sdkTools?: readonly CustomTool[]` (and `RuntimeOverrides.sdkTools`) forwards already-built SDK tools RAW to `Agent.create.tools`, appended after the `@Tool`-compiled tools, bypassing `defineTool` (which requires a Zod schema). Lets an app whose tools come from imperative SDK factories (`@theokit/sdk-tools` → `CustomTool[]`, JSON-Schema `inputSchema`, no recoverable Zod) adopt `AgentRunner.stream()` — closes the last tool-sourcing gap the theocode loop-adoption discover found. Additive + backward-compatible: absent ⇒ the compiled-tools path is byte-identical; distinct from `tools` (which REPLACES the compiled set). No new dependency (Rule 9).

## 0.16.0

### Minor Changes

- 208ea7f: V4-P: per-round transient retry in the reflective loop.

  `AgentRunnerRunOptions.retry?: RetryOptions` (and `RunReflectiveLoopConfig.retry`) opt into retrying a transient failure at a round START — the factory creation + first event, before any event is yielded, so a recovered 429/5xx/network blip never re-applies an edit. Reuses the SDK `withRetry` (`@theokit/sdk/retry`, default `isRetryable: isTransientError`), dynamic-imported only when `retry` is set so the loop stays SDK-optional. Once an event is yielded, a throw propagates (exactly-one-terminal + no double-edit preserved). Absent ⇒ single attempt (backward-compatible). Lets a consumer (theocode) keep its per-continuation-round retry safety when it adopts `AgentRunner.stream()`. No new dependency (Rule 9).

## 0.15.0

### Minor Changes

- d69f7b4: V4-O: forward the SDK reasoning/cache token buckets through the adapter `done` event and `DelegationResult`.

  `realUsageDone` (`createSdkAgentStream`) now reads `reasoningTokens`/`cacheReadTokens`/`cacheWriteTokens` from `RunResult.usage` and includes them on the `done` event (0 when the provider omits them); the reflective loop folds them per round and accumulates them into `DelegationResult` (alongside the V4-N split usage). The typed `DoneEvent.usage` declares the three optional buckets. Additive + backward-compatible: existing fields unchanged, the new fields are optional, absent buckets default to 0. Lets a consumer (theocode's `LlmUsage`) keep full per-turn usage when it adopts `AgentRunner.stream()` — closes the usage-richness regression the loop-adoption discover found. Reuses the `RunResult.usage` already read by `run.wait()` (Rule 9); no new dependency.

## 0.14.0

### Minor Changes

- 6f1a757: V4-N: the reflective loop now exposes faithful per-round tool calls + split token usage, so a custom `ReflectionStrategy` (and `DelegationResult` consumers) can read the tool-call command, correlate by id, and map split usage.

  - `LoopOutcome.toolCalls` / `DelegationResult.toolCalls` entries now carry `{ id, name, input, output }` — `input` is the tool-call args (correlated from the `tool_call` event by callId), no longer always `{}`, and `id` is the call id.
  - `DelegationResult` now carries `tokensInput` / `tokensOutput` (accumulated across rounds); `tokens` (total) is preserved.

  Additive + backward-compatible (existing fields unchanged; new fields are optional on `DelegationResult`). `consumeOneRound` correlates each round's `tool_call` events (which carry the input/command) with their `tool_result` events (which carry the output) by callId; an unmatched result degrades to `input: {}` (no worse than before). The tool-call id+input half flows on the real SDK path. NOTE: the split-usage half is plumbing — the SDK adapter must emit real per-turn token counts on the `done` event for `tokensInput`/`tokensOutput` to be non-zero (today it emits zeros, unchanged from before; a follow-up). Unblocks a consumer's verify-before-finish / fix-failed-test ladder + tool persistence that need the command and the id.

### Patch Changes

- a4e1c25: V4-N.1: `createSdkAgentStream` now emits the SDK Run's REAL token usage on the `done` event.

  It reads `run.wait()` after the stream and emits one `done` carrying the real `TokenUsage` (`inputTokens`/`outputTokens`/derived `totalTokens`) + `cost`, suppressing the stream's zero-usage `done`. This completes V4-N's split-usage story end-to-end: `DelegationResult.tokens`/`tokensInput`/`tokensOutput` now report real values on the real SDK path (previously hardcoded to 0). An error round skips the `wait()` re-emit (exactly-one-terminal); a `wait()` rejection surfaces as an `error` (fail-loud). Additive; reuses the SDK's documented `run.wait()` (Rule 9); no new dependency.

## 0.13.0

### Minor Changes

- 8811577: V4-M: `AgentRunner.stream()` reflective-loop rounds now share a persisted SDK session, so round N+1 sees what rounds 1..N read and did.

  - Each round resumes the same session via `Agent.getOrCreate(sessionId, { conversationStorage })` with ONE shared `conversationStorage` created per run (default `InMemoryConversationStorage` — per-run, no disk), survivable across the per-round agent dispose.
  - Rounds 2+ no longer re-send the original task — the persisted session carries it; the round-2+ prompt is the reflection block (or a short continuation). Round 1 sends the original message unchanged.
  - New `AgentRunnerRunOptions.conversationStorage` (and `RuntimeOverrides.conversationStorage`) lets an app plug a `FileSystemConversationStorage`/custom adapter for durable cross-run history.

  **Behavior change (fix):** previously each round created a fresh, memoryless agent (history was NOT carried across rounds) — a multi-round reflective loop whose rounds could not see prior tool results. Rounds are now stateful by default. This reuses the SDK's own session-persistence primitives (Rule 9); no new dependency. It unblocks consumers (e.g. a code agent) adopting `AgentRunner.stream()` for continuation loops. The `delegate()` sub-agent path shares the same loop driver, so sub-agent delegation rounds gain session memory too.

## 0.12.0

### Minor Changes

- 47dd837: V4-L.3: `AgentRunner.stream()/run()` complete the per-request `Agent.create` surface with four more `AgentRunnerRunOptions` fields (Axis-A / SWAP), each forwarded to the SDK when present — parallel to the existing `tools`/`model`/`cwd`/`maxIterations`.

  - **`plugins`** (`PluginsSettings`) — per-request plugins (e.g. a permission gate selected by request mode).
  - **`providers`** (`ProviderRoutingSettings`) — per-request provider routing.
  - **`agents`** (`Record<string, AgentDefinition>`) — per-request sub-agent definitions (opts-only; `@SubAgents` compiled agents stay deferred).
  - **`budgetTracker`** (`BudgetTracker`) — per-request SDK budget tracker capping the INNER tool-loop per send (distinct from the OUTER reflective-loop USD `budget`).

  Internals: `createSdkAgentStream`'s per-request parameters are collapsed into a single `RuntimeOverrides` object (subsuming the prior `envModel`/`cwd` positionals) to avoid a parameter explosion; the model now resolves at a single site (`overrides.model ?? compiled.model ?? default`). Backward-compatible (absent fields ⇒ no `Agent.create` key; the 3-arg `createSdkAgentStream` call still compiles); no new dependency. With this slice the full per-request surface theocode needs is expressible through `AgentRunner`.

## 0.11.0

### Minor Changes

- b1c6a71: V4-L.2: `AgentRunner.stream()/run()` accept three per-request overrides on `AgentRunnerRunOptions` (Axis-A / SWAP), each merge-over-compiled, parallel to the V4-J `tools` override.

  - **`model`** — overrides the compiled model for this call (`opts.model ?? compiled.model ?? default`).
  - **`cwd`** — forwarded into `Agent.create({ local: { cwd } })`, so the SDK populates `SystemPromptContext.cwd` (read by a V4-L.1 `SystemPromptResolver` / `@ProjectContext`). Absent ⇒ no `local.cwd`.
  - **`maxIterations`** — overrides the reflective-loop ceiling for this call by re-resolving the loop strategy (zod-validated — `< 1` throws, never a silent unbounded loop); the build-time strategy is not mutated. Terminal `step_limit` when the override stops a would-continue round.

  All three are backward-compatible (absent ⇒ build-time defaults); a `{ apiKey }`-only call and existing `tools` overrides behave exactly as before. No new dependency.

## 0.10.0

### Minor Changes

- 13a4abc: V4-L.1: `@Agent`'s `systemPrompt` now accepts a per-request `SystemPromptResolver`, not just a static string.

  - `@Agent({ systemPrompt: (ctx) => ... })` declares a prompt COMPUTED per request (from project rules, memory, cwd, etc.); the SDK invokes the resolver each send with the run's `SystemPromptContext`. A plain string still works unchanged (backward-compatible union widening — `string | SystemPromptResolver`).
  - The resolver flows byref through the compile boundary (`compileAgent` → `CompiledAgentOptions.systemPrompt`) into `Agent.create` — no translation, no new dependency (the type is the SDK's own `SystemPromptResolver`).
  - `@ProjectContext` now COMPOSES with a resolver base: env + repo map + project instructions are prepended to the resolved base output (resolve-then-prepend); a failing base resolver propagates (fail-loud). Previously `base` was `string`-only.
  - This is Axis-B (computed-per-request config) of the dynamic-`@Agent` design and closes the long-standing M8 edge case where the decorator could only carry a static prompt. Sub-agent resolver execution remains out of scope (the type is carried, not invoked).

## 0.9.0

### Minor Changes

- 079f725: V4-J + V4-K: two backward-compatible `AgentRunner` hooks that unblock loop adoption by apps with per-request tools and stateful reflection.

  - **V4-J — runtime tool override:** `AgentRunner.stream(message, opts)` / `run(...)` accept `opts.tools?: readonly CompiledTool[]` that replaces the build-time `compiled.tools` for that call only (a consumer selecting tools by request mode/permission). Absent ⇒ the agent's compiled tools (unchanged). Decorators and the compile path are untouched.
  - **V4-K — ReflectionContext:** `ReflectionStrategy.reflect(outcome, ctx?)` now receives a per-run mutable `ReflectionContext` (a generic scratch bag). The reflective loop creates ONE per run and passes the SAME reference to every round, so a stateful custom strategy can accumulate cumulative state (counters, one-shot flags). The framework writes nothing app-specific into it (the strategy owns the contents). `ctx` is optional — shipped `ladderReflectionStrategy`/`noopReflectionStrategy` and existing custom strategies are unaffected.

## 0.8.0

### Minor Changes

- 0620275: V4-D-stream: the reflective `@MainLoop` runtime now streams events live. `AgentRunner` gains a `stream(message, opts)` method that yields each round's events incrementally (the on-ramp for SSE-first apps) while still returning the aggregated result. `run()` is unchanged for callers — it drains the stream internally. Fully backward-compatible: the collect-mode `delegate()` path is untouched.
- 0620275: V4-F: a named, callable `TranscriptCompactionStrategy` authoring layer. `@Compaction('token-budget', { keepTokens })` (and `AgentRunner.builder(...).compaction(...)`) resolve a strategy exposed as `runner.compaction`, which the app calls directly — `runner.compaction?.compact(messages, { summarize })`. The `'token-budget'` strategy delegates to the SDK's `compactTranscript` (no reimplementation — the SDK owns the algorithm); the app keeps when-to-compact and the summarize callback. Compaction is opt-in (`runner.compaction` is `undefined` when undeclared); the builder override wins over the decorator. Requires `@theokit/sdk >= 2.9.0` (the `keepTokens` token-budget mode).

## 0.7.0

### Minor Changes

- V4-D — `@MainLoop` react/plan-act-reflect loops gain two outer-loop terminals on `LoopStrategy`, surfaced on `DelegationResult.finishReason`: `no_progress` (the loop ends when the agent repeats the same round signature — sorted, key-canonical tool-call set + text — for 2 consecutive rounds, so a stuck agent no longer drains the whole `maxIterations` budget) and `step_limit` (the loop reports when it stopped at the `maxIterations` ceiling, distinct from a natural `stop`, and injects a graceful "summarize, no more tools" prompt hint on the final round — modeled on opencode's `MAX_STEPS_PROMPT`). Both fire on both on-ramps (`delegate()` + `AgentRunner`) via the shared `runReflectiveLoop`; no new dependency, no `@theokit/sdk` change. Derived from the codex/opencode agent-loop study — neither implements no-progress, so it is a theokit value-add.

## 0.6.0

### Minor Changes

- d9012b4: V4-B/V4-C — `@MainLoop({ strategy })` gets a real multi-round reflective runtime (was metadata-only). A Zod-validated `LoopStrategy`/`ReflectionStrategy` contract + a shared `runReflectiveLoop` driver give the strategy field execution: `simple-chat` ⇒ one round (unchanged); `react`/`plan-act-reflect` ⇒ multi-round bounded by `maxIterations` (forced terminal at the ceiling), with a degenerate/empty round terminating as `stop`. Both on-ramps — `delegate()` (decorator) and `AgentRunner.builder()` (imperative twin) — route through the same driver, so the runtime metric, cumulative budget, typed errors and result shape are identical (ADR D4). The loop lives in the bridge while the model call stays in the SDK `Run.stream()` (no second runtime, ADR 0031). Modeled on Mastra's `agentic-loop`/`stopWhen` + `maxSteps` ceiling.

  Also fixes the `event-translator` against the real `@theokit/sdk` `SDKMessage` union: assistant content is read from `msg.message.content`, the cloud-run status enum is matched UPPERCASE (`FINISHED`/`CANCELLED` → done, `ERROR`/`EXPIRED` → error — fail-loud), `tool_call` uses `call_id`, and `thinking` reads `msg.text`. Previously a live SDK run returned an empty response and silently swallowed `ERROR`. The adapter's fallback `done` is now conditional so a translated `FINISHED` does not double-emit the terminal.

## 0.5.0

### Minor Changes

- fa1518b: M8 — declarative decorators get SDK-backed runtime. `@Skills`, `@ContextWindow`, and `@ProjectContext` are no longer metadata-only: the bridge compiles each into a native `@theokit/sdk` `Agent.create()` field (`skills` → `SkillsSettings`, `@ContextWindow` → `ContextSettings.maxTokens`, `@ProjectContext` → a `systemPrompt` resolver composing the env block + repo map + nearest `THEO.md` via `@theokit/sdk-tools` + `@theokit/sdk/project`), and the SDK executes it (the bridge compiles; the SDK runs — `sdk-runtime.md`). Decorator knobs with no native SDK mapping now emit a stable `THEO_AGENT_*_METADATA_ONLY` warning at compile time instead of silently doing nothing. Requires `@theokit/sdk >= 2.5.0`; adds `@theokit/sdk-tools` as an optional peer.
