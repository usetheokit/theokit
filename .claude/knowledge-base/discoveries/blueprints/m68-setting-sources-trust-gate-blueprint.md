---
slug: m68-setting-sources-trust-gate
milestone_id: M68
created_at: 2026-08-12
cycle: discover
question: "Como tornar irrepresentável habilitar hooks que executam shell de um repositório não confiável — e quanto disso o SDK já resolve?"
---

# Blueprint — M68: o gate de confiança do `settingSources`

## O achado

**O `TrustDecision` que o `ROADMAP-v3` § M68 manda inventar já existe.** É o `TrustPosture<K>` do
`@theokit/sdk`, e ele só ficou alcançável porque o M67 elevou o piso e abriu a porta. Escrever um tipo
novo aqui seria violar a Rung 2 da `parsimony-ladder` — e, pior, criar uma segunda gramática de
confiança ao lado da que o runtime já usa.

O vocabulário completo que o SDK publica (`@theokit/sdk@4.51.1`, `dist/index.d.ts:3106-3212`):

```ts
type TrustLevel = 'trusted' | 'untrusted'

interface TrustPostureInput<K extends string> {
  readonly isTrusted: () => boolean
  /** `false` e `undefined` significam "o operador não ligou", nunca "desligou" */
  readonly envOverride?: boolean
}

interface TrustPosture<K extends string> {
  readonly level: TrustLevel
  readonly source: TrustSource
  /** Uma entrada por capacidade declarada. Todo valor é `false` quando o nível é untrusted. */
  readonly allows: Readonly<Record<K, boolean>>
}

declare function resolveTrustPosture<K extends string>(input: TrustPostureInput<K>): TrustPosture<K>
```

E o **consumidor canônico já existe no próprio SDK** — `recordWiring` recebe a posture como *o gate*:

> *"The gate. Typically the output of `resolveTrustPosture`, which is what makes the name
> `suppressedByTrust` accurate rather than decorative — a posture is the only thing in this package
> that withholds a capability."* (`index.d.ts:3192-3196`)

Ou seja: o SDK já trata `TrustPosture` como **a** unidade de retenção de capacidade, e já tem um
segundo símbolo (`recordWiring`) que a consome nessa exata forma. O M68 não desenha um mecanismo novo;
ele **liga uma capacidade que hoje escapa do gate** ao gate que já governa as outras.

## O defeito, com precisão

`packages/agents/src/bridge/define-agent.ts:76-84`:

```ts
settingSources?: readonly SettingSource[]
```

Um array de strings. Habilitar `'project'` liga a descoberta de `<cwd>/.theokit/` — **incluindo
`hooks.json`, que executa shell**. A JSDoc reconhece o risco e o justifica:

> *"SECURITY: enabling `"project"` enables shell-executing hooks from `.theokit/hooks.json` — this is
> opt-in because `.theokit/` is the app's own repo (informed consent)."*

A premissa é *"`.theokit/` é o repo do próprio app"*. Ela vale para um app web cujo `cwd` é o próprio
deploy. **Não vale** para a classe de produto que o framework endereça — um agente cujo `cwd` é um
repositório que o usuário acabou de clonar. Ali `.theokit/` é conteúdo controlado pelo atacante, e
habilitar `project` é execução remota de código no primeiro `build()`.

E a capability é um pass-through cru — `agent-capabilities.ts:136-139`:

```ts
export class SettingSourcesCapability extends FieldCapability<'settingSources'> {
  readonly name = 'setting-sources'
  protected readonly field = 'settingSources' as const
}
```

Nenhuma decisão interposta. O valor atravessa para `Agent.create({ local.settingSources })` como veio.

## A evidência de que a premissa está errada na prática

O TheoCode — produto real de agente de código, `cwd` = repositório arbitrário do usuário — **não
confia nessa API**. Ele gateia por fora (`packages/agent/src/chat.ts:386`):

```ts
.settingSources(projectSourceAllowed(posture.allows) ? ['project', 'user'] : ['user'])
```

com o comentário in-file registrando o motivo (B-008): *"o source `project` habilita hooks do
repositório também, não só descoberta de subagentes, e esses contornam o gate de fingerprint por hook
do TheoCode. Agora exige as duas capacidades."*

Repare no que isso significa: o consumidor **já usa uma `posture.allows`** para decidir. Ele só não
consegue passar essa decisão adiante — a API só aceita strings. O gate existe do lado do consumidor e
some na fronteira.

## Coverage Corner 1 — Integration Tests

- **Negativo, o principal:** um `.theokit/hooks.json` presente + `project` habilitado **sem** posture
  que o permita ⇒ **nenhum hook instalado**, e o motivo aparece num canal de aviso — não em silêncio.
  Sem este teste, a correção é uma promessa de tipo sem prova de comportamento.
- **Positivo:** posture com `allows.project === true` ⇒ os hooks são descobertos normalmente. Uma
  guarda que proíbe tudo passaria num teste feito só de casos negativos, e seria breaking change
  disfarçado de segurança.
- **Tipo:** habilitar o source do repositório com um literal de string **não compila**. É o controle
  de tipo fechado, no molde do narrowing de `Agent.list` (`index.ts:94-120`) — a chamada errada não
  nasce.
- **Interop com `recordWiring`:** quando a posture retém `project`, o registro de wiring deve marcar
  `suppressedByTrust: true` para as entidades correspondentes. É o SDK já pronto para responder
  "por que este hook não está aqui" — e o M84 (doctor) vai depender disso.

## Coverage Corner 2 — Dependencies

- `@theokit/sdk` `^4.49.0` — já no piso desde o M67. `TrustPosture`, `TrustLevel`, `TrustPostureInput`
  e `resolveTrustPosture` **precisam atravessar** o barrel; o M67 atravessou `resolveTrustPosture`
  (valor), e o veredito ROOT-BAR de `TrustLevel`/`TrustPosture`/`TrustPostureInput` (tipos) fica
  coberto pela lacuna declarada no ADR 0061 — este milestone precisa fechá-la para os três.
- Nenhuma dependência nova. O milestone é composição sobre primitiva existente.

## Coverage Corner 3 — Tools

- `tests/type/*.test-d.ts` + `pnpm test:types` — o instrumento que prova um controle de tipo fechado.
  Confirmado no M67 que ele roda no CI; `expectTypeOf` num `.test.ts` deste pacote é no-op.
- `@ts-expect-error` como asserção positiva de recusa — o padrão de `agent-list-narrowed.test-d.ts`:
  a linha **precisa** errar, e o teste quebra quando ela para de errar.
- `scripts/check-*-parity.mjs` — a mudança de forma do `settingSources` altera superfície publicada e
  os gates vão cobrar veredito.

## Coverage Corner 4 — Techniques

- **Tornar irrepresentável, não documentar.** A JSDoc atual documenta o risco há quanto tempo, e o
  consumidor gateou por fora mesmo assim. Documentação não impediu; tipo impede.
- **Exigir evidência, não afirmação.** Mesmo movimento que o M77 fará com `auto-approve` (que hoje
  aceita `reason: string` e deveria exigir `confinedBy: SandboxPosture`): a decisão consequente pede
  o **valor** que a sustenta, não uma string que a alega.
- **Ausência não é negação.** `TrustPostureInput.envOverride` já codifica isso: *"`false` e
  `undefined` ambos significam 'o operador não ligou', não 'desligou'"*. A API nova precisa herdar a
  mesma assimetria — omitir `project` é não habilitar, nunca "habilitar sem gate".
- **Precedentes de par citados pelo consumidor** (`approval-posture.ts:8-14`): `codex` com o enum
  `AskForApproval`, `opencode` com regra ausente resolvendo para `ask`. Os dois recusam o default
  permissivo.

## ADRs propostos

### ADR-M68-1 — `TrustPosture` do SDK é o tipo de evidência; não se cria um `TrustDecision`

**Alternativas.** (a) Tipo próprio `TrustDecision` como o roadmap sugeria — **rejeitada**: cria
segunda gramática de confiança ao lado da que o runtime usa, e `recordWiring` já consome a do SDK, o
que faria as duas divergirem no primeiro milestone que tocasse ambas. (b) `boolean` simples —
**rejeitada**: é exatamente a forma atual, só com outro nome; um booleano não carrega *quem decidiu* e
*por quê*. (c) Callback `isTrusted: () => boolean` — **rejeitada**: adia a decisão para dentro do
build, onde o erro já não tem contexto para ser reportado.

### ADR-M68-2 — A forma do `settingSources` muda, e isso é major

De `readonly SettingSource[]` para uma forma em que o source do repositório exige a posture. É
breaking em `@theokit/agents` e assumido como tal — a alternativa (aceitar as duas formas) preserva
para sempre o caminho inseguro, que é o que o milestone existe para fechar.

## Caveats honestos

- **Não li o corpo de `resolveTrustPosture`**, apenas a declaração e a doc. A afirmação de que a
  posture "é a única coisa que retém capacidade" é do SDK sobre si mesmo, e precisa valer também para
  o caminho de `settingSources` — que hoje **não** passa por ela. Confirmar isso é a primeira tarefa
  do PLAN, não uma premissa deste blueprint.
- **`TrustSource` não foi inspecionado.** Ele aparece em `TrustPosture` e provavelmente distingue
  store em disco de override de env; o PLAN precisa saber se a nossa API deve expô-lo.
- **A capacidade `K` é genérica.** O SDK não fixa o vocabulário de capacidades — quem chama declara.
  Qual o conjunto `K` correto para o framework (`project`? `hooks`? `mcp`? `skills`?) é decisão de
  desenho ainda **em aberto**, e o TheoCode usa oito nomes próprios. Copiar os oito seria importar
  vocabulário de produto para dentro do framework; escolher menos exige justificativa escrita.
