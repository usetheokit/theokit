# Agent feature backlog

Living document. Tracks features identificadas durante revisão de documentação (paridade Mastra × TheoKit).
Atualizado a cada nova seção auditada.

**Severidade:**
- `P1` — Capacidade central ausente; bloqueia casos de uso reais
- `P2` — Útil mas contornável
- `P3` — Nice-to-have / usuário avançado
- `OUT` — Fora de escopo por decisão explícita

**Disposição:**
- `TODO` — não implementado, sem decisão ainda
- `DEFERRED` — decidido adiar; motivo registrado
- `OUT_OF_SCOPE` — decidido não construir; motivo registrado
- `DONE` — entregue no TheoKit

---

## ✅ Release M9–M17 — gaps de paridade fechados (2026-07-07)

Os gaps P1/P2 abaixo foram convertidos nos milestones **M9–M17** do roadmap e **publicados no npm**:

| Pacote | Versão | Governança |
|---|---|---|
| `@theokit/agents` | **0.31.0** | ADR-0040 (runtime-vs-home boundary) |
| `theokit` | **0.16.0** | — |
| `@theokit/sdk` | **2.19.0** | — |

Validado E2E do registry público (9/9 exports + smoke funcional). Detalhe por milestone nas tabelas.

## ✅ Release M18–M30 — TODOS os DEFERRED fechados (2026-07-07)

Os 13 milestones **M18–M30** foram implementados, validados (E2E OpenRouter onde tocam o modelo) e **publicados no npm**:

| Pacote | Versão | Milestones |
|---|---|---|
| `theokit` | **0.17.0** | M18, M20, M26, M27, M28, M29, M30 |
| `@theokit/agents` | **0.32.0** | M19, M24, M25 (+ fix de segurança HITL `kind:'general'`) |
| `@theokit/sdk` | **2.20.0** | M21, M22, M23 |

PR #88 merged develop→main; tag + GitHub release `theokit@0.17.0`. **Não resta nenhum gap `DEFERRED` de paridade.**

## 🗺️ Todos os DEFERRED → milestones M18–M30 (ADR-0041, força total 2026-07-07)

Por decisão do dono, **todos** os gaps `DEFERRED` (+ os `OUT_OF_SCOPE`, re-escopados via `ADR-0041`) viraram milestones no `ROADMAP.md`:

| Milestone | Gaps do backlog cobertos |
|---|---|
| **M18** | `toModelOutput`, `transform` (tool output shaping) |
| **M19** | `processInputStream`, `processAPIError` (processor hooks) |
| **M20** | Approval payload customizado (HITL) |
| **M21** | Separate structuring model (SDK) |
| **M22** | `createSkill()` inline + custom skills directory |
| **M23** | Valibot / ArkType / JSON Schema providers (SDK) |
| **M24** | MCP: dynamic toolsets + registries + `requireToolApproval` |
| **M25** | Background task execution + task-completion scoring |
| **M26** | Workflows as tools (thin adapter — engine fica no SDK) |
| **M27** | Channels (Slack/Discord/Telegram) + webhook routes |
| **M28** | SDK Agents wrappers (Claude/OpenAI/Cursor) |
| **M29** | Code mode sandbox (`createCodeMode`) |
| **M30** | MCP Apps (iframe `ui://` UIs) |

As invariantes que **permanecem** off-limits (ADR-0041 D3): tornar `theokit` um SDK, reimplementar o loop/orchestrator, e abstração própria de provider. Todos esses milestones estão agora **DONE e publicados** (ver seção de release acima) — as tabelas por domínio abaixo foram atualizadas de `DEFERRED` → `DONE (Mxx)`.

---

## Docs — visão geral de agentes

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| Doc conceitual de overview | P2 | DONE | `docs/agents/overview.md` criado |
| Formato `provider/model` indocumentado | P2 | DONE | Tabela provider → env var em `overview.md` |
| Fluxo `useAgent` não documentado isoladamente | P2 | DONE | Coberto em `overview.md` |
| Decisão "agente vs action vs route" não escrita | P2 | DONE | Seção adicionada em `overview.md` |
| Mapa de features além do básico | P2 | DONE | Tabela em `overview.md` |

---

## Tools

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| `beforeToolCall` / `afterToolCall` hooks | P2 | **DONE (M10)** | `createToolHooksPlugin({ beforeToolCall, afterToolCall })` sobre `pre/post_tool_call` do SDK. `beforeToolCall` pode VETAR. `@theokit/agents@0.31.0`. |
| `toModelOutput` — controlar o que o modelo vê | P3 | **DONE (M18)** | `defineAgentTool({ handler, toModelOutput })` — handler retorna dados ricos `R`; `toModelOutput(R)` mapeia para a string que o modelo vê. Validado E2E OpenRouter. `theokit@0.17.0`. |
| `transform` — formatar payloads para UI e transcritos | P3 | **DONE (M18)** | `transform: { display?, transcript? }` + `applyTransform(tool, result, target)` — formata o resultado rico por target (nunca no wire do modelo). `theokit@0.17.0`. |
| Agentes como tools (padrão supervisor) | P2 | DONE | `defineSubAgent` + `createSquad` em `@theokit/sdk/a2a`. Ver `docs/agents/multi-agent.md`. |
| Workflows como tools | P3 | **DONE (M26)** | `createWorkflowTool(workflow, { name, description })` — thin adapter sobre um `Workflow` do SDK (engine fica no SDK; `packages/workflows/` continua G13-forbidden). `theokit@0.17.0`. |

---

## Skills

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| `skills.enabled` não filtra de verdade | P2 | **DONE (verificado — não era bug)** | Verificação M13: o SDK filtra por `SkillsSettings.enabled` e `compile-skills` mapeia `include → enabled`. O `void _enabled` documentado não existia no código. |
| API inline `createSkill()` | P3 | **DONE (M22)** | `createSkill({ name, description, instructions })` — skill code-defined sem SKILL.md, via `SkillsSettings.inline` (inline vence file no conflito de nome). `@theokit/sdk@2.20.0`. |
| Seleção dinâmica de skills por request | P2 | **DONE (M13)** | `defineAgent({ skills: (ctx) => string[] })` resolvido per-request contra o run-context via `resolveEnabledSkills` no mount. `@theokit/agents@0.31.0` + `theokit@0.16.0`. |
| Custom skills directory via opção do agente | P3 | **DONE (M22)** | `SkillsSettings.skillsDir` — descobre skills de um diretório custom em vez de `.theokit/skills`. `@theokit/sdk@2.20.0`. |

---

## Memória

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| Background compression (compressão automática de histórico longo) | P2 | **DONE (já no SDK)** | Verificação M11: o SDK já tem `autoSummarize` (trigger por `triggerFraction`, mantém `keepNewest`, summariza via `compressConversationWindow`), auto-disparado no local-agent. Não reimplementado (DRY). |
| Multi-user scoping nativo via `resource + thread` | P2 | **DONE (M11)** | `deriveConversationId(resource, thread)` / `parseConversationId` — determinístico e collision-safe. `@theokit/agents@0.31.0`. |

---

## Orquestração multi-agente

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| `onDelegationStart` / `onDelegationComplete` hooks | P2 | **DONE (M12)** | Hooks em `delegate()` — supervisor reescreve input antes / transforma resultado depois. `abortSignal` já propagava. `@theokit/agents@0.31.0`. Doc em `multi-agent.md`. |
| `messageFilter` — filtrar histórico antes da delegação | P2 | **N/A arquitetural** | O modelo subagent-as-tool (input único, sem histórico do pai) não expõe histórico para filtrar — nem no framework nem no SDK squad. Diferença arquitetural, não gap. |
| Background task execution (subagent assíncrono) | P3 | **DONE (M25)** | `delegateBackground(subAgent, msg)` → handle `{ wait(), settled() }` não-bloqueante (thin async wrapper sobre `delegate`, sem scheduler). `@theokit/agents@0.32.0`. |
| Task completion scoring / LLM-as-judge | P3 | **DONE (M25)** | `delegateWithScoring(subAgent, msg, { scorer, maxRounds })` — re-delega com o feedback do scorer até passar ou esgotar rounds. `@theokit/agents@0.32.0`. |

---

## Structured output

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| Valibot / ArkType / JSON Schema como schema providers | P3 | **DONE (M23)** | `normalizeSchema()` — Zod (default) / JSON Schema (passthrough) / ArkType (`.toJsonSchema()`) / Valibot (peer opcional) → JSON Schema interno. Zod continua o recomendado. `@theokit/sdk@2.20.0`. |
| Separate structuring model | P3 | **DONE (M21)** | `generateObject({ structuringModel })` — `model` raciocina (fase 1), `structuringModel` extrai a estrutura (fase 2). Validado E2E OpenRouter. `@theokit/sdk@2.20.0`. |
| `errorStrategy` — controlar o que acontece em falha de validação | P2 | **DONE (M14)** | `Agent.generateObject({ errorStrategy: 'throw' \| 'return-partial' \| 'return-raw' })`. `return-partial` salva os campos que validam. `@theokit/sdk@2.19.0`. |

---

## Human-in-the-loop

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| HITL no `defineAgent` / fluent builder | P2 | **DONE (M14)** | `defineAgent({ approvals: { <tool>: { question, timeout?, onTimeout? } } })` reusa a fiação HITL do endpoint. Falha-fast se a aprovação nomeia tool inexistente. `@theokit/agents@0.31.0`. |
| Listagem de aprovações pendentes entre runs | P2 | **DONE (M14)** | `GET /api/agents/<name>/approvals` — o `ApprovalRegistry` rastreia metadata (`toolName`, `question`, `expiresAt`) via `list()`. `theokit@0.16.0`. |
| Approval payload customizado | P3 | **DONE (M20)** | `POST /approve/<id>` aceita `{ approved, reason?, payload? }` (payload cap 16 KiB); negação injeta reason+payload no veto → modelo self-corrige. `payloadSchema` opcional no evento/`list()`. Validado E2E. `theokit@0.17.0` + `@theokit/agents@0.32.0`. |

---

## Guardrails (moderação de input/output)

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| Pipeline de guardrails built-in | P1 | **DONE (M9)** | `defineAgent({ guardrails: [...] })` — input guards fail-fast no boundary, output moderado antes do cliente (`moderateOutputStream`). `@theokit/agents@0.31.0`. |
| Detecção automática de prompt injection | P1 | **DONE (M9)** | `promptInjectionDetector()` — match de frase normalizado (ReDoS-free). |
| Sanitização de PII antes do modelo | P2 | **DONE (M9)** | `piiDetector({ redact })` — CPF/email/telefone → `[REDACTED]` antes do LLM. |
| Limitador de custo por sessão | P2 | **DONE (M9)** | `costGuard({ maxTokens })` — budget cumulativo de tokens, `CostBudgetExceededError`. |
| Output moderation antes de retornar ao usuário | P2 | **DONE (M9)** | `outputModeration({ moderate })` — predicado injetado (zero chamada LLM no módulo, G2); bloqueia antes do cliente. |

---

## Processors (middleware customizado)

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| Custom processor pipeline | P2 | **DONE (M10)** | `createToolHooksPlugin` expõe tool hooks (`beforeToolCall`/`afterToolCall`) + LLM-turn hooks (`beforeLLMCall`/`afterLLMCall`) sobre os hooks nativos do SDK (`pre/post_tool_call`, `pre/post_llm_call`). `@theokit/agents@0.31.0`. |
| `processInputStream` — modificar input (M19: `processInput`) | P3 | **DONE (M19)** | `createToolHooksPlugin({ processInput })` sobre o `pre_user_send` do SDK — injeta contexto derivado antes do modelo (o SDK não expõe mutação de prompt raw a plugins; teto honesto documentado). Validado E2E. `@theokit/agents@0.32.0`. |
| `processAPIError` — interceptar erros de API do LLM | P2 | **DONE (M19)** | `runWithApiErrorHandling` / `createApiErrorHandler` — sibling factory app-level que re-invoca o run do SDK no erro (o SDK é dono do retry interno; G2 preservado). Validado E2E (2 runs reais falhos → sucesso). `@theokit/agents@0.32.0`. |

---

## A2A — Agent-to-Agent (protocolo cross-network)

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| Protocolo A2A open-standard | P2 | **DONE (M15)** | Agent cards A2A servidos em `/.well-known/<name>/agent-card.json` + `createA2ATool` para delegação cross-network. `@theokit/agents@0.31.0` + `theokit@0.16.0`. |
| Agent cards (descoberta de capacidades) | P2 | **DONE (M15)** | `buildAgentCard(entry, { baseUrl })` + `handleAgentCard` servindo o JSON. |
| `A2AAgent` client | P2 | **DONE (M15)** | `createA2ATool({ url, name, description, auth? })` — POSTa `{ message }` a um agente remoto, retorna a resposta. Auth Bearer/API-key. |

---

## Channels (plataformas de mensagem)

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| Adaptadores de canal (Slack, Discord, Telegram) | P3 | **DONE (M27)** | Validadores de assinatura por plataforma: `slack()` (reuso), `telegram()` (secret-token), `discord()` (Ed25519 via Web Crypto). `theokit@0.17.0`. |
| Webhook routes auto-geradas por plataforma | P3 | **DONE (M27)** | `handleChannelWebhook` serve `POST /api/agents/<name>/channels/<platform>/webhook` — valida assinatura (401 no inválido) antes do handoff `onMessage` (onde o app fia o gateway do SDK). `theokit@0.17.0`. |

---

## Code mode (sandbox de execução)

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| Sandbox de execução de código (`createCodeMode`) | P3 | **DONE (M29)** | `createCodeMode({ tools, sandbox, onPermissionRequest })` — API restrita (só tools declaradas) + gate de permissão obrigatório (sem default-allow); a isolação é um `sandbox` **injetado** (app fornece engine vetado — nunca `node:vm`). Threat model em `docs/agents/code-mode.md`. `theokit@0.17.0`. |

---

## MCP

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| `MCPServer` — expor agentes TheoKit como servidor MCP | P2 | **DONE (M16)** | `buildMcpToolDescriptors`/`mcpServerInfo` + `POST /api/agents/<name>/mcp` (JSON-RPC: `initialize`, `tools/list`). `@theokit/agents@0.31.0` + `theokit@0.16.0`. |
| Dynamic toolsets por request (`listToolsets()`) | P2 | **DONE (M24)** | `resolveMcpServers(selection, ctx)` — resolver de config MCP per-request (creds multi-tenant), espelha o resolver de skills M13. `@theokit/agents@0.32.0`. |
| Integrações com registries MCP | P3 | **DONE (M24)** | `mcpRegistry({ registry, apiKey, apps?/profile? })` — config para Composio (`@composio/mcp`) e mcp.run (`@mcp.run/cli`); key no `env`. `@theokit/agents@0.32.0`. |
| MCP Apps (UIs iframe em MCP tools) | P3 | **DONE (M30, re-escopado ADR-0041)** | `defineAppResource` (`ui://` HTML) servido por `resources/list`+`resources/read`; `mountMcpApp` renderiza em iframe **sandboxed** (`allow-scripts`, sem `allow-same-origin`) + guest API cap-scoped. `theokit@0.17.0`. |
| `requireToolApproval` propagado via MCP | P3 | **DONE (M24)** | `mcpToolApprovals(specs)` → entradas `HumanInTheLoopOptions` que o `defineAgent({ approvals })` do M14 consome — tool MCP gated roteia pelo fluxo HITL (E2E-provado). `@theokit/agents@0.32.0`. |

---

## ACP — Agent Communication Protocol

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| `AcpAgent` — wrapper para coding agents via stdio JSON | P2 | **DONE (M17)** | `createACPTool({ command, args, cwd, onPermissionRequest })` — spawna coding agent via `NodeAcpTransport`, dirige com `AcpClient` (JSON-RPC newline-delimited). `theokit@0.16.0` + `@theokit/agents@0.31.0`. |
| Permission request handler para coding agents | P2 | **DONE (M17)** | `onPermissionRequest` **obrigatório** (security by default — sem default-allow), roteado via `AcpClient.onRequest('session/request_permission')`. |

---

## SDK Agents (wrappers de SDKs de terceiros)

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| Wrappers para Claude Agent SDK, OpenAI Agents SDK, Cursor SDK | P3 | **DONE (M28, re-escopado ADR-0041)** | `createVendorAgentTool({ vendor, client, onSession? })` — expõe um SDK de agente de terceiro como `CustomTool` (runtime deles; client injetado, sem dep de vendor no core). Resume via session id. `theokit@0.17.0`. |

---

## Docs escritos

| Doc | Status | Diferencial TheoKit |
|---|---|---|
| `docs/agents/overview.md` | ✅ | Diagrama do pipeline + decisão agente vs action vs route |
| `docs/agents/using-tools.md` | ✅ | `@theokit/sdk-tools` pré-prontos, `ctx.context` (M7), decorator `@Tool` |
| `docs/agents/skills.md` | ✅ | SKILL.md filesystem-based, `discoverSkills` + `buildSkillsBlock` públicos, `agent.skills.list()` |
| `docs/agents/memory.md` | ✅ | `ConversationStorageAdapter`, `MemorySettings` + dreaming sweep, semantic index |
| `docs/agents/multi-agent.md` | ✅ | `defineSubAgent` + `createSquad`, delegation hooks (M12), tool scope, delegation depth |
| `docs/agents/structured-output.md` | ✅ | `Agent.generateObject` + `Agent.streamObject`, `errorStrategy` (M14) |
| `docs/agents/human-in-the-loop.md` | ✅ | `@HumanInTheLoop`, `defineAgent({ approvals })` (M14), `GET /approvals` |
| `docs/agents/mcp.md` | ✅ | `@MCP` decorator + `POST /mcp` serving (M16), envPolicy seguro, OAuth 2.1 PKCE |
| `docs/agents/guardrails.md` | ✅ | M9 — 5 detectores, input fail-fast + output buffer/moderate, guards custom |
| `docs/agents/a2a.md` | ✅ | M15 — agent cards `/.well-known/`, `createA2ATool` client + auth |
| `docs/agents/processors.md` | ✅ | M10 — `createToolHooksPlugin` tool + LLM-turn hooks, veto |
| `docs/agents/acp.md` | ✅ | M17 — `createACPTool` + `AcpClient`, `onPermissionRequest` obrigatório |
| `docs/agents/code-mode.md` | ✅ | M29 — `createCodeMode`, boundary de sandbox **injetado** + gate de permissão, threat model |
| `docs/agents/channels.md` | ✅ | M27 — webhook routes por plataforma, validação de assinatura (Slack/Telegram/Discord Ed25519) |
| `docs/agents/sdk-agents.md` | ✅ | M28 — `createVendorAgentTool`, vendor client injetado, resume via session id |

---

## Auditoria Mastra — cobertura completa

Todas as 16 páginas do espaço de agents + MCP da documentação Mastra foram auditadas. Os gaps
identificados na auditoria (guardrails, processors, a2a, acp, mcp-server, delegation hooks, skills
resolver, scoping, errorStrategy, HITL surface) foram **implementados e publicados** como M9–M17.

### Páginas auditadas (agents/)

| Página Mastra | Doc TheoKit gerado | Status |
|---|---|---|
| `agents/overview` | `docs/agents/overview.md` | ✅ |
| `agents/using-tools` | `docs/agents/using-tools.md` | ✅ |
| `agents/skills` | `docs/agents/skills.md` | ✅ |
| `agents/agent-memory` | `docs/agents/memory.md` | ✅ |
| `agents/supervisor-agents` | `docs/agents/multi-agent.md` | ✅ |
| `agents/structured-output` | `docs/agents/structured-output.md` | ✅ |
| `agents/agent-approval` | `docs/agents/human-in-the-loop.md` | ✅ |
| `agents/guardrails` | Backlog P1 → **shipped M9** | ✅ |
| `agents/processors` | Backlog P2 → **shipped M10** | ✅ |
| `agents/a2a` | Backlog P2 → **shipped M15** | ✅ |
| `agents/channels` | Backlog P3 → **shipped M27** | ✅ |
| `agents/code-mode` | Backlog P3 → **shipped M29** + `docs/agents/code-mode.md` | ✅ |
| `agents/acp` | Backlog P2 → **shipped M17** | ✅ |
| `agents/sdk-agents` | Backlog P3 → **shipped M28** | ✅ |
| `agents/streaming` | Página não existe (404) — coberto inline em `overview.md` | ✅ |
| `agents/dynamic-agents` | Página não existe (404) | ✅ |

### Páginas auditadas (mcp/)

| Página Mastra | Doc TheoKit gerado | Status |
|---|---|---|
| `mcp/overview` | `docs/agents/mcp.md` → **serving shipped M16** | ✅ |
| `mcp/mcp-apps` | Backlog P3 → **shipped M30** (re-escopado ADR-0041) | ✅ |

**TUDO MAPEADO E FECHADO. Paridade Mastra × TheoKit 100%: gaps auditados → implementados (M9–M30) → publicados no npm (`theokit@0.17.0`, `@theokit/agents@0.32.0`, `@theokit/sdk@2.20.0`). Zero `DEFERRED` restantes.**
