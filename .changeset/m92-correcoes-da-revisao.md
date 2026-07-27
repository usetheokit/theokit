---
'@theokit/agents': patch
---

**Correções da revisão adversarial do M92 — dois BLOCKERs e três furos de eviction.**

- **O `concat` que o `4.27.0` prometeu e não entregou.** O `#prefixo` era um **alias** do `#committed`
  (mesma referência) e o `#emit` continuava espalhando: byte-idêntico ao anterior, medido em ~2 µs @400.
  Agora é um `concat` único. O ganho é de constante, não de ordem — e é honesto dizer isso.

- **O coalescing não tinha teste capaz de falhar.** Substituir o corpo inteiro de `#agendarEmit` por
  `return` deixava **580/580 verdes**: os testes instalavam timers falsos e nunca os avançavam, e só
  exercitavam `reset()`, que faz flush síncrono por decisão. Os testes novos dirigem 30 deltas por um
  transporte falso e medem a razão de emits — **32 contra 2**, e o mutante mata 2 testes.

- **Três furos na eviction de aprovação, todos medidos:**
  - Sinal **já abortado** no `sendMessages` não dispara `addEventListener`, então uma aprovação que
    estacionasse depois ficava pendente para sempre — o travamento que o milestone existe para fechar,
    alcançável por outro caminho. Agora o sinal é consultado **no momento em que a aprovação estaciona**.
  - O turno era lido de um **campo compartilhado**, então um runner do turno 1 estacionando depois do
    `send` do turno 2 nascia etiquetado turno 2 e o abort do turno 1 não o alcançava. O turno passou a
    viver num **closure por turno** — o único lugar onde não é sobrescrito.
  - Rejeitar sem handler mata o processo em Node ≥ 15; o caminho tem teste.
