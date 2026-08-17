---
slug: m67-layered-boundary-passthrough
milestone_id: M67
created_at: 2026-08-12
cycle: discover
question: "Por que os símbolos de config/trust/wiring do SDK não atravessam @theokit/agents — e o que custa fazê-los atravessar?"
---

# Blueprint — M67: a fronteira em camadas e o que realmente a bloqueia

## Pergunta de investigação

`ROADMAP-v3.md` § M67 afirma: *"Custo de correção: re-export puro."* A investigação existe para
validar essa afirmação antes de qualquer código, porque ela é a justificativa de o M67 vir primeiro.

**Veredito: a afirmação está errada.** O re-export é trivial; o que o bloqueia não é.

## A causa real

Os oito símbolos (`foldLayers`, `verifyLayerOrdering`, `applySecurityFloor`, `resolveTrustPosture`,
`auditEnvReachability`, `recordWiring`, `WiredEntity`, `ToolResultContentBlock`) **não existem na
versão do `@theokit/sdk` que consumimos**. Não é omissão de barrel — é ausência de dependência.

Medido por download e grep de cada tarball publicado (`dist/`), não por leitura de changelog:

| Versão | Símbolos presentes (dos 7 novos) | O que entrou |
|---|---:|---|
| **4.40.0 — instalada hoje** | **0/7** | — |
| 4.43.0 | 0/7 | — |
| 4.44.0 | 0/7 | `loadProjectEnv` |
| 4.45.0 | 1/7 | `applySecurityFloor` |
| 4.46.0 | 3/7 | `foldLayers`, `verifyLayerOrdering` |
| 4.47.0 | 4/7 | `resolveTrustPosture` |
| 4.48.0 | 6/7 | `recordWiring`, `WiredEntity` |
| **4.49.0** | **7/7** | `auditEnvReachability` |
| 4.51.1 (latest) | 7/7 | — |

O piso é **4.49.0**, exatamente a versão que o TheoCode declara em `packages/agent/package.json:24`.
Não é coincidência: ele bumpou porque precisava desses símbolos, e por isso conseguiu importá-los
direto do `@theokit/sdk` enquanto nós não conseguiríamos nem re-exportá-los.

Isso reescreve a leitura do finding original. A cross-validation concluiu *"o consumidor quebrou a
própria regra de fronteira 6 vezes em vez de reimplementar"*. Verdade — mas a fronteira não estava
apenas mal desenhada: para nós ela era **intransponível**, porque a dependência declarada não
continha o que atravessar.

## O que a investigação encontrou além do escopo — e que corrige outros milestones

O bump não é só o pré-requisito do M67. Ele torna **visíveis** primitivas que outros milestones
assumiram ausentes. Varredura do `dist/` de 4.49.0 contra os nomes que o roadmap promete construir:

| Milestone | O roadmap prometia construir | Estado real em 4.49.0 | Consequência |
|---|---|---|---|
| **M72** | `classifyTranscriptArtifact(name, isDirectory)` | **`classifySessionArtifact` já existe** | Construir seria reinventar (Rung 2/4). O DoD do M72 tem de consumir, não escrever. |
| **M82** | "exportar a união `RunEvent`" | `RunEvent` + `mcp_server_failed` **existem e são tipados** (4.41.0) | Vira re-export, não trabalho novo. O duck-check do consumidor deixa de ser necessário. |
| **M79** | `resolveCredential` público | **`resolveCredential` e `loadProjectEnv` existem** | O motivo declarado para retê-lo ("duas funções homônimas divergentes") precisa ser reavaliado contra 4.49, não contra 4.40. |
| **M74** | árvore de instruções | `readProjectInstructions` existe; `@theokit/sdk/context` virou barrel público (4.42.0) | O escopo do M74 encolhe: falta budget/frontmatter/escada, não a leitura. |
| **M71** | ciclo de vida de sessão | `listSessions`/`deleteSession` **não existem**; `encodeProjectDir` segue sem inverso | Confirmado como lacuna real. |
| **M75** | motor de hooks | `HookSpec`/`hookFingerprint`/`buildHookHandlers` **não existem** | Confirmado como lacuna real. |

**Esta é a descoberta de maior valor do ciclo**, e ela só apareceu porque o DISCOVER não foi pulado.
Escrever o M72 antes deste levantamento produziria uma reimplementação de primitiva existente — o
anti-pattern que a `parsimony-ladder` classifica como "Rule 9 violation dressed as *it was simpler to
write my own*".

## Risco do salto de nove minors

Avaliado pelo CHANGELOG publicado dentro do tarball 4.49.0 (`package/CHANGELOG.md`), não por
suposição:

- **Nenhuma entrada Major. Nenhum BREAKING.** As nove são `Minor Changes` aditivas ou `Patch`.
- **Duas são correções de segurança a nosso favor:** 4.41.1 confina imports de contexto `@path` ao
  repositório em que são declarados; 4.42.1 corrige uma checagem de containment que admitia diretório
  irmão e qualquer symlink. Ficar em 4.40.0 é permanecer exposto às duas.
- Risco residual real: os gates de paridade (`scripts/check-auth-parity.mjs`,
  `scripts/check-sandbox-parity.mjs`, `scripts/check-wire-parity.mjs`,
  `packages/agents/tests/unit/subpath-coverage.test.ts`, `packages/agents/tests/unit/subpath-surface.test.ts`)
  fixam superfícies do SDK símbolo a símbolo. Nove minors aditivas **adicionam** símbolos, e um gate
  que exige veredito por símbolo falha quando aparece um símbolo sem veredito. Isso é o gate
  funcionando, não uma regressão — mas é trabalho que o M67 tem de absorver, e o roadmap não previu.

## Coverage Corner 1 — Integration Tests

O que precisa de teste de integração, e por quê:

- **Re-export resolve em runtime, não só em tipo.** Um `export { x } from '@theokit/sdk'` compila
  contra o `.d.ts` e explode em runtime se o símbolo não estiver no bundle. Teste: importar cada um
  dos 8 do barrel público e afirmar `typeof !== 'undefined'`.
- **Os gates de paridade sobrevivem ao bump.** `pnpm check:auth-parity`, `check:direction`,
  `test:types` e as duas suítes de subpath rodam contra o SDK novo antes do merge.
- **A suíte inteira sob 4.49.0.** É o único jeito honesto de medir a superfície do salto de nove
  minors; nenhuma leitura de changelog substitui.

## Coverage Corner 2 — Dependencies

- `@theokit/sdk` — declarado `^4.40.0` em `packages/agents`, `packages/theo`, `packages/http` e
  `packages/presenter` (este último com peer `^4.40.0` e dev `^3.8.0`, divergência já registrada como
  finding #20 e endereçada no M70). O bump precisa ser **coordenado** entre os quatro, senão o
  workspace resolve duas cópias.
- Nenhuma dependência nova é introduzida por este milestone. O re-export não adiciona superfície de
  supply-chain; o bump move uma dependência já declarada dentro do mesmo major.
- `@theokit/sdk-tools` e `@theokit/sdk-pty` são pares independentes e **não** são tocados.

## Coverage Corner 3 — Tools

- `npm view @theokit/sdk versions` + download por tarball + `grep` no `dist/` — o método que produziu
  a tabela de bracket. Ler o changelog teria dado a resposta errada: 4.42.1 na fonte local do irmão
  **tem** os símbolos em `packages/sdk/src/index.ts`, mas a versão publicada de mesmo número não os
  tem. Fonte local ≠ registry.
- `scripts/check-auth-parity.mjs`, `scripts/check-sandbox-parity.mjs`, `scripts/check-wire-parity.mjs`,
  `packages/agents/tests/unit/subpath-coverage.test.ts` e
  `packages/agents/tests/unit/subpath-surface.test.ts` — os gates existentes
  que precisam ser estendidos, não substituídos.
- `pnpm knip` — para provar que cada símbolo re-exportado tem consumidor (G7).

## Coverage Corner 4 — Techniques

- **Enumeração explícita, nunca `export *`.** O barrel já pratica as duas formas e documenta por quê:
  `export *` para subpaths pequenos e coesos onde "parte do domínio" não é unidade significativa
  (`/errors`, `/retry`, `/concurrency`, `/messages`, `/models` —
  `packages/agents/src/index.ts:166-170`), e lista nomeada para o resto. A família config/trust/wiring
  entra **nomeada**: ela não é um subpath, é um recorte da barra root, e `export *` sobre a root
  arrastaria a superfície inteira do SDK para dentro do nosso barrel.
- **Veredito in/out por símbolo com motivo escrito** — a técnica que o `subpath-coverage.test.ts` já
  aplica aos 28 subpaths e que precisa ser replicada para a barra root, que é onde o buraco estava.
- **Narrowing de pass-through quando o SDK promete demais** — o precedente do `Agent.list`
  (`packages/agents/src/index.ts:94-120`). Não se aplica a nenhum dos 8, mas é a regra que decide
  quando um pass-through deixa de ser puro.

## ADRs

### ADR-0060 — O piso do `@theokit/sdk` passa a ser `^4.49.0`

**Contexto.** Sete dos oito símbolos do M67 não existem antes de 4.49.0. O piso não é escolha de
gosto: é a menor versão publicada em que o milestone é sequer expressável.

**Alternativas consideradas.**
1. **Ficar em 4.40.0 e reimplementar os 8 símbolos localmente.** Rejeitada: viola a Rung 9
   (`.claude/rules/parsimony-ladder.md`) e a G2 (`.claude/rules/sdk-runtime.md`) —
   `resolveTrustPosture` e `applySecurityFloor` são política de runtime/segurança
   do SDK; uma segunda implementação diverge silenciosamente da primeira, que é exatamente o defeito
   que o M67 existe para fechar.
2. **Bump para `^4.51.1` (latest).** Rejeitada por ora: adiciona duas minors sem demanda medida. O
   piso é o que a evidência sustenta; subir além disso é escolha sem critério. O range `^4.49.0`
   admite 4.51.1 de qualquer forma.
3. **Bump só em `packages/agents`.** Rejeitada: o workspace resolveria duas cópias do SDK, e
   `instanceof` sobre a hierarquia de erro — que o M80 vai endurecer — falharia entre elas.

**Decisão.** `^4.49.0` nos quatro pacotes que declaram a dependência, no mesmo commit.

**Consequência declarada.** Os gates de paridade vão falhar apontando símbolos novos sem veredito.
Isso é o gate funcionando; o M67 absorve o trabalho de dar veredito a cada um.

### ADR-0061 — O veredito de cobertura passa a incluir a barra root

**Contexto.** A omissão sobreviveu porque o gate exige veredito para os 28 **subpaths** do SDK, e os
oito símbolos vivem na **barra root**, que nenhum gate enumera. O buraco não era de disciplina — era
de escopo do gate.

**Alternativas consideradas.**
1. **Revisão humana no PR.** Rejeitada: é exatamente o que já existia e falhou nove minors seguidas.
2. **`export *` da barra root do SDK.** Rejeitada: arrasta a superfície inteira do SDK para o nosso
   barrel, apaga a fronteira que o M63 desenhou e torna toda adição upstream automaticamente pública
   aqui — o oposto de um veredito.

**Decisão.** Tabela de veredito ROOT-BAR em `packages/agents/tests/unit/subpath-coverage.test.ts`, mesma disciplina
in/out-com-motivo já aplicada aos subpaths.

## Caveats honestos

- A varredura de "o que já existe no SDK" foi feita por `grep` de **nome** no `dist/`. Nome presente
  não prova semântica equivalente: `classifySessionArtifact` pode não cobrir os quatro tipos de
  artefato que o M72 precisa. O que a varredura estabelece é **obrigação de verificar antes de
  escrever**, não equivalência.
- O CHANGELOG lido é o publicado dentro do tarball 4.49.0. Ele descreve o que cada minor adicionou,
  não o que cada uma pode ter mudado em comportamento não documentado. Só a suíte rodando sob 4.49.0
  responde isso — e é por isso que ela é DoD, não formalidade.
- A fonte local do irmão (`../theokit-sdk`, 4.42.1) está **atrás** do registry (4.51.1) e por isso é
  fonte não-confiável para "o que está publicado". Foi usada apenas para confirmar que os símbolos
  existem em código, não para determinar versões.
