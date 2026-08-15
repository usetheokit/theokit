---
"@theokit/agents": minor
---

**`resolveAgentCredential` — a montagem de autenticacao, para um app novo nao reescrever nenhuma.**

O framework ja entregava as PECAS (store no 0600, device flow RFC 8628, refresh, `writeCredential`) e
nao entregava a MONTAGEM. Medido no consumidor mais proximo: ele importa seis simbolos nossos e
escreve ~250 linhas em cima, e nenhuma delas e sobre o dominio dele — sao a politica de resolucao que
todo app de agente de terminal precisa e nenhum consegue importar.

Adicionado:

- **`DEFAULT_PROVIDERS`** — openrouter, anthropic, openai com variavel de ambiente, prioridade e
  prefixo de chave. O consumidor abre com TRES tabelas escritas a mao dizendo isto; agora um app novo
  nao escreve nenhuma. Prioridades espacadas de 10 para caber um provider entre dois padroes sem
  renumerar.
- **`resolveAgentCredential({ env })`** — a chamada unica. Aplica os padroes e mantem todos
  sobrescreviveis: `providers` para estreitar (um produto que so fala com um provider) ou estender
  (um gateway self-hosted).
- **O pin de provider** (`THEOKIT_PROVIDER` por padrao) que se RECUSA a cair para outro. Cair
  mandaria a requisicao — e a conta, e os dados — para um provider que o operador nao escolheu. Um
  typo no nome tambem e recusado: um erro de digitacao nao pode desligar o pin em silencio.
- **Coerencia chave↔provider** via `keyPrefix`. `ANTHROPIC_API_KEY=sk-proj-…` e uma colagem na
  variavel errada, pega aqui de graca em vez de virar um 401 remoto cuja mensagem nao fala do
  desencontro.
- **`requireCredential`** e `CredentialNotFoundError` carregando ONDE procurou. "Nenhuma credencial
  encontrada" sem a lista e a frase menos util que um CLI pode imprimir, e e por isso que o consumidor
  carregava a propria.

`resolveCredential` segue devolvendo `undefined` — a forma nao-lancante e o que o caminho de primeira
execucao quer, e `requireCredential` e o opt-in de quem nao pode continuar. Duas funcoes em vez de uma
flag: a intencao fica visivel no call site.

Os prefixos vivem aqui E no SDK (`providerFromApiKeyPrefix`), o que nao e ideal e esta guardado: um
teste falha quando as duas tabelas discordam. Uma tabela so seria melhor, mas o simbolo do SDK esta
exportado em runtime e AUSENTE do `auth/index.d.ts` (medido contra 4.52.0), entao um import tipado nao
resolve. Guardado por CI em vez de esperado.
