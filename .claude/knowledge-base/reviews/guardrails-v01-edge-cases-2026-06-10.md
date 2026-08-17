# Edge Case Review — guardrails-v01

Data: 2026-06-10
Plano: knowledge-base/plans/guardrails-v01-plan.md
Tasks analisadas: 6 (T1.1, T1.2, T2.1, T3.1, T3.2, T3.3)
Edge cases encontrados: 8 (MUST FIX: 2, SHOULD TEST: 4, DOCUMENT: 2)

## MUST FIX

### EC-1: T3.1 — Credential masking regex collision entre rules com overlap
- **Task afetada:** T3.1
- **Familia:** Input
- **Cenario:** Um OpenAI key (`sk-proj-abc123...`) casa com AMBOS `openai-key` e `anthropic-key` regex se o pattern do anthropic-key for muito broad (`sk-.*`). O plano lista 11 rules mas não especifica a ORDEM de aplicação nem como evitar que uma rule mais genérica engula um match de uma mais específica.
- **Impacto:** Masking aplica o fake errado (fake de Anthropic para uma key OpenAI), e o restore map fica inconsistente. O modelo recebe um fake com prefixo `sk-ant-` para uma key que era `sk-proj-`.
- **Fix sugerido:** Adicionar no Deep Dives de T3.1: "BUILTIN_RULES MUST be ordered from most-specific to least-specific (per OpenGuardrails `masking.ts:57-59` ordering rationale). Add test: `test_masks_openaiKey_notMatchedByAnthropicRule`."

### EC-2: T2.1 — Pipeline modify-chain muta o contexto original do caller
- **Task afetada:** T2.1
- **Familia:** State
- **Cenario:** O plano diz "if result.action === 'modify', update ctx.content with result.modified for next guardrail". Se `ctx` é passado por referência e o pipeline muta `ctx.content` in-place, o caller que manteve referência ao `ctx` original vê o content modificado — side effect inesperado. O caller pode querer o content original para logging ou retry.
- **Impacto:** O caller perde acesso ao content original após pipeline.run(). Dificulta logging "before guardrails" vs "after guardrails".
- **Fix sugerido:** Pipeline deve clonar o ctx antes de modificar: `const workingCtx = { ...ctx }` no início de `run()`. Nunca mutar o objeto recebido. Add test: `test_pipeline_doesNotMutateOriginalContext`.

## SHOULD TEST

### EC-3: T3.1 — Credential com multiple occurrences do mesmo tipo
- **Task afetada:** T3.1
- **Teste sugerido:** `test_masks_twoDistinctOpenaiKeys_getDifferentFakes` — Quando o texto contém duas OpenAI keys distintas (`sk-proj-AAA...` e `sk-proj-BBB...`), cada uma deve receber um fake diferente (per OpenGuardrails `masking.ts:479`: `fake_N` suffix). Sem isso, restore confunde qual fake mapeia para qual real.

### EC-4: T3.2 — Shell-pattern false positive em code blocks/documentation
- **Task afetada:** T3.2
- **Teste sugerido:** `test_allows_rmRfInMarkdownCodeBlock` — O texto `"Here's how to clean up: \`rm -rf ./build\`"` é documentation legítima, não um ataque. O guardrail deve (idealmente) não bloquear commands em code fences. Se isso for too complex para v0.1, documentar como limitação conhecida e add test que verifica o comportamento atual (block tudo, mesmo em code blocks).

### EC-5: T3.3 — PII regex false positive em credit card patterns
- **Task afetada:** T3.3
- **Teste sugerido:** `test_allows_randomLargeNumber_notCreditCard` — Sequências como `1234567890123456` (16 digits) que NÃO passam Luhn check não devem ser flagged. O plano menciona "Luhn-valid" mas não tem um teste explícito para Luhn rejection. Add: `test_rejects_invalidLuhnNumber`.

### EC-6: T2.1 — Pipeline com guardrail que retorna 'modify' mas modified é undefined
- **Task afetada:** T2.1
- **Teste sugerido:** `test_pipeline_modifyWithoutModifiedField_treatedAsAllow` — Se um guardrail retorna `{ action: 'modify', modified: undefined }`, o pipeline deve tratar como allow (não crashear tentando `ctx.content = undefined`). Runtime guard: `if (result.action === 'modify' && result.modified != null)`.

## DOCUMENT

### EC-7: T3.2 — Shell-pattern não detecta obfuscated commands
- **Risco aceito:** Atacantes podem obfuscar (`r$()m -rf /`, `\rm -rf /`, base64-encoded commands). Regex-based detection é inherently bypassable. Isso é uma limitação conhecida de TODOS os projetos regex-based (OpenGuardrails documenta isso explicitamente). LLM-based detection (LlamaFirewall CodeShield) é necessário para catch obfuscation — deferido para v0.2. Adicionar nota no README: "Shell-pattern detection covers common dangerous patterns but does not prevent obfuscated commands. For production-critical safety, combine with LLM-based guardrails."

### EC-8: Unresolved Q2 — GuardrailContext.content como string ignora structured data
- **Risco aceito:** Tool arguments são JSON objects, não strings. Um guardrail que recebe `content: JSON.stringify(toolArgs)` perde a estrutura e faz regex matching em JSON serializado — propenso a false positives (e.g., um JSON key chamado "email" matchando o PII regex). A decisão de usar `string` é pragmática para v0.1 (regex opera em strings). v0.2 pode introduzir `content: string | unknown` com type narrowing. Documentar no README como limitação.

## Padrões Sistêmicos Detectados

| Padrão | Encontrado? | Onde |
|--------|-------------|------|
| Implemented but not wired | Sim — por design | Package standalone, SDK hooks são plano separado. Documentado no plano. |
| Correct code in wrong place | Não | — |
| State mutation side effect | Sim | EC-2 (pipeline modify-chain muta ctx) |

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 |
| T1.2 | 0 | 0 | 0 | 0 |
| T2.1 | 2 | 1 (EC-2) | 1 (EC-6) | 0 |
| T3.1 | 2 | 1 (EC-1) | 1 (EC-3) | 0 |
| T3.2 | 2 | 0 | 1 (EC-4) | 1 (EC-7) |
| T3.3 | 1 | 0 | 1 (EC-5) | 0 |
| Global | 1 | 0 | 0 | 1 (EC-8) |

**Veredicto:** PLANO PRECISA DE AJUSTE (2 MUST FIX)

Os 2 MUST FIX são cirúrgicos:
1. EC-1: Ordenação específica→genérica dos BUILTIN_RULES + teste de non-collision
2. EC-2: Clone do ctx no pipeline runner + teste de non-mutation
