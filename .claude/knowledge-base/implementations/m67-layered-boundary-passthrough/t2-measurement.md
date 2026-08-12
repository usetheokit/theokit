# T2 — Medir o salto de nove minors

**Data:** 2026-08-12 · **Log íntegro:** `t2-full-suite.log` · **SDK resolvido:** 4.51.1 (range `^4.49.0`)

## Resultado

```
Test Files  12 failed | 545 passed | 2 skipped (559)
Tests       16 failed | 4149 passed | 14 skipped (4179)
Type Errors no errors
Duration    609s
```

**Zero erros de tipo** é o dado mais forte a favor do bump: nove minors aditivas atravessaram o
typecheck do monorepo inteiro sem uma única incompatibilidade de assinatura.

## Classificação dos 16 vermelhos (EC-6 — nada silenciado)

O método: **meu diff toca exclusivamente** sete strings de versão de `@theokit/sdk` em cinco
manifests, o `pnpm-lock.yaml`, e dois arquivos de `.claude/skills/code-quality/`. Um teste que não lê
nenhum desses arquivos, e cujo caminho de runtime não passa pelo SDK, não pode ter sido quebrado por
ele. Onde a inspeção não bastou, segui até a origem do erro.

### Causado por este milestone — 1

| Teste | Arquivo | Diagnóstico |
|---|---|---|
| `includes @theokit/sdk in dependencies (npm registry ^2.x)` | `tests/unit/fixture-template-default-canonical-chat.test.ts:103` | Eu bumpei `fixtures/template-default` de `^2.30.0` para `^4.49.0`; o guarda exige `/^\^2\./` |

**Correção de uma afirmação minha.** No log de T1 escrevi que o pin `^2.30.0` da fixture era
"apodrecimento, não intenção". Estava errado: existe um teste que o pina explicitamente. A suposição
era minha e o ciclo a pegou — que é para isso que ele serve.

O que a evidência mostra, agora que olhei: **os dois lados estão obsoletos, em direções opostas.** O
template canônico (`packages/create-theokit/templates/default/package.json.tmpl`) pina `^4.50.0`. A
fixture, que existe para espelhar a saída desse template, pina `^2.30.0` — e o guarda a congela lá. O
guarda irmão (`create-theo-default-template.test.ts:83`, exigindo `^2.13`–`^2.99` do template) **já
estava vermelho** pelo mesmo motivo, na direção contrária.

Tratamento em T2.1 (abaixo).

### Pré-existentes — 15

| # | Teste | Evidência de que é anterior |
|---|---|---|
| 1 | `test_ui_peer_accepts_0_18` | Lê `peerDependencies['@theokit/ui']` = `^1.1.0`; meu diff em `packages/theo/package.json` toca só linhas de `@theokit/sdk` |
| 2 | `test_ui_peer_accepts_0_19` | idem |
| 3 | `test_ui_peer_still_accepts_0_14` | idem |
| 4 | `should declare a caret OR-range for @theokit/ui …` | idem (`package-json-peerdep-usetheo-ui.test.ts`) |
| 5 | `package.json.tmpl pins @theokit/sdk at the 2.13+ floor` | Lê o `.tmpl`, que pina `^4.50.0` e **não** foi tocado por mim |
| 6 | `test_sdk_tools_peer_is_closed_caret` | Espera `peerDependencies['@theokit/sdk-tools']` em `packages/agents`; o pacote declara sdk-tools em `dependencies`. O guarda espera um peer que não existe |
| 7 | `yields an IDENTICAL handler-dispatch sequence through both paths` | O teste faz `vi.mock('@theokit/agents')` (linha 20) — o barrel inteiro é substituído, o SDK real nunca é carregado. `AgentDefinitionError` vem do nosso loader contra o mock |
| 8 | `test_surfaces_error_chunk_then_terminates` | `consume-ui-message-stream.ts` importa `@theokit/presenter/wire`; `read-message-stream.ts:46` **lança** `WireStreamError` em chunk de erro enquanto o teste espera terminação limpa. Fonte do presenter inalterada — contradição anterior entre a implementação e a expectativa |
| 9 | `test_harness_calls_no_llm_provider_api` | `ENOENT` em `packages/agents/src/bridge/ui-message-stream-translator.ts` — arquivo que o teste procura e não existe. Não criei nem removi arquivo ali |
| 10 | `test_harness_issues_no_fetch_of_its_own` | mesmo `ENOENT`, mesmo arquivo |
| 11 | `"AgentEvent" e "useAgentStream" ausentes de packages src` | Hits em `packages/create-theokit/src/scaffold-surface.ts:63`, arquivo não tocado |
| 12 | `has no orphan rows` | Linha de índice `onda1-hello-theo` sem diretório correspondente em `fixtures/` |
| 13 | `lists every subdirectory as a table row` | mesmo índice de fixtures |
| 14 | `test_no_forgotten_task_marker_in_the_layers_source` | **Um** marcador, em `tests/lint/no-ptbr.test.ts:94` — falso positivo auto-referencial (o teste que proíbe marcadores contém um). A primeira versão desta linha dizia "3 marcadores na fonte de `packages/agents`": conclusão certa, evidência errada, corrigida após o `/review` medir |
| 15 | `test_check_naming_passes_today` | **Timeout de 30 s**, não asserção — o `ls-lint` levou 112 s numa execução anterior. Falha de infraestrutura/limite, não de conteúdo |

Nenhum foi silenciado. **Correção (pós-`/review`):** a primeira versão deste parágrafo dizia que os 15
estavam "registrados como tasks abertas". Estavam apenas na lista de tarefas da sessão, que não é um
artefato do repositório — o `/review` apontou que isso converte "pré-existente" de classificação em
desculpa permanente, porque o próximo milestone repete a frase e ninguém nunca os conserta. O registro
durável está em `.claude/knowledge-base/backlog.md` § B-M67-01, com diagnóstico e ação por item.

## T2.1 — Tratamento do único vermelho que é meu

Duas saídas possíveis:

**(a) Reverter o bump da fixture.** O vermelho some. Mas a fixture volta a manter viva uma cópia do
SDK major 2 no workspace, contra o invariante de cópia única do ADR 0060 — e volta a "testar" uma
combinação impossível: SDK 2.x com `theokit` e `@theokit/agents` do workspace, cujo piso é 4.49.

**(b) Manter o bump e corrigir o guarda.** Escolhida. Mas **não** movendo o literal de `^2.` para
`^4.` — isso apenas empurra o apodrecimento uma casa adiante e garante o mesmo vermelho no próximo
bump. O guarda passa a afirmar **coerência entre a fixture e o template canônico**, que é a
propriedade que ele sempre quis expressar: uma fixture que espelha a saída do template não pode
divergir dela.

O guarda irmão do template (`^2.13`–`^2.99`) sofre do mesmo mal e **já estava vermelho**. Ele fica
como task, não como conserto oportunista — a regra vale também quando o conserto é tentador.
