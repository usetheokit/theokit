---
slug: theokit-ai-first
date: 2026-07-03
generated_by: roadmap-init
questions_answered: 7
unresolved_dims: []
status: completed
---

# Roadmap grill: theokit-ai-first

### Q1/7: Root problem

**Question:** Qual é o problema central que esta iniciativa resolve, e para quem dói hoje?

**Recommended:** A integração do TheoKit com o @theokit/sdk é fragmentada e proprietária, impondo três custos: (1) dois caminhos concorrentes para expor um agente (@Agent decorator vs defineAgentEndpoint + useAgentStream) sem história canônica; (2) wire format AgentEvent SSE próprio, isolando o TheoKit do ecossistema ai-sdk (sem reuso de useChat, ai-elements, componentes de terceiros); (3) peças de um agent app (loop, tool cards, human-in-the-loop, conversation history) espalhadas, sem superfície coesa. Dói para o desenvolvedor que constrói apps de agente no TheoKit — mais wiring que no ai-sdk e lock-in a um só ecossistema. Enquadramento: DX + interop, não "falta um SDK".

**User answer:** Aceita a recomendação integralmente.

### Q2/7: Primary users

**Question:** Quem é o usuário primário desta iniciativa (papel, interno vs externo, um time vs muitos)?

**Recommended:** Primário — desenvolvedor TypeScript externo que constrói app de agente sobre o TheoKit (público do HERO "build the app your agent lives in"); já conhece/espera a ergonomia do ai-sdk (useChat, streamText, message.parts) e quer essa fluidez sem abrir mão do "home" (auth, sessões, deploy, WS) que o ai-sdk não dá. Secundário — o time do TheoKit, que hoje mantém dois caminhos + protocolo proprietário e paga o custo da duplicação. Parte do valor é reduzir superfície proprietária mantida internamente.

**User answer:** Aceita a recomendação integralmente.

### Q3/7: V1 scope

**Question:** O que precisa estar pronto para chamar esta iniciativa de "V1 entregue"?

**Recommended (proposta original):** V1 = Eixos A + B completos e dogfooded; C (harness) em V2 gated por ADR; D (terminal-ui) fora até haver demanda. Faseamento por KISS/YAGNI.

**User answer (OVERRIDE):** V1 = **A + B + C + D completos e dogfooded**. O usuário rejeitou o faseamento — quer os quatro eixos entregues no V1. Ressalvas de honestidade aceitas e convertidas em GATES de milestone (não bloqueiam a iniciativa): (C) exige ADR de escopo aprovado ANTES do código — harness é adapter/wiring sobre o @theokit/sdk, NUNCA runtime paralelo (invariante locked "built-in agent orchestration = out of scope"); (D) exige decisão explícita de wedge documentada — terminal-ui está fora do "app web onde o agente vive". Ambos entram no V1 com esses portões declarados no roadmap.

### Q4/7: Explicitly out of scope

**Question:** O que é tentador mas NÃO entra nesta iniciativa (nem no V1, nem depois sem revisão estratégica)?

**Recommended:** (1) Transformar o theokit num SDK — @theokit/sdk continua o runtime; iniciativa é integração, não substituição. (2) Reimplementar loop de agente / orquestração multi-agente própria — harness (C) é adapter sobre run.stream()/Agent.create(), não runner paralelo; orquestração "de verdade" continua upstream (SDK/Mastra). (3) AI SDK RSC — TheoKit é client-by-default por decisão locked, RSC deferido pós-1.0. (4) Provider abstraction própria — seleção/roteamento de modelos é do SDK; não duplicar a camada de providers do ai-sdk. (5) Quebrar o path HTTP de decorators (@theokit/http) — iniciativa toca a superfície de agente, não a de controllers HTTP. NOTA: D (terminal-ui) NÃO está fora — foi incluído no V1 na Q3 com gate de wedge.

**User answer:** Aceita a recomendação integralmente.

### Q5/7: Hard constraints

**Question:** Quais são as restrições invioláveis que limitam o espaço de solução?

**Recommended (original):** (1) Invariantes locked (SDK é o único runtime; TheoKit continua framework; multi-runtime nunca no core). (2) Backward-compat: AgentEvent/useAgentStream não quebram de imediato; coexistência + deprecação com janela de migração. (3) Stack fixa (TS, Node>=22.12, Vite6/React19, Zod, Web Standards; bridge é o único adaptador SDK→evento). (4) Processo (DISCOVER→...→RELEASE, TDD-first, CHANGELOG/Changesets, develop; C requer ADR antes do código). (5) Time pequeno favorece adotar protocolo do ai-sdk em vez de manter próprio.

**User answer (OVERRIDE na #2):** NÃO manter retrocompatibilidade — VIRADA TOTAL (clean break). Sem shim, sem coexistência, sem dual-path-deprecado: o caminho proprietário antigo (AgentEvent + useAgentStream) é REMOVIDO, não mantido como legacy. Consequências assumidas: (a) breaking change explícito, comunicado no CHANGELOG (Removed/BREAKING) + bump de versão adequado; (b) apps existentes (incl. dogfood TheoCode) quebram e MIGRAM via guia de migração hard (documentation-architect), NÃO via compat layer; (c) design dos Eixos A-D nasce limpo, sem carregar o legado (mais KISS). Constraints (1)(3)(4)(5) permanecem válidas; a antiga (2) é substituída por "migração hard documentada, sem compat layer".

### Q6/7: Measurable V1 success criterion

**Question:** Qual número/comportamento verificável diz "V1 entregue"?

**Recommended:** Critério composto e binário: (1) Interop (A) — app TheoKit consome agente com useChat do @ai-sdk/react SEM adaptador custom; teste E2E Playwright verde renderizando texto + tool call via message.parts. (2) Superfície única (B) — expor agente = 1 arquivo (server/agents/x.ts) + 0 linhas de wiring manual no client (hook tipado gerado); grep por AgentEvent/useAgentStream no core = 0 (prova do clean break). (3) Harness (C) — exemplo agent-saas roda loop statefull com resume + HITL approval E2E, ADR de escopo mergeado antes do código. (4) Terminal (D) — theokit expõe harness de terminal renderizando stream + tool calls + approval de agente local (decisão de wedge documentada). (5) Dogfood — create-theokit default + agent-saas migrados; /dogfood emite EVIDENCE_SUFFICIENT para o cenário-âncora "chat de agente na superfície nova". Cada item é oráculo binário (E2E, grep==0, verdict /dogfood), não adjetivo.

**User answer:** Aceita a recomendação integralmente.

### Q7/7: North-star metric

**Question:** Diferente do "entregue" (Q6), qual métrica, quando se move, diz que a iniciativa está vencendo?

**Recommended:** Tempo-até-agente-em-produção (time-to-shipped-agent): tempo/linhas do `npx create-theokit` até um agente com chat streaming + tool calls numa URL real. Meta: bater a fluidez percebida do ai-sdk E entregar o que ele não dá (app com auth/deploy) — "5 minutos para um agente que seus amigos usam de verdade". Proxies observáveis: linhas de wiring de agente por app (deve cair para ~1 arquivo) e adoção da superfície nova (nº de apps/exemplos em server/agents/* vs zero no protocolo antigo). Amarra ao HERO locked "build the app your agent lives in".

**User answer:** Aceita a recomendação integralmente.

