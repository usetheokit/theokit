# Agent feature backlog

Living document. Tracks features identificadas durante revisão de documentação.
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
| `beforeToolCall` / `afterToolCall` hooks | P2 | TODO | Executar lógica antes/depois de cada tool call — logging, auditoria, bloqueio de input. Suportar por agente e por execução. |
| `toModelOutput` — controlar o que o modelo vê | P3 | DEFERRED | Tool retorna dados ricos para o app; modelo recebe representação menor ou multimodal. Útil para tools de imagem. Adiar até haver demanda concreta. |
| `transform` — formatar payloads para UI e transcritos | P3 | DEFERRED | Separado de `toModelOutput`. Formata input/output/erros para targets `display` e `transcript`. Complexo; adiar. |
| Agentes como tools (padrão supervisor) | P2 | DONE | `defineSubAgent` + `createSquad` em `@theokit/sdk/a2a`. Ver `docs/agents/multi-agent.md`. |
| Workflows como tools | P3 | DEFERRED | Converter um workflow em tool que o agente pode invocar. Desbloquear depois que workflows existirem no TheoKit. |

---

## Skills

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| `skills.enabled` não filtra de verdade | P2 | TODO | O código faz `void _enabled` — o parâmetro é ignorado. `list()` retorna todos os skills independente do filtro. Feature marcada como "hint" internamente. |
| API inline `createSkill()` | P3 | DEFERRED | Mastra permite definir skills em código TypeScript sem SKILL.md. TheoKit só tem filesystem. Adiar até haver demanda concreta — SKILL.md é suficiente para a maioria dos casos. |
| Seleção dinâmica de skills por request | P2 | TODO | Mastra tem resolver function que recebe `requestContext` e retorna lista de skills condicional. TheoKit descobre skills no startup, não por request. Útil para multi-tenant. |
| Custom skills directory via opção do agente | P3 | DEFERRED | `discoverSkills(dir)` é público e aceita qualquer dir, mas o agente sempre usa `.theokit/skills/`. Contornável com `systemPrompt` resolver + `discoverSkills`. |

---

## Memória

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| Background compression (compressão automática de histórico longo) | P2 | TODO | Mastra usa background agents para comprimir histórico crescente. TheoKit não tem equivalente. Workaround: `getMessages(id, { limit, offset })` + adapter custom com sumário. |
| Multi-user scoping nativo via `resource + thread` | P2 | TODO | Mastra tem `{ resource, thread }` como primitiva de primeira classe. TheoKit usa `conversationId` opaco — o usuário monta `user-${userId}-thread-${threadId}` manualmente. Não documentado como padrão. |

---

## Orquestração multi-agente

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| `onDelegationStart` / `onDelegationComplete` hooks | P2 | TODO | Interceptar delegação antes/depois para modificar prompt, aprovar/rejeitar, ou injetar feedback. Workaround: `defineAgentTool` customizado com lógica de hook. |
| `messageFilter` — filtrar histórico antes da delegação | P2 | TODO | Controlar quais mensagens do supervisor são passadas ao subagente. TheoKit passa só a string `input`. |
| Background task execution (subagent assíncrono) | P3 | DEFERRED | Executar subagente sem bloquear o supervisor; `streamUntilIdle()`. Adiar até haver demanda. |
| Task completion scoring / LLM-as-judge | P3 | DEFERRED | Validar resultado do subagente com scorer customizado; injetar feedback para iteração. |

---

## Structured output

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| Valibot / ArkType / JSON Schema como schema providers | P3 | DEFERRED | Mastra suporta Zod, Valibot, ArkType e JSON Schema raw. TheoKit só suporta Zod. Adiar — Zod é o padrão de facto do ecossistema TheoKit. |
| Separate structuring model | P3 | DEFERRED | Usar modelo barato só para extração estruturada após raciocínio do modelo principal. Workaround: duas chamadas manuais. |
| `errorStrategy` — controlar o que acontece em falha de validação | P2 | TODO | Mastra tem `errorStrategy: 'return-partial' \| 'return-raw' \| 'throw'`. TheoKit só faz retry até `maxRetries`. |

---

## Human-in-the-loop

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| HITL no `defineAgent` / fluent builder | P2 | TODO | `@HumanInTheLoop` funciona apenas na superfície `@Agent` class. `defineAgent` e builder `.build()` não têm equivalente. Workaround: `defineAgentTool` customizado que chama a API de aprovação. |
| Listagem de aprovações pendentes entre runs | P2 | TODO | Sem API built-in para listar todos os `callId` pendentes. O app deve persistir `approval_required` events no seu próprio banco. |
| Approval payload customizado | P3 | DEFERRED | Mastra permite payload customizado na aprovação (comentários, campos extras). TheoKit só suporta `approved: bool + reason?: string`. |

---

## Guardrails (moderação de input/output)

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| Pipeline de guardrails built-in | P1 | TODO | Mastra tem processors plugáveis (PromptInjectionDetector, UnicodeNormalizer, PIIDetector, ModerationProcessor, CostGuardProcessor, SystemPromptScrubber, BatchPartsProcessor). TheoKit não tem nenhum. Workaround: implementar na rota HTTP antes/depois de chamar o agente. |
| Detecção automática de prompt injection | P1 | TODO | Nenhuma proteção built-in contra prompt injection. Crítico para apps expostos ao público. |
| Sanitização de PII antes do modelo | P2 | TODO | Sem redação automática de dados sensíveis (emails, CPF, telefones) do input do usuário antes de enviar ao LLM. |
| Limitador de custo por sessão | P2 | TODO | Sem controle automático de custo por sessão ou usuário. Workaround: instrumentar `usage` do result e cortar manualmente. |
| Output moderation antes de retornar ao usuário | P2 | TODO | Sem verificação de conteúdo inapropriado na resposta do modelo antes de chegar ao cliente. |

---

## Processors (middleware customizado)

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| Custom processor pipeline | P2 | TODO | Mastra tem interface `Processor` com hooks em cada fase (`processInput`, `processLLMRequest`, `processLLMResponse`, `processOutputResult`, `processOutputStream`, `processAPIError`). TheoKit não tem equivalente. Plugin TheoKit (`TheoPlugin`) é mais limitado — só tem `register(app)`. |
| `processInputStream` — modificar input chunk a chunk | P3 | DEFERRED | Transformar input em streaming antes de chegar ao modelo. Adiar até ter demanda. |
| `processAPIError` — interceptar erros de API do LLM | P2 | TODO | Sem hook para capturar erros de API (rate limit, timeout) e aplicar retry/fallback customizado. |

---

## A2A — Agent-to-Agent (protocolo cross-network)

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| Protocolo A2A open-standard | P2 | TODO | Mastra implementa o Google A2A protocol — agentes em redes diferentes delegam uns aos outros via HTTP, com agent cards padronizados em `/.well-known/<name>/agent-card.json`. TheoKit não tem equivalente. `defineSubAgent` é in-process; não há cross-network delegation. |
| Agent cards (descoberta de capacidades) | P2 | TODO | Expor capacidades de um agente TheoKit via endpoint padronizado para consumo por outros sistemas. |
| `A2AAgent` client | P2 | TODO | Chamar um agente remoto como se fosse local. Mastra: `new A2AAgent({ url, headers })`. |

---

## Channels (plataformas de mensagem)

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| Adaptadores de canal (Slack, Discord, Telegram) | P3 | DEFERRED | Mastra tem adaptadores para plataformas de mensagem com webhook routes auto-geradas. TheoKit não tem. Gateway package (`@theokit/gateway-telegram`) existe no SDK mas não está integrado ao framework TheoKit. Adiar — não é core do "app que o agente mora". |
| Webhook routes auto-geradas por plataforma | P3 | DEFERRED | `/api/agents/{id}/channels/{platform}/webhook` com validação de assinatura. Adiar até channels serem core. |

---

## Code mode (sandbox de execução)

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| Sandbox de execução de código (`createCodeMode`) | P3 | DEFERRED | Mastra tem `createCodeMode({ tools, sandbox })` para agentes que compõem ferramentas em código executado em sandbox. TheoKit não tem. Caso de uso: coding agents que geram e executam código. `createShellTool` do `@theokit/sdk-tools` é o workaround mais próximo, mas sem sandbox de segurança. |

---

## MCP

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| `MCPServer` — expor agentes TheoKit como servidor MCP | P2 | TODO | Mastra tem `MCPServer` que expõe agentes e tools via protocolo MCP para clientes externos. TheoKit não tem. Workaround: expor uma rota HTTP que o cliente MCP conecta com `type: 'http'`. |
| Dynamic toolsets por request (`listToolsets()`) | P2 | TODO | Mastra permite credenciais MCP diferentes por request — útil em apps multi-tenant onde cada usuário tem sua própria API key. TheoKit configura servidores MCP uma vez no startup do agente, sem variação por request. |
| Integrações com registries MCP | P3 | DEFERRED | Mastra tem integrações pré-prontas com Klavis AI, mcp.run, Composio.dev, Smithery.ai, Apify, Ampersand. TheoKit não tem — o usuário instala servidores MCP manualmente. Adiar até haver demanda. |
| MCP Apps (UIs iframe em MCP tools) | P3 | DEFERRED | Mastra tem `appResources` no `MCPServer` que renderiza UIs HTML em iframes sandboxed no Mastra Studio. Caso de uso muito específico do ecossistema Mastra Studio. Fora de escopo para TheoKit. |
| `requireToolApproval` propagado via MCP | P3 | DEFERRED | Mastra propaga o mecanismo de aprovação de tools pelo protocolo MCP (hosts que suportam sampling). TheoKit não tem integração de aprovação pelo protocolo MCP. Adiar. |

---

## ACP — Agent Communication Protocol

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| `AcpAgent` — wrapper para coding agents via stdio JSON | P2 | TODO | Mastra tem `AcpAgent` + `createACPTool()` para rodar coding agents (Claude Code, Amp, OpenAI Codex) como ferramentas de um agente supervisor. Comunicação via stdio newline-delimited JSON. Config: `command`, `args`, `cwd`, `model`, `persistSession`, `onPermissionRequest`, `workspace`. TheoKit não tem equivalente. |
| Permission request handler para coding agents | P2 | TODO | `onPermissionRequest` callback que o supervisor usa para aprovar/rejeitar ações do coding agent (criar arquivo, executar comando, etc.). Relacionado ao gap de HITL mas para o caso de agentes de código. |

---

## SDK Agents (wrappers de SDKs de terceiros)

| Gap | Severidade | Disposição | Notas |
|---|---|---|---|
| Wrappers para Claude Agent SDK, OpenAI Agents SDK, Cursor SDK | P3 | DEFERRED | Mastra tem `@mastra/claude`, `@mastra/cursor`, `@mastra/openai` — wrappers que expõem agentes de terceiros via interface unificada. `resumeGenerate()`/`resumeStream()` com IDs de sessão de cada vendor (Claude: `sessionId`, OpenAI: `previousResponseId`, Cursor: `agentId`). TheoKit não tem wrappers — o `@theokit/sdk` é o runtime próprio. Adiar — não é core da proposta TheoKit. |

---

## Docs escritos

| Doc | Status | Diferencial TheoKit |
|---|---|---|
| `docs/agents/overview.md` | ✅ | Diagrama do pipeline + decisão agente vs action vs route |
| `docs/agents/using-tools.md` | ✅ | `@theokit/sdk-tools` pré-prontos, `ctx.context` (M7), decorator `@Tool` |
| `docs/agents/skills.md` | ✅ | SKILL.md filesystem-based, `discoverSkills` + `buildSkillsBlock` públicos, `agent.skills.list()` |
| `docs/agents/memory.md` | ✅ | `ConversationStorageAdapter`, `MemorySettings` + dreaming sweep, semantic index |
| `docs/agents/multi-agent.md` | ✅ | `defineSubAgent` + `createSquad`, tool scope restriction, delegation depth |
| `docs/agents/structured-output.md` | ✅ | `Agent.generateObject` + `Agent.streamObject`, synthetic `output` tool approach |
| `docs/agents/human-in-the-loop.md` | ✅ | `@HumanInTheLoop` decorator, `approval_required` SSE, `Workflow.suspend()`/`resume()` |
| `docs/agents/mcp.md` | ✅ | `@MCP` decorator, `McpStdioServerConfig` (envPolicy seguro), `McpHttpServerConfig` + OAuth 2.1 PKCE |

---

## Auditoria Mastra — cobertura completa

Todas as 16 páginas do espaço de agents + MCP da documentação Mastra foram auditadas:

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
| `agents/guardrails` | Backlog P1 — sem equivalente | ✅ auditado |
| `agents/processors` | Backlog P2 — sem equivalente | ✅ auditado |
| `agents/a2a` | Backlog P2 — sem equivalente | ✅ auditado |
| `agents/channels` | Backlog P3 DEFERRED | ✅ auditado |
| `agents/code-mode` | Backlog P3 DEFERRED | ✅ auditado |
| `agents/acp` | Backlog P2 — sem equivalente | ✅ auditado |
| `agents/sdk-agents` | Backlog P3 DEFERRED | ✅ auditado |
| `agents/streaming` | Página não existe (404) — streaming coberto inline em `overview.md` | ✅ |
| `agents/dynamic-agents` | Página não existe (404) — não há feature dedicada no Mastra | ✅ |

### Páginas auditadas (mcp/)

| Página Mastra | Doc TheoKit gerado | Status |
|---|---|---|
| `mcp/overview` | `docs/agents/mcp.md` | ✅ |
| `mcp/mcp-apps` | Backlog P3 DEFERRED | ✅ auditado |

**TUDO MAPEADO. Auditoria Mastra × TheoKit concluída.**
