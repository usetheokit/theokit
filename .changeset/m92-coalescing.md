---
'@theokit/agents': minor
---

**O stream ganha coalescing opt-in, e o transporte para de vazar aprovação estacionada.**

- **`AgentClient` cacheia o prefixo commitado.** `#committed` só muda em dois lugares (o `done` de
  `send()` e o `reset()`), então reconstruí-lo por delta de token era trabalho que a estrutura já
  garantia inútil. Honestidade sobre o tamanho: medido, o spread custa **0,0062 ms por delta @400
  mensagens** — 3,1 ms no turno inteiro. É real e é micro.

- **Coalescing opt-in: `new AgentClient(transport, ctx, { emitIntervalMs })`.** Sem o campo, emite por
  delta como sempre. É aqui que está a ordem de grandeza: o que pende de cada emit é a derivação da
  timeline, medida em **3,274 ms por chamada** no mesmo tamanho de thread — **≈ 528×** o spread. O
  coalescing não torna o emit mais barato; faz **menos emits acontecerem**. As transições de status
  (`done`/`error`/`abort`) fazem **flush síncrono**, porque um estado final preso num timer de 16 ms é
  um estado final perdido se o processo sair antes.

- **`InProcessTransport` evicta aprovação de turno abortado**, rejeitando com `ApprovalAbortedError`.
  Antes, `#pending` guardava só o `resolve` e nada apagava a entrada: a promessa ficava pendente **para
  sempre** e a chamada de tool do SDK pendurava com ela. Uma promessa que nunca resolve **nem** rejeita
  é a forma mais silenciosa de engolir um erro — nem stack trace existe. Rejeitar e não `resolve(false)`
  porque `false` é indistinguível de *"o usuário negou"*: negar é decisão, abortar é interrupção. As
  entradas passaram a ser chaveadas por turno, então um `send()` novo varre o anterior.
