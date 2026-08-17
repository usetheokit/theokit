# Discover Edge Case Review — guardrails-module

Data: 2026-06-10
Discovery plan analisado: .claude/knowledge-base/discoveries/plans/guardrails-module-plan.md
Research questions analisadas: 8
Edge cases encontrados: 7 (MUST FIX: 2, SHOULD TEST: 3, DOCUMENT: 2)

## MUST FIX

### EC-1: Q8 cita path relativo do SDK que pode confundir o halt-loop
- **Question afetada:** Q8
- **Familia:** Reference path
- **Cenario:** Q8 cita `theokit-sdk/packages/sdk/src/` como path relativo, mas o SDK vive em `/home/paulo/Projetos/usetheo/theokit-tools/theokit-sdk/packages/sdk/src/` — fora da arvore `.claude/knowledge-base/references/`. O halt-loop checkpoint "`.claude/knowledge-base/references/{project}/{path}` cited in Fase A exists" nao vai encontrar o SDK porque ele NAO esta em references/.
- **Impacto:** Halt-loop marca Q8 BLOCKED erroneamente por "path not found" quando o SDK existe no workspace.
- **Fix sugerido:** Adicionar checkpoint especifico para Q8 que verifica o path absoluto `theokit-sdk/packages/sdk/src/internal/agent-loop/tool-dispatch.ts` (ja verificado — existe). Separar o checkpoint de Q8 do checkpoint generico Q1-Q7.

### EC-2: Q6 (testes) — NeMo testes NAO estao em `nemoguardrails/guardrails/` mas em `tests/guardrails/`
- **Question afetada:** Q6
- **Familia:** Reference path
- **Cenario:** O plano diz "Glob `*test*` e `*spec*` em ambos os projetos; Grep `describe|test|def test_` nos diretories de guardrails/risk". Os testes do NeMo nao estao em `nemoguardrails/guardrails/` — estao em `tests/guardrails/` (e.g., `tests/guardrails/test_content_safety_iorails_actions.py`). A Fase A vai retornar vazio se buscar no diretorio errado.
- **Impacto:** Q6 fica BLOCKED para NeMo sem necessidade — os testes existem, so estao em outro path.
- **Fix sugerido:** Alterar Fase A de Q6 para incluir `tests/guardrails/` do NeMo alem de `nemoguardrails/guardrails/`. Path verificado: `.claude/knowledge-base/references/nemo-guardrails/tests/guardrails/test_content_safety_iorails_actions.py` existe.

## SHOULD TEST

### EC-3: Q6 (testes) — OpenGuardrails tem testes de risk detector em path inesperado
- **Question afetada:** Q6
- **Familia:** Reference path
- **Cenario:** OpenGuardrails tem testes de masking em `src/daemon/proxy/credential-mask.test.ts` e de prompt injection em `src/daemon/risk/prompt-injection.test.ts`, mas NAO tem testes unitarios dedicados para `shell-pattern.ts` ou `secret-leak.ts` (no `risk/` dir, so `prompt-injection.test.ts` existe). A Fase A pode encontrar menos testes do que esperado para a survey de test strategy.
- **Halt-loop checkpoint sugerido:** Antes de declarar Q6 respondida, verificar que ao menos 2 test files foram lidos por projeto. Se < 2, expandir busca para `**/*.test.ts` no projeto inteiro.

### EC-4: Q3 depende implicitamente de Q1 e Q2
- **Question afetada:** Q3
- **Familia:** Dependency
- **Cenario:** Q3 pede comparacao side-by-side da interface `RailAction` (NeMo) vs `RiskTagger` (OpenGuardrails). Para fazer uma comparacao justa, o investigador precisa ter entendido o pipeline de cada um (Q1 para NeMo, Q2 para OpenGuardrails). Se o halt-loop responder Q3 antes de Q1/Q2, a comparacao sera superficial.
- **Halt-loop checkpoint sugerido:** Adicionar dependencia explicita: "Q3 requires Q1 and Q2 answered first" no halt-loop checkpoints.

### EC-5: LlamaFirewall paper via WebFetch pode ter conteudo truncado
- **Question afetada:** Q1-Q3 (indiretamente — paper e usado para taxonomia comparativa)
- **Familia:** Method
- **Cenario:** WebFetch de PDFs do arxiv pode retornar conteudo parcial ou mal-formatado. O paper de 2505.03574 foi acessado com sucesso na sessao atual (titulo + abstract + 3 core guardrails), mas durante `/discover-execute` em outra sessao, o fetch pode falhar ou truncar.
- **Halt-loop checkpoint sugerido:** Se WebFetch do paper falhar, usar o resumo ja capturado nesta sessao como fallback (LlamaFirewall = PromptGuard 2 + Agent Alignment Checks + CodeShield). Adicionar nota no plano.

## DOCUMENT

### EC-6: NeMo e Python-only — patterns podem nao traduzir diretamente para TypeScript
- **Question afetada:** Q1, Q3, Q4
- **Risco aceito:** NeMo usa `async def`, `asyncio.wait`, `FIRST_COMPLETED` para parallel execution e class-based template method com heranca Python. TypeScript usa `Promise.race`, interfaces, e nao tem heranca de template method idiomatica — usa composicao. A traducao de patterns nao e 1:1. O blueprint precisa adaptar, nao copiar. Isso e esperado e nao requer mudanca no plano — D3 ja foca em PATTERN vs CATALOGO.

### EC-7: OpenGuardrails agentfw e wire-proxy, nao SDK middleware — paradigma diferente
- **Question afetada:** Q2, Q5
- **Risco aceito:** OpenGuardrails intercepta no nivel de rede (HTTP proxy entre agente e LLM), enquanto o ecossistema Theo precisa de interceptacao no nivel de SDK (in-process, antes/depois de `Agent.send()`). Os patterns de detector-as-pure-function e credential masking sao portateis, mas a arquitetura de composicao (proxy vs middleware) e fundamentalmente diferente. O blueprint deve explicitar essa diferenca e nao assumir que a integracao e identica. Nao requer mudanca no plano — D3 e D2 cobrem.

## Resumo

| Question | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------------|----------|-------------|----------|
| Q1 | 1 | 0 | 0 | 1 (EC-6) |
| Q2 | 1 | 0 | 0 | 1 (EC-7) |
| Q3 | 2 | 0 | 1 (EC-4) | 1 (EC-6) |
| Q4 | 1 | 0 | 0 | 1 (EC-6) |
| Q5 | 1 | 0 | 0 | 1 (EC-7) |
| Q6 | 2 | 1 (EC-2) | 1 (EC-3) | 0 |
| Q7 | 0 | 0 | 0 | 0 |
| Q8 | 1 | 1 (EC-1) | 0 | 0 |
| Global | 1 | 0 | 1 (EC-5) | 0 |

**Veredicto:** DISCOVERY PLAN PRECISA DE AJUSTE (2 MUST FIX)

Os 2 MUST FIX sao cirurgicos:
1. EC-1: Separar checkpoint de Q8 do generico (SDK nao vive em references/)
2. EC-2: Expandir Fase A de Q6 para incluir `tests/guardrails/` do NeMo

Ambos sao fixes de 1 linha no plano. Apos absorver, o plano esta pronto para `/discover-plan-confidence`.
