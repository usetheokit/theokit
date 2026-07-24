---
slug: loop-strategy-seam
date: 2026-07-24
generated_by: roadmap-feature
questions_answered: 4
unresolved_dims: []
status: completed
---

# Roadmap-feature grill: loop-strategy-seam

> **Origem das respostas (honestidade):** as quatro dimensões foram resolvidas na conversa de design
> que precedeu este milestone — o owner pediu "uma construção mais OO para que os usuários possam
> sobrescrever o comportamento", eu investiguei os seams reais do `AgentRunner` e apresentei o
> achado; o owner então mandou abrir o milestone. Não foram inventadas: cada uma abaixo cita a
> evidência de código que a sustenta. A única dimensão genuinamente aberta (o cross-check de
> out-of-scope) foi decidida pelo owner via pergunta explícita — registrada em Q0.

### Q0 (cross-check obrigatório): o item travado *"Reimplementing the agent loop / own multi-agent orchestration"* é violado?

**Decisão do owner:** *Seguir — só a fatia do seam.*

Rationale registrado: o `AgentRunner` e a interface `LoopStrategy` **já existem** (V4-B / T3.1); a
mudança não reimplementa loop nem adiciona orquestração — apenas permite **injetar** o critério de
parada que hoje é escolhido entre 3 nomes fixos. Segue o precedente dos M38/M39/M40: o milestone
declara explicitamente que pega **só a fatia do seam** e **reafirma** loop próprio / orquestração
multi-agente como OUT, com cross-check datado (2026-07-24).

### Q1/4: o que é esta feature e por que AGORA (o que mudou)?

Abrir `AgentRunnerBuilder.loopStrategy(custom)` para que o consumidor injete a própria
`LoopStrategy` (o critério `shouldContinue`).

**O que mudou:** a análise dos seams do runner (feita nesta sessão) revelou uma **assimetria de
OCP** que ninguém tinha nomeado. Evidência de código:

| Eixo de comportamento | Injetável? | Evidência |
|---|---|---|
| Reflexão entre rounds | ✅ objeto custom | `AgentRunnerBuilder.reflection(strategy?: ReflectionStrategy)` |
| Compactação | ✅ por nome | `.compaction(name, opts)` → `resolveCompactionStrategy` |
| Produção do round | ✅ | `AgentRunnerRunOptions.streamFactory` |
| **Critério de parada** | ❌ | `resolveLoopStrategy` valida `z.enum(['simple-chat','plan-act-reflect','react'])`; não há `.loopStrategy()` no builder |

A interface `LoopStrategy` **já é aberta** (`{ name, maxIterations, shouldContinue(outcome) }`) — só
o construtor a tranca. É o eixo que o usuário mais quer controlar na prática ("pare quando o custo
passar de X", "pare quando a confiança ≥ 0.9").

### Q2/4: quais milestones precisam estar `[x]` antes desta feature começar?

**M53.** A mudança toca `AgentRunnerBuilder`/`AgentRunnerSpec`, que acabaram de ser reescritos no
M53 (seams spec-only, remoção dos decorators). Começar antes do M53 fechar criaria conflito no mesmo
arquivo e invalidaria a prova de zero-behavior daquele milestone.

### Q3/4: qual é a Definition of Done verificável?

Ver o bloco `### M54` no `ROADMAP.md` — cinco critérios, dos quais dois são gates duros: a prova de
zero-behavior nas três estratégias existentes, e o guardrail de terminação (uma custom com
`shouldContinue: () => true` DEVE parar no teto `maxIterations`).

### Q4/4: quais são os 2 riscos NOVOS que esta feature introduz?

1. **Loop custom que não termina** — uma `shouldContinue` sempre-true queima orçamento até o teto.
   Mitigação: `maxIterations` permanece um teto duro que a custom **não** pode sobrescrever, provado
   por teste.
2. **Breaking sutil de tipo** — relaxar `LoopStrategy.name` de `MainLoopMeta['strategy']` para
   `string` quebra quem lê `.name` esperando a union (ex.: um `switch` exaustivo). Mitigação:
   declarar como breaking de tipo no CHANGELOG, aproveitando o major que o M53 já carrega.
