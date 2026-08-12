# ADR 0062 — O `@theokit/presenter` passa a ser testado contra o range que declara

**Status:** Accepted
**Date:** 2026-08-12
**Cycle:** m67-layered-boundary-passthrough (M67 — fechar a fronteira em camadas)
**Context source:** finding #20 da cross-validation TheoKit × TheoCode (2026-08-12)

## Context

`packages/presenter/package.json` declara:

```
"peerDependencies": { "@theokit/sdk": "^4.40.0" }
"devDependencies":  { "@theokit/sdk": "^3.8.0"  }
```

O pacote é **testado** contra uma major que não pode conter o que seu **peer** promete. A suíte verde
do presenter não prova nada sobre o contrato que ele publica: ela prova que o código funciona contra
3.8.x, enquanto o consumidor é informado de que precisa de 4.40+.

Isso é a mesma classe de defeito que o M67 inteiro existe para fechar — declarado divergindo do
verificado — e apareceu como finding #20 da cross-validation, atribuído ao M70.

## Decision

`devDependencies["@theokit/sdk"]` do presenter passa a `^4.49.0`, igual ao peer (que também sobe, por
ADR 0060). O DoD correspondente do M70 fica satisfeito por antecipação e será marcado lá quando o
roadmap for corrigido pós-M67.

## Alternatives considered

1. **Deixar para o M70, como o roadmap atribuiu.** REJEITADA. Este milestone move **todos** os ranges
   de `@theokit/sdk` do workspace, num único commit, por exigência do ADR 0060 (uma cópia só). Sair
   dele deixando um pacote testado contra uma major anterior significaria fechar o commit que fecha a
   fronteira com um pacote cuja suíte verde não prova o contrato declarado. O custo de fazer agora é
   uma linha; o custo de não fazer é carregar a incoerência dentro do próprio commit que a denuncia.
2. **Alinhar o peer ao dev, baixando para `^3.8.0`.** REJEITADA. Inverteria o contrato: o peer é a
   promessa ao consumidor, o dev é o instrumento com que a verificamos. Ajustar a promessa para caber
   no instrumento é o raciocínio de trás para frente.
3. **Remover o peer e depender direto.** REJEITADA. O presenter é consumido junto de `@theokit/agents`
   e de `theokit`; uma dependência direta duplicaria o SDK na árvore do consumidor, que é exatamente
   o cenário de duas cópias rejeitado no ADR 0060.

## Consequences

- Elevar o peer do presenter tem o mesmo efeito de contrato descrito no ADR 0060: quem estiver pinado
  abaixo de 4.49.0 vê falha de resolução no install. Coberto pela mesma entrada de CHANGELOG.
- O M70 herda um DoD já cumprido. Sobreposição declarada, não silenciosa — anotada na task de
  correção do roadmap pós-M67.
- Se a suíte do presenter ficar vermelha ao subir de 3.8 para 4.49, isso **não** é regressão
  introduzida por este milestone: é a primeira vez que o pacote é exercitado contra o que ele
  promete. Um vermelho aqui é informação nova, e vira task com teste de regressão antes do fix.
