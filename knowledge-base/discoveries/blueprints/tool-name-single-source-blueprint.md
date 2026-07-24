# Blueprint: contrato de nome de tool na fronteira `@theokit/agents` ↔ `@theokit/sdk`

**Slug:** `tool-name-single-source`
**Discovery plan:** `knowledge-base/discoveries/plans/tool-name-single-source-plan.md` (v1.1)
**Edge-case review:** `knowledge-base/reviews/tool-name-single-source-edge-cases-2026-07-24.md`
**Date:** 2026-07-24
**Verdict:** `SHIPPABLE` (100/100, zero hard caps) — `/discover-confidence` em 2026-07-24. Ressalva registrada em `## Nota honesta sobre o gate deste próprio ciclo`: a dimensão `reference_citations` pontuou sem detectar citação alguma (incompatibilidade de prefixo no checker); as 8 citações foram verificadas manualmente em disco.

**Versões lidas (EC-2):** `@theokit/sdk@4.1.0` · `ai@7.0.14` · `opencode` clone raso em `knowledge-base/references/opencode/` (D4 — snapshot aceito).

**Fontes independentes (EC-3):** três, de naturezas distintas — (1) `opencode`, peer clonado, harness de terminal em produção; (2) `@theokit/sdk@4.1.0`, o **contrato real em execução**; (3) `ai@7.0.14`, contraponto de desenho. Cada questão declara abaixo quais a sustentam; questões com uma só estão rotuladas `SINGLE-SOURCE`.

---

## Context

O issue usetheodev/theokit#145 mostrou que um toolbox com `namespace` mintava `ns.tool` — fora do charset que o `@theokit/sdk` aceita — e portanto um caminho **documentado** nunca funcionou contra um provider real. O fix (em `@theokit/agents@1.0.1`) trocou o separador para `_` e validou na autoria. A revisão de System Design + Design Pattern desse fix achou **6 defeitos residuais**, dois deles introduzidos pela própria correção (`knowledge-base/grills/tool-name-single-source-feature-grill.md` § Q1; bloco `### M55` do `ROADMAP.md`).

Esta discovery existe porque a correção tratou o **sintoma** (o separador) sem interrogar a **causa**: a regra do provider foi copiada por amostragem, e a identidade da tool vive replicada em duas estruturas. Regras consumidas: `.claude/rules/error-handling.md` § 2, `.claude/rules/parsimony-ladder.md`, `.claude/rules/testing.md` § 4.1, `.claude/rules/architecture.md` § 2.

## Objective

Decidir, com evidência de código de terceiros e do contrato real em execução, **onde a regra de nome de tool deve viver, onde deve ser aplicada, se deve coagir ou lançar, e qual mecanismo impede o drift contra o provider** — para que o M55 seja implementado sem re-trabalho e sem workaround.

## Sumário executivo

A investigação **refuta a premissa implícita do fix do #145**. O problema nunca foi "o separador estava errado"; foi que **a regra do SDK foi copiada por amostragem** e que **duas estruturas paralelas carregam a mesma identidade**. As duas conclusões são acionáveis e ambas ampliam o escopo conhecido do M55:

1. **A cópia está incompleta, e o defeito ainda está vivo.** `validateToolName` do SDK impõe **três** regras; `SDK_TOOL_NAME` replica **uma**. Um toolbox com `namespace: 'mcp'` minta `mcp_deploy`, passa na nossa validação de autoria e é **rejeitado pelo `Agent.create`** — mesma classe do #145, não corrigida.
2. **O gate que o M55 declarava como prova não prova nada.** `knip.json` tem `"exports": "off"`; o knip **não reporta export não usado** neste repositório. "knip limpo" nunca detectaria o órfão `compileHitlGates`. O DoD do M55 precisa de outra prova.

E uma terceira, de desenho, vinda do peer: o opencode **não tem** o bug de drift nome↔permissão porque **não mantém um segundo mapa** — a permissão filtra o próprio `Record<string, Tool>`. A nossa `compiled.hitl` é justamente esse segundo mapa.

---

## Coverage Corner 1 — Integration tests

### Q5 — Como se testa o contrato de nome sem mockar o validador, e qual é o gap?

**Fontes independentes:** `@theokit/sdk@4.1.0` + repo local (2).

O teste `packages/agents/tests/integration/tool-name-sdk-contract.test.ts` acerta a técnica: importa `@theokit/sdk` de verdade e chama `Agent.create` com uma chave falsa, porque **a validação roda antes de qualquer conexão** — contrato real exercitado, zero rede. Essa é a única suíte do pacote que não mocka o SDK, e foi ela que provou o fix.

O **gap** é de cobertura, e é derivável mecanicamente da lista de códigos de erro que o SDK emite (`@theokit/sdk@4.1.0 › validateToolName`):

| Código do SDK | Condição | Coberto pelo nosso teste? |
|---|---|---|
| `tool_missing_name` | nome ausente ou string vazia | ❌ |
| `tool_invalid_name` | falha o charset `/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/` | ✅ (2 casos: `has space`, `9leading-digit`) |
| `tool_reserved_name` | ∈ `{shell, memory_search, memory_get}` **ou** prefixo `mcp_` | ❌ — **e não é apenas gap de teste: a regra não existe no nosso código** |

Além disso, os dois casos negativos existentes asseguram só `toThrow(ConfigurationError)` — **não** a mensagem. `.claude/rules/testing.md` § 4.1 exige que o caso negativo asserte **o erro tipado E a mensagem**; asserção só de tipo passa mesmo que a mensagem aponte o campo errado.

**Decisão proposta:** a matriz acima **é** a lista de testes do M55 — um caso negativo por código de erro do SDK, cada um assertando tipo + mensagem. A tabela vira a fonte da suíte, e não uma escolha de autor.

### Q6 — O acoplamento nome↔chave de gate existe nos peers? Como impedem o drift?

**Fontes independentes:** `opencode` + repo local (2).

O opencode **não tem esse acoplamento — por construção**. A permissão não vive num segundo mapa: `visibleTools` recebe o **próprio registro de tools** e devolve o registro filtrado (`knowledge-base/references/opencode/packages/opencode/src/permission/index.ts:223-226`):

```ts
export function visibleTools<T>(tools: Record<string, T>, ruleset: PermissionV1.Ruleset): Record<string, T> {
  const hidden = disabled(Object.keys(tools), ruleset)
  return Object.fromEntries(Object.entries(tools).filter(([name]) => !hidden.has(name)))
}
```

O comentário do autor logo acima (linha ~219) declara a intenção sem ambiguidade: *"Used both when preparing the LLM tool list (request prep) and when building/dispatching the code-mode MCP catalog, **so the two cannot drift**."* A avaliação é por **padrão** contra as chaves existentes (`evaluate(permission, pattern, ...rulesets)`, `permission/index.ts:28`), não por lookup de chave exata num mapa paralelo.

Contraste direto com o nosso desenho: `CompiledAgentOptions` carrega `tools: CompiledTool[]` **e** `hitl: Map<string, HumanInTheLoopOptions>` — duas estruturas com a mesma identidade replicada. Duas estruturas podem divergir; foi exatamente o que aconteceu no #145 (a tool virou `ns_tool`, o gate ficou `ns.tool`, e o HITL foi silenciosamente desgatilhado).

**Decisão proposta:** manter o `Map` (mudar a forma do waist é escopo de outro milestone e quebraria o contrato do plugin HITL), mas **eliminar a segunda derivação**: `ToolboxCapability` deriva o `ToolboxWalkResult` **uma vez** e alimenta `compileTools` e `compileHitlGates` com o mesmo objeto. A propriedade "não podem discordar" passa a ser estrutural (mesma entrada, mesma função de nome), não uma convenção repetida em dois laços. O teste `the HITL gate map uses the SAME name as the compiled tool` já existe e vira a prova de regressão dessa propriedade.

---

## Coverage Corner 2 — Dependencies

### Q4 — Quais regras o `@theokit/sdk` aplica, e quais a nossa cópia replica?

**Fontes independentes:** `@theokit/sdk@4.1.0` (1) — `SINGLE-SOURCE` por natureza: é o contrato em si; não existe segunda fonte para o que este pacote faz.

**Veredito da hipótese H1: CONFIRMADA.** Re-derivada lendo `validateToolName` de ponta a ponta em `node_modules/@theokit/sdk/dist/index.js` (símbolo `validateToolName`, ~linha 6559 em `@theokit/sdk@4.1.0`), não da seção Context do plano:

```js
function validateToolName(tool) {
  if (typeof tool.name !== "string" || tool.name.length === 0) → ConfigurationError code:"tool_missing_name"
  if (!TOOL_NAME_PATTERN.test(tool.name))                      → ConfigurationError code:"tool_invalid_name"
  if (RESERVED_TOOL_NAMES.has(tool.name) || tool.name.startsWith("mcp_"))
                                                               → ConfigurationError code:"tool_reserved_name"
}
// TOOL_NAME_PATTERN   = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/
// RESERVED_TOOL_NAMES = new Set(["shell", "memory_search", "memory_get"])
```

Delta contra `packages/agents/src/bridge/agent-compiler.ts:86`:

| Regra do SDK | Nossa cópia |
|---|---|
| não-vazio | ❌ ausente (parcialmente coberta por acidente: o charset exige ≥1 char) |
| charset | ✅ replicada literalmente |
| reservado (`{shell, memory_search, memory_get}` ∪ prefixo `mcp_`) | ❌ **ausente — defeito vivo** |

**O defeito concreto:** `new ToolboxCapability(x, { namespace: 'mcp' })` minta `mcp_*`, passa na validação de autoria e é rejeitado pelo `Agent.create` com `tool_reserved_name`. Uma tool sem namespace chamada `shell` tem o mesmo destino. É o #145 de novo, por outro dos três eixos.

**Export?** `grep TOOL_NAME_PATTERN dist/*.d.ts package.json` → **vazio**. A regra existe como *documentação* no tipo (`dist/run-*.d.ts:411`: *"Tool name surfaced to the LLM. Must match `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`"*) mas **não como valor exportável**. Consumir a regra do SDK é impossível hoje; duplicar é a única opção.

**Decisão proposta:** duplicar **as três** regras, não uma — numa única função nomeada que declare no comentário que espelha `@theokit/sdk › validateToolName` e nomeie a versão espelhada (`4.1.0`). O teste de contrato não-mockado é o alarme de drift: quando o SDK apertar a regra, ele falha. Gatilho de revisão registrado: **se o SDK passar a exportar `TOOL_NAME_PATTERN`/`validateToolName`, consumir e apagar a cópia.**

---

## Coverage Corner 3 — Tools

### Q7 — Qual gate mecanizado teria pego o órfão, e ele está ligado aqui?

**Fontes independentes:** repo local + `.claude/rules/code-quality-golden-rule.md` (2).

**Nenhum gate deste repositório pegaria.** Evidência em `knip.json`:

```json
"rules": { "files": "error", "dependencies": "error", "unlisted": "error",
           "exports": "off", "types": "off", "duplicates": "warn" }
```

`"exports": "off"` desliga exatamente a categoria que detecta símbolo exportado sem consumidor. Somando: `compileHitlGates` **não** é reexportado por nenhuma entry do pacote (`knip.json › workspaces["packages/agents"].entry` lista `src/index.ts`, `src/decorators-entry.ts`, `src/bridge-entry.ts`, `src/testing/index.ts`, `src/theokit-plugin.ts`; `grep` mostra que o símbolo não aparece em nenhuma delas, e o barril `src/bridge/index.ts` exporta `compileTools` mas **não** `compileHitlGates`). Ou seja, é um export de módulo interno sem consumidor — o caso canônico do knip — invisível por configuração.

`.claude/rules/code-quality-golden-rule.md` § 2 classifica isso como `dead_code_unallowlisted_typescript`, cap **FAIL_HARD (49)**. O detector D1 do `/code-quality` usa knip; com `exports: off`, o D1 herda a cegueira.

**Consequência direta para o M55:** o critério *"`pnpm knip` limpo e nenhum símbolo exportado do pacote sem chamador"* escrito no DoD **não é verificável como está** — knip passaria verde de qualquer forma. Isso é um workaround acidental, e o objetivo é não ter nenhum.

**Decisão proposta (parcimônia, rung 1 — a prova mais barata que realmente prova):** não ligar `exports: "error"` no repo inteiro dentro do M55 — isso é mudança de política de qualidade com raio de alcance em 6 workspaces e vira um milestone próprio. A prova do M55 é **local e direta**: um `grep` de chamador de produção, executado como parte da validação, exigindo que todo símbolo exportado por `bridge/agent-compiler.ts` tenha ≥1 consumidor fora de comentário e fora de `dist/`. Se o M55 optar por **deletar** `compileHitlGates` em vez de reconectá-lo, o achado se fecha por remoção e a asserção fica trivialmente verdadeira. Ligar `exports: "error"` no monorepo fica registrado como **próximo milestone candidato**, com o dado de que hoje ninguém sabe quantos órfãos existem.

---

## Coverage Corner 4 — Techniques

### Q1 — Convenção de mintagem: separador, sanitização, e quantos pontos de mintagem?

**Fontes independentes:** `opencode` + `@theokit/sdk` (2).

O opencode usa **`_`** — a mesma escolha que o #145 fez — e a razão é a mesma: é o único separador de "agrupamento" dentro do charset que os providers aceitam. Ponto de mintagem nomeado, em `knowledge-base/references/opencode/packages/opencode/src/mcp/catalog.ts:117-119`:

```ts
export const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_")
export const toolName = (clientName: string, name: string) => sanitize(clientName) + "_" + sanitize(name)
```

**Mas o opencode tem DOIS pontos de mintagem, e o segundo é o frágil** — `packages/opencode/src/tool/registry.ts:184-190` monta o nome do tool de plugin com template inline e **sem sanitizar**, derivando o namespace de um **basename de arquivo**:

```ts
const namespace = path.basename(match, path.extname(match))
custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
```

Um arquivo `my.tools.ts` produziria `my.tools_x` — inválido no mesmo charset. **Esta é a prova mais forte da discovery**, e é um argumento *contra* copiar o peer cegamente: o padrão certo (uma função nomeada que minta e sanitize) existe no opencode, mas **não é aplicado universalmente**, e o ponto que escapa é exatamente o que constrói o nome inline. É a mesma forma do nosso achado (2): o ponto que escapa da regra é o que a inline.

**Decisão proposta:** um único ponto de mintagem (`toolRuntimeName`) que **também valida**, e nenhuma construção inline de nome em lugar nenhum — verificável por `grep` de template com `_` entre namespace e nome.

### Q2 — O nome é reversível? Como a ambiguidade é resolvida?

**Fontes independentes:** `opencode` (1) — `SINGLE-SOURCE`.

**Sim, e a técnica é nomeada.** `knowledge-base/references/opencode/packages/opencode/src/tool/code-mode.ts` § `groupByServer` desfaz `server_tool` **contra a lista conhecida de namespaces**, com **o prefixo mais longo vencendo** — o comentário do autor é explícito: *"the longest matching prefix wins so a server named `a_b` beats `a` for the key `a_b_tool`"*:

```ts
const byLongest = [...servers].sort((a, b) => b.length - a.length)
const server = byLongest.find((name) => key.startsWith(name + "_")) ?? (key.includes("_") ? key.slice(0, key.indexOf("_")) : key)
```

Ou seja: `_` **é** reversível desde que exista o registro de namespaces; o que não é reversível é o split ingênuo. E o opencode reforça isso por contraste — para chaves **internas** (não expostas ao LLM, logo sem restrição de charset) ele usa `:` com escape explícito (`catalog.ts:104-108`: *"Escape both the separator and escape marker so `server:uri` keys remain unambiguous"*). O peer separa conscientemente **nome para o LLM** (charset restrito → `_`, reversível por prefixo mais longo) de **chave interna** (`:` com escape, reversível por construção).

**Decisão proposta:** registrar em ADR que a reversibilidade de `ns_tool` é **condicional ao registro de namespaces**, com a técnica do prefixo mais longo nomeada e citada como caminho pronto caso algum dia precisemos do parse reverso (hoje, `grep "split('.')\|split('_')"` → vazio: ninguém precisa). Fecha o achado (5) sem escrever código para necessidade inexistente (Rule 11, YAGNI).

### Q3 — Coagir ou lançar? Qual o critério?

**Fontes independentes:** `opencode` + `@theokit/sdk` + `ai` (3).

Três posturas observadas, e o critério que as separa é **quem controla a entrada**:

| Fonte | Postura | Onde | Por que faz sentido lá |
|---|---|---|---|
| `opencode` | **coage** (`sanitize`: qualquer char fora do charset vira `_`) | `mcp/catalog.ts:117` | O nome vem do **servidor MCP de terceiro**, declarado em config do usuário. Lançar tornaria um servidor externo mal-nomeado capaz de derrubar a sessão inteira |
| `@theokit/sdk@4.1.0` | **lança tipado** (3 códigos distintos) | `validateToolName` | O nome vem do **código do consumidor**. Um nome inválido é bug do autor, e falhar cedo é o serviço mais útil |
| `ai@7.0.14` | **nem valida** — o nome é chave de tipo (`toolName: Extract<keyof TOOLS, string>`, `dist/index.d.ts:145`), com `DynamicToolCall` (`:1130-1134`) para o que só existe em runtime | — | Empurra a checagem para o compilador; o provider é quem rejeita em runtime |

**Decisão proposta:** **lançar**, e alinhar com o SDK também nos **códigos**. Nossos namespaces vêm da autoria (código ou `.theokit/agent.json` do próprio usuário) — fronteira controlada, exatamente o caso do SDK. Coagir aqui seria pior que o bug: `namespace: 'my ops'` viraria silenciosamente `my_ops` e o autor descobriria pelo nome errado no log de tool call. Isso satisfaz `.claude/rules/error-handling.md` § 2 (validar na fronteira, falhar tipado) e o padrão do `ai` é inaplicável — nossos nomes são compostos em runtime a partir de `namespace + name`, então não há chave de tipo para inferir.

---

## Cross-cutting Comparison

Comparação lado a lado das três fontes nos eixos que decidem o desenho do M55. A coluna `theokit hoje` é o estado medido em `develop` (pós-`@theokit/agents@1.0.1`); `theokit alvo` é o que os ADRs abaixo decidem.

| Eixo | `opencode` (peer clonado) | `@theokit/sdk@4.1.0` (contrato) | `ai@7.0.14` (contraponto) | **theokit hoje** | **theokit alvo (M55)** |
|---|---|---|---|---|---|
| Separador de namespace | `_` (`mcp/catalog.ts:119`) | n/a — só valida o resultado | n/a — sem composição | `_` | `_` (mantém) |
| Pontos de mintagem | **2** — função nomeada (`toolName`) + template inline sem sanitizar (`tool/registry.ts:190`) | n/a | n/a — nome é chave de tipo | 1 (`toolRuntimeName`) | 1, e a única que pode mintar |
| Onde a regra é aplicada | na mintagem (dentro de `toolName`) | no `Agent.create` (`validateToolName`) | no compilador (`keyof TOOLS`) | **longe** da mintagem (`ToolboxCapability`), e `compileTools` público escapa | na mintagem |
| Postura ante nome inválido | **coage** (`sanitize`) | **lança tipado** (3 códigos) | não valida | lança (1 código, 1 regra) | **lança tipado, 3 regras** |
| Nº de regras conhecidas | 1 (charset, via sanitize) | **3** (vazio, charset, reservado) | 0 | **1** ⟵ delta vivo | 3 |
| Identidade duplicada em 2ª estrutura? | **não** — permissão filtra o próprio `Record` (`permission/index.ts:223`) | n/a | não | **sim** — `tools[]` + `hitl` Map derivados em laços separados | sim (Map mantido), mas **uma** derivação |
| Reversibilidade do nome | sim — prefixo mais longo contra a lista de namespaces (`tool/code-mode.ts`) | n/a | n/a | não usada por ninguém | documentada como condicional (ADR D3) |
| Value Object para o nome | não (`string` + função) | não (`string` + validador) | não (chave de tipo) | não | **não** (recusado, ADR D5) |

Leitura transversal: **nenhuma das três fontes usa VO**, as três colocam a regra junto de quem produz ou consome o nome, e a única que mantém identidade em estrutura paralela (a nossa) é a única que teve drift em produção.

## ADRs

### D1 — Duplicar as TRÊS regras do SDK, com espelho declarado e gatilho de revisão

**Decisão:** `toolRuntimeName` valida contra as três regras de `@theokit/sdk@4.1.0 › validateToolName` (não-vazio, charset, reservado), numa função que declara o espelho e a versão espelhada.

**Rationale:** o SDK não exporta a regra (Q4) — consumir é impossível, e a alternativa "validar só o charset" é o defeito atualmente vivo. Alternativas consideradas: (a) abrir issue no SDK pedindo o export e esperar — rejeitada, deixa o defeito em produção por tempo indeterminado; (b) chamar `Agent.create` na autoria para delegar a validação — rejeitada, acopla autoria a um construtor de runtime e exige chave; (c) copiar só o charset — é o status quo, e é o bug.

**Consequences:** a cópia é dívida consciente com alarme. O alarme é o teste de contrato não-mockado, que é integração real com o validador do SDK — não uma cópia da cópia. Gatilho: SDK exportar ⇒ consumir e apagar.

### D2 — Uma derivação, dois consumidores (fecha o achado 3 estruturalmente)

**Decisão:** `ToolboxCapability` deriva o `ToolboxWalkResult` uma vez e passa o **mesmo objeto** para `compileTools` e `compileHitlGates`; o laço duplicado em `apply` desaparece.

**Rationale:** evidência do peer (Q6) — o opencode elimina o drift nome↔permissão operando sobre a mesma estrutura, com o autor declarando o motivo. Aplicar o mesmo princípio ao nosso desenho custa ~8 linhas, ressuscita um símbolo órfão e torna a propriedade "não podem discordar" estrutural. Alternativa considerada: deletar `compileHitlGates` e manter o laço na capability — resolve a orfandade mas **preserva** a duplicação de conhecimento, que é a causa-raiz do #145.

**Consequences:** `compileHitlGates` volta a ter chamador; o achado (3) fecha por reconexão, não por remoção. `.claude/rules/parsimony-ladder.md` rung 4 (reusar o que já existe) resolve antes do rung 6.

### D5 — Value Object `ToolName`: RECUSADO

**Decisão:** não introduzir `ToolName` como VO.

**Rationale:** com ADR-B1 + ADR-B2, o nome só pode ser produzido por `toolRuntimeName`, que valida — o estado ilegal já fica inalcançável **sem** mudar tipo em API pública. O VO só se pagaria se houvesse múltiplos pontos de mintagem que não dá para unificar; o M55 unifica. Nenhuma das três fontes usa VO para nome de tool: o opencode usa `string` + função de mintagem; o SDK usa `string` + validador; o `ai` usa chave de tipo. Parcimônia rungs 1 e 5.

**Consequences:** se um dia surgir um segundo minter legítimo (ex.: nomes vindos de um servidor MCP, onde a postura é coagir e não lançar — Q3), o VO volta à mesa e este ADR é o registro do gatilho.

### D4 — A prova de código morto do M55 é local, não uma mudança de política do knip

**Decisão:** o M55 prova a ausência de órfão por asserção local (chamador de produção existe para cada símbolo exportado do módulo tocado); **não** liga `"exports": "error"` no `knip.json`.

**Rationale:** Q7 mostrou que "knip limpo" é prova vazia hoje. Ligar `exports` no monorepo atinge 6 workspaces com número desconhecido de achados — é um milestone próprio, e enfiá-lo aqui inflaria o M55 e atrasaria a correção do defeito vivo. Alternativa considerada: ligar `exports: "error"` só para `packages/agents` — o knip aplica `rules` globalmente, então isso exigiria reestruturar a config; custo desproporcional ao ganho dentro deste escopo.

**Consequences:** o DoD do M55 troca o critério "knip limpo" por uma asserção que realmente falha quando deveria. Fica registrado como candidato a próximo milestone: *ligar `exports: "error"` e allowlistar/limpar o que aparecer.*

---

## Recommendations — para o M55 (prioridade por risco)

| # | Ação | Fecha | Evidência |
|---|---|---|---|
| 1 | Validar as **três** regras do SDK em `toolRuntimeName` (incluindo reservado/`mcp_`) | achado (2) + **defeito vivo novo** | Q4 |
| 2 | Derivar o walk uma vez; `compileTools` + `compileHitlGates` sobre o mesmo objeto | achado (3) | Q6, D2 |
| 3 | Um caso negativo por código de erro do SDK, assertando **tipo + mensagem** | gap de teste + `testing.md` § 4.1 | Q5 |
| 4 | Trocar no DoD "knip limpo" por asserção local de chamador | prova vazia | Q7, D4 |
| 5 | Corrigir os 2 comentários com `.` | achado (4) | revisão de origem |
| 6 | ADR registrando cópia deliberada + gatilho, reversibilidade condicional, e recusa do VO | achados (1) e (5) | D1/D5, Q2 |

---

## Blocked questions

Nenhuma. As 7 questões foram respondidas dentro do budget (3h), com os checkpoints EC-4 e EC-5 executados antes das Q6/Q7 conforme o plano v1.1.

## Nota honesta sobre o gate deste próprio ciclo

`run_discover_plan_score.py` devolveu `SHIPPABLE` (100) para o plano, mas a dimensão `reference_citations` pontuou 100 com **zero citações detectadas**: o regex do checker (`check_reference_citations.py:22`) exige o prefixo `.claude/knowledge-base/references/`, e o theokit usa `knowledge-base/references/`. Foi um verde vazio, não um verde merecido. As 8 citações do plano foram, por isso, verificadas **manualmente** em disco (todas OK) antes desta execução. Registrado aqui em vez de silenciado, pela mesma razão que o achado (6) existe: um gate que não pode falhar não é um gate.
