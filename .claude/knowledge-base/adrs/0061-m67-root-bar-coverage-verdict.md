# ADR 0061 — O veredito de cobertura passa a incluir a barra root do SDK

**Status:** Accepted
**Date:** 2026-08-12
**Cycle:** m67-layered-boundary-passthrough (M67 — fechar a fronteira em camadas)
**Context source:** `/discover` do M67; extende a política do M78

## Context

O M78 criou a política de cobertura por veredito e o seu próprio cabeçalho explica por que ela existe
(`packages/agents/tests/unit/subpath-coverage.test.ts:1-22`): o barrel crescia **reativamente**,
símbolo por símbolo sob pressão de bug, e nada avisava quando o SDK ganhava superfície nova. A
solução foi exigir um veredito para **cada** subpath — `in` (verificado) ou `out` (com motivo
escrito) — de modo que "ninguém decidiu ainda" deixasse de ser indistinguível de "decidimos que fica
fora".

A política funcionou para o eixo que ela cobre. O M67 encontrou o eixo que ela **não** cobre.

Os oito símbolos da família config/trust/wiring vivem na **barra root** do SDK — o entry `.` do
`package.json` —, não em nenhum dos 31 subpaths. O gate enumera subpaths. Resultado medido: nove
minors consecutivas do SDK adicionaram símbolos à barra root (4.41 → 4.49) e **nenhuma** disparou
qualquer sinal aqui. A omissão não sobreviveu por falta de disciplina de quem revisou; sobreviveu
porque estava fora do escopo do instrumento.

## Decision

`packages/agents/tests/unit/subpath-coverage.test.ts` ganha uma tabela `ROOT_BAR_VERDICTS` cobrindo
**todo export de valor da barra root do SDK**, com a mesma disciplina in/out-com-motivo já aplicada
aos subpaths, reusando as interfaces `Inside`/`Outside` do próprio arquivo.

O escopo declarado é **valores**, e o nome do teste diz isso (`test_every_root_bar_VALUE_has_a_verdict`).
A enumeração usa `createRequire`, que devolve o objeto de runtime: todo `export type` do SDK é apagado
na compilação e não aparece em `Object.keys`. Prometer "todo export tem veredito" cobrindo só valores
seria repetir, um nível abaixo, exatamente o defeito que este ADR corrige — um eixo não enumerado
apresentado como cobertura completa.

## Alternatives considered

1. **Confiar na revisão humana do PR.** REJEITADA. É o que já existia, e falhou nove minors
   seguidas. Um controle que já falhou de forma medida não é candidato.
2. **`export *` da barra root do SDK.** REJEITADA. Arrasta a superfície inteira do SDK para dentro do
   nosso barrel, apaga a fronteira que o M63 desenhou, e torna toda adição upstream automaticamente
   pública aqui — o oposto de um veredito. Note que `export *` **é** usado hoje para cinco subpaths
   (`/errors`, `/retry`, `/concurrency`, `/messages`, `/models`) e por bom motivo, registrado em
   `index.ts:158-165`: são domínios pequenos e coesos onde "parte do domínio" não é unidade
   significativa. A barra root é o oposto disso — é o catálogo inteiro.
3. **Tabela ROOT-BAR contendo apenas os oito símbolos deste milestone.** REJEITADA. Seria um
   allowlist do que entra, e o cabeçalho do M78 já explica por que allowlist falha: um símbolo novo
   cai silenciosamente na categoria "indecidido". Foi assim que a cobertura chegou a 9 de 28 sem
   ninguém perceber.
4. **Estender também a tipos, via `.d.ts`.** REJEITADA para este milestone, registrada como lacuna
   conhecida. Exigiria um segundo mecanismo (parse de declaração, `attw` ou
   `tsc --emitDeclarationOnly`) e o milestone entregaria dois instrumentos meio-feitos em vez de um
   inteiro. O que **não** é aceitável é prometer cobertura de tipos e entregar cobertura de valores —
   daí o nome do teste declarar o escopo.

## Consequences

- A tabela nasce grande — dezenas de entradas, cada uma exigindo motivo escrito. É trabalho real, e o
  modo de falha óbvio é preencher `out` em massa com motivos plausíveis porém irrefletidos. O teste
  exige motivo com mais de 20 caracteres, o que torna preenchimento automático detectável; o resíduo
  não tem defesa mecânica e vira item explícito de olhar humano no `/review`.
- Um símbolo novo na barra root do SDK passa a quebrar o build **uma vez**, e o conserto é escrever
  uma linha dizendo o que se decidiu — inclusive "fica fora porque X".
- Um veredito para um nome que o SDK deixou de exportar também quebra, senão a tabela apodrece
  guardando decisões sobre coisas que não existem mais.
