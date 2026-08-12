# ADR 0065 — O vocabulário de capacidades do framework é mínimo e declarado

**Status:** Accepted
**Date:** 2026-08-12
**Cycle:** m68-setting-sources-trust-gate (M68)

## Context

`resolveTrustPosture<K>` deixa o vocabulário de capacidades a cargo de quem chama — `K` é genérico e o
SDK não fixa nomes. O consumidor medido (TheoCode) declara **oito** capacidades próprias
(`packages/agent/src/config/trust-posture.ts:22-71`), cada uma com o custo de retê-la escrito.

A tentação é copiar as oito. A questão que este ADR fecha é: quantos nomes o **framework** declara.

O fato que decide: medido no corpo de `resolveTrustPosture`, `allows` é **all-or-nothing** — todo `K`
declarado recebe o mesmo booleano. Um vocabulário fino não entrega granularidade fina; entrega a
*aparência* dela.

## Decision

O framework gateia **a raiz de descoberta**, com o vocabulário mínimo que expressa isso. O que essa
raiz habilita depois — hooks, skills, subagentes, MCP — é decisão do SDK, e o framework não promete
gatear cada um separadamente.

## Alternatives considered

1. **Copiar as oito capacidades do TheoCode.** REJEITADA. Importa vocabulário de **produto** para
   dentro do framework. As oito refletem as escolhas de um agente de código específico; um app web que
   use `settingSources` não tem opinião sobre metade delas, e carregá-las obrigaria todo consumidor a
   entender um vocabulário que não é dele.
2. **Um vocabulário fino próprio (`hooks`, `skills`, `subagents`, `mcp`).** REJEITADA — e esta é a
   alternativa perigosa, porque *parece* melhor. Ela prometeria ao consumidor gatear hooks sem gatear
   skills, e a `allows` all-or-nothing não entrega isso: os quatro receberiam o mesmo booleano. Uma
   API que sugere uma distinção que o runtime não faz é pior que uma API grosseira — ensina errado e
   o erro só aparece quando alguém depende da distinção.
3. **Deixar `K` aberto para o consumidor declarar.** REJEITADA por ora. É mais flexível e é o que o
   SDK faz, mas transfere ao consumidor a decisão de *o que* precisa ser gateado — que é exatamente a
   decisão que ele errou até aqui (habilitar `project` sem gate nenhum). O framework deve declarar o
   mínimo que ele mesmo sabe ser perigoso.

## Consequences

- Se um consumidor precisar de granularidade real, a conversa é upstream, com o SDK — não uma segunda
  camada de gate aqui que finge granularidade sobre um booleano único.
- Reabrir esta decisão exige evidência de demanda (o padrão dos gates do ADR-0011): um consumidor com
  caso concreto em que gatear hooks sem gatear skills muda o resultado.
- O vocabulário mínimo mantém a mensagem de recusa legível: nomear uma capacidade que o consumidor
  reconhece vale mais que enumerar quatro que ele nunca declarou.
