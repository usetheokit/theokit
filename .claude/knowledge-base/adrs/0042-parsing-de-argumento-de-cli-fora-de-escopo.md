# ADR 0042 — Parsing de argumento de CLI fica fora do framework

**Data:** 2026-08-14 · **Status:** aceito · **Milestone:** M83

## Contexto

O M83 exige uma decisão **registrada** sobre parsing de argumento:

> **ou** um helper `defineCliCommand`, **ou** documentação explícita de que está fora de escopo — para
> que o próximo consumidor descubra **antes** de escrever 470 LOC, não depois.

A pergunta não é se parsing de argumento é útil. É se o framework deve possuí-lo.

## Decisão

**Fora de escopo.** Não haverá `defineCliCommand` nem parser de flags no `@theokit/agents` ou no
`theokit`.

O que o framework possui, e que o M83 entrega, é o **roteamento de comando de terminal**:
`defineCommand` + `routeCommand`, que decidem se uma linha digitada numa sessão é um comando, uma
mensagem ou um erro. Isso é uma coisa diferente de parsing de `argv`.

## Por quê

**São dois problemas com formas diferentes.** Um roteador de terminal recebe *uma linha que um humano
digitou numa sessão em andamento* e responde "isto é `/model`, com argumento `gpt-5`". Um parser de
CLI recebe `process.argv` *uma vez, na inicialização*, e precisa de flags curtas e longas, valores
negados, `--`, agrupamento (`-abc`), coerção de tipo, subcomandos, arquivos de resposta e mensagens
de erro que citem a flag. Compartilham a palavra "argumento" e quase nada mais.

**Não reinvente a roda (Regra 9).** Esse é um domínio com soluções maduras e battle-tested —
`commander`, `yargs`, `citty`, `cac`, além do `parseArgs` do próprio Node desde a 18.3. Escrever a
nossa versão significaria manter para sempre um parser inferior às opções que já existem, e o custo
não aparece no dia em que ele é escrito.

**A mitigação do Top-risk 1 do próprio milestone diz isto.** O risco declarado é *"absorver 'sistema
de comandos' vira um mini-framework de CLI dentro do agents"*, e a mitigação é: entra o roteamento e
a forma do interpretador; **não** entram rendering de ajuda, alias nem completions. Parsing de flags
está do mesmo lado dessa linha — é o primeiro passo de um parser completo, não o último.

**E o custo de errar é assimétrico.** Um helper de parsing que quase serve é pior que nenhum: o
consumidor o adota, encontra o caso que falta na terceira semana, e agora tem 470 LOC *mais* uma
dependência do framework para remover.

## O que o consumidor faz em vez disso

Para `argv`, usar `node:util`'s `parseArgs` (zero dependências, no runtime alvo) ou uma das
bibliotecas acima. Para uma linha digitada numa sessão, usar `routeCommand` — que é o que o M83
entrega, e que essas bibliotecas **não** fazem.

## Consequências

- A página de comandos do wiki declara isto explicitamente, para que a descoberta aconteça antes de
  escrever o parser, que é o resultado que o milestone pede.
- Se aparecer demanda concreta — 3+ apps bloqueados, com o caso descrito — um ADR novo pode reabrir.
  Esta decisão não é sobre a utilidade da coisa; é sobre quem a possui.

## Cross-references

- Milestone: `ROADMAP-v3.md § M83` (Top-risk 1)
- Roteamento que o framework possui: `packages/agents/src/commands/command-router.ts`
- Regra citada: `~/.claude/CLAUDE.md § 9` (Não Reinvente a Roda)
- Gate de escopo: `.claude/rules/system-design-guardrails.md § G13`
