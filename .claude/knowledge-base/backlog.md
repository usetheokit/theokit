# Backlog — defeitos rastreados fora de um milestone

Artefato durável para achados que **não** pertencem ao escopo de quem os encontrou. Existe porque a
alternativa observada é pior: um defeito classificado como "pré-existente" dentro do log de
implementação de um milestone fica preso num audit trail sujeito a rotação
(`.claude/rules/audit-trail-rotation.md`), e o próximo milestone o classifica com a mesma frase. Duas
iterações disso e "pré-existente" deixou de ser classificação e virou desculpa permanente.

Este arquivo **nunca rotaciona**. Uma entrada sai daqui de três formas: corrigida (com o commit),
promovida a milestone do `ROADMAP-v3.md`, ou fechada com motivo escrito.

> **Nota sobre tracker.** O remote é `usetheodev/theokit`, mas o `gh` desta máquina não resolve o host
> (`github-usetheo` é um alias de SSH). Enquanto o `gh` não estiver autenticado contra ele, este
> arquivo é o tracker. Quando estiver, cada entrada vira issue e a linha ganha `#NNN`.

---

## B-M67-01 — 15 testes vermelhos na suíte da raiz, todos anteriores ao M67

**Encontrado em:** M67 (T2), 2026-08-12 · **Evidência:**
`.claude/knowledge-base/implementations/m67-layered-boundary-passthrough/t2-measurement.md` e
`t7-root-suite-after.log`

Medição: antes do M67 a suíte da raiz tinha **16** testes vermelhos; depois, **15**. A diferença é um
guarda que o M67 quebrou e consertou no mesmo ciclo. Cada um dos 15 foi atribuído individualmente —
não por amostragem — e nenhum é causado pelo milestone. A verificação de atribuição foi refeita de
forma independente pelo `/review` do M67, que confirmou os 15.

O que **não** foi feito, e é a razão desta entrada existir: consertá-los. Ficam aqui com dono.

| # | Teste | Arquivo | Diagnóstico | Ação proposta |
|---|---|---|---|---|
| 1–3 | `test_ui_peer_accepts_0_18`, `..._0_19`, `..._still_accepts_0_14` | `tests/unit/ui-peer-range.test.ts` | O peer `@theokit/ui` foi estreitado para `^1.1.0`, perdendo as alternativas OR. O docblock do teste diz que ele existe para pegar um estreitamento **de volta** para `^0.14.0`; o estreitamento veio na direção oposta e ele ficou vermelho por default | Decidir: o suporte a 0.14.x/0.18.x foi descontinuado (atualizar o teste com a justificativa) ou o peer regrediu (voltar a ser OR) |
| 4 | `should declare a caret OR-range for @theokit/ui …` | `tests/unit/package-json-peerdep-usetheo-ui.test.ts` | mesma causa | mesma decisão |
| 5 | `package.json.tmpl pins @theokit/sdk at the 2.13+ compaction floor` | `tests/unit/create-theo-default-template.test.ts:83` | O guarda exige `^2.13`–`^2.99`; o template já pina `^4.50.0`. **Irmão exato** do guarda da fixture que o M67 consertou, com a mesma correção disponível (afirmar coerência em vez de congelar literal) | Aplicar o mesmo padrão do M67: comparar contra a fonte de verdade, não contra um literal |
| 6 | `test_sdk_tools_peer_is_closed_caret` | `tests/integration/sdk-peer-ranges.test.ts:21` | Espera `@theokit/sdk-tools` em `peerDependencies` de `packages/agents`; o pacote o declara em `dependencies` | Decidir onde a dependência deve viver e alinhar guarda e manifest |
| 7 | `yields an IDENTICAL handler-dispatch sequence through both paths` | `tests/integration/agent-turn-in-process-parity.test.ts:20` | `vi.mock('@theokit/agents')` substitui o barrel inteiro e o mock não satisfaz o loader (`AgentDefinitionError`) | Atualizar o mock à forma que o loader exige, ou trocar o mock por um duplo tipado |
| 8 | `test_surfaces_error_chunk_then_terminates` | `tests/unit/consume-ui-message-stream.test.ts:70` | O teste espera terminação limpa em chunk de erro; `packages/presenter/src/wire/read-message-stream.ts:46` **lança** `WireStreamError`. Contradição real entre implementação e expectativa | **Relevante ao M70**, que é dono do seam do presenter. Decidir qual dos dois está certo |
| 9–10 | `test_harness_calls_no_llm_provider_api`, `test_harness_issues_no_fetch_of_its_own` | `tests/unit/harness-invariant-guard.test.ts` | `ENOENT` em `packages/agents/src/bridge/ui-message-stream-translator.ts` — o teste procura um arquivo que não existe | Repontar para o arquivo atual, ou remover o guarda se o invariante mudou de lugar |
| 11 | `"AgentEvent" e "useAgentStream" ausentes de packages src` | `tests/unit/clean-break-grep-gate.test.ts:48` | Hits em `packages/create-theokit/src/scaffold-surface.ts:63` — dentro de um **comentário** | Ajustar o grep para ignorar comentários, ou reescrever o comentário |
| 12–13 | `has no orphan rows`, `lists every subdirectory as a table row` | `tests/unit/fixtures-index.test.ts` | Linha de índice `onda1-hello-theo` sem diretório correspondente | Remover a linha órfã ou restaurar a fixture |
| 14 | `test_no_forgotten_task_marker_in_the_layers_source` | `tests/lint/task-marker.test.ts` | Marcador de dívida em `tests/lint/no-ptbr.test.ts:94` — **falso positivo auto-referencial** (o teste que proíbe marcadores contém um) | Excluir o próprio arquivo do escopo do grep |
| 15 | `test_check_naming_passes_today` | `tests/unit/architecture-guards-ci.test.ts` | **Timeout de 30 s**, não asserção — o `ls-lint` levou 112 s numa medição. Passou em outra execução | Elevar o timeout com justificativa, ou tornar o `ls-lint` incremental |

**Correção de rastreabilidade.** O log do T2 do M67 afirmava que estes 15 estavam "registrados como
tasks abertas". Estavam apenas na lista de tarefas da sessão, que não é um artefato do repositório —
apontado pelo `/review`. Esta entrada é o registro durável que a afirmação prometia.

---

## B-M67-02 — 4 advisories `high` pré-existentes na árvore de dependências

**Encontrado em:** M67 (`/deps-audit`), 2026-08-12 · **Evidência:**
`.claude/knowledge-base/audits/m67-layered-boundary-passthrough-deps-audit-2026-08-12.md`

Nenhum é dependência declarada do M67; nenhum bloqueou aquele milestone.

| Sev | Pacote | Vulnerável | Corrigido em | Nota |
|---|---|---|---|---|
| high | `react-router` | `>=7.12.0 <7.18.2` | `>=7.18.2` | **O mais urgente**: bypass de CSRF em modo RSC, exploração remota, e é dependência de aplicação |
| high | `postcss` | `<=8.5.17` | `>=8.5.18` | Path traversal em source map; entra por `vitest → vite`, toolchain de teste |
| high | `nanoid` ×2 | `<3.3.16`, `<3.3.17` | `>=3.3.17` | Loop infinito; mesma cadeia do `postcss` |

Bump de `vitest`/`vite` resolve os três últimos de uma vez; o `react-router` é separado.

---

## B-M67-03 — `@theokit/studio@0.1.0` declara peers obsoletos

**Encontrado em:** M67 (T1), 2026-08-12

Peer opcional de `theokit` (`packages/theo/package.json:136,162`). Declara
`@theokit/agents@^0.39.0` (o workspace tem **7.4.2** — sete majors de defasagem, e **já** não batia
antes do M67) e `@theokit/sdk@^3.8.0` (que era satisfeito pela cópia 3.8.0 arrastada pelo presenter; o
M67 removeu essa cópia e o mismatch ficou visível). Install continua funcionando — é peer opcional e o
pnpm apenas avisa.

Ação: republicar o `@theokit/studio` com peers alinhados, ou remover o peer se o acoplamento não
existe mais.

---

## B-M67-04 — Teste flaky em `subpath-coverage`

**Encontrado em:** M67, 2026-08-12

`packages/agents/tests/unit/subpath-coverage.test.ts::test_the_symbols_of_._CROSS_the_layer` falhou
por timeout de 5000 ms numa execução e passou nas seguintes **sem mudança de código entre elas**. Pela
`.claude/rules/testing.md § 3`, teste flaky é bug — corrigir ou remover, não conviver.

Causa provável: a fase de `collect` do vitest chegou a 81 s nesta máquina, e 5000 ms é apertado para um
teste que enumera o barrel inteiro. Fix candidato: mover a enumeração para um `beforeAll`
compartilhado, ou elevar o timeout deste teste com justificativa escrita.

---

## B-M67-05 — O SDK declara dois valores na barra root que não emite

**Encontrado em:** `/review` do M67, 2026-08-12

`@theokit/sdk@4.51.1` declara `isValidTaskId` (`declare function`) e `TASK_RESERVED_PREFIXES`
(`declare const`) na barra root do `.d.ts`, mas `grep -c isValidTaskId dist/index.js` devolve **0**.
São valores por declaração e `undefined` em runtime.

Consequência: um re-export futuro deles **compila** e explode no import. O gate ROOT-BAR do M67 é cego
a este caso — ele enumera `Object.keys` do namespace, que só vê o que é emitido (ADR 0061 declara a
lacuna de tipos; esta é diferente).

Ação: issue upstream no `theokit-sdk` (bug de empacotamento). Nada a fazer neste repo além de não
re-exportá-los.

---

## B-M67-06 — `pnpm lint` está vermelho no repo, por um `eslint-disable-line` mal colocado

**Encontrado em:** M67 (verificação pré-commit), 2026-08-12

`packages/agents/src/bridge/agent-sse-handler.ts:41-42`:

```
41:13  error  Unnecessary conditional, value is always truthy   @typescript-eslint/no-unnecessary-condition
42:11  error  Unused eslint-disable directive
```

A causa é mecânica: o `// eslint-disable-line` está **numa linha própria** (42), então desabilita a
linha 42 — não a 41, que é o `if (!closed) {` que ele pretendia cobrir. Resultado: a 41 acusa e a 42
fica "unused". A intenção original está no comentário (`-- mutated by safeEnqueue catch`) e é
legítima: a CFA do TypeScript não rastreia mutação de closure, então `closed` parece sempre `false`.

**Não é causado pelo M67.** O arquivo não é tocado pelo diff (último commit nele: `e91e9169`), não
importa nada do `@theokit/sdk` — `StreamEvent` é interface declarada localmente e `closed` é um `let`
local. O veredito da regra type-aware aqui não pode depender da versão do SDK.

**Consequência para o RELEASE:** o DoD do M67 exige `lint --max-warnings=0` verde. Ele está verde
para os arquivos do M67 (`eslint <13 arquivos> --max-warnings=0` → exit 0) e **vermelho no repo**.
O M67 não pode ser released enquanto isto não for resolvido, mesmo o defeito sendo anterior — CI
falha do mesmo jeito.

**Fix:** trocar por `eslint-disable-next-line` na linha 40 (e o mesmo no bloco de cima, linha 35, que
usa a forma inline correta e serve de modelo). Duas linhas.
