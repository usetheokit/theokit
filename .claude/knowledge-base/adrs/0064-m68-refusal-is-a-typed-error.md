# ADR 0064 — Recusar o source não confiado é um erro tipado, não um descarte silencioso

**Status:** Accepted
**Date:** 2026-08-12
**Cycle:** m68-setting-sources-trust-gate (M68)

## Context

Quando o consumidor pede o source `project` sem uma `TrustPosture` que o autorize, há duas saídas
possíveis: **ignorar** o source e seguir construindo o agente, ou **recusar**.

O SDK já escolheu um lado, e o escolheu para o mesmo problema. `recordWiring` lança
`UngatedCapabilityError` quando alguém registra uma capacidade que a posture não gateia
(`dist/index.js`):

```js
if (allowed === void 0) {
  throw new UngatedCapabilityError(
    `capability \`${capability}\` was recorded as wired but the posture does not gate it; ` +
    `gated capabilities are: ${Object.keys(input.posture.allows).join(', ') || '(none)'}`
  )
}
```

Repare na forma da mensagem: nomeia **o que** foi pedido e **o que estava disponível**. É esse padrão
que este milestone segue.

## Decision

Pedir o source do repositório sem a posture que o autoriza **lança**. A mensagem nomeia a capacidade
recusada e o `TrustSource` da decisão (`env` / `store` / `default`).

## Alternatives considered

1. **Ignorar com aviso.** REJEITADA. O produto segue rodando acreditando que os hooks do repositório
   estão ativos — o modo de falha é silencioso e do lado errado. Um agente que *acha* que carregou os
   hooks de lint do repositório e não carregou dá respostas erradas com confiança, e ninguém investiga
   um aviso num log que já tem mil linhas.
2. **Ignorar em silêncio.** REJEITADA pelo mesmo motivo, sem sequer o aviso. É o comportamento que
   `packages/agents/src/bridge/approval-posture.ts:8-14` já denunciou noutro contexto: *"uma ausência
   não tem `match` exaustivo, não aparece em log nenhum e não falha teste nenhum"*.
3. **Rebaixar para `user`-only automaticamente.** REJEITADA. É "ignorar com aviso" com uma camada de
   esperteza: o consumidor pediu A, recebeu B, e a diferença só aparece quando um hook que ele
   esperava não roda. Degradação silenciosa de postura de segurança é pior que falha, porque não
   ensina nada.

## Consequences

- O erro precisa ser tipado e descender de `TheokitAgentError` — a regra do repo é essa, e o M67
  acabou de reparentar cinco classes por causa dela.
- O caminho seguro tem de continuar trivial: `user`-only não exige posture alguma, senão a recusa vira
  fricção que empurra o consumidor para desligar o gate.
- Um consumidor `.js` (sem tipos) não é alcançado pelo controle de tipo; a recusa em runtime é o que o
  cobre. É a mesma residualidade declarada no narrowing de `Agent.list` (M103), e ela é declarada aqui
  em vez de descoberta depois.
