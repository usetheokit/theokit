---
'@theokit/agents': patch
---

**Restaura a compatibilidade que o `4.26.0` quebrou em silêncio: `BudgetExceededError` volta a ser a
classe de DELEGAÇÃO no barril raiz.**

O `4.26.0` **reaproveitou** o nome — o barril passou a exportar a classe do SDK (orçamento de JANELA)
sob `BudgetExceededError`. Medido contra os tarballs publicados:

| | 4.25.1 | 4.26.1 |
|---|---|---|
| `new BudgetExceededError('agente', 5, 1)` da raiz | funciona | `TypeError: Cannot read properties of undefined` |
| raiz `===` `/bridge` | `true` | `false` |

Para quem estava em `^4.25` com `catch (e) { if (e instanceof BudgetExceededError) … }`, o ramo de
orçamento de delegação **deixou de casar, em silêncio** — o modo de falha exato que o rename existia
para matar, em espelho, e publicado como MINOR.

Agora: `BudgetExceededError` é o alias `@deprecated` de `DelegationBudgetExceededError` — mesma
identidade referencial de sempre, zero quebra. A classe do SDK atravessa como
`WindowBudgetExceededError`, que fecha a lacuna original **sem redefinir o que um nome significa**.
Travado por `tests/unit/erro-de-dominio.test.ts`, que assere `barril.BudgetExceededError` **é** a
classe de delegação e que as duas são classes distintas.
