# ADR 0063 — A evidência de confiança é a `TrustPosture` do SDK, não um tipo novo

**Status:** Accepted
**Date:** 2026-08-12
**Cycle:** m68-setting-sources-trust-gate (M68)
**Context source:** `.claude/knowledge-base/discoveries/blueprints/m68-setting-sources-trust-gate-blueprint.md`

## Context

`packages/agents/src/bridge/define-agent.ts:76-84` aceita `settingSources?: readonly SettingSource[]`.
Habilitar `'project'` liga a descoberta de `<cwd>/.theokit/` — **incluindo `hooks.json`, que executa
shell**. A JSDoc justifica: *"é opt-in porque `.theokit/` é o repo do próprio app (consentimento
informado)"*. A premissa vale para um app web cujo `cwd` é o próprio deploy; **não vale** para um
agente cujo `cwd` é um repositório que o usuário acabou de clonar, onde `.theokit/` é conteúdo do
atacante e habilitar `project` é execução remota de código no primeiro `build()`.

O `ROADMAP-v3` § M68 propunha inventar um `TrustDecision`. A investigação mostrou que **ele já
existe**: `TrustPosture<K>` do `@theokit/sdk`, alcançável desde o M67.

Medido no corpo publicado (`dist/index.js`), não só na declaração:

```js
function resolveTrustPosture(input) {
  const source = input.envOverride === true ? 'env' : input.isTrusted() ? 'store' : 'default'
  const level  = source === 'default' ? 'untrusted' : 'trusted'
  const granted = level === 'trusted'
  const allows = Object.fromEntries(input.capabilities.map((key) => [key, granted]))
  return { level, source, allows }
}
```

Três fatos que o desenho precisa respeitar: `allows` é **all-or-nothing** (todo `K` declarado recebe o
mesmo booleano); `TrustSource` é `'env' | 'store' | 'default'`; e `default` implica sempre
`untrusted` — **ausência nunca concede**.

E o SDK já trata a posture como *o* gate, com consumidor canônico. A doc de `recordWiring`
(`index.d.ts:3192-3196`) diz: *"The gate. Typically the output of `resolveTrustPosture`, which is what
makes the name `suppressedByTrust` accurate rather than decorative — a posture is the only thing in
this package that withholds a capability."*

## Decision

O source do repositório passa a exigir uma `TrustPosture` do SDK como evidência. Nenhum tipo de
confiança é criado neste repositório.

## Alternatives considered

1. **Criar um `TrustDecision` próprio, como o roadmap sugeria.** REJEITADA. Criaria uma segunda
   gramática de confiança ao lado da que o runtime já usa, e `recordWiring` já consome a do SDK — as
   duas divergiriam no primeiro milestone que tocasse ambas. É também a Rung 2 da
   `.claude/rules/parsimony-ladder.md`: a plataforma já resolve.
2. **Um `boolean`.** REJEITADA. É a forma atual com outro nome. Um booleano não carrega **quem
   decidiu** nem **de onde veio a decisão**, e é exatamente essa ausência que torna o risco atual
   invisível em log e em teste.
3. **Um callback `isTrusted: () => boolean`.** REJEITADA. Adia a decisão para dentro do `build()`,
   onde o erro perde o contexto que o tornaria acionável — e reproduz a assinatura de entrada do
   próprio `resolveTrustPosture` sem o veredito que ela produz.

## Consequences

- O consumidor precisa nomear `TrustPosture` — logo os tipos de confiança do SDK têm de atravessar o
  barrel (T1). A lacuna de tipos declarada no ADR 0061 é fechada para estes quatro.
- `allows` all-or-nothing significa que a API **não deve prometer granularidade por capacidade**. Ver
  ADR 0065.
- A proveniência (`TrustSource`) vem de graça na mensagem de recusa: dizer *"negado, e a decisão veio
  de `default`"* é acionável; *"negado"* não é.
