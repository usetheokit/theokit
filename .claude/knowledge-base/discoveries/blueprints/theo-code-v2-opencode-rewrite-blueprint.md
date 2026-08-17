# Blueprint — Reescrever o OpenCode sobre TheoKit (`theo-code-v2`)

> DISCOVER cycle output. Prior-art: OpenCode (`sst/opencode`, MIT, ~350K LoC), clonado em
> `.claude/knowledge-base/references/opencode/`. Alvo: novo repo limpo `theo-code-v2`,
> coding-agent sobre TheoKit, **modo server E terminal desde o M0** (1 agente, N superfícies).
> Data: 2026-07-07.

## Coverage Corner 1 — Integration Tests (o que provar end-to-end)

- **Dual-mode invariant:** o MESMO `agents/code.ts` responde streamando um modelo real E executa
  uma tool real, tanto em `theo-code serve` (HTTP/UIMessageStream) quanto em `theo-code` (terminal).
- **HITL invariant:** uma tool mutante (edit/write/bash) pausa o run e pede aprovação nos DOIS modos,
  usando o MESMO registry de aprovação.
- **LSP-feedback invariant (M3+):** após um `edit`, o diagnostic do language server é injetado no
  output que o modelo vê (`<diagnostics>`), fechando o loop de auto-correção.

## Coverage Corner 2 — Dependencies (o que consumir, nunca reimplementar)

Regra G2/`sdk-runtime.md`: `@theokit/sdk` é o ÚNICO runtime. **Reconciliado contra o pacote
instalado `@theokit/sdk@2.20.0`** — todos confirmados no `dist`:

| Subsistema OpenCode | Contraparte | Verdict |
|---|---|---|
| Reflective loop (LLM→tools→repeat) | SDK `Agent.create` + `run.stream()` | **EXISTS-in-SDK** |
| Providers (Anthropic/OpenAI/OpenRouter/Ollama) | SDK `defineProvider`/`models` | **EXISTS-in-SDK** |
| MCP client (stdio + HTTP/SSE + OAuth) | SDK `./` MCP client | **EXISTS-in-SDK** |
| Conversation persistence | SDK `ConversationStorageAdapter` (JSONL) | **EXISTS-in-SDK** (OpenCode usa SQLite — adapter, não rewrite) |
| **Permission engine** (allow/ask/deny, patterns) | SDK **`PermissionEngine`** (confirmado no dist) | **EXISTS-in-SDK** — só o *surfacing* é GAP |
| Subagents / `task` | SDK `./subagents` | **EXISTS-in-SDK** |
| Compaction / overflow / summary | SDK `./compaction` | **EXISTS-in-SDK** |
| Skills (SKILL.md) | SDK `createSkill` + `./skills` | **EXISTS-in-SDK** (discovery on-disk = app) |
| Trajectory export (offline) | SDK `toShareGptTrajectory` | **EXISTS-in-SDK** (share hosted = GAP) |

**TheoKit framework (home):** HTTP server (fetch handler), `mountAgent`→UIMessageStream, HITL
approve endpoint + registry, one-shot terminal run (`runAgentInTerminal`), MCP-over-HTTP + stdio serving.

**theokit-tui (Ink/React) — componentes prontos (~30-40% do TUI):** ChatThread, ChatMessage,
ToolCall(+spinner/status), ToolResult, DiffViewer, CodeBlock, ContextWindowBar, CostMeter,
TokenUsageChart, AgentTimeline, themes, WelcomeBanner.

## Coverage Corner 3 — Tools (o built-in tool suite é o maior GAP de conteúdo)

TheoKit ships o **mecanismo** (`@Tool`/`defineAgentTool`, Zod, sempre explícito — G4) mas **ZERO
tools de coding**. Catálogo do OpenCode a portar (effect-Schema → Zod):

| Tool | Função | Gating HITL |
|---|---|---|
| `read` | ler arquivo (offset/limit; imagem→attachment) | não |
| `write` | escrever arquivo inteiro (+ LSP diagnostics) | sim (edit) |
| `edit` | string-replace (+ replaceAll; + LSP diagnostics) | sim (edit) |
| `apply_patch` | patch V4A multi-arquivo (modelos gpt-*) | sim (edit) |
| `glob` / `grep` / `ls` | busca por nome / conteúdo (ripgrep) / listar | não |
| `bash` | shell + **tree-sitter scan** p/ permissão por padrão | sim (pattern) |
| `webfetch` / `websearch` | fetch URL / busca web (Exa/Parallel) | webfetch/websearch |
| `task` | delega sub-agente (+ background) | pattern(subagent_type) |
| `todowrite` | estado de todo do agente | não |
| `skill` | invoca skill nomeada | não |
| `question` | perguntas estruturadas ao usuário | — |

## Coverage Corner 4 — Techniques (padrões-chave do OpenCode a adotar)

1. **Um binário, modo = subcomando** (OpenCode: yargs; `$0`=TUI, `serve`=headless, `run`=one-shot).
2. **Session como recurso REST server-side** — create/get/list/messages/abort/fork/summarize/revert
   + **SSE `/event` bus** desacoplado do request que iniciou o run (OpenCode: GlobalBus→SSE).
   TheoKit hoje streama por-POST; o bus standalone é GAP.
3. **Diagnostics-after-edit** — o feature de correção mais load-bearing do OpenCode (edit→LSP→
   `<diagnostics>` no output). LSP é **100% ausente** no TheoKit → maior subsistema net-new.
4. **Permission rule engine** — patterns wildcard last-match, `once|always|reject`, session-`always`
   acumulado, `external_directory` guard. Engine EXISTS-in-SDK; **surfacing** (AST scan + config + UX) é GAP.
5. **TUI app shell** — screen router, keybinding/leader-mode, command palette, ~30 dialogs, slash
   commands, composer c/ autocomplete, sidebar. OpenCode é **SolidJS/OpenTUI** (un-portable p/
   Ink/React do theokit-tui) → referência de UX, não de código. 60-70% do TUI é net-new.

## ADRs (decisões do blueprint)

- **ADR-B1 — 1 agente, N superfícies (não cliente/servidor como OpenCode).** OpenCode roda o agente
  server-side e o TUI é cliente HTTP+SSE fino. TheoKit inverte: `agents/*.ts` definido uma vez,
  rodado **in-process** no terminal OU **over-HTTP** no server. É a wedge do TheoKit — adotamos ela,
  não o modelo worker-RPC do OpenCode (que vira GAP opcional, só se precisarmos embutir server no TUI).
- **ADR-B2 — GAPs de runtime viram feature no SDK, nunca hack no app.** Hosted Session Share não tem
  contraparte no SDK → proposta de `ShareAdapter` no SDK (tem o seam `toShareGptTrajectory`). Nunca
  reimplementar dentro de `theo-code-v2`.
- **ADR-B3 — Permission é ligar, não construir.** Consumir `PermissionEngine` do SDK; o app só
  adiciona o AST-scan do bash (tree-sitter), a config de regras e a UX de `always`.
- **ADR-B4 — LSP começa TS/JS-only.** O loop diagnostics-after-edit é o valor; os 38 language servers
  do OpenCode são escopo futuro. M3 entrega TS/JS (a própria linguagem do dogfood).

## Verdict do escopo

Tudo **agent-execution-shaped já EXISTS** (SDK runtime + TheoKit home + theokit-tui components). O
rewrite é 6 GAPs: (G1) tool suite built-in, (G2) surfacing de permissão, (G3) LSP, (G4) session
server resource + SSE bus, (G5) TUI app shell, (G6) hosted share (SDK). Escala multi-milestone —
`ROADMAP.md` do `theo-code-v2` decompõe em M0-M8, com dogfood real a cada corte.
