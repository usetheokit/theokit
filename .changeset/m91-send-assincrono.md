---
'@theokit/agents': patch
---

Corrige o tipo de `SdkAgentHandle.send` introduzido no `4.26.0`: ele devolve
`Promise<SdkTurnHandle>`, não `SdkTurnHandle`.

`SDKAgent.send` é `(message, options?) => Promise<Run>`, e o `GoalLoopAgent` do SDK declara
`send(prompt): Promise<{ wait(): … }>`. A primeira versão do tipo era síncrona — e o detalhe é que o
`tsc` do consumidor **não teria pegado**, porque o adaptador que este milestone existe para apagar
(`runner-facade.ts`, com um `as never` na origem) absorvia exatamente essa diferença.

É a divergência que o docstring daquele adaptador descrevia, reencontrada ao tentar removê-lo — a
prova de que o `unknown` não era só feio: ele desligava a checagem no ponto onde o contrato importa.
