# Blueprint — theokit como camada de adaptação/apresentação multi-surface (SDK ↔ UI)

> Discover 2026-07-23. Origem: aprendizados de construir o **agent-builder** (clone do Codex sobre `@theokit/sdk`) — o terminal re-implementou formatters que deveriam ser presenters do theokit. Alvo: elevar a camada de apresentação do theokit de **web-cêntrica** para **multi-surface** (web + terminal + API), com um contrato `Presenter` (Strategy) e Ports de protocolo (HTTP/PTY/WS) de 1ª classe. **Sem retrocompatibilidade** (decisão do owner). Não implementado — este é o mapa + o alvo + o roadmap faseado.

## Estado atual (evidência, develop)

**theokit JÁ é "adapter sobre o SDK" com formato canônico web** (ROADMAP M1/M4/M5, 49/49 `[x]`):
- Web presenter: `packages/agents/src/bridge/ui-message-stream-translator.ts:181` `translateToUIMessageStream` — `AgentStreamEvent → Vercel ai-sdk UIMessageStream` (consumido por `useChat`/assistant-ui via SSE).
- SDK→evento: `packages/agents/src/bridge/event-translator.ts:153` `translateSdkEvent` / `:181` `translateInteractionUpdate`.
- SSE: `packages/agents/src/bridge/agent-sse-handler.ts`; think/tool massaging: `think-tag-extractor.ts`, `tool-dialect-stripper.ts`.
- Controller→SDK: `packages/agents/src/bridge/sdk-adapter.ts` (`@Agent → compileAgent() → Agent.create() → Run.stream()`) + loop Strategy em `packages/agents/src/loop/{agent-runner,loop-strategy,reflection-strategy}.ts`.
- Port HTTP: `packages/http/src/request-context.ts` `TheoRequestContext` (AsyncLocalStorage).
- `packages/theo/src/adapters/*` = adapters de **deploy** (lambda/vercel/bun/cloudflare), NÃO de protocolo.

**O gap (a duplicação):** o **terminal** traduz em PARALELO, fora do bridge — `@theokit/tui/src/messages-to-events.ts`, `agent-event.ts`, `tool-call.tsx`. O agent-builder re-implementa ainda mais (`formatGoalEvent`, `tool-header`). **Não há UM contrato Presenter**; cada superfície re-traduz o output do agente. E não há Port de 1ª classe p/ PTY/WS (só HTTP tem request-context; PTY mora no `@theokit/sdk-pty`; `ws-shim` é shim de deploy).

## Alvo (Hexagonal — Ports & Adapters + Presenter Strategy)

```
[ @theokit/sdk ]  (Harness: Run.stream() cru)
       │  SDKMessage / InteractionUpdate
       ▼
┌─ theokit (camada de adaptação/apresentação) ──────────────────┐
│  Ports/Adapters(IN):  HTTP · PTY · WS  → RequestContext único  │
│         ▼                                                      │
│  Controller:  reusa bridge/sdk-adapter + loop (orquestra o SDK)│
│         ▼  AgentOutput (evento canônico normalizado)           │
│  Presenter (Strategy):  AgentOutput → SurfaceOutput            │
│     ├─ UIMessageStreamPresenter (web/SSE — o atual)            │
│     ├─ TerminalPresenter (ANSI — porta os formatters do tui)   │
│     └─ JsonPresenter (API)                                     │
└───────────────────────────────────────────────────────────────┘
       │  SurfaceOutput
       ▼
[ @theokit/ui · @theokit/tui · API consumers ]
```

- **Presenter** é a peça nova/central (o owner: "criar todos os formatters, outputs"). Um contrato + registry; os tradutores dispersos passam a ser implementações do contrato.
- **Zero duplicação:** o `TerminalPresenter` é a fonte única do ANSI — o `@theokit/tui` e o agent-builder consomem, não re-implementam.

## Roadmap faseado (walking-skeleton primeiro)

| # | Milestone | DoD-chave |
|---|---|---|
| **A** (skeleton) | Contrato `Presenter` (Strategy) + registry; refatora `translateToUIMessageStream` por trás do contrato — **zero mudança no path web/SSE** | contrato definido; web via `UIMessageStreamPresenter`; testes existentes verdes |
| **B** | `TerminalPresenter` (ANSI) — fonte única; porta `messages-to-events`/`tool-call`/`formatGoalEvent` | mesma saída ANSI (A/B vs tui atual); tui consome o presenter |
| **C** | Port de protocolo unificada (`ProtocolAdapter`/`RequestContext`) HTTP + PTY + WS | 1 agente, 3 protocolos, testes de cada Port |
| **D** | Controller consolidado fiado Port(in) ↔ Presenter(out) | web+terminal+API do mesmo agente, E2E |

## Riscos

| # | Risco | Mitigação |
|---|---|---|
| 1 | Refatorar o path web quebra `useChat`/assistant-ui (consumidores reais) | M-A é zero-behavior-change atrás do contrato; testes E2E existentes (M1) são o oráculo |
| 2 | ANSI do tui tem detalhes sutis (Static, glifos, cores) | M-B faz A/B byte-a-byte vs o tui atual; porta verbatim antes de unificar |
| 3 | Acoplar o Presenter ao formato ai-sdk (UIMessageStream) e não generalizar | o contrato normaliza p/ `AgentOutput` canônico ANTES do presenter; UIMessageStream vira UMA estratégia |
| 4 | PTY/WS como Port real (não shim) exige repensar streaming bidirecional | M-C isolado; reusa `@theokit/sdk-pty` (session/writeChain) + `request-context` como base |

## Cross-references
- ROADMAP theokit (49/49 `[x]`): M1 UIMessageStream, M4 harness-adapter, M5 terminal.
- SDK (faixa posterior — L1–L6): Oráculo público (`goal-loop.ts` depsOverride @internal), status `blocked` (`run-until.ts:138`), credencial fresh (M59 agent-builder), PTY-sandbox (M57), export-hygiene (M42/M56).
- agent-builder (a evidência de dogfood): `tui/*` re-implementa presenters; M62/M64/M65 documentam os atritos.
