---
paths:
  - "packages/**/*.ts"
---

# SDK Runtime Rule (INQUEBRÁVEL)

## A Regra

**`@theokit/sdk` é o ÚNICO runtime de execução de agentes.** Nenhum código no monorepo TheoKit pode:

1. Chamar APIs de LLM diretamente (OpenRouter, OpenAI, Anthropic, Ollama) via `fetch()` ou HTTP client
2. Reimplementar tool calling loop (o SDK já faz)
3. Reimplementar session/conversation storage (o SDK já faz)
4. Reimplementar budget/cost tracking (o SDK já faz)
5. Reimplementar streaming de agent responses (o SDK já faz via `Run.stream()`)

## O que é permitido

- `@theokit/agents` decorators (`@Agent`, `@Tool`, `@MainLoop`) são **metadata** — eles descrevem, não executam
- `packages/agents/src/bridge/agent-compiler.ts` **compila** decorators em formato que o SDK aceita
- O **adapter** entre decorators e SDK é o único código de "ponte" permitido
- Testes com `createMockAgentStream()` são permitidos (não chamam LLM real)

## O que deve ser migrado

- `packages/agents/src/bridge/llm-runner.ts` — chama OpenRouter API diretamente → substituir por `Agent.create()` + `Run.stream()` do SDK
- `fixtures/demo-faang/server/llm-agent-runner.ts` — mesma reimplementação → substituir

## Por que esta regra existe

Reimplementar o SDK dentro do TheoKit é:
- **DRY violation** — mesma lógica em dois repos
- **Bug surface 2x** — fix no SDK não propaga para TheoKit
- **Provider lock-in** — `llm-runner.ts` só suporta OpenRouter; SDK suporta 4+ providers
- **Feature gap** — SDK tem retry, rate limiting, provider fallback; TheoKit não
- **Incoerência** — CLAUDE.md diz "SDK é a runtime" mas o código diz o contrário

## Enforcement

- Code review: qualquer `fetch()` para URLs de LLM API é BLOCKER
- Grep guard: `grep -rn "openrouter.ai\|api.openai.com\|api.anthropic.com" packages/ --include="*.ts"` deve retornar ZERO resultados (exceto em testes/mocks)
- Todo novo agent feature vai para `@theokit/sdk`, não para `packages/agents/`

## Exceção temporária

`llm-runner.ts` existe como exceção documentada até a migração ser completada (plan `sdk-integration`). Após a migração, este arquivo DEVE ser deletado.

## Carve-out — runtime vs. home (ADR-0040, owner sign-off 2026-07-07)

A regra "SDK é o único runtime" continua **inteira** para o que é runtime: loop LLM,
chamadas de provider, tool-dispatch, engine de storage de conversa, streaming. ADR-0040
esclarece que **não é reimplementação de runtime** — e portanto É permitido em framework
core sob pacotes existentes — o que toca o **boundary/home**: guards no boundary HTTP/stream,
scoping `{resource,thread}` de request→conversa, hooks de observabilidade de delegação,
exposição HTTP (agent cards, rotas MCP-over-HTTP) e human gates. Esses reusam primitivas do
SDK, nunca as reimplementam. Features cujo núcleo É runtime (compression de histórico,
transporte stdio de MCP, subprocess de coding-agent) vão para `../theokit-sdk` (publish
train), não para `packages/`. A linha "todo novo agent feature vai para o SDK" (acima) é
refinada por esta: **runtime → SDK; home/boundary → core**. Ver ADR-0040 § D2.
