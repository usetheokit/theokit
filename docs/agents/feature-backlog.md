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
| `toModelOutput` — controlar o que o modelo vê | P3 | DEFERRED | Tool retorna dados ricos para o app; modelo recebe representação menor ou multimodal. Adiar até haver demanda concreta. |
| `transform` — formatar payloads para UI e transcritos | P3 | DEFERRED | Formata input/output/erros para targets `display` e `transcript`. Complexo; adiar. |
| Agentes como tools (padrão supervisor) | P2 | DONE | `defineSubAgent` + `createSquad` em `@theokit/sdk/a2a`. Ver `docs/agents/multi-agent.md`. |
| Workflows como tools | P3 | DEFERRED | Desbloquear depois que workflows existirem no TheoKit. |

---

## Skills

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| `skills.enabled` não filtra de verdade | P2 | **DONE (verificado — não era bug)** | Verificação M13: o SDK filtra por `SkillsSettings.enabled` e `compile-skills` mapeia `include → enabled`. O `void _enabled` documentado não existia no código. |
| API inline `createSkill()` | P3 | DEFERRED | Mastra permite definir skills em código sem SKILL.md. SKILL.md filesystem é suficiente para a maioria. |
| Seleção dinâmica de skills por request | P2 | **DONE (M13)** | `defineAgent({ skills: (ctx) => string[] })` resolvido per-request contra o run-context via `resolveEnabledSkills` no mount. `@theokit/agents@0.31.0` + `theokit@0.16.0`. |
| Custom skills directory via opção do agente | P3 | DEFERRED | `discoverSkills(dir)` público; contornável com `systemPrompt` resolver. |

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
| Background task execution (subagent assíncrono) | P3 | DEFERRED | `streamUntilIdle()`. Adiar até haver demanda. |
| Task completion scoring / LLM-as-judge | P3 | DEFERRED | Validar resultado do subagente com scorer customizado. |

---

## Structured output

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| Valibot / ArkType / JSON Schema como schema providers | P3 | DEFERRED | TheoKit só suporta Zod (padrão de facto). |
| Separate structuring model | P3 | DEFERRED | Workaround: duas chamadas manuais. |
| `errorStrategy` — controlar o que acontece em falha de validação | P2 | **DONE (M14)** | `Agent.generateObject({ errorStrategy: 'throw' \| 'return-partial' \| 'return-raw' })`. `return-partial` salva os campos que validam. `@theokit/sdk@2.19.0`. |

---

## Human-in-the-loop

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| HITL no `defineAgent` / fluent builder | P2 | **DONE (M14)** | `defineAgent({ approvals: { <tool>: { question, timeout?, onTimeout? } } })` reusa a fiação HITL do endpoint. Falha-fast se a aprovação nomeia tool inexistente. `@theokit/agents@0.31.0`. |
| Listagem de aprovações pendentes entre runs | P2 | **DONE (M14)** | `GET /api/agents/<name>/approvals` — o `ApprovalRegistry` rastreia metadata (`toolName`, `question`, `expiresAt`) via `list()`. `theokit@0.16.0`. |
| Approval payload customizado | P3 | DEFERRED | TheoKit suporta `approved: bool + reason?`. Adiar. |

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
| `processInputStream` — modificar input chunk a chunk | P3 | DEFERRED | Adiar até ter demanda. |
| `processAPIError` — interceptar erros de API do LLM | P2 | DEFERRED | O SDK já tem retry/backoff de provider; um hook dedicado de erro de API fica adiado até haver demanda concreta. |

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
| Adaptadores de canal (Slack, Discord, Telegram) | P3 | DEFERRED | Gateway package existe no SDK, não integrado ao framework. Não é core do "app que o agente mora". |
| Webhook routes auto-geradas por plataforma | P3 | DEFERRED | Adiar até channels serem core. |

---

## Code mode (sandbox de execução)

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| Sandbox de execução de código (`createCodeMode`) | P3 | DEFERRED | `createShellTool` do `@theokit/sdk-tools` é o mais próximo, sem sandbox. Parcialmente coberto pelo M17 (coding agents via `createACPTool`). |

---

## MCP

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| `MCPServer` — expor agentes TheoKit como servidor MCP | P2 | **DONE (M16)** | `buildMcpToolDescriptors`/`mcpServerInfo` + `POST /api/agents/<name>/mcp` (JSON-RPC: `initialize`, `tools/list`). `@theokit/agents@0.31.0` + `theokit@0.16.0`. |
| Dynamic toolsets por request (`listToolsets()`) | P2 | TODO | Credenciais MCP diferentes por request (multi-tenant). Follow-up — o serving atual expõe tools estáticas. |
| Integrações com registries MCP | P3 | DEFERRED | Klavis/mcp.run/Composio/Smithery. Usuário instala servidores manualmente. |
| MCP Apps (UIs iframe em MCP tools) | P3 | OUT_OF_SCOPE | Específico do Mastra Studio. |
| `requireToolApproval` propagado via MCP | P3 | DEFERRED | Aprovação de tool via protocolo MCP. Adiar. |

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
| Wrappers para Claude Agent SDK, OpenAI Agents SDK, Cursor SDK | P3 | DEFERRED | O `@theokit/sdk` é o runtime próprio. Não é core da proposta. |

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
| `agents/channels` | Backlog P3 DEFERRED | ✅ auditado |
| `agents/code-mode` | Backlog P3 DEFERRED (parcial M17) | ✅ auditado |
| `agents/acp` | Backlog P2 → **shipped M17** | ✅ |
| `agents/sdk-agents` | Backlog P3 DEFERRED | ✅ auditado |
| `agents/streaming` | Página não existe (404) — coberto inline em `overview.md` | ✅ |
| `agents/dynamic-agents` | Página não existe (404) | ✅ |

### Páginas auditadas (mcp/)

| Página Mastra | Doc TheoKit gerado | Status |
|---|---|---|
| `mcp/overview` | `docs/agents/mcp.md` → **serving shipped M16** | ✅ |
| `mcp/mcp-apps` | Backlog P3 OUT_OF_SCOPE | ✅ auditado |

**TUDO MAPEADO. Paridade Mastra × TheoKit: gaps auditados → implementados (M9–M17) → publicados no npm.**
