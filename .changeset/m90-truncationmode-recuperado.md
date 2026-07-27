---
'@theokit/agents': patch
---

**Corrige uma regressão de superfície introduzida no `4.25.0`: `TruncationMode` voltou a ser exportado
por `@theokit/agents/tools`.**

A entrada do `4.25.0` afirma *"172 símbolos, superfície preservada inteira (nada sai)"*. Isso era falso:
o gerador de re-exports rodou contra uma cópia local de `@theokit/sdk-tools@0.26.0` (92 exports)
enquanto o registro já publicara `0.26.1` (93, com `TruncationMode`). O peer é uma faixa flutuante
(`>=0.24.1 <1.0.0`), então consumidores instalavam a versão nova e perdiam o símbolo: sob `export *` ele
atravessava; enumerado a partir da cópia velha, sumiu. A entrada anterior não pode ser editada, então
a correção fica aqui.

O gate que deveria ter pego isso era **vacuo para `/tools` e `/pty`** — 98 dos 173 símbolos, 57% da
superfície. Ele comparava *a fonte* contra o snapshot, e nunca *a camada* contra a fonte; remover
símbolos reais desses dois entries deixava a suíte inteira verde. `tests/unit/subpath-surface.test.ts`
passa a enumerar o `dist/*.d.ts` **emitido** e a comparar nas duas direções (nada da fonte falta na
camada; nada na camada é inventado), e deixa de engolir a ausência de `dist/`, que o fazia passar por
vacuidade num clone sem build.

Superfície agora: **173 símbolos** (`tools` 93, `sandbox` 36, `persistence` 29, `pty` 6,
`interactive` 9).
