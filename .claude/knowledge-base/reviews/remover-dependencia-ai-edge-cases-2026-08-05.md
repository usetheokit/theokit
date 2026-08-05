# Edge Case Review — remover-dependencia-ai

Date: 2026-08-05
Tasks analyzed: 10 (T0.1, T1.1–T1.4, T2.1, T2.2, T3.1–T3.3)
Cases found: 15 (EDGE: 6, NEGATIVE: 9 | MUST FIX: 8, SHOULD TEST: 4, DOCUMENT: 3)

## MUST FIX

### EC-1: o frame sentinela `[DONE]` derruba o parser em TODO stream
- **Affected task:** T1.2
- **Kind:** NEGATIVE (input inválido para `JSON.parse`)
- **Family:** Format
- **Scenario:** `packages/theo/src/server/define/ui-message-stream-response.ts:27` emite `data: [DONE]\n\n` como frame terminal de todo stream — o comentário na linha 12 diz explicitamente *"ignored by the parser"*. O pseudo-código de T1.2 faz `wireChunkSchema.safeParse(JSON.parse(payload))` com o `JSON.parse` **fora** de qualquer guarda. `JSON.parse('[DONE]')` lança `SyntaxError`.
- **Impact:** **Não é edge case — é falha determinística.** O último frame de toda resposta quebraria o stream com uma exceção não-tratada, depois de já ter entregue o conteúdo. O plano, como escrito, não funciona. O `ai` acerta hoje porque trata o sentinela; nós herdaríamos o contrato sem herdar o tratamento.
- **Suggested fix:** antes do parse, `if (payload === '[DONE]') continue`; e envolver o `JSON.parse` em `try/catch` que descarta o frame com aviso (mesma política de leniência da D2).

### EC-2: terminador de linha CRLF/CR faz o parser nunca emitir nada
- **Affected task:** T1.2
- **Kind:** EDGE (extremo de entrada válida — SSE permite três terminadores)
- **Family:** Format
- **Scenario:** WHATWG HTML §9.2 define o terminador de evento como CRLF, LF **ou** CR. Nosso servidor emite `\n\n` (`ui-message-stream-response.ts:38`), mas um proxy reverso, um load balancer ou um servidor de terceiros falando o mesmo wire pode emitir `\r\n\r\n`. O `splitOnBlankLine` do pseudo-código não declara qual terminador reconhece.
- **Impact:** Silêncio total — o buffer nunca fecha um evento, nada é emitido, e o stream termina "limpo" sem uma única mensagem. É o pior modo de falha: nenhum erro, nenhuma renderização.
- **Suggested fix:** normalizar terminadores na entrada — `buffer.replace(/\r\n|\r/g, '\n')` antes do split — e adicionar um RED com fixture CRLF.

### EC-3: chunk após `finish` estoura em `msg` nulo
- **Affected task:** T1.3
- **Kind:** NEGATIVE (frame fora de ordem)
- **Family:** State
- **Scenario:** O pseudo-código zera `msg = null` no `finish`. Um `text-delta` ou `tool-*` chegando depois (duplicata do servidor, retransmissão após reconexão do M37, race entre `finish` e um chunk em voo) cai em `appendText(null, chunk)`.
- **Impact:** `TypeError` não-tratado no meio do stream. Pior no caminho resumível (`durable-ui-message-stream-response.ts`), onde reconexão por `Last-Event-ID` pode legitimamente reentregar frames.
- **Suggested fix:** no `default`/`text-delta`, `if (msg === null) { warn('chunk after finish'); continue }` — descarta em vez de crashar, coerente com a leniência de leitura da D2.

### EC-4: a asserção de tipo bidirecional provavelmente é inalcançável e trava T1.4
- **Affected task:** T1.4
- **Kind:** EDGE (limite do contrato de tipos)
- **Family:** Integration
- **Scenario:** O plano exige `expectTypeOf<WireTransport>().toMatchTypeOf<ChatTransport<UIMessage>>()` **e** o inverso. Assignability estrutural só é simétrica se as duas formas forem equivalentes. `ChatTransport` do `ai` (`index.d.ts:5350`) pode ter membros que não espelhamos — e a D2 diz explicitamente que espelhamos **só o subconjunto usado**. Com menos membros, `ChatTransport → WireTransport` passa, mas `WireTransport → ChatTransport` falha.
- **Impact:** A task fica bloqueada por uma asserção que o próprio plano tornou impossível ao escolher o subconjunto. O implementador ou afrouxa o teste sem critério, ou espelha membros a mais — violando a D2 e o `G7`.
- **Suggested fix:** exigir **uma** direção — a que protege o consumidor: nossas implementações de transport devem satisfazer `ChatTransport`. Trocar por `expectTypeOf<HttpTransport>().toMatchTypeOf<ChatTransport<UIMessage>>()` e remover a exigência inversa.

### EC-5: `@theokit/presenter` promovido a dependency, mas ausente de `external` no tsup
- **Affected task:** T2.1
- **Kind:** NEGATIVE (configuração inconsistente)
- **Family:** Integration
- **Scenario:** `packages/agents/tsup.config.ts:38` declara `external: ['@theokit/http', '@theokit/sdk', '@theokit/sdk-pty', '@theokit/sdk-tools', 'zod']` — `@theokit/presenter` **não está na lista**, e por isso é inlinado (verificado: `UIMessageStreamPresenter` aparece em `@theokit/agents@7.0.0/dist/chunk-3YPKTOJ6.js`). T2.1 manda promovê-lo a `dependency` sem tocar no `external`.
- **Impact:** O consumidor instala o pacote **e** recebe uma cópia embutida do mesmo código — duas instâncias do schema Zod no mesmo processo. Além do peso duplicado, qualquer comparação de identidade entre schemas passa a falhar de forma difícil de diagnosticar.
- **Suggested fix:** decidir explicitamente e registrar como ADR: **ou** adicionar `@theokit/presenter` ao `external` e declarar como `dependency`, **ou** mantê-lo inlinado e como `devDependency`. Misturar é o defeito.

### EC-6: o gate `check-ai-free-surface` passa por vacuidade sem `dist/`
- **Affected task:** T3.3
- **Kind:** NEGATIVE (ausência de insumo tratada como sucesso)
- **Family:** Resource
- **Scenario:** O pseudo-código faz `for f in glob(dist/**/*.js)` e devolve 0 quando a lista de problemas está vazia. Num clone limpo sem build — ou num job de CI sem passo de build — o glob retorna zero arquivos e o gate **passa**.
- **Impact:** É exatamente o modo de falha que o `subpath-surface.test.ts` já documenta (*"rode `npm run build` — sem `dist/` este gate não mede nada"*) e que derrubou o job `surface parity` por semanas neste repo. Um gate que mede nada e reporta verde é pior que gate nenhum: ele afirma a métrica do Goal sem tê-la medido.
- **Suggested fix:** falhar quando qualquer pacote publicável não tiver `dist/`, com a mensagem apontando o build — e um RED `test_gate_falha_sem_dist()`.

### EC-7: o teste do template importa `@theokit/presenter/wire` sem o template declarar o pacote
- **Affected task:** T3.2
- **Kind:** NEGATIVE (dependência não declarada)
- **Family:** Integration
- **Scenario:** T3.2 reponta `templates/default/app/hooks/use-transcript.test.ts:4` de `ai` para os tipos do wire. O `package.json.tmpl` fixa `theokit`, `@theokit/agents`, `@theokit/ui` — não `@theokit/presenter`.
- **Impact:** O app scaffoldado deixa de resolver o import e o teste do template quebra no primeiro `npm test` do usuário — justamente o cenário que o plano quer provar limpo.
- **Suggested fix:** reexportar os tipos do wire por um caminho que o app já tem (`theokit/client`) e apontar o teste para lá; declarar `@theokit/presenter` no template é a alternativa pior, por expor um pacote interno ao usuário.

### EC-8: `error` malformado é descartado pela leniência e a falha vira silêncio
- **Affected task:** T1.2 + T1.3 (resolve a Q4 do plano)
- **Kind:** NEGATIVE (interseção de duas regras do próprio plano)
- **Family:** Format / State
- **Scenario:** A D2 manda descartar frame que falha no schema; o `#136` manda que um chunk `error` **rejeite** o stream. Um frame `{"type":"error"}` sem `errorText` — ou com campo extra de um provider — falha na validação e cai na regra de descarte.
- **Impact:** A pior combinação possível: uma falha real de provider (401/429/5xx) desaparece silenciosamente, o stream termina "limpo", e o store assenta em `done`. É a regressão do `#136` reintroduzida por uma porta lateral, contra a qual o plano acha que está protegido.
- **Suggested fix:** ler `type` **antes** de validar; se for `error`, rejeitar sempre — com `errorText` quando presente, com mensagem genérica quando ausente. Isso responde a Q4: leniência nunca se aplica ao canal de erro.

## SHOULD TEST

### EC-9: múltiplas linhas `data:` no mesmo evento
- **Affected task:** T1.2
- **Kind:** EDGE
- **Suggested test:** `test_multiplas_linhas_data_sao_concatenadas_com_newline()` — evento com `data: {"a":\ndata: 1}` produz **um** chunk com o JSON remontado. Os Deep Dives de T1.2 mencionam a concatenação em prosa, mas nenhum RED a cobre.

### EC-10: buffer cresce sem limite quando a linha em branco nunca chega
- **Affected task:** T1.2
- **Kind:** NEGATIVE
- **Suggested test:** `test_frame_sem_terminador_nao_cresce_sem_limite()` — servidor que emite 10MB sem linha em branco deve produzir erro tipado de frame excedido, não consumir memória até o OOM. Assertar o erro específico, não apenas "lança".

### EC-11: dois `start` consecutivos descartam a primeira mensagem
- **Affected task:** T1.3
- **Kind:** EDGE
- **Suggested test:** `test_start_duplicado_nao_perde_a_mensagem_anterior()` — o segundo `start` deve emitir/fechar a mensagem em curso antes de abrir a nova. Listado nos Deep Dives sem RED correspondente.

### EC-12: `error` como primeiro chunk, sem `start`
- **Affected task:** T1.3
- **Kind:** NEGATIVE
- **Suggested test:** `test_error_sem_start_rejeita_sem_crashar()` — falha de auth acontece antes de qualquer conteúdo; assertar o erro tipado com a mensagem do provider, e que nada tenta acessar `msg` nulo.

## DOCUMENT

### EC-13: o oráculo precisa de política de pin
- **Kind:** NEGATIVE
- **Accepted risk:** `ai` fica como devDependency (D4). Quando ele for bumpado, o teste diferencial pode ficar vermelho por mudança legítima **upstream**, e a tentação será ajustar nosso espelho para acompanhar uma mudança que talvez não queiramos. Aceitável se o pin for exato (`7.0.14`, não `^7.0.14`) e o bump for ato deliberado com leitura do changelog — registrar isso no ADR de D4.

### EC-14: skew de versão do zod entre o nosso schema e o do `ai`
- **Kind:** EDGE
- **Accepted risk:** usamos `zod ^4.4.3` (com override na raiz); o `ai` traz o seu. Divergência de semântica de parse entre versões pode fazer o diferencial falhar por motivo alheio ao wire. Risco baixo dado o override, e o diagnóstico é direto quando ocorre. Documentar no harness que uma divergência deve primeiro ser investigada como skew de zod antes de virar mudança no espelho.

### EC-15: apps já scaffoldados ficam com um `ai` órfão
- **Kind:** EDGE
- **Accepted risk:** o pin sai do template, mas apps existentes seguem com `ai` no manifesto. Não quebram — o pacote continua no npm. Documentar no CHANGELOG como remoção opcional, sem codemod: o ganho não paga a complexidade de migração automática (KISS).

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 | 0 | 0 |
| T1.1 | 0 | 0 | 0 | 0 | 1 (EC-14) |
| T1.2 | 2 | 3 | 3 (EC-1,2,8) | 2 (EC-9,10) | 0 |
| T1.3 | 1 | 3 | 2 (EC-3,8) | 2 (EC-11,12) | 0 |
| T1.4 | 1 | 0 | 1 (EC-4) | 0 | 0 |
| T2.1 | 0 | 1 | 1 (EC-5) | 0 | 0 |
| T2.2 | 0 | 0 | 0 | 0 | 0 |
| T3.1 | 0 | 0 | 0 | 0 | 1 (EC-13) |
| T3.2 | 1 | 1 | 1 (EC-7) | 0 | 1 (EC-15) |
| T3.3 | 1 | 1 | 1 (EC-6) | 0 | 0 |

*(EC-8 conta em T1.2 e T1.3 por atravessar as duas.)*

**Coverage check:** T1.2, T1.3, T3.2 e T3.3 tocam fronteira de entrada e têm ao menos um caso de cada lente. T1.1 é schema puro (a lente NEGATIVE já está no próprio plano, no teste de variante desconhecida). T0.1, T2.2 e T3.1 não têm fronteira de entrada em runtime — T2.2 é troca de import de tipo, T3.1 é edição de manifesto, T0.1 lê fixtures do próprio repo.

**Verdict: PLAN NEEDS ADJUSTMENT**

O bloqueador é o **EC-1**: o plano, como escrito, não funciona — o `JSON.parse` sem guarda quebra no frame `[DONE]` que o nosso próprio servidor emite ao final de todo stream. Não é um extremo raro; é o caminho comum. Junto dele, **EC-8** reintroduz por porta lateral exatamente a regressão (`#136`) que o plano se propõe a proteger, e **EC-6** repete no gate novo o modo de falha que este repo acabou de pagar caro no job `surface parity`.

Os oito MUST FIX devem ser absorvidos numa v1.1 do plano antes do `/plan-confidence`.
