# Edge Case Review — tool-name-single-source (plano de implementação)

Date: 2026-07-24
Plan analyzed: `knowledge-base/plans/tool-name-single-source-plan.md`
Tasks analyzed: 7 (T0.1, T1.1, T1.2, T2.1, T3.1, T3.2, T3.3)
Edge cases found: 10 (MUST FIX: 4, SHOULD TEST: 4, DOCUMENT: 2)

Todas as fronteiras foram sondadas **empiricamente** (composição executada em node contra o charset real), não inferidas. Cobertura das duas lentes por fronteira: *edge* (maior/menor válido) **e** *negative* (primeiro inválido depois dele).

## MUST FIX

### EC-1: nome de tool VAZIO com namespace passa em tudo — inclusive no SDK
- **Affected task:** T1.1
- **Family:** Negative case
- **Scenario:** `{ name: '', method: 'deploy' }` num toolbox com `namespace: 'ops'`. A composição produz `"ops_"`, que **casa o charset** (medido: `charset=true`, len=4), não é vazio e não é reservado. Nossa validação aceita, e o `Agent.create` **também** aceita — a tool chega ao LLM chamada `ops_`.
- **Impact:** a validação inteira do T1.1 tem um buraco exatamente no caso que ela existe para pegar: um nome sem sentido chega ao provider. Sem namespace o caso é pego por acidente (`''` falha o charset); **com** namespace, não.
- **Suggested fix:** validar `toolName` (a parte, antes de compor) como não-vazio, além do resultado composto — uma guarda a mais em `toolRuntimeName`.

### EC-2: composição estourando 64 chars com ambas as partes válidas
- **Affected task:** T1.1
- **Family:** Edge case
- **Scenario:** namespace de 60 chars válidos + tool `deploy` → 67 chars (medido: `charset=false`). Cada parte é individualmente legítima; só a **soma** viola.
- **Impact:** a mensagem genérica de charset ("deve casar /regex/") faria o autor procurar um caractere inválido que não existe. É a mesma patologia do comentário mentiroso do T3.1, na camada de erro.
- **Suggested fix:** quando o comprimento for a única regra violada, a mensagem deve dizer que a **composição** `namespace + '_' + tool` estourou 64, citando o comprimento obtido.

### EC-3: `draft.hitl` não pode passar a existir vazio
- **Affected task:** T2.1
- **Family:** Regression / observable behavior
- **Scenario:** a implementação ingênua de T2.1 faria `draft.hitl ??= new Map()` antes de checar se `compileHitlGates` devolveu vazio. Hoje o código retorna **antes** de criar o Map (`toolbox.ts:147`), então um toolbox sem tools gated deixa `draft.hitl` como `undefined`.
- **Impact:** `agent-compiler.ts:105` declara que "Empty map ⇒ no gated tools ⇒ the non-HITL stream path (M2, byte-unchanged)". Criar um Map vazio pode virar a branch e mudar o caminho de stream de **todo** agente sem HITL — regressão silenciosa e larga, exatamente o oposto de zero-behavior.
- **Suggested fix:** manter o early-return: `const gates = compileHitlGates([walk]); if (gates.size === 0) return` **antes** de qualquer `??=`.

### EC-4: a regra reservada tem de ser aplicada ao nome COMPOSTO, nunca às partes
- **Affected task:** T1.1
- **Family:** Negative case / fidelity of the mirror
- **Scenario:** `namespace: 'x'` + tool `shell` compõe `x_shell` (medido: charset ok). O SDK só rejeita match **exato** contra `{shell, memory_search, memory_get}`, então `x_shell` é legítimo. Uma implementação que checasse as partes rejeitaria um agente válido.
- **Impact:** ser **mais estrito** que o SDK é tão errado quanto ser mais frouxo — quebra autoria legítima e, pior, torna a nossa cópia uma regra inventada, contradizendo o ADR D1 ("espelhar", não "interpretar").
- **Suggested fix:** aplicar `SDK_RESERVED_TOOL_NAMES.has(name) || name.startsWith('mcp_')` **sobre o nome composto**, e cobrir `x_shell` como caso POSITIVO (deve passar).

## SHOULD TEST

### EC-5: fronteira do prefixo `mcp_`
- **Affected task:** T1.1
- **Suggested test:** `namespace: 'mcpx'` compõe `mcpx_deploy`, que **não** começa com `mcp_` (medido) e deve **passar**. Par com `namespace: 'mcp'` → `mcp_deploy` que deve **falhar**. Sem o par, um `startsWith('mcp')` sem underscore passaria despercebido.

### EC-6: tool com prefixo reservado sem namespace
- **Affected task:** T1.1
- **Suggested test:** `{ name: 'mcp_foo' }` sem namespace compõe `mcp_foo` — reservado, deve falhar. Prova que a regra é do nome final e não "do namespace".

### EC-7: mutação parcial do draft quando uma tool é inválida
- **Affected task:** T1.1, T2.1
- **Suggested test:** toolbox com 2 tools, a 2ª inválida. Como o construtor valida **todas** as declarações antes, o objeto nem chega a existir — asserção: `expect(() => new ToolboxCapability(...)).toThrow()` **e** um `draft` reutilizado permanece sem `tools`/`hitl` adicionados. Sem esse teste, mover a validação para a mintagem poderia (numa refatoração futura) empurrar a falha para o `apply`, deixando o draft meio populado.

### EC-8: remoção de `src/metadata/*` e de `ceilingRoundFactory` sem consumidor oculto
- **Affected task:** T3.2
- **Suggested test:** antes de cada remoção, `grep -rn "<símbolo|caminho>" packages/ --include=*.ts` incluindo `tests/`. Se o único consumidor for um teste, o teste vai junto (teste de símbolo morto é dívida, não cobertura). O knip **ignora `**/tests/**`** por config, então ele não enxerga esse consumidor — o grep é o complemento obrigatório, não redundância.

## DOCUMENT

### EC-9: `#walk()` é chamado duas vezes por instância (`compile()` público + `apply()`)
- **Accepted risk:** os dois walks são objetos distintos mas estruturalmente idênticos, derivados de estado imutável (`#declarations`, `#namespace`, `#instance` são readonly). Nenhum consumidor compara por identidade. Memoizar seria otimização sem problema medido (KISS/YAGNI); a propriedade que importa — `apply` usar **um** walk para os dois compiladores — é o que T2.1 garante.

### EC-10: `instanceof ConfigurationError` através da reexportação
- **Accepted risk:** sob ESM, `src/errors.ts` é instanciado uma vez e a reexportação em `capabilities.ts` referencia o **mesmo** objeto de classe, então `instanceof` continua verdadeiro por qualquer caminho de import. Risco real seria duplicação de módulo por bundler com dupla resolução (CJS+ESM) — não aplicável: o pacote é ESM e a suíte roda direto do source.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|---|---|---|---|---|
| T0.1 | 1 | 0 | 0 | 1 (EC-10) |
| T1.1 | 6 | 3 (EC-1, EC-2, EC-4) | 3 (EC-5, EC-6, EC-7) | 0 |
| T1.2 | 0 | 0 | 0 | 0 |
| T2.1 | 3 | 1 (EC-3) | 1 (EC-7) | 1 (EC-9) |
| T3.1 | 0 | 0 | 0 | 0 |
| T3.2 | 1 | 0 | 1 (EC-8) | 0 |
| T3.3 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT — 4 MUST FIX a absorver antes de `/implement`. Nenhum deles exige nova tarefa: EC-1/EC-2/EC-4 são guardas e mensagens dentro de T1.1, EC-3 é uma linha de ordem em T2.1.
