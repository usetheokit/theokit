# ADR 0041 — O resolvedor de provider vira público em vez de ser deletado

**Data:** 2026-08-14 · **Status:** aceito · **Milestone:** M79

## Contexto

O M79 exige uma decisão registrada e executada, com duas saídas mutuamente exclusivas:

> **ou** `resolveProvider`/`registerProvider`/`ProviderDescriptor` viram públicos em
> `theokit/server/agent`, **ou** `provider-resolver.ts` é deletado e CLI/vite-plugin passam a chamar
> o caminho público. Um segundo resolvedor inalcançável é o que garante que o consumidor escreva o
> terceiro.

E adiciona, para o segundo caso: *"as URLs literais de vendor saem de `packages/`"*.

## O que foi medido

| Fato | Medição |
|---|---|
| `provider-resolver.ts` existe e é completo | `packages/theo/src/server/agent/provider-resolver.ts`, 4932 bytes, com `registerProvider`, `resolveProvider`, `resetProviderRegistry`, `getProviderRegistry` — todos marcados `@public` no JSDoc e nenhum alcançável |
| Consumidores internos | 3 call sites, ambos no vite-plugin (`api-middleware.ts`, `agent-middleware.ts`) |
| URLs de vendor | as três (`openrouter.ai`, `api.openai.com`, `api.anthropic.com`) vivem só nesse arquivo |
| **O SDK possui baseUrl de provider?** | **Não.** `grep` nos `.d.ts` do `@theokit/sdk@4.51.1` não encontra nenhuma das três URLs, nem `ProviderDescriptor`, nem registry |

## Decisão

**Opção (a): tornar o resolvedor público.** `provider-resolver.ts` não é deletado.

## Por quê

O último fato medido decide. A opção (b) exige que as URLs de vendor deixem `packages/` — e **não há
para onde levá-las**: o SDK não as conhece, e a única alternativa restante seria exigir que cada app
declare os três endpoints na própria config. Isso quebraria o `theokit dev` zero-config, que hoje
funciona com um `OPENAI_API_KEY` no shell e nada mais.

Trocar "um resolvedor inalcançável" por "todo app tem de declarar endpoints de vendor" não é remover
duplicação — é transferi-la para fora do repositório, multiplicada pelo número de apps. Seria a mesma
falha do M79 com pior distribuição.

A queixa central do milestone é a **inalcançabilidade** — *"um segundo resolvedor inalcançável é o que
garante que o consumidor escreva o terceiro"* — e a opção (a) a resolve diretamente, sem criar a
nova.

## Consequências

- `resolveProvider`, `registerProvider`, `resetProviderRegistry`, `getProviderRegistry` e
  `ProviderDescriptor` saem de trás do `internal-api.ts`.
- O gate G2 continua acendendo nesse arquivo com as três URLs literais. **Isso é aceito e nomeado
  aqui:** o G2 proíbe *chamar* APIs de LLM diretamente (`fetch` para um endpoint de vendor), e uma
  tabela de descritores é configuração, não chamada. O grep do gate não distingue as duas coisas, e
  refiná-lo é trabalho próprio, fora do escopo do M79.
- `@theokit/agents/auth` publica `resolveCredential` com **a assinatura do framework** — descritores
  como parâmetro. O símbolo homônimo do SDK continua **não** re-exportado, então só um é alcançável
  daquele subpath. É a mitigação que o próprio milestone prescreve para o risco de homônimos.

## O que fica em aberto, honestamente

Os descritores default do framework (`DEFAULT_REGISTRY`) e a lista que um app passa a
`resolveCredential` são hoje duas expressões da mesma ideia em pontos diferentes da pilha. Não as
unifiquei: o registry serve o caminho zero-config do vite-plugin, e o parâmetro serve o app que
declara a própria política. Convergi-los exigiria decidir quem é a fonte — decisão que precisa de um
consumidor real pedindo, e não de simetria.

## Cross-references

- Milestone: `ROADMAP-v3.md § M79`
- Implementação: `packages/agents/src/auth/resolve-credential.ts`
- Registry: `packages/theo/src/server/agent/provider-resolver.ts`
- Doutrina de homônimos: `packages/agents/src/auth-entry.ts` (parágrafos M73 e M110)
- Guardrail citado: `.claude/rules/system-design-guardrails.md § G2`
