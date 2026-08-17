---
type: Grill
title: Grill: transport unification
description: The scope questions and the milestone renumbering reconciliation for transport unification.
tags: [grill, transport]
status: stable
generated: { by: process:roadmap-feature, at: 2026-07-24T00:00:00Z }
migrated: { by: claude-opus-5/okf-skill, at: 2026-08-06T00:00:00Z, from: knowledge-base/grills/transport-unification-4x-feature-grill.md }
sources:
  - id: origin
    resource: knowledge-base/grills/transport-unification-4x-feature-grill.md
    title: Original document, absorbed into this bundle verbatim
    last_modified: 2026-07-24
# --- keys carried over from the source document ---
slug: transport-unification-4x
date: 2026-07-24
produced_by: roadmap-feature
questions_answered: 4
unresolved_dims: []
record_status: completed
milestone_id: M66
roadmap: v2 thread
---

# Feature grill: transport-unification-4x

Reconciled numbering: the global max is **M65** on the v1 thread; the v2 thread reused M57-M63. The
next free global is **M66**, added to the **v2** thread as the direct continuation of the
"alinhar tudo na linha 4.x" que a v2 começou.

### Q1/4: What / why now

**Recommended:** Unificar o transporte in-process em `@theokit/agents@4.x`. **Why now:** a fronteira
zero-`@theokit/sdk*` (M63) acabou de fechar, e a evidência desta sessão mostra que o split de linha do
transporte é a última rachadura de fundação: (a) o dedup guard precisou ser **re-escopado** (M62) em
vez de corrigido, (b) é a causa-raiz provável do **#77** (rota OAuth Codex retorna `input_tokens=0`
mesmo com credencial cabeada — o transporte `theokit/server/agent`@0.44.x é quem resolve o builtin
`openai-chatgpt`), (c) o "boundary via `AgentDefinition` (dado puro, não `instanceof`)" é um workaround
load-bearing entre 4.x e 0.44.x.

**User answer:** confirmado (o usuário elegeu isto como o passo #1 evolutivo; escopo "como rascunhado").

### Q2/4: Dependencies

**Recommended/answer:** **M63** (`[x]`) — a fronteira já fechada. Este milestone alinha a última peça
(o transporte) na mesma linha 4.x. O CLI já está migrado no monorepo (`packages/theo` = `theokit@0.43.12`,
`@theokit/agents: workspace:^` → 4.5.0); falta publicar + o agent-builder consumir.

### Q3/4: Definition of done

**Recommended/answer (confirmado — "como rascunhei"):**
1. `theokit@0.43.12`+ publicado no npm dependendo de `@theokit/agents@^4.x` (via CI — `provenance:true`).
2. agent-builder bumpa `theokit` → UMA cópia de `@theokit/agents` (sem a aninhada 0.44.x); dedup guard
   volta ao invariante ORIGINAL "one copy" (reverte o re-escopo do M62).
3. Rota OAuth Codex destravada: `exec/TUI --model openai-chatgpt/*` responde (`input_tokens>0`) OU erro
   tipado — fim do silent `tokens=0`. Prova live; **#77 fechada com evidência**.
4. Gates verdes nos dois repos; TUI+exec smoke live sem regressão.

### Q4/4: Top new risks

1. `theokit@0.43.12` (4.x) pode divergir de `0.44.7` no transporte in-process (resolução do builtin
   `openai-chatgpt`, wiring de hooks). Mitigação: smoke live completo TUI+exec ANTES de fechar; a prova
   do #77 é o teste de aceitação.
2. Publicar `theokit` exige CI/provenance (não sai local). Mitigação: acionar o release pipeline; se
   bloqueado, documentar o blocker e NÃO fechar (honestidade).

### Decisão de escopo (fork resolvido)

A feature "rastrear a mutação espúria do `chat.ts`" foi **separada como ad-hoc** (não vira milestone) —
por decisão do usuário, alinhada ao próprio contrato do skill (investigações → ad-hoc, não roadmap).
Será tratada via `/auto-plan` ad-hoc: causa-raiz (hook rodando prettier/eslint `--fix` na árvore? editor?)
+ guard de regressão.

# Related
* [multi-surface-architecture](/architecture/multi-surface-architecture.md) — the architecture.
* [agent-conversation-in-core](/grills/agent-conversation-in-core.md) — where the thread logic should live.
* [agent-client](/agents/agent-client.md) — the client that consumes it.

