---
slug: tool-name-single-source
milestone_id: M55
created_at: 2026-07-24
goal: Consolidar em fonte única o contrato de nome de tool na fronteira @theokit/agents ↔ @theokit/sdk — validar no ponto de mintagem com as três regras do SDK, e eliminar a segunda derivação que produz o gate HITL.
---

# Plan: nome de tool com fonte única — validar onde se minta, matar o código morto do gate HITL

## Goal

Fazer com que **a regra de nome de tool exista em um lugar só, seja aplicada no ponto que minta o nome, e cubra as três regras que o `@theokit/sdk` realmente impõe** — fechando os 6 achados da revisão de arquitetura do fix #145 e os 2 defeitos adicionais que a discovery encontrou.

## Context

O fix do issue usetheodev/theokit#145 (`@theokit/agents@1.0.1`) trocou o separador de namespace de `.` para `_` e adicionou validação na autoria. A revisão de System Design + Design Pattern desse fix achou 6 defeitos residuais — dois deles **introduzidos pela própria correção**. A discovery subsequente (`knowledge-base/discoveries/blueprints/tool-name-single-source-blueprint.md`, `SHIPPABLE` 100) achou mais dois, ambos medidos:

1. **Defeito vivo:** `validateToolName` do SDK impõe **três** regras; a nossa cópia replica **uma**. `namespace: 'mcp'` minta `mcp_*`, passa na autoria e é **rejeitado pelo `Agent.create`** (`tool_reserved_name`). É a mesma classe do #145, não corrigida.
2. **Gate vazio:** `knip.json` tem `"exports": "off"` — o critério "knip limpo" escrito no DoD do M55 **não detectaria** o órfão `compileHitlGates`. Provado por execução: com `exports:"error"` num override de config, o knip aponta `packages/agents/src/bridge/agent-compiler.ts:107 compileHitlGates`.

## Baseline Context (deep review of current state)

**Git sha do baseline:** `271124d5` (branch `develop`).

### Files that will be touched

| Arquivo | LoC | Papel hoje | O que muda |
|---|---|---|---|
| `packages/agents/src/bridge/agent-compiler.ts` | 240 | Minta o nome (`toolRuntimeName`), declara `SDK_TOOL_NAME`, define `compileTools` e o órfão `compileHitlGates` | `toolRuntimeName` passa a validar as 3 regras; `SDK_TOOL_NAME` acompanhado das outras duas regras |
| `packages/agents/src/capability/toolbox.ts` | 152 | Valida o nome (longe da mintagem) e reimplementa o laço de gate HITL | Para de duplicar validação e laço; deriva o walk uma vez |
| `packages/agents/src/capability/capabilities.ts` | 144 | Define `ConfigurationError` + capabilities `model`/`tools`/`skills` | Passa a **reexportar** `ConfigurationError` de `src/errors.ts` |
| `packages/agents/src/errors.ts` | 0 (novo) | — | Passa a definir `ConfigurationError` (módulo sem imports ⇒ sem ciclo) |
| `packages/agents/src/capability/agent-capabilities.ts` | 192 | Capabilities restantes | Comentário mentiroso na linha 75 corrigido |
| `packages/agents/tests/integration/tool-name-sdk-contract.test.ts` | 77 | Único teste do pacote que **não** mocka o SDK | Ganha um caso negativo por código de erro do SDK, assertando tipo **e** mensagem |

### Current callers / dependents

- `toolRuntimeName` — 4 chamadas de produção: `agent-compiler.ts:114` (dentro do órfão `compileHitlGates`), `agent-compiler.ts:152` (dentro de `compileTools`), `toolbox.ts:101` (validação no construtor), `toolbox.ts:145` (laço de gate duplicado). Após o plano: 2 (uma em cada compilador), mais o construtor.
- `compileTools` — **1** chamador de produção: `toolbox.ts:130`. Exportado publicamente em `bridge/index.ts:9`; nenhum consumidor externo no monorepo.
- `compileHitlGates` — **0** chamadores de produção (medido: `grep -rn compileHitlGates packages/agents/src` só retorna a definição e 3 comentários). Não é reexportado por nenhuma entry do pacote.
- `ConfigurationError` — importado por 4 arquivos de `src/` e ~16 de `tests/`. A reexportação em `capabilities.ts` mantém **todos** os caminhos de import funcionando (zero churn).

### Domain glossary

| Termo | Significado neste plano |
|---|---|
| **nome de runtime** | o nome que o SDK expõe ao LLM: `namespace_tool` quando há namespace, senão o nome puro |
| **ponto de mintagem** | a função que **produz** o nome — `toolRuntimeName`. Distinta do ponto de **consumo** (`compileTools`, `compileHitlGates`) |
| **walk** (`ToolboxWalkResult`) | a estrutura intermediária que descreve um toolbox (classe, namespace, tools com config/hitl); é a entrada dos dois compiladores |
| **gate HITL** | entrada em `compiled.hitl`: `Map<nome-de-runtime, HumanInTheLoopOptions>` que o plugin HITL consulta para pausar a run |
| **regra reservada** | 3ª regra do SDK: nome ∈ `{shell, memory_search, memory_get}` **ou** com prefixo `mcp_` ⇒ `tool_reserved_name` |

### Architecture boundaries affected

`packages/agents/src/bridge/` (adapter SDK) e `packages/agents/src/capability/` (autoria). Hoje `capability/ → bridge/` (toolbox.ts importa agent-compiler.ts). Fazer `bridge/` lançar `ConfigurationError` — hoje definido em `capability/capabilities.ts`, que importa `bridge/agent-compiler.js` — **fecharia um ciclo**. Por isso `src/errors.ts` (sem imports) é pré-requisito ordenado, não preferência estética. Guard mecânico: `pnpm check:direction` (`scripts/check-package-direction.mjs`) + pre-push.

### Estado dos gates no baseline (medido, não presumido)

| Gate | Estado em `271124d5` | Implicação |
|---|---|---|
| `npx knip` (política do repo) | **exit 1** — falha já no baseline. Dois grupos: (a) `Unused files (2)` em `packages/agents`: `src/metadata/index.ts`, `src/metadata/keys.ts` (resíduo do M53); (b) `Unused devDependencies (8)`: `@types/pg`, `autocannon`, `pg`, `unplugin-swc`, `wrangler` (raiz) e `@types/pg`, `pg`, `pg-mem` (`packages/theo`) | (a) está **dentro** do escopo do M55 (`packages/agents`) e será corrigido em T3.2. (b) é **pré-existente e fora do escopo** — outros pacotes, sem relação com nome de tool; reportado como followup, **não mascarado**. Consequência: o DoD global deste plano não pode exigir "`npx knip` verde no repo" sem absorver dívida alheia; exige verde **em `packages/agents`** |
| `knip --include exports` com a política do repo | **0 achados** — `rules.exports:"off"` suprime o detector | o critério "knip limpo" do DoD é vazio como escrito |
| `knip` com override `exports:"error"` | 2 exports órfãos em `packages/agents`: `agent-compiler.ts:107 compileHitlGates` e `run-reflective-loop.ts:450 ceilingRoundFactory` | ambos entram no escopo do DoD |

## Prior Art & Related Work

| Fonte | O que aporta | Onde |
|---|---|---|
| Blueprint desta discovery | as 4 decisões (D1 cópia das 3 regras + gatilho; D2 uma derivação; D4 prova local; D5 recusa do VO) | `knowledge-base/discoveries/blueprints/tool-name-single-source-blueprint.md` |
| `opencode` (peer clonado) | permissão filtra o **próprio** `Record<string,Tool>` — *"so the two cannot drift"* | `knowledge-base/references/opencode/packages/opencode/src/permission/index.ts:223` |
| `opencode` | mintagem nomeada com `_` e sanitização; e o contra-exemplo do template inline sem sanitizar | `.../src/mcp/catalog.ts:117-119`; `.../src/tool/registry.ts:190` |
| `@theokit/sdk@4.1.0` | as três regras + os três códigos de erro tipados | `node_modules/@theokit/sdk/dist/index.js` › `validateToolName` |
| Revisão de origem | os 6 achados que abriram o M55 | `knowledge-base/grills/tool-name-single-source-feature-grill.md` § Q1 |

## Objective

Ao fim deste plano: (a) nenhum caminho consegue produzir um nome de tool que o `Agent.create` rejeite, porque a validação vive dentro do único produtor; (b) `compiled.tools` e `compiled.hitl` são derivados de **uma** estrutura, então não podem discordar por construção; (c) cada código de erro do SDK tem um caso negativo assertando tipo e mensagem; (d) `packages/agents` não tem símbolo exportado sem chamador, provado por um detector que **pode** falhar.

## ADRs

### D1 — Espelhar as três regras do SDK numa função nomeada, com versão declarada e gatilho de revisão

**Decisão:** `toolRuntimeName` valida contra as três regras de `@theokit/sdk@4.1.0 › validateToolName`, com o comentário declarando o espelho e a versão espelhada.

**Rationale:** o SDK não exporta a regra (verificado: `grep TOOL_NAME_PATTERN dist/*.d.ts package.json` → vazio); a regra só existe como prosa num JSDoc (`dist/run-*.d.ts:411`) e como constante interna. Consumir é impossível hoje. **Alternativas consideradas:** (a) validar só o charset — é o status quo e é o defeito vivo; (b) chamar `Agent.create` na autoria para delegar a validação — acopla autoria a um construtor de runtime e exigiria uma apiKey; (c) abrir issue pedindo o export e esperar — deixa o defeito em produção por tempo indeterminado. Nenhuma resolve hoje sem cópia.

**Consequences:** dívida consciente **com alarme** — o alarme é o teste de contrato não-mockado, que exercita o validador real do SDK e não uma cópia da cópia. Gatilho registrado: se o SDK exportar `TOOL_NAME_PATTERN`/`validateToolName`, consumir e apagar a cópia.

### D2 — Uma derivação, dois consumidores (mantendo o `Map`)

**Decisão:** `ToolboxCapability` deriva o `ToolboxWalkResult` uma vez (método privado) e passa **o mesmo objeto** para `compileTools` e `compileHitlGates`. O laço duplicado em `apply()` desaparece.

**Rationale:** evidência do peer — o opencode não tem drift nome↔permissão porque não mantém segundo mapa. Não podemos copiar a forma (`compiled.hitl` é `Map` no waist e o plugin HITL depende disso), mas podemos copiar a **propriedade**: derivar de uma estrutura só. **Alternativas consideradas:** (a) deletar `compileHitlGates` e manter o laço na capability — fecha a orfandade mas **preserva a duplicação de conhecimento**, que é a causa-raiz do #145; (b) trocar `hitl: Map` por um campo em `CompiledTool` (a forma do opencode) — muda o waist e quebra o plugin HITL: é outro milestone, não este.

**Consequences:** `compileHitlGates` volta a ter chamador; o achado fecha por reconexão, não por remoção. Parcimônia rung 4 (reusar o que já existe) resolve antes do rung 6.

### D3 — Reversibilidade do nome: documentada como condicional, não implementada

**Decisão:** registrar que `ns_tool` é reversível **desde que exista o registro de namespaces** (técnica do prefixo mais longo, `opencode .../tool/code-mode.ts`), e **não** escrever código de parse reverso.

**Rationale:** `grep "split('.')\|split('_')" packages/agents/src` → vazio; ninguém faz parse reverso hoje. **Alternativas consideradas:** implementar o parse agora "porque um dia pode precisar" — YAGNI (Regra 11); manter silêncio sobre a propriedade perdida — foi o achado (5) da revisão, e silêncio é o que o achado condena.

**Consequences:** se o parse virar necessidade, o caminho está citado e pronto; o custo hoje é uma seção de ADR.

### D4 — A prova de código morto é um override de config do knip, não uma mudança de política

**Decisão:** adicionar `knip-exports.json` (override que liga `exports:"error"`) + script `knip:exports` restrito a `packages/agents`, e **não** alterar `rules.exports` no `knip.json` do repo.

**Rationale:** medido — a política atual suprime o detector, então "knip limpo" é prova vazia. Ligar `exports:"error"` globalmente atinge 6 workspaces com número desconhecido de achados: vira milestone próprio e atrasaria a correção do defeito vivo. **Alternativas consideradas:** (a) comando ad-hoc no DoD sem arquivo — não é re-executável por outra pessoa nem por CI; (b) ligar global — escopo desproporcional; (c) um teste unitário que assere "compileHitlGates é chamado" — não existe asserção honesta para isso: se alguém re-inlinar o laço, o teste de comportamento continua verde. Só o detector de exports pega.

**Consequences:** o M55 ganha um gate que **pode falhar** (provado: falha hoje, com 2 achados). O escopo do gate é `packages/agents`; ligar `exports` no monorepo fica como followup com dado concreto.

### D5 — Value Object `ToolName`: RECUSADO

**Decisão:** não introduzir um VO para o nome de tool.

**Rationale:** com D1 + D2, o nome só pode nascer de `toolRuntimeName`, que valida — o estado ilegal já fica inalcançável **sem** mudar tipo em API pública. **Alternativas consideradas:** introduzir o VO — nenhuma das três fontes estudadas usa VO para nome de tool (opencode: `string` + função; SDK: `string` + validador; `ai`: chave de tipo), e o ganho marginal não paga uma mudança de assinatura pública. Parcimônia rungs 1 e 5.

**Consequences:** se surgir um segundo minter legítimo com postura diferente (ex.: nomes vindos de servidor MCP, onde se coage em vez de lançar), o VO volta à mesa; este ADR é o registro do gatilho.

## Drawbacks & Risks

| # | Risco | Por que é real | Mitigação |
|---|---|---|---|
| R1 | **Ciclo de import `bridge → capability`** | Lançar o erro tipado de `bridge/` exige tirar `ConfigurationError` de `capability/capabilities.ts`, que importa `bridge/agent-compiler.js` | T0.1 é pré-requisito ordenado; `pnpm check:direction` é o guard; a reexportação mantém os ~20 importadores intactos |
| R2 | **Falha nova em caminho público antes silencioso** | `compileTools` é exportado em `bridge/index.ts`; um par que hoje passa e só explode no `Agent.create` passará a lançar na compilação | É a correção pretendida (falhar cedo, tipado). Declarada como breaking de comportamento no CHANGELOG. Churn real baixo: **1** chamador de produção, zero consumidores externos no monorepo |
| R3 | **A cópia da regra pode envelhecer** | Espelhar `validateToolName` cria dívida contra `@theokit/sdk@4.1.0` | O teste de contrato não-mockado falha quando o SDK apertar a regra; ADR D1 registra o gatilho para apagar a cópia quando o export existir |
| R4 | **A regra reservada pode quebrar autoria existente** | Quem usa `namespace: 'mcp'` hoje passa na nossa validação | Nenhuma mitigação necessária: esse agente **já não funciona** (o `Agent.create` o rejeita); depois do M55 ele falha mais cedo e com mensagem melhor. O CHANGELOG explica |
| R5 | **O DoD puxa órfãos vizinhos** | O DoD do M55 pede "nenhum símbolo exportado do pacote sem chamador", e o baseline tem `ceilingRoundFactory` + 2 arquivos mortos em `src/metadata/`, não relacionados a nome de tool | Entram em T3.2 por serem literalmente parte do DoD declarado; são **remoções**, então o custo é baixo e o risco (regressão de import) é coberto pela suíte + grep obrigatório (EC-8) |

## Unresolved Questions

- Q1 — `ceilingRoundFactory` (`run-reflective-loop.ts:450`) é órfão de verdade ou seam intencional para o M54, que mexe justamente nesse arquivo? **Resolução em T3.2:** verificar consumidor por grep; se for seam planejado, allowlistar com sunset citando M54 em vez de deletar. Decidido com evidência na hora, não agora.
- Q2 — Ligar `exports:"error"` no monorepo inteiro vale um milestone? Depende de quantos órfãos existem fora de `packages/agents` — número desconhecido hoje. **Não bloqueia o M55**: o ADR D4 escopa o gate ao pacote tocado e registra o followup.

## Dependency Graph

T0.1 é pré-requisito duro de T1.1 (sem `src/errors.ts` o import fecha ciclo). T1.1 precede T1.2 (a capability só pode parar de validar depois que a mintagem valida). T2.1 é independente de T1.x em código, mas depende de T1.1 para o teste de gate ficar significativo, então roda depois. T3.1 (comentários) é independente. T3.2 (gate) depende de T2.1 — é ele que fecha a orfandade de `compileHitlGates`. T3.3 (ADR + CHANGELOG) fecha.

---

## Phase T0 — Fundação sem ciclo

### T0.1 — Extrair `ConfigurationError` para `src/errors.ts`

#### Objective
Permitir que `bridge/` lance o erro tipado sem fechar ciclo de import com `capability/`.

#### Why this step (action + reasoning — ReAct discipline)
A validação precisa migrar para `toolRuntimeName`, que vive em `bridge/agent-compiler.ts`. O erro tipado que ela deve lançar (`ConfigurationError`) está hoje em `capability/capabilities.ts`, que importa `bridge/agent-compiler.js` — importar de volta fecha um ciclo. Fazer isso primeiro, como passo separado e sem mudança de comportamento, é o que permite que T1.1 seja um diff pequeno e legível em vez de um diff que mistura mudança estrutural com mudança de regra.

#### Evidence
`packages/agents/src/capability/capabilities.ts:3-4` importa `../bridge/agent-compiler.js` e `../bridge/define-agent.js`; `capabilities.ts:15` define `ConfigurationError`.

#### Files to edit
- `packages/agents/src/errors.ts` (novo) — define `ConfigurationError`
- `packages/agents/src/capability/capabilities.ts` — remove a definição, reexporta de `../errors.js`

#### Deep file dependency analysis
`src/errors.ts` não importa nada — é folha, então não pode participar de ciclo. A reexportação em `capabilities.ts` preserva os ~20 caminhos de import existentes (4 em `src/`, ~16 em `tests/`), então o diff não toca nenhum consumidor.

#### Tasks
1. Criar `packages/agents/src/errors.ts` com a classe `ConfigurationError` (mesma forma: `extends Error`, `override readonly name`).
2. Em `capabilities.ts`, trocar a definição por `export { ConfigurationError } from '../errors.js'`.
3. Rodar a suíte inteira sem editar nenhuma expectativa.

#### TDD
```
RED:     (nenhum teste novo — mudança estrutural sem comportamento; a prova é a suíte existente passar SEM edição de expectativa)
GREEN:   criar src/errors.ts; capabilities.ts reexporta
REFACTOR: None expected
VERIFY:  cd packages/agents && npx vitest run
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `instanceof ConfigurationError` continua verdadeiro para erros lançados por `ModelCapability`, `skills()` e `ToolboxCapability` (provado pela suíte existente, sem edição)
- [ ] `pnpm check:direction` verde
- [ ] Pass: lint — `npx eslint --max-warnings=0 $(git diff --name-only HEAD | grep '\.ts$')` sai 0
- [ ] Pass: size — `wc -l` de todo arquivo tocado ≤ 500: `wc -l $(git diff --name-only HEAD | grep '\.ts$') | awk '$1>500'` retorna vazio

#### DoD
- [ ] Suíte de `packages/agents` verde **sem uma única expectativa editada**
- [ ] Zero erros de tipo — `npx tsc --noEmit` na raiz
- [ ] Commit atômico referenciando T0.1

---

## Phase T1 — Uma regra, um ponto de mintagem

### T1.1 — `toolRuntimeName` valida as TRÊS regras do SDK

#### Objective
Fazer com que seja impossível produzir, por qualquer caminho, um nome que o `Agent.create` rejeite.

#### Why this step (action + reasoning — ReAct discipline)
Hoje a regra é aplicada em `ToolboxCapability` (construtor) e o produtor do nome (`toolRuntimeName`) não valida nada — então `compileTools`, que é público, escapa. Mover a validação para dentro do produtor fecha **todos** os caminhos de uma vez, porque não existe outra forma de obter um nome de runtime. Ao mesmo tempo, é o momento certo para corrigir o defeito vivo: a cópia replica 1 das 3 regras do SDK, e adicionar as outras duas aqui custa 6 linhas, enquanto adicioná-las depois exigiria tocar o mesmo arquivo de novo.

#### Evidence
`node_modules/@theokit/sdk/dist/index.js` › `validateToolName` (`@theokit/sdk@4.1.0`): três guardas, três códigos (`tool_missing_name`, `tool_invalid_name`, `tool_reserved_name`), com `RESERVED_TOOL_NAMES = {shell, memory_search, memory_get}` e o prefixo `mcp_`. `packages/agents/src/bridge/agent-compiler.ts:86` replica só `TOOL_NAME_PATTERN`.

#### Files to edit
- `packages/agents/src/bridge/agent-compiler.ts` — `SDK_RESERVED_TOOL_NAMES` + validação dentro de `toolRuntimeName`
- `packages/agents/tests/integration/tool-name-sdk-contract.test.ts` — casos negativos

#### Deep file dependency analysis
`toolRuntimeName` é chamado em 4 pontos (2 dentro dos compiladores, 2 em `toolbox.ts`). Validar dentro dele torna os 4 seguros de uma vez. `agent-compiler.ts` passa a importar `../errors.js` (folha, sem ciclo — garantido por T0.1).

#### Deep Dives
A regra reservada é a que expõe o defeito vivo: `namespace: 'mcp'` produz `mcp_<tool>`, que casa o charset e é rejeitado pelo SDK. A mensagem precisa distinguir os três casos — uma mensagem única ("nome inválido") reproduziria o problema que este plano existe para resolver: o autor não saberia **qual** regra quebrou.

#### Pseudo-code / Signatures
```ts
/** Espelha `@theokit/sdk@4.1.0 › validateToolName`. Gatilho (ADR D1): se o SDK
 *  exportar TOOL_NAME_PATTERN/validateToolName, consumir e apagar esta cópia. */
export const SDK_TOOL_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/
export const SDK_RESERVED_TOOL_NAMES: ReadonlySet<string>  // shell, memory_search, memory_get

export function toolRuntimeName(namespace: string, toolName: string): string {
  // EC-1: a PARTE `toolName` precisa ser não-vazia antes de compor — `ns` + '' produz "ns_",
  // que casa o charset e o SDK ACEITA (medido). Validar só o composto deixa esse buraco.
  const name = namespace ? `${namespace}_${toolName}` : toolName
  // Guardas espelhando o SDK, SEMPRE sobre o nome COMPOSTO (EC-4), cada uma com mensagem própria:
  //   vazio → charset (com caso especial de comprimento, EC-2) → reservado
  return name
}
```

#### Tasks
1. Declarar `SDK_RESERVED_TOOL_NAMES` ao lado de `SDK_TOOL_NAME`, com comentário citando símbolo + versão espelhada.
2. Guardar a **parte** `toolName` como não-vazia (EC-1) antes de compor.
3. Validar o nome **composto** (EC-4): vazio → charset → reservado, cada um com `ConfigurationError` de mensagem própria; quando só o comprimento violar, a mensagem cita a composição e o comprimento obtido (EC-2).
4. Escrever os casos negativos ANTES (RED), um por código do SDK + os de fronteira.

#### TDD
```
RED:     toolRuntimeName_lanca_quando_nome_vazio() — assert ConfigurationError E mensagem contendo 'vazio'
RED:     toolRuntimeName_lanca_quando_toolName_vazio_com_namespace() — (EC-1) ns='ops', tool='' → hoje produziria "ops_" e passaria; deve LANÇAR
RED:     toolRuntimeName_lanca_quando_fora_do_charset() — namespace 'has space' → assert ConfigurationError E mensagem contendo o nome ofensor "has space_deploy"
RED:     toolRuntimeName_lanca_quando_composicao_estoura_64() — (EC-2) ns de 60 chars + 'deploy' (67) → mensagem cita a COMPOSIÇÃO e o comprimento, não um char inválido inexistente
RED:     toolRuntimeName_lanca_quando_nome_reservado() — tool 'shell' sem namespace → assert ConfigurationError E mensagem contendo 'reservado'
RED:     toolRuntimeName_lanca_quando_prefixo_mcp() — namespace 'mcp' → assert ConfigurationError E mensagem contendo 'mcp_'
RED:     toolRuntimeName_ACEITA_x_shell() — (EC-4) ns='x' + 'shell' → "x_shell" NÃO é reservado; deve PASSAR (ser mais estrito que o SDK é tão errado quanto ser mais frouxo)
RED:     toolRuntimeName_ACEITA_mcpx() — (EC-5) ns='mcpx' → "mcpx_deploy" não começa com 'mcp_'; deve PASSAR
RED:     toolRuntimeName_lanca_para_tool_mcp_foo_sem_namespace() — (EC-6) prova que a regra é do nome final, não do namespace
RED:     draft_intacto_quando_uma_tool_do_toolbox_e_invalida() — (EC-7) o construtor valida TODAS antes; nada é empurrado para o draft
RED:     agent_create_rejeita_o_que_nossa_validacao_rejeita() — para CADA nome inválido acima, Agent.create com esse nome REJEITA (prova de que espelhamos o SDK de verdade, não uma regra inventada)
GREEN:   implementar as guardas em toolRuntimeName
REFACTOR: None expected
VERIFY:  cd packages/agents && npx vitest run tests/integration/tool-name-sdk-contract.test.ts
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Os 3 códigos de erro do SDK têm caso negativo assertando **tipo e mensagem** (`rules/testing.md` § 4.1)
- [ ] O teste de espelho prova que o SDK real rejeita cada nome que rejeitamos: `npx vitest run tests/integration/tool-name-sdk-contract.test.ts` sai 0 com ≥ 9 casos verdes
- [ ] `new ToolboxCapability(x, { namespace: 'mcp' })` falha na autoria — o defeito vivo fecha
- [ ] Pass: lint — `npx eslint --max-warnings=0 $(git diff --name-only HEAD | grep '\.ts$')` sai 0
- [ ] Pass: size — `wc -l` de todo arquivo tocado ≤ 500: `wc -l $(git diff --name-only HEAD | grep '\.ts$') | awk '$1>500'` retorna vazio

#### DoD
- [ ] Suíte de `packages/agents` verde
- [ ] `npx tsc --noEmit` na raiz sem erro
- [ ] Commit atômico referenciando T1.1

### T1.2 — `ToolboxCapability` para de duplicar a validação

#### Objective
Deixar exatamente **um** lugar no código que conheça o formato do nome.

#### Why this step (action + reasoning — ReAct discipline)
Depois de T1.1 a validação no construtor da capability vira cópia da regra — e uma cópia que pode divergir é exatamente o achado (1)/(2) reencenado um nível abaixo. Manter a falha **na autoria** (mais cedo que o `apply`) continua valendo, então o construtor segue chamando `toolRuntimeName` por tool; o que sai é o `if (!SDK_TOOL_NAME.test(...))` e a mensagem duplicada.

#### Evidence
`packages/agents/src/capability/toolbox.ts:100-108` — laço que testa `SDK_TOOL_NAME` e monta a própria mensagem.

#### Files to edit
- `packages/agents/src/capability/toolbox.ts`

#### Tasks
1. Trocar o laço de validação por uma chamada a `toolRuntimeName` por declaração (o valor é descartado; a chamada é o que valida).
2. Remover o import de `SDK_TOOL_NAME` se ficar sem uso.

#### TDD
```
RED:     (os testes de autoria de T1.1 já cobrem — a prova aqui é que continuam verdes DEPOIS da remoção, mais o teste existente `a namespace that cannot produce a valid name fails at AUTHORING`)
GREEN:   substituir o laço pela chamada validadora
REFACTOR: remover import órfão de SDK_TOOL_NAME
VERIFY:  cd packages/agents && npx vitest run
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `grep -n "SDK_TOOL_NAME" packages/agents/src` retorna **apenas** `agent-compiler.ts` — nenhum outro módulo de produção conhece o formato
- [ ] A falha continua acontecendo na **construção** da capability, não no `apply` (teste existente verde)
- [ ] Pass: lint — `npx eslint --max-warnings=0 $(git diff --name-only HEAD | grep '\.ts$')` sai 0

#### DoD
- [ ] Suíte verde; `tsc --noEmit` limpo
- [ ] Commit atômico referenciando T1.2

---

## Phase T2 — Uma derivação, dois consumidores

### T2.1 — Derivar o walk uma vez e alimentar os dois compiladores

#### Objective
Tornar estrutural — não convencional — a propriedade "o gate HITL e a tool nunca discordam de nome".

#### Why this step (action + reasoning — ReAct discipline)
Hoje `compile()` monta um `walk` e `apply()` percorre `#declarations` de novo montando as chaves de gate por conta própria. São duas derivações da mesma identidade, e foi exatamente assim que elas divergiram no #145. O peer resolve o problema análogo operando sobre uma estrutura só, e declara isso no comentário. Derivar o walk uma vez e passar o **mesmo objeto** para `compileTools` e `compileHitlGates` copia essa propriedade, e de quebra ressuscita o símbolo órfão em vez de deletá-lo — reuso antes de reescrita (parcimônia rung 4).

#### Evidence
`packages/agents/src/capability/toolbox.ts:112-131` (monta o walk) vs `:142-146` (laço paralelo). `packages/agents/src/bridge/agent-compiler.ts:107-119` — `compileHitlGates` já faz exatamente esse laço, sobre a mesma estrutura, e tem 0 chamadores.

#### Files to edit
- `packages/agents/src/capability/toolbox.ts`

#### Deep file dependency analysis
`compileHitlGates` devolve `Map<string, HumanInTheLoopOptions>`; `apply` precisa **mesclar** no `draft.hitl` existente (outra toolbox pode já ter contribuído), então a fusão continua explícita — o que sai é a construção da chave, não a fusão.

#### Pseudo-code / Signatures
```ts
class ToolboxCapability {
  #walk(): ToolboxWalkResult { /* a derivação, uma vez */ }
  compile(): CompiledTool[] { return compileTools([this.#walk()], new Map([[token, this.#instance]])) }
  apply(draft) {
    const walk = this.#walk()
    draft.tools.push(...compileTools([walk], new Map([[walk.class, this.#instance]])))
    const gates = compileHitlGates([walk])          // <- mesmo walk, zero laço duplicado
    // EC-3 (CRÍTICO): o early-return vem ANTES do `??=`. Criar um Map vazio faria todo agente
    // sem HITL passar a ter `hitl` definido — `agent-compiler.ts:105` declara que map vazio
    // seleciona o caminho de stream non-HITL (M2, byte-unchanged). Regressão larga e silenciosa.
    if (gates.size === 0) return
    draft.hitl ??= new Map()
    for (const [k, v] of gates) draft.hitl.set(k, v)
  }
}
```

#### Tasks
1. Extrair a montagem do walk para o método privado `#walk()`.
2. `apply()` deriva o walk uma vez e usa `compileTools` + `compileHitlGates` sobre ele.
3. Remover o laço duplicado e o import de `toolRuntimeName` se ficar sem uso em `toolbox.ts`.

#### TDD
```
RED:     hitl_gate_key_igual_ao_nome_da_tool_com_namespace() — já existe; deve continuar verde (regressão do #145)
RED:     toolbox_com_tools_gated_e_nao_gated() — só as gated aparecem em compiled.hitl, e cada chave existe em compiled.tools (assert de inclusão, não só de igualdade)
RED:     duas_toolboxes_com_namespaces_distintos_mesclam_gates_sem_sobrescrever() — a fusão continua correta após a troca
RED:     toolbox_sem_tools_gated_deixa_draft_hitl_UNDEFINED() — (EC-3) prova que o Map vazio não passa a ser criado; guarda o caminho de stream non-HITL
GREEN:   #walk() + compileHitlGates
REFACTOR: remover import órfão
VERIFY:  cd packages/agents && npx vitest run
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `grep -c "toolRuntimeName" packages/agents/src/capability/toolbox.ts` — zero chamadas de construção de nome fora do construtor validador
- [ ] `compileHitlGates` tem ≥ 1 chamador de produção
- [ ] Toda chave de `compiled.hitl` existe em `compiled.tools[].name` para toolboxes mistas e múltiplas
- [ ] Pass: lint — `npx eslint --max-warnings=0 $(git diff --name-only HEAD | grep '\.ts$')` sai 0

#### DoD
- [ ] Suíte verde; `tsc --noEmit` limpo
- [ ] Commit atômico referenciando T2.1

---

## Phase T3 — Verdade documental e prova que pode falhar

### T3.1 — Corrigir os comentários que descrevem o separador errado

#### Objective
Eliminar documentação que descreve o comportamento removido pelo #145.

#### Why this step (action + reasoning — ReAct discipline)
Um comentário errado é pior que nenhum: ele foi escrito para ser confiado. Os dois pontos dizem que a chave é `"<toolbox>.<tool>"` — com ponto — que é exatamente o formato que o SDK rejeita. Quem ler para escrever uma allow-list vai reproduzir o bug.

#### Evidence
`packages/agents/src/capability/agent-capabilities.ts:75` e `packages/agents/src/capability/toolbox.ts:59`.

#### Files to edit
- `packages/agents/src/capability/agent-capabilities.ts`
- `packages/agents/src/capability/toolbox.ts`

#### Tasks
1. Corrigir os dois comentários para `"<namespace>_<tool>"`.
2. Varrer o pacote por outras ocorrências do formato antigo.

#### TDD
```
RED:     (documentação — sem teste; a asserção é o grep abaixo, executado como critério)
GREEN:   corrigir os dois comentários
REFACTOR: None expected
VERIFY:  grep -rn '"<toolbox>\.<tool>"\|"<namespace>\.<tool>"' packages/*/src  → deve retornar vazio
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] O grep acima retorna vazio em `packages/*/src`
- [ ] Nenhum comentário de produção descreve o separador como `.`

#### DoD
- [ ] Commit atômico referenciando T3.1

### T3.2 — Gate de exports órfãos que pode falhar, e limpeza do que ele acusa

#### Objective
Substituir a prova vazia ("knip limpo") por um detector que **falha hoje** e passa depois.

#### Why this step (action + reasoning — ReAct discipline)
Medido: com a política do repo, o knip não olha exports — então o critério do DoD passaria mesmo com o órfão presente. Um gate que não pode falhar é pior que nenhum gate, porque produz confiança falsa; é a mesma patologia do comentário errado de T3.1, no plano das ferramentas. O override de config liga o detector certo, no escopo certo, sem mudar a política de 6 workspaces.

#### Evidence
`knip.json` › `rules.exports: "off"`. Execução com override `exports:"error"` em `packages/agents`: 2 achados — `agent-compiler.ts:107 compileHitlGates`, `run-reflective-loop.ts:450 ceilingRoundFactory`. Execução com a política do repo: `Unused files (2)` — `src/metadata/index.ts`, `src/metadata/keys.ts`.

#### Files to edit
- `knip-exports.json` (novo, raiz) — override com `exports:"error"`
- `package.json` — script `knip:exports`
- `packages/agents/src/metadata/` — remover se confirmado morto
- `packages/agents/src/loop/run-reflective-loop.ts` — remover `ceilingRoundFactory` OU allowlistar com sunset citando M54

#### Deep file dependency analysis
`compileHitlGates` deixa de ser órfão por T2.1 (reconexão). Os outros três achados são **remoções**: o risco é remover algo usado por um teste. **EC-8:** o `knip.json` tem `**/tests/**` no `ignore`, então o knip **não enxerga** consumidor de teste — o `grep` em `tests/` não é redundância, é o complemento obrigatório antes de cada remoção. Se um teste for o único consumidor, o símbolo é órfão de produção e o teste vai junto (teste de símbolo morto é dívida, não cobertura).

#### Tasks
1. Criar `knip-exports.json` (herda `knip.json`, liga `exports`) e o script `knip:exports`.
2. Rodar; confirmar que acusa os achados do baseline.
3. Verificar consumidor de `ceilingRoundFactory` e de `src/metadata/*`; remover o que for morto, allowlistar com sunset o que for seam declarado do M54.
4. Re-rodar até zero achados em `packages/agents`.

#### TDD
```
RED:     pnpm knip:exports → FALHA hoje (2 exports órfãos) — é a prova de que o gate pode falhar
GREEN:   T2.1 fecha compileHitlGates; remover/allowlistar o restante
REFACTOR: None expected
VERIFY:  pnpm knip:exports  (zero achados em packages/agents) E npx knip (zero Unused files)
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `pnpm knip:exports` falha no baseline `271124d5` e passa no HEAD final — evidência das duas execuções registrada
- [ ] `npx knip` não reporta `Unused files` em `packages/agents`
- [ ] Cada símbolo removido teve consumidor verificado: `grep -rn '<símbolo>' packages --include='*.ts'` retorna vazio (registrado no log de implementação, um grep por remoção)
- [ ] Qualquer allowlist carrega sunset e milestone: `grep -c 'sunset' <arquivo-de-allowlist>` ≥ 1 por entrada adicionada (zero entradas também satisfaz)

#### DoD
- [ ] Suíte verde após as remoções; `tsc --noEmit` limpo
- [ ] Commit atômico referenciando T3.2

### T3.3 — ADR + CHANGELOG

#### Objective
Registrar as decisões conscientes para que a próxima pessoa não as re-litigue nem as desfaça sem saber.

#### Why this step (action + reasoning — ReAct discipline)
Três das decisões deste plano são **dívidas ou recusas deliberadas** (copiar a regra do SDK; não implementar parse reverso; recusar o VO). Sem registro, cada uma vira ou um bug futuro ("por que copiaram isso?") ou um refactor desnecessário ("vou criar o VO"). O ADR é o que transforma decisão em contrato.

#### Evidence
`knowledge-base/adrs/0001-capability-patterns-budget.md` — o precedente de formato (13 adotados / 8 recusados, cada um justificado).

#### Files to edit
- `knowledge-base/adrs/0002-tool-name-single-source.md` (novo)
- `CHANGELOG.md`

#### Tasks
1. Escrever o ADR com D1..D5 deste plano, incluindo os gatilhos de revisão.
2. Entrada no CHANGELOG sob `[Unreleased]` declarando o breaking de comportamento em `compileTools` e o defeito reservado corrigido.

#### TDD
```
RED:     (documentação — sem teste)
GREEN:   escrever ADR + CHANGELOG
REFACTOR: None expected
VERIFY:  o ADR cita D1..D5 com alternativas consideradas em cada um
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] ADR contém as 5 decisões: `grep -c '^### D' knowledge-base/adrs/0002-tool-name-single-source.md` retorna 5, e `grep -c 'Alternativas consideradas' ...` retorna 5
- [ ] Gatilhos de revisão explícitos (SDK exportar a regra; segundo minter aparecer; ligar `exports` no monorepo)
- [ ] CHANGELOG declara o breaking de comportamento de `compileTools`

#### DoD
- [ ] Commit atômico referenciando T3.3

---

## Coverage Matrix

| # | Gap / Requirement | Origem | Task(s) | Resolução |
|---|---|---|---|---|
| 1 | `SDK_TOOL_NAME` é cópia de contrato não exportado | revisão, achado 1 | T1.1, T3.3 | Espelho declarado com versão + gatilho em ADR; teste de contrato é o alarme de drift |
| 2 | Validação longe do ponto de mintagem; `compileTools` público escapa | revisão, achado 2 | T1.1, T1.2 | Validação move para dentro de `toolRuntimeName`; capability para de duplicar |
| 3 | `compileHitlGates` órfão + lógica duplicada na capability | revisão, achado 3 | T2.1 | Uma derivação (`#walk()`) alimenta os dois compiladores |
| 4 | Dois comentários documentam o separador como `.` | revisão, achado 4 | T3.1 | Corrigidos + grep de verificação |
| 5 | Reversibilidade perdida sem registro | revisão, achado 5 | T3.3 (ADR D3) | Documentada como condicional ao registro de namespaces; técnica citada |
| 6 | Gate de código morto cego para o pacote | revisão, achado 6 | T3.2 | Override do knip que **falha** no baseline |
| 7 | **Defeito vivo:** regra reservada (`mcp_`, `shell`, …) ausente | discovery, Q4 | T1.1 | 3 regras espelhadas; caso negativo por código de erro |
| 8 | "knip limpo" é prova vazia (`exports:"off"`) | discovery, Q7 | T3.2 (ADR D4) | Critério substituído por detector que pode falhar |
| 9 | VO `ToolName` — decidir em vez de silenciar | revisão, recomendação 5 | T3.3 (ADR D5) | Recusado com justificativa e gatilho de reabertura |
| 10 | Casos negativos assertam só o tipo, não a mensagem | discovery, Q5 | T1.1 | Um caso por código do SDK, assertando tipo **e** mensagem |

**Coverage: 10/10 gaps covered (100%)**

## Dependencies

### Existing
| Dependência | Versão | Uso neste plano | Rule 9 |
|---|---|---|---|
| `knip` | `^5.88.1` (devDep raiz) | detector de export órfão (T3.2), via override de config | reutiliza o que já está instalado — parcimônia rung 4 |
| `vitest` | já instalado | RED/GREEN de todas as fases | idem |
| `@theokit/sdk` | `4.1.0` | o contrato espelhado; o validador real exercitado pelo teste de contrato | idem |

### New
Nenhuma. O plano não adiciona dependência — a única ferramenta nova (`knip-exports.json`) é um arquivo de config para um pacote já instalado.

### Removed
Nenhuma dependência removida. Símbolos/arquivos removidos estão em T3.2 e são código morto interno, não dependências.

## Failure scenarios (when I/O external)

```
(none — no external I/O touched)
```

O único ponto que parece I/O é `Agent.create` no teste de contrato, mas a validação de opções roda **antes** de qualquer conexão (é exatamente por isso que o teste usa chave falsa e não faz rede). Nenhuma tarefa deste plano toca HTTP client, driver de banco, fila, RPC ou object store.

## Global Definition of Done

- [ ] Todas as fases (T0..T3) completas
- [ ] `cd packages/agents && npx vitest run` verde, **sem nenhuma expectativa existente editada**
- [ ] `npx tsc --noEmit` na raiz sem erro
- [ ] `npx eslint --max-warnings=0` nos arquivos tocados
- [ ] `pnpm check:direction` verde (prova de que T0.1 evitou o ciclo)
- [ ] `pnpm knip:exports` sem achado em `packages/agents`; `npx knip` sem `Unused files` em `packages/agents` (as 8 devDeps não usadas em outros pacotes são pré-existentes e ficam no followup 1b — reportadas, nunca mascaradas)
- [ ] `npm run validate:publint` verde
- [ ] Teste live no tmux `agentbuilder` contra provider real: agente com toolbox namespaceada responde e a tool é chamada pelo nome `ns_tool`
- [ ] `/code-quality` com verdict ∈ {PASS, PASS_WITH_CAVEATS}
- [ ] `/review` com verdict READY_TO_MERGE
- [ ] CHANGELOG `[Unreleased]` atualizado (Regra Inquebrável 6)
- [ ] ADR `0002-tool-name-single-source.md` escrito

## Followups

1. **Ligar `exports: "error"` no `knip.json` do monorepo** — hoje o número de órfãos fora de `packages/agents` é desconhecido. Milestone próprio, com allowlist + sunset para o que aparecer.
1b. **Zerar as 8 devDependencies não usadas** (`@types/pg`, `autocannon`, `pg`, `unplugin-swc`, `wrangler` na raiz; `@types/pg`, `pg`, `pg-mem` em `packages/theo`) — medidas no baseline `271124d5`, fazem `npx knip` sair 1 no repo inteiro. Fora do escopo do M55 (outros pacotes, sem relação com nome de tool), mas é dívida real e o gate do repo fica vermelho até alguém pegá-la.
2. **Pedir ao `@theokit/sdk` o export de `TOOL_NAME_PATTERN`/`validateToolName`** — resolveria a duplicação de D1 na raiz, permitindo apagar a cópia.
3. **Considerar mover o gate HITL para dentro de `CompiledTool`** (a forma do opencode) — elimina o segundo mapa de vez, mas muda o waist e o contrato do plugin HITL.

## Related

- Milestone: `ROADMAP.md` § `### M55`
- Blueprint: `knowledge-base/discoveries/blueprints/tool-name-single-source-blueprint.md`
- Discovery plan: `knowledge-base/discoveries/plans/tool-name-single-source-plan.md` (v1.1)
- Grill: `knowledge-base/grills/tool-name-single-source-feature-grill.md`
- Regras consumidas: `.claude/rules/error-handling.md`, `.claude/rules/testing.md`, `.claude/rules/parsimony-ladder.md`, `.claude/rules/architecture.md`

## Desvios do DoD do M55 (registrados, não editados no ROADMAP)

`cycle-roadmap` proíbe editar milestone em voo, então os três desvios ficam aqui e no ADR:

1. **"`pnpm knip` limpo" foi substituído** por `pnpm knip:exports` sem achado. Motivo medido: com `rules.exports:"off"`, "knip limpo" passa com o órfão presente — é prova vazia (ADR D4). O critério novo é mais forte, não mais fraco: falha no baseline.
2. **Escopo ampliado pela discovery:** o DoD original falava em validar "o nome"; a validação passa a cobrir as **três** regras do SDK, porque a cópia parcial é um defeito vivo (gap 7). Ampliação de escopo dentro do mesmo objetivo, sem tarefa nova de produto.
3. **UMA expectativa pré-existente FOI editada** — contrariando a redação literal do Global DoD ("sem nenhuma expectativa existente editada"). Achado pelo **agente de cross-validation do `/review`**, não declarado por mim na hora. O teste era `'the generated name matches the SDK charset'` em `tool-name-sdk-contract.test.ts`, que **re-declarava o regex do charset** — a terceira cópia da regra que este milestone existe para eliminar. Virou asserção de comportamento (`toBe('ops_deploy')`), mais forte que o `toMatch` anterior, sem mascarar regressão. A promessa "zero expectativa editada" é o oráculo de **T0.1** (refactor estrutural puro) e foi restatada sem qualificador no nível global — erro de redação meu. Registrado em vez de silenciado: desvio não declarado é exatamente o que o gate de review existe para pegar.
