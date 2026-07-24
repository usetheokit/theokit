# ROADMAP v2 — camada OO `SDK → Theokit → AgentBuilder`

> **Segunda geração.** O `ROADMAP.md` (v1, M0–M56) está **57/57 completo**. Esta revisão abre a
> iniciativa que o owner definiu em 2026-07-24: **SDK (lib pura) → Theokit (enriquece com
> interfaces/classes/patterns) → AgentBuilder**. Numeração **global e contínua** (M57…M63) para que
> run-files e traceability permaneçam únicos entre v1 e v2. O flip de checkbox usa
> `--roadmap ROADMAP-v2.md` (o script `flip_milestone_checkbox.py` aceita o parâmetro).

## Vision

O agent-builder importa hoje de `@theokit/sdk*` em **20 arquivos / 8 domínios**, e o `@theokit/agents`
expõe **~12 factory functions livres** ("sugar"). A v2 elimina as duas coisas: o Theokit vira a única
fronteira OO que o app consome, e a superfície de autoria fica 100% classes — terminando a migração
`X.create()` que o próprio `@theokit/sdk` já fez (removeu suas free functions no v3.0).

## In scope (V1 desta iniciativa)

- **must-have:** as 12 factory functions viram classes; o agent-builder não importa mais de
  `@theokit/sdk*` em nenhum dos 8 domínios; um gate mecânico impede a regressão.
- Enriquecimento **seletivo** (blueprint D2): pass-through onde é já-OO ou helper puro; interface/classe
  onde há orquestração/estado/duplicação.

### Explicitly out of scope

- **Enriquecer domínios já-OO ou puros** (core, persistence path-helpers, sandbox, interactive, pty) —
  envolver `Agent.create` ou `transcriptPath(base,cwd,id): string` numa classe própria é a cerimônia
  que a parcimônia recusa (Rung 9). Re-export puro, não wrapper.
- **Fachada OO sobre `@theokit/sdk-tools`** (13 factories de terceiro-pacote) — o sugar ali é do
  SDK-tools, não do Theokit; barrel pass-through, sem reinventar. Reabrir exige ADR com evidência de
  padrão de consumo (blueprint Q5).
- **Mudar o runtime** — o `@theokit/sdk` continua o único runtime; a v2 é fronteira/autoria, não um
  segundo runtime (ADR-0031 do v1 preservado).

## Constraints

| Categoria | Constraint |
|---|---|
| Stack | TypeScript, Node ≥ 22.12, pnpm workspace, zod. O `@theokit/sdk@4.1.0` é o provedor. |
| Direção | `SDK → Theokit → AgentBuilder`. O Theokit nunca depende do agent-builder; o agent-builder nunca importa `@theokit/sdk*` (gate M63). |
| Parcimônia | Enriquecer só onde há orquestração/estado/contrato-a-unificar. Não-Reinvente (Rung 9). |

## North-star

`grep -rn "from '@theokit/sdk" agents/ --include=*.ts | grep -v node_modules` → **0** ao fim de M63, e
a superfície de autoria do `@theokit/agents` com **zero factory functions livres**.

---

### M57 — [x] Sugar → OO: as 12 factory functions viram classes `Capability` (major)

**Objective:** Terminar a migração OO que o M52 começou (2/12 já são classe). Cada factory function
livre do `@theokit/agents` — `skills()`, `memory()`, `mcpServers()`, `guardrails()`, `checkpoint()`,
`humanInTheLoop()`, `subAgents()`, `contextWindow()`, `projectContext()`, `skillsOptions()` — vira uma
classe que implementa `Capability`, instanciada por `new XCapability(...)` (sync puras — `.create()`
sem factory-logic seria a cerimônia inversa; o SDK reserva `.create()` para construção async/validada).
`agent()` vira `AgentBuilder` construível (alinhado ao `AgentRunner.fromSpec` que já existe). Reverte o
ADR-0001 (skills-como-função) **com fundamento** — consistência com o `X.create()` do SDK + superfície
uniforme 12/12 (registrado em ADR novo, ADR-0001 citado não apagado).

**Definition of done:**
- [ ] As 10 capabilities-função + `agent()` + `contextualTool()` são classes; `grep -rnE "^export (function|const) (skills|memory|mcpServers|guardrails|checkpoint|humanInTheLoop|subAgents|contextWindow|projectContext|skillsOptions|agent|contextualTool)\b" packages/agents/src --include='*.ts' | grep -v test` retorna vazio.
- [ ] **(GATE) Zero-behavior:** para cada capability, `new XCapability(a).apply(draft)` produz draft deep-equal a `x(a).apply(draft)` no waist; a suíte atual passa **sem editar expectativa** (a suíte é repontada da função para a classe, sem mudar asserção).
- [ ] Cada capability antiga é **deletada** no mesmo milestone (playbook M49/M53 — sem sugar layer, sem deprecation window).
- [ ] ADR registrando a reversão do ADR-0001 com os 3 motivos.
- [ ] `pnpm test` / `typecheck` / `lint --max-warnings=0` / `knip` verdes; entrada no CHANGELOG marcando o breaking (as funções somem → major do `@theokit/agents`).

**Dependencies:** nenhuma (opera sobre o `@theokit/agents` atual).

**Top risks:**
1. Reverter o ADR-0001 sem registrar o fundamento vira "everything must be a class" cego. Mitigação: ADR novo com os 3 motivos, citando o ADR-0001; o gate de zero-behavior prova que não é churn sem valor.
2. Uma capability com lógica (`skills`/`checkpoint`/`subAgents`) diverge ao virar classe. Mitigação: o teste de equivalência no waist é o oráculo (precedente M52).

---

### M58 — [x] Barrel dos domínios já-OO/puros + repointing do agent-builder

**Objective:** O `@theokit/agents` re-exporta (pass-through) os 5 domínios que já são OO ou helpers
puros — core (`Agent`/`Tool`/`Provider`/tipos), persistence (`transcriptPath`/`encodeProjectDir`),
sandbox (`LocalSandbox`/`SandboxBackend`), interactive, pty — via barris estáveis. O agent-builder
reponta esses imports de `@theokit/sdk*` para `@theokit/*`. Pass-through, **não** wrapper (Rung 9).

**Definition of done:**
- [ ] `@theokit/agents` expõe os símbolos dos 5 domínios (barril re-exporta do SDK; teste de superfície trava cada um).
- [ ] O agent-builder não importa mais `@theokit/sdk`, `/persistence`, `/sandbox`, `/interactive`, nem `@theokit/sdk-pty`: `grep -rn "from '@theokit/sdk\('\|/persistence\|/sandbox\|/interactive\)'\|@theokit/sdk-pty" agents/` retorna vazio para esses.
- [ ] Suíte do agent-builder verde **sem editar expectativa**; prova live no tmux `agentbuilder` contra provider real (um agente com sandbox + sessão persistida responde).
- [ ] `pnpm test`/`typecheck`/`lint`/`knip` verdes nos dois repos.

**Dependencies:** M57 (`[ ]`) — o barril e a superfície OO vêm juntos; começar antes duplicaria o barril.

**Top risks:**
1. Re-export de tipo do SDK vaza detalhe interno. Mitigação: re-exportar só a superfície pública do SDK (subpaths documentados), teste de superfície como guard.
2. Ciclo `@theokit/agents` ↔ SDK. Mitigação: `check:direction` já guarda; o agents já depende do SDK (direção correta).

---

### M59 — [x] Goal enriquecido: `GoalRunner` classe sobre `runGoalLoop`

**Objective:** `runGoalLoop` é free function de orquestração no SDK. O Theokit a envolve numa classe
`GoalRunner` (paralela ao `AgentRunner` que já existe), impondo o padrão OO. O agent-builder
(`agents/lib/goal.ts`) reponta de `@theokit/sdk` para `@theokit/agents`.

**Definition of done:**
- [ ] `GoalRunner` (classe) encapsula `runGoalLoop`, com teste que prova paridade de comportamento (mesmos `GoalEvent`s emitidos).
- [ ] `agents/lib/goal.ts` importa `GoalRunner` de `@theokit/agents`; `grep runGoalLoop agents/` só no teste de paridade, se houver.
- [ ] Suíte do agent-builder verde sem editar expectativa; prova live no tmux (um goal-loop real termina).
- [ ] Gates verdes nos dois repos.

**Dependencies:** M58 (`[ ]`) — o barril precede o enriquecimento específico.

**Top risks:**
1. `GoalRunner` reimplementa em vez de envolver `runGoalLoop`. Mitigação: DELEGA ao `runGoalLoop` do SDK; o teste de paridade prova que não reimplementa (Rung 9).

---

### M60 — [x] Auth enriquecido: `CredentialStore` / `AuthProvider`

**Objective:** O fluxo de auth do SDK (`ensureFreshCredential`, `openaiDeviceLogin`,
`persistOAuthTokens`) são free functions com estado (login → persist → refresh). O Theokit as unifica
num contrato OO (`CredentialStore`/`AuthProvider`). O agent-builder reponta os 3 arquivos de auth
(`credentials.ts`, `login.ts`, `oauth-config.ts`).

**Definition of done:**
- [ ] `CredentialStore`/`AuthProvider` (classe/interface) encapsula o fluxo, com teste de paridade (login → persist → refresh produz o mesmo estado).
- [ ] Os 3 arquivos de auth do agent-builder importam de `@theokit/agents`; `grep "@theokit/sdk/auth" agents/` vazio.
- [ ] Nenhum segredo em teste/log (Regra: auth checks metadata-only). Suíte verde sem editar expectativa.
- [ ] Gates verdes nos dois repos.

**Dependencies:** M58 (`[ ]`).

**Top risks:**
1. Vazar token em log ao envolver o fluxo. Mitigação: o contrato reporta metadata (presença/validade), nunca o valor; teste asserta a ausência do segredo na saída.

---

### M61 — [x] `ConfigurationError` unificado (resolve a duplicação)

**Objective:** Há dois `ConfigurationError` — o do Theokit (`errors.ts:16`, `extends Error`) e o do SDK
(`extends TheokitAgentError`). O agent-builder importa o do SDK. Um `catch (e instanceof
ConfigurationError)` pega um e não o outro. A v2 decide o contrato: o Theokit expõe **um**
`ConfigurationError` (provável: o do Theokit passa a estender o do SDK, unificando a hierarquia), e o
agent-builder passa a importá-lo do `@theokit/agents`.

**Definition of done:**
- [ ] Um único `ConfigurationError` no contrato do Theokit; ADR registrando a decisão de hierarquia (estender `TheokitAgentError` vs manter `extends Error`).
- [ ] O agent-builder importa de `@theokit/agents`; `grep "@theokit/sdk/errors" agents/` vazio.
- [ ] Teste: `instanceof` funciona através da fronteira para os dois caminhos que hoje lançam (autoria do Theokit + o que o SDK lança).
- [ ] Gates verdes nos dois repos.

**Dependencies:** M57 (`[ ]`) — o `ConfigurationError` do Theokit é superfície de autoria; a decisão de hierarquia acompanha a virada OO.

**Top risks:**
1. Unificar a hierarquia quebra um `catch` existente. Mitigação: se o do Theokit passar a estender `TheokitAgentError`, todo `catch (instanceof ConfigurationError)` existente continua pegando; provado por teste.

---

### M62 — [ ] `sdk-tools` via barrel `@theokit/agents/tools`

**Objective:** As 13 factory tools do `@theokit/sdk-tools` (`createReadFileTool`, `createShellTool`, …)
+ `withName`/`withDescription` são re-exportadas via `@theokit/agents/tools` (pass-through — são
factories de terceiro-pacote sem estado; enriquecer seria reinventar, blueprint Q5). O agent-builder
(`chat.ts`, `roles.ts`, `analyst.ts`) reponta.

**Definition of done:**
- [ ] `@theokit/agents/tools` re-exporta a superfície de `@theokit/sdk-tools` usada pelo agent-builder; teste de superfície trava.
- [ ] O agent-builder não importa `@theokit/sdk-tools`: `grep "@theokit/sdk-tools" agents/` vazio.
- [ ] Suíte verde sem editar expectativa; prova live no tmux (um agente com uma tool do barril executa).
- [ ] Gates verdes nos dois repos.

**Dependencies:** M58 (`[ ]`).

**Top risks:**
1. O barril `/tools` cria superfície pública nova a manter. Mitigação: pass-through puro (re-export), sem lógica própria a versionar.

---

### M63 — [ ] Gate de fronteira: proibir `from '@theokit/sdk*'` no agent-builder

**Objective:** Mecanizar o invariante da v2 — o agent-builder nunca importa `@theokit/sdk*`. Um teste
de fronteira no agent-builder faz o grep e falha se um import direto reaparecer (precedente: o
`check:direction` do Theokit). Fecha a iniciativa.

**Definition of done:**
- [ ] Teste no agent-builder que falha se `from '@theokit/sdk'`, `@theokit/sdk/*` ou `@theokit/sdk-*` aparecer em `agents/**/*.ts` (fora de teste). Verde no HEAD (tudo já repontado).
- [ ] `grep -rn "from '@theokit/sdk" agents/ --include=*.ts | grep -v node_modules` → **0** (north-star).
- [ ] O gate roda no CI/pre-push do agent-builder.
- [ ] Documentação: a arquitetura `SDK → Theokit → AgentBuilder` registrada no CLAUDE.md/README do agent-builder.

**Dependencies:** M58, M59, M60, M61, M62 (`[ ]`) — o gate só passa quando todos os domínios foram repontados.

**Top risks:**
1. O grep tem falso-negativo (ex: import multi-linha). Mitigação: o teste usa o mesmo padrão do `check:direction` (lê o manifesto/AST, não só linha); cobrir import multi-linha no próprio teste.

---

## State-of-the-art references

| Fonte | O que aporta | Onde |
|---|---|---|
| `@theokit/sdk@4.1.0` | o padrão `X.create()` + a remoção das free functions no v3.0 (o precedente do sugar→OO) | `node_modules/@theokit/sdk/dist/index.d.ts` |
| blueprint desta iniciativa | as 4 decisões (D1 sugar→classe, D2 seletivo por domínio, D3 gate de fronteira, D4 corte) | `knowledge-base/discoveries/blueprints/layered-oo-boundary-blueprint.md` |
| ADR-0001 | o patterns-budget que o M57 reverte (skills-como-função) | `knowledge-base/adrs/0001-capability-patterns-budget.md` |

---

## Revision protocol

- **Marcar progresso:** flip do checkbox no header via `flip_milestone_checkbox.py --roadmap ROADMAP-v2.md`.
- **Adicionar milestone pós-M63:** continuar a numeração global (M64…), aqui neste arquivo.
- **Concluir a v2:** quando M57…M63 forem `[x]`, o north-star (`grep` → 0) é a prova; decidir v3 ou parar é decisão humana.
