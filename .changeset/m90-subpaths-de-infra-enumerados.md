---
'@theokit/agents': minor
---

Os cinco subpaths de infra (`/tools`, `/sandbox`, `/persistence`, `/pty`, `/interactive`) deixam de ser
alias e viram camada.

Até aqui, o corpo inteiro de cada `*-entry.ts` era uma linha `export *`, e o `dist/*.d.ts` emitido
carregava a mesma coisa: o pacote emprestava o nome sem interpor decisão. Um rename upstream se
propagava verbatim, **sem erro de build aqui**, e o consumidor descobria em call site.

Agora os cinco enumeram — **172 símbolos**, superfície preservada inteira (nada sai; reduzir seria
breaking, e a regra do `auth-entry.ts` desde o M73 é que enriquecer nunca reduz). Medido lado a lado no
mesmo cenário de rename: com `export *` o build passa; com lista nomeada, `tsc` reprova com `TS2724` e
sugere o nome novo.

Acompanham a mudança um snapshot da superfície sobre `dist/*.d.ts`
(`tests/unit/subpath-surface.test.ts`) e a promoção dos três subpaths de SDK em
`subpath-coverage.test.ts` de `cobertura: 'amostra'` com lista **vazia** para `'total'`.
