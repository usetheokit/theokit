---
slug: tool-name-single-source
date: 2026-07-24
generated_by: roadmap-feature
questions_answered: 4
unresolved_dims: []
status: completed
---

# Roadmap-feature grill: tool-name-single-source

> **Origem das respostas (honestidade):** o owner pediu uma revisão de **System Design + Design
> Pattern** da correção do issue theokit#145 (o separador de namespace `ns.tool` → `ns_tool`,
> publicado em `@theokit/agents@1.0.1`). A revisão achou **6 defeitos** — incluindo dois na minha
> própria correção — e o owner respondeu *"Para corrigir TODOS os pontos encontrados"*. As quatro
> dimensões abaixo derivam desse achado, e **cada uma cita a evidência de código medida**, não
> suposição. Nenhuma dimensão ficou aberta.

### Q0 (cross-check obrigatório): algum item de `### Explicitly out of scope` é violado?

**Não — zero overlap.** A lista travada cobre: virar SDK, reimplementar o loop / orquestração
multi-agente, dispatch engine de background, framework de signals + pub/sub, sandbox embutido do
Code-Mode, AI SDK RSC, abstração própria de provider, e quebrar o path de decorators do
`@theokit/http`. Este milestone toca **nomeação de tool + validação na fronteira agents↔SDK**
(`packages/agents/src/bridge/agent-compiler.ts` + `capability/toolbox.ts`). Nenhum keyword
significativo cruza. O item mais próximo — *"breaking the `@theokit/http` decorator path"* — é
**preservado**: nada aqui toca `@theokit/http`.

### Q1/4: o que é esta feature e por que AGORA (o que mudou)?

**O que é:** consolidar em **fonte única** o contrato de nome de tool na fronteira `@theokit/agents`
↔ `@theokit/sdk`, fechando os 6 achados da revisão de arquitetura do fix #145.

**O que mudou:** o fix #145 corrigiu o **sintoma** (o nome agora é aceito pelo `Agent.create`, provado
end-to-end por `tests/integration/tool-name-sdk-contract.test.ts`, que NÃO mocka o SDK) mas deixou o
**desenho** com a mesma classe de defeito que causou o bug — conhecimento duplicado, validado num
lugar e assumido nos outros. Evidência medida (2026-07-24, `develop` pós-`@theokit/agents@1.0.1`):

| # | Achado | Evidência |
|---|---|---|
| 1 | `SDK_TOOL_NAME` é **cópia** do contrato do SDK | `agent-compiler.ts:86`; `grep TOOL_NAME\|toolNamePattern\|validateToolName node_modules/@theokit/sdk/dist/*.d.ts` → **vazio** (o SDK não exporta a regra). Drift seria silencioso. |
| 2 | Validação **longe do ponto de mintagem** | o nome é mintado em `toolRuntimeName` (`agent-compiler.ts:98`) mas validado em `ToolboxCapability` (`toolbox.ts:100-108`); `compileTools` é **público** (`bridge/index.ts:9`) e esse caminho escapa da validação inteiramente. |
| 3 | `compileHitlGates` é **código morto** e sua lógica está **duplicada** | definido em `agent-compiler.ts:107`; `grep -rn compileHitlGates packages --include=*.ts` → só comentários + `dist/`. **Zero chamadores de produção.** `ToolboxCapability.apply` (`toolbox.ts:142-146`) reimplementa o loop. Meu fix de DRY removeu a string duplicada mas **deixou a lógica duplicada** — corrigiu o sintoma da duplicação, não a duplicação. |
| 4 | Comentários **mentindo** sobre o formato | `agent-capabilities.ts:75` (`keyed "<toolbox>.<tool>"`) e `toolbox.ts:59` (`Prefix for every tool name ("<namespace>.<tool>")`) — ambos ainda com **ponto**, descrevendo o comportamento que o #145 removeu. |
| 5 | Propriedade perdida sem registro | `ns_tool` não é reversível (ns ou tool com `_` tornam o parse ambíguo); `.` era menos ambíguo. Hoje **inócuo** (`grep "split('.')\|split('_')"` → vazio: ninguém faz parse reverso), mas foi troca de propriedade sem ADR. |
| 6 | Gate de código morto **cego** para este pacote | o achado 3 é exatamente `dead_code_unallowlisted_typescript` (FAIL_HARD em `code-quality-golden-rule.md` § 2) e passou. |

**Por que AGORA:** os achados 2 e 3 são **regressões latentes da mesma classe do #145** — um caminho
público sem validação e uma lógica duplicada que já divergiu uma vez (a tool virou `ns_tool` e o gate
HITL ficou `ns.tool`, desgatilhando silenciosamente o HITL). Deixar assentar é esperar o segundo
incidente com a causa-raiz já documentada.

### Q2/4: quais milestones precisam estar `[x]` antes desta feature começar?

**M53** (`[x]` — `@theokit/agents@1.0.0`, decorators removidos). Todo o código tocado
(`agent-compiler.ts`, `capability/toolbox.ts`, `capability/capabilities.ts`) foi reescrito ou movido
no M53; o fix #145 (`1.0.1`) já está em cima dele.

**M54 NÃO é dependência** — toca `AgentRunnerBuilder`/`AgentRunnerSpec` (`loop/agent-runner.ts`),
arquivos disjuntos destes. Os dois podem correr em qualquer ordem sem conflito.

### Q3/4: qual é a Definition of Done verificável?

Ver o bloco `### M55` no `ROADMAP.md` — seis critérios, dos quais dois são gates duros: a prova de
zero-behavior (a suíte atual passa **sem editar expectativa**) e a **eliminação do código morto**
(`compileHitlGates` com chamador de produção real **ou** deletado — orfandade + duplicação é o
achado 3 e não pode sobreviver ao milestone).

### Q4/4: quais são os 2 riscos NOVOS que esta feature introduz?

1. **Ciclo de import `bridge ↔ capability`.** Mover a validação para dentro de `toolRuntimeName`
   (`bridge/`) exige lançar `ConfigurationError`, que hoje vive em `capability/capabilities.ts:15` —
   `bridge/` importando `capability/` fecha um ciclo. Mitigação: extrair o erro para um módulo
   neutro (`src/errors.ts`) **antes** de mover a validação; `pnpm check:direction`
   (`scripts/check-package-direction.mjs`) e o pre-push são o guard mecânico.
2. **Falha nova em caminho antes silencioso.** Validar no ponto de mintagem faz `compileTools` —
   API **pública** — passar a lançar para um par namespace/tool que hoje passa e só é rejeitado
   depois pelo `Agent.create`. É a correção pretendida (falhar cedo, tipado), mas é observável para
   quem chama `compileTools` direto. Mitigação: declarar como breaking de comportamento no CHANGELOG
   com a mensagem tipada nomeando o nome ofensor, e cobrir por teste negativo
   (`rules/testing.md` § 4.1 — asserção sobre o **erro tipado e a mensagem**, não sobre "lança").
