---
'@theokit/agents': minor
---

**Contratos de tipo honestos: a camada passa a devolver o tipo que já sabe.**

- **`toAgentFactory` aceita um THUNK de definição** — `(sessionId) => AgentDefinition`. O parâmetro
  `apiKey` já aceitava thunk desde o M74, adicionado por exatamente esta razão; a assimetria custava
  caro: com a forma objeto, trust, hooks, skills e MCP são compilados no load do módulo e ficam
  **congelados para o processo inteiro**. Num `theokit acp` que uma IDE mantém aberto por horas, isso
  reintroduzia a obsolescência que o M67 removeu. A forma objeto continua **byte-idêntica** — projeta
  uma vez, fora do closure; só o thunk paga por sessão.

- **`SdkAgentHandle.send` deixa de ser `=> unknown`** e passa a `(msg, opts?) => { wait(): … }`, com
  `SdkSendOptions`/`SdkTurnHandle` publicados. O `unknown` custava ao consumidor um módulo inteiro de
  38 linhas cujo único trabalho era re-estreitar este retorno — e o docstring daquele módulo registra
  que, antes dele, o chamador escrevia `as never`, sob cuja capa a superfície goal divergiu do agente
  real por vários milestones.

- **`Toolset` é a primitiva que faltava** (`@theokit/agents` barril). Coleção nomeada e imutável com
  política de resolução que falha alto em nome **desconhecido** e em **duplicado** — nos dois casos, o
  silêncio seria uma mudança de autoridade não observável, que é o que uma whitelist existe para
  impedir. **Não prefixa namespace**: o nome de uma tool é contrato com o modelo. Não constrói tools —
  quais e com que escopo é decisão do consumidor.

- **`BudgetExceededError` → `DelegationBudgetExceededError`**, com alias `@deprecated` por uma major.
  O nome antigo **sombreava** a classe homônima do SDK (orçamento de JANELA contra orçamento de
  DELEGAÇÃO), e como o consumidor tem regra de nunca importar `@theokit/sdk` direto, ele nunca
  alcançava a do SDK: `instanceof` casava com o domínio errado **em silêncio**. O barril agora exporta
  as duas. A `lacuna` registrada em `subpath-coverage.test.ts` saiu junto com o conflito que a criou.
