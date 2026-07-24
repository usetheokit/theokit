# Discovery Plan: contrato de nome de tool na fronteira `@theokit/agents` ↔ `@theokit/sdk`

> **Version 1.1** (2026-07-24 — absorve os 3 MUST FIX de `knowledge-base/reviews/tool-name-single-source-edge-cases-2026-07-24.md`: EC-1 hipótese H1 explícita na Q3/Q4, EC-2 citação por símbolo+versão, EC-3 coluna de fontes independentes) — investiga como projetos de referência resolvem **onde vive a regra de nome de tool**, **onde ela é aplicada**, e **como o drift contra o provider é impedido**, para decidir com evidência (e não por gosto) o desenho do M55: validar no ponto de mintagem, matar o código morto do gate HITL, e decidir se um Value Object `ToolName` se paga. Referências em escopo: `opencode` (clonado), `@theokit/sdk` (o próprio contrato, em `node_modules`) e `ai` (Vercel AI SDK, em `node_modules`) como contraponto de desenho. O blueprint deve produzir uma decisão por questão, com citação linha-exata.

**Slug:** `tool-name-single-source`
**Owner:** paulohenriquevn
**Created:** 2026-07-24
**Time budget:** 3h (quebra por projeto em ADR D1)

## Context

O issue usetheodev/theokit#145 mostrou que um toolbox com `namespace` mintava `ns.tool` — fora do charset que o `@theokit/sdk` aceita — e portanto um caminho **documentado** nunca funcionou contra um provider real. O fix (publicado em `@theokit/agents@1.0.1`) trocou o separador para `_` e adicionou validação na autoria. A revisão de System Design + Design Pattern desse fix (2026-07-24) achou **6 defeitos residuais**, dois deles introduzidos pela própria correção, registrados em `knowledge-base/grills/tool-name-single-source-feature-grill.md` § Q1 e no bloco `### M55` do `ROADMAP.md`.

O gatilho desta discovery é uma **sonda de pré-validação** que já contradiz a premissa da correção. `node_modules/@theokit/sdk/dist/index.js:6559-6577` mostra que `validateToolName` impõe **três** regras — não-vazio (`tool_missing_name`), charset (`tool_invalid_name`) e **nome reservado** (`tool_reserved_name`, para `{shell, memory_search, memory_get}` **ou** qualquer nome começando com `mcp_`) — enquanto a nossa cópia (`packages/agents/src/bridge/agent-compiler.ts:86`) replica **apenas o charset**. Um toolbox com `namespace: 'mcp'` minta `mcp_deploy`, passa na nossa validação de autoria e é **rejeitado pelo `Agent.create`** — a mesma classe de defeito do #145, ainda viva. Isso é evidência de que o problema não é "o separador estava errado", e sim **"a regra do SDK foi copiada por amostragem"** — exatamente o que esta discovery precisa resolver com prior art antes de o M55 escrever qualquer código.

Regras de projeto consumidas: `.claude/rules/error-handling.md` § 2 (validar na fronteira, falhar tipado), `.claude/rules/parsimony-ladder.md` (rungs 1 e 5 — o VO `ToolName` precisa se pagar), `.claude/rules/testing.md` § 4.1 (caso negativo asserta erro tipado + mensagem), `.claude/rules/architecture.md` § 2 (direção de dependência: `bridge/` não pode importar `capability/`).

## Objective

O blueprint deve permitir decidir, com evidência de código de terceiros: **onde a regra de nome de tool deve viver, onde deve ser aplicada, se deve coagir ou lançar, e qual mecanismo impede o drift contra o provider** — para que o M55 seja implementado sem re-trabalho.

- [ ] Todas as questões respondidas com citação a `knowledge-base/references/` ou a um caminho real em `node_modules/`
- [ ] Tabela comparativa preenchida para cada projeto em escopo
- [ ] Ao menos uma proposta de decisão concreta por questão
- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `knowledge-base/references/opencode/` | `packages/opencode/src/mcp/`, `packages/opencode/src/tool/` | Harness de terminal real em TS que namespaceia tools de MCP e de plugin — o análogo mais próximo do nosso problema, e o único peer clonado |
| `node_modules/@theokit/sdk/dist/` | `index.js` (`validate-agent-options`), `run-*.d.ts` | É **o contrato** que estamos duplicando; a fonte da verdade sobre o que o `Agent.create` aceita |
| `node_modules/ai/dist/` | `index.d.ts` | Contraponto de desenho: nome de tool como **chave de tipo** (`keyof TOOLS & string`) em vez de string validada em runtime |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| Peers listados na tabela do `ROADMAP.md` mas **não clonados** (`ai-sdk`, `mastra`, `openai-agents-js`, `assistant-ui`, `copilotkit`, `cloudflare-agents-starter`, `trpc`) | Não existem em `knowledge-base/references/` — citá-los seria citação fabricada (hard cap). O pacote `ai` em `node_modules` cobre o ângulo do Vercel AI SDK sem clonar |
| `knowledge-base/references/opencode/` fora de `src/mcp/` e `src/tool/` | TUI, sessão, provider — não tocam nomeação de tool |
| `node_modules/@theokit/sdk/dist/**/*.map`, `*.cjs` | Artefatos de build duplicados do `.js`/`.d.ts` já em escopo |
| Qualquer decisão de **implementação** do M55 | Discovery pergunta; quem responde com código é `/implement` |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** `opencode`: 1.5h · `@theokit/sdk`: 1h · `ai`: 0.5h.

**Rationale:** o `opencode` é o único peer que resolve o problema **inteiro** (namespaceia, minta, e faz parse reverso) — merece a fatia maior. O `@theokit/sdk` é curto porque é uma função só (`validateToolName`), mas é o de maior consequência: é o contrato que erramos. O `ai` recebe a menor fatia porque entra como **contraponto**, não como modelo a copiar (ele não valida nome em runtime; o nome é chave de tipo).

**Alternatives considered:** (a) fatia igual entre os três — rejeitada, trataria o contraponto com o mesmo peso do análogo direto; (b) mergulho só no `@theokit/sdk` — rejeitada, responderia "qual é a regra" mas não "como se evita o drift", que é a pergunta cara; (c) sem budget — rejeitada, `cycle-discover` exige stop condition por questão.

**Stop condition — per question (mandatory):** quando a Fase A de uma questão retornar vazio após 3 variantes de query, marcar a questão BLOCKED com motivo "Fase A exhausted" e seguir. NUNCA preencher com hotspot de outra questão.

**Stop condition — per project (mandatory):** com o budget do projeto esgotado e questões pendentes, marcar as restantes daquele projeto BLOCKED com motivo "budget exhausted" e avançar. Se todo projeto restante estiver nesse estado, emitir `<promise>BLUEPRINT_BLOCKED</promise>` — nunca `BLUEPRINT_COMPLETE` com questão bloqueada.

**Anti-pattern:** NUNCA fabricar resposta de Fase B para fechar questão cuja Fase A esgotou (Regra Inquebrável 3).

**Consequences:** o blueprint pode sair com questões BLOCKED explícitas; elas viram semente da próxima discovery em vez de buraco silencioso.

### D2 — Investigation depth

**Decision:** `Grep`/`ast-grep` para mapear hotspot, depois **Read do arquivo inteiro** nos módulos de nomeação (`mcp/catalog.ts`, `tool/code-mode.ts`, o bloco `validate-agent-options` do `index.js`). Para o `ai`, só `Grep` + Read de trecho — é contraponto.

**Rationale:** a pergunta desta discovery é sobre **intenção de desenho** (por que coagir em vez de lançar? por que esse separador?), e intenção mora em comentário e vizinhança, não em assinatura. Ler só o match reproduziria o erro que causou o #145 — validar por amostragem. Alternativa considerada: só `Grep` em todos, rejeitada por esse motivo; alternativa de ler tudo em todos, rejeitada por custo sem retorno no contraponto.

**Consequences:** o custo por questão sobe nos dois primeiros projetos; em troca, cada decisão do blueprint pode citar a razão declarada pelo autor original, não a nossa inferência.

### D3 — `node_modules/` como fonte legítima de discovery

**Decision:** tratar `node_modules/@theokit/sdk/` e `node_modules/ai/` como fontes citáveis de primeira classe, ao lado de `knowledge-base/references/`.

**Rationale:** o hard cap de citação fabricada existe para impedir que se afirme comportamento de um projeto sem ler o fonte dele. Um pacote instalado é o fonte **realmente em execução** — mais autoritativo que um clone raso, que pode estar em outra versão que a instalada. Clonar `@theokit/sdk` para `references/` só para satisfazer o formato do caminho seria cerimônia que **piora** a fidelidade (Rule 10, KISS). Alternativa considerada: clonar os peers faltantes (`ai-sdk`, `mastra`) — rejeitada por YAGNI: `ai` já está instalado e responde o ângulo de contraponto; clonar 6 peers para 3h de discovery é custo sem retorno.

**Consequences:** as citações a `node_modules/` são verificáveis em disco mas **não** por `check_reference_citations.py`, que só varre `knowledge-base/references/`. Cada citação a `node_modules/` no blueprint carrega arquivo + linha exatos para que um revisor humano confira em um comando.

### D4 — Riscos de snapshot conscientemente aceitos (absorve EC-6 e EC-7)

**Decision:** aceitar sem mitigação adicional (a) que a versão instalada de `ai` pode não ser a que o theokit alveja, e (b) que o clone do `opencode` é `--depth 1` de data desconhecida.

**Rationale:** as duas fontes entram por **intenção de desenho**, não por superfície de API versionada — o `ai` como contraponto ("nome é chave de tipo, não string validada", estável há várias majors) e o `opencode` por decisões de convenção (separador, coerção vs exceção, parse reverso por prefixo mais longo). Um delta de versão não move nenhuma dessas conclusões. Alternativas consideradas: fixar versões e re-clonar em pin — rejeitada por custo sem retorno (Rule 11, YAGNI), já que a citação linha-exata torna qualquer divergência futura detectável em um `git log` do peer.

**Consequences:** conclusões desta discovery são sobre **padrão**, não sobre contrato de API de terceiro; qualquer uso futuro que dependa da API exata do `ai` ou do `opencode` precisa re-verificar na versão-alvo.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad) | Fase B (deep — Read) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | Qual convenção de **mintagem** de nome namespaceado o opencode usa — separador, sanitização, e o nome é mintado num ponto só? | techniques | `knowledge-base/references/opencode/` | `Grep -rn "toolName\|sanitize" packages/opencode/src/mcp/ packages/opencode/src/tool/` | Read integral de `packages/opencode/src/mcp/catalog.ts` + `packages/opencode/src/tool/registry.ts` | Função de mintagem citada com linha, separador declarado, e se há 1 ou N pontos de mintagem |
| Q2 | O nome namespaceado é **reversível**? Se sim, por qual técnica a ambiguidade de separador é resolvida? | techniques | `knowledge-base/references/opencode/` | `Grep -rn "groupByServer\|startsWith\|slice" packages/opencode/src/tool/code-mode.ts` | Read integral de `packages/opencode/src/tool/code-mode.ts` § agrupamento | Técnica nomeada + citação; e se a reversibilidade é propriedade exigida ou acidental |
| Q3 | Diante de um nome inválido, o peer **coage** (sanitiza) ou **lança**? Qual critério decide? | techniques | `knowledge-base/references/opencode/`, `node_modules/@theokit/sdk/` | `Grep -rn "replace(/\[^\|throw new ConfigurationError" nos dois` | Read de `catalog.ts:117-119` e do bloco `validateToolName` (símbolo, não linha — EC-2) | Tabela coerção-vs-exceção com o critério (fronteira confiável vs não-confiável) e o que isso implica para nós |
| Q4 | Quais regras **exatas** o `@theokit/sdk` aplica a um nome de tool, e quais delas a nossa cópia replica? **H1 (hipótese a confirmar OU refutar, EC-1):** são 3 regras — não-vazio, charset, e reservado (`{shell, memory_search, memory_get}` ∪ prefixo `mcp_`) — e a nossa cópia replica só a 2ª. | deps | `node_modules/@theokit/sdk/` | `grep -n "TOOL_NAME_PATTERN\|RESERVED_TOOL_NAMES\|validateToolName" dist/index.js dist/*.d.ts` | Read do bloco `validateToolName` **de ponta a ponta** (não só do match) + verificação de export em `dist/*.d.ts` e `package.json`. A resposta NÃO pode citar a seção `## Context` deste plano como evidência — tem de re-derivar do arquivo. | Lista das regras com código de erro tipado + veredito explícito `H1: CONFIRMADA \| REFUTADA \| PARCIAL`; delta contra `SDK_TOOL_NAME` em `packages/agents/src/bridge/agent-compiler.ts:86` |
| Q5 | Como se testa o contrato de nome **sem mockar** o validador — e o que o peer/nosso teste cobre hoje? | tests | `node_modules/@theokit/sdk/`, repo local | `Grep -rn "tool_invalid_name\|tool_reserved_name" packages/agents/tests/` | Read de `packages/agents/tests/integration/tool-name-sdk-contract.test.ts` inteiro | Lista dos códigos de erro do SDK vs os cobertos pelo nosso teste — o gap é a lista de testes que o M55 precisa |
| Q6 | O acoplamento **nome da tool ↔ chave do gate HITL** existe nos peers? Como eles impedem os dois de divergirem? | tests | `knowledge-base/references/opencode/`, repo local | `Grep -rn "permission\|approval\|ask(" packages/opencode/src/tool/` | Read dos pontos onde a permissão é resolvida por nome | Mecanismo citado (chave derivada da mesma função? ou lookup por objeto?) + o que isso diz sobre `compileHitlGates` |
| Q7 | Qual gate **mecanizado** teria pego um símbolo exportado órfão como `compileHitlGates`, e ele está ligado neste repo? | tools | repo local, `knowledge-base/references/opencode/` | `Grep -rn "knip" package.json packages/agents/package.json knip.json* 2>/dev/null` | Read da config do knip + de `.claude/rules/code-quality-golden-rule.md` § 2 | Nome do gate, se está habilitado para `packages/agents`, e por que não pegou |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q5, Q6 | Covered |
| Dependencies | Q4 | Covered |
| Tools | Q7 | Covered |
| Techniques | Q1, Q2, Q3 | Covered |

**Coverage: 4/4 corners covered (100%)**

Total de questões: **7** (budget 5-10 ✓, máx 3 por corner ✓, mín 1 por corner ✓).

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Antes de responder Qx | O caminho declarado na Fase A existe em disco | Marcar Qx BLOCKED "path not found", seguir |
| Budget de Fase A por questão | Fase A retornou ≥ 1 hotspot OU 3 variantes tentadas | Após 3 variantes vazias, BLOCKED "Fase A exhausted" |
| Depois de responder Qx | A seção de Qx tem ≥ 1 citação com arquivo:linha | Re-iterar Qx (1 retry) |
| Sanidade de citação (EC-2) | Toda citação a `node_modules/` carrega **símbolo + versão instalada** além de arquivo:linha; a versão é registrada uma vez no header do blueprint | Adicionar símbolo/versão; citação só com linha de bundle não conta |
| Fontes por questão (EC-3) | Cada questão declara suas `Fontes independentes`; questão apoiada em uma só é rotulada `SINGLE-SOURCE` | Rotular explicitamente — nunca deixar implícito |
| Antes de responder Q6 (EC-4) | Confirmado se `Permission.evaluate`/`Permission.visibleTools` (`opencode .../tool/registry.ts:263,283`) recebem a chave plana namespeada ou um par estruturado | Se estruturado, reformular a resposta da Q6 para "evitam o acoplamento não tendo chave" |
| Antes de responder Q7 (EC-5) | `knip.json` lido: `packages/agents` está no escopo? qual o comportamento de export de entrypoint (`includeEntryExports`)? `bridge/index.ts` reexporta `compileHitlGates`? | Sem isso, a conclusão "o gate é cego" é infundada — pode ser configuração, não falha |
| Budget por projeto | Budget do projeto não esgotado | Ao esgotar, BLOCKED "budget exhausted" nas restantes; avançar |
| Antes de prometer completo | Os 4 corners têm seção populada | Recusar a promessa, continuar |

## Acceptance Criteria

- [ ] Todas as 7 questões respondidas OU marcadas BLOCKED com motivo
- [ ] Os 4 corners com seção populada no blueprint
- [ ] Toda citação a `knowledge-base/references/` resolve em disco; toda citação a `node_modules/` carrega arquivo:linha
- [ ] Ao menos uma seção de ADR no blueprint sintetizando as decisões (incluindo a de aceitar ou recusar o VO `ToolName`)
- [ ] Budget de 3h respeitado
- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint em `knowledge-base/discoveries/blueprints/tool-name-single-source-blueprint.md`

## Global Definition of Done

- [ ] Todas as fases completas (plan → edge-cases → plan-confidence → execute → confidence)
- [ ] Verdict final registrado no header do blueprint
- [ ] Zero citação fabricada
- [ ] Coverage Matrix 100%
- [ ] Os ADRs referenciam ao menos uma regra de projeto — aqui: `.claude/rules/parsimony-ladder.md` (o VO precisa se pagar), `.claude/rules/error-handling.md` § 2 (validar na fronteira, falhar tipado) e `.claude/rules/testing.md` § 4.1 (caso negativo asserta tipo + mensagem)
