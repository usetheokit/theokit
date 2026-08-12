---
slug: m67-layered-boundary-passthrough
milestone_id: M67
created_at: 2026-08-12
goal: Fazer a família config/trust/wiring do SDK atravessar `@theokit/agents` — o que exige, antes do re-export, elevar o piso de `@theokit/sdk` de `^4.40.0` para `^4.49.0`, a menor versão publicada em que os oito símbolos existem — e estender o gate de cobertura à barra root, que é onde a omissão sobreviveu a nove minors.
---

# M67 — Fechar a fronteira em camadas: pass-through da família config/trust/wiring

## Goal

`packages/agents/src/index.ts:53-58` declara a doutrina: *"o consumidor importa as primitivas core do
SDK a partir de `@theokit/agents`, não de `@theokit/sdk` diretamente"*, e o M63 chamou essa fronteira
de fechada. Ela não está. Oito símbolos — `foldLayers`, `verifyLayerOrdering`, `applySecurityFloor`,
`resolveTrustPosture`, `auditEnvReachability`, `recordWiring`, `WiredEntity`,
`ToolResultContentBlock` — não atravessam, e o consumidor real (TheoCode) quebrou a própria regra de
fronteira **seis vezes** para alcançá-los.

O DISCOVER estabeleceu que a causa não é omissão de barrel: **sete dos oito não existem na versão do
SDK que consumimos** (`4.40.0`). O milestone portanto tem duas metades, nesta ordem: elevar o piso da
dependência para `^4.49.0`, e só então re-exportar — com um veredito de cobertura sobre a **barra
root**, que nenhum gate enumera hoje e por isso deixou a omissão sobreviver a nove minors.

Fora de escopo, explicitamente: nenhum wrapper. Todos os oito são pass-through puro — `foldLayers` e
`applySecurityFloor` são funções puras, `resolveTrustPosture` e `recordWiring` são derivações, e
envolvê-los seria a cerimônia que a `parsimony-ladder` Rung 9 recusa.

## Coverage Matrix

Toda afirmação do Goal/DoD mapeia para ≥ 1 task.

| # | Afirmação Goal/DoD | Task(s) |
|---|---|---|
| C1 | ADR aceito ANTES do código (GATE): o piso passa a ser `^4.49.0`, com as alternativas rejeitadas registradas | T0 |
| C2 | `@theokit/sdk` sobe para `^4.49.0` nos três pacotes que o declaram, no mesmo commit | T1 |
| C3 | A divergência declarado-vs-testado do `presenter` (dev `^3.8.0` vs peer `^4.40.0`) é fechada | T1 |
| C4 | A suíte inteira passa sob 4.49.0 — a única medida honesta do salto de nove minors | T2 |
| C5 | Os gates de paridade existentes passam ou recebem veredito para cada símbolo novo | T2, T5 |
| C6 | Os 8 símbolos são re-exportados de `@theokit/agents` por lista nomeada, nunca `export *` | T3 |
| C7 | Cada símbolo resolve em RUNTIME, não só em tipo (referential identity, padrão M73) | T4 |
| C8 | Tabela de veredito ROOT-BAR em `subpath-coverage.test.ts`, disciplina in/out-com-motivo | T5 |
| C9 | Um símbolo novo na barra root do SDK sem veredito quebra o build UMA vez | T5 |
| C10 | CHANGELOG + o registro de que o custo declarado no roadmap estava errado | T6 |

## Baseline Context

**Git sha de partida:** `5ce0f7d2` (branch `workspace`).

### Files that will be touched

| Arquivo | LoC | Papel |
|---|---:|---|
| `packages/agents/src/index.ts` | 226 | O barrel público. Onde os 8 entram; já contém os blocos M58/M63/M77/M78 com a mesma doutrina |
| `packages/agents/tests/unit/subpath-coverage.test.ts` | 403 | O gate de veredito por subpath (28 subpaths). Onde a tabela ROOT-BAR entra |
| `packages/agents/tests/unit/subpath-surface.test.ts` | 156 | Fixa a superfície símbolo a símbolo dos entries de pass-through |
| `packages/agents/package.json` | — | `dependencies["@theokit/sdk"] = "^4.40.0"` |
| `packages/theo/package.json` | — | `devDependencies` `^4.40.0` + `peerDependencies` `^4.40.0` (optional) |
| `packages/presenter/package.json` | — | `devDependencies` **`^3.8.0`** + `peerDependencies` `^4.40.0` — divergem por uma major |
| `scripts/check-auth-parity.mjs` / `check-sandbox-parity.mjs` / `check-wire-parity.mjs` | — | Gates que fixam superfícies do SDK e podem reagir ao bump |

### Current callers / dependents

- Dentro deste repo, **nenhum**: é essa a lacuna. Grep por
  `foldLayers|verifyLayerOrdering|applySecurityFloor|resolveTrustPosture|auditEnvReachability|recordWiring`
  em `packages/` retorna zero ocorrências.
- Fora do repo, o TheoCode importa seis dos oito direto de `@theokit/sdk`, em seis arquivos de
  produção — `config/layers.ts:10`, `config/config.ts:1`, `config/trust-posture.ts:8-11`,
  `config/security-floor.ts:22`, `wired-capabilities.ts:22`, `tools/view-image.ts:15`.
- Dependentes de quem MUDA: `packages/agents/src/index.ts` é o barrel público de `@theokit/agents`,
  consumido por `packages/theo` (dep interna) e por todo app scaffoldado. Adicionar exports é aditivo;
  o que não é aditivo é o piso de peer (ver Drawbacks).

### Domain glossary

- **Barra root (root bar):** o entry `.` do `package.json` do SDK — distinto dos 31 subpaths
  (`./auth`, `./sandbox`, …). Os oito símbolos vivem na barra root; o gate de cobertura de hoje só
  enumera subpaths, e é exatamente por isso que a omissão sobreviveu.
- **Pass-through:** re-export sem wrapper, preservando identidade referencial. Um `instanceof`
  através da fronteira só continua verdadeiro se o valor for o mesmo objeto, não uma cópia — daí a
  asserção ser `toBe` e não `toBeDefined`.
- **Veredito in/out:** cada unidade coberta pelo gate precisa de decisão escrita — `in` (e o teste
  verifica que atravessa) ou `out` (com motivo não-vazio). É a **falta** de veredito que quebra o
  build, não o veredito `out`. Essa distinção é o que separa uma política de um muro.
- **Piso (floor) de dependência:** a menor versão que um range admite. `^4.49.0` tem piso 4.49.0 e
  teto implícito < 5.0.0.

### Architecture boundaries affected

- **Nenhuma fronteira é movida.** O milestone opera dentro da G1: `@theokit/agents` já depende de
  `@theokit/sdk`, e o plano não cria pacote, não inverte direção e não adiciona aresta ao DAG.
- **G2 (`.claude/rules/sdk-runtime.md`) fica intacta** — re-exportar não é reimplementar. Ao
  contrário: o milestone existe justamente para tornar a reimplementação desnecessária.
- **A fronteira que MUDA é a de contrato publicado**, não a de código: `peerDependencies` de
  `theokit` e `@theokit/presenter` passam a exigir um piso maior. É a única mudança visível a quem
  instala, e por isso tem tratamento próprio em T6.

## Prior Art

- **`.claude/knowledge-base/discoveries/blueprints/m67-layered-boundary-passthrough-blueprint.md`** —
  a investigação que produziu a tabela de bracket por versão, o levantamento de risco do salto de nove
  minors e a descoberta de que outros milestones (M72/M74/M79/M82) têm DoD desatualizado contra 4.49.
- **`packages/agents/src/index.ts:144-170` (M78)** — o precedente direto: a mesma política de veredito,
  aplicada a subpaths. Este milestone a estende ao eixo que faltava.
- **`packages/agents/src/index.ts:76-120` (M103)** — o precedente de quando um pass-through **não** é
  puro: o narrowing de `Agent.list`. Nenhum dos oito se qualifica, e o plano registra por quê.
- **`packages/agents/tests/unit/subpath-coverage.test.ts:24-30`** — a justificativa de `toBe` sobre
  `toBeDefined`: se o build inlinear o SDK, a camada passa a exportar uma **cópia**, `instanceof` vira
  `false` em silêncio e nenhum teste comportamental fica vermelho.

## ADRs

### ADR-0060 — O piso do `@theokit/sdk` passa a ser `^4.49.0`

**Contexto.** Medição por download e `grep` no `dist/` de cada tarball publicado: 4.40.0 tem 0 dos 7
símbolos novos; 4.45.0 tem 1; 4.46.0 tem 3; 4.47.0 tem 4; 4.48.0 tem 6; **4.49.0 tem 7**. O piso não
é preferência — é a menor versão em que o milestone é expressável.

**Alternativas consideradas.**
1. **Permanecer em 4.40.0 e reimplementar os oito localmente.** Rejeitada. Viola a Rung 9 e a G2:
   `resolveTrustPosture` e `applySecurityFloor` são política de segurança do runtime, e uma segunda
   implementação diverge silenciosamente da primeira — precisamente o defeito que o milestone fecha.
2. **Subir para `^4.51.1` (latest).** Rejeitada por ora. Adiciona duas minors sem demanda medida; o
   range `^4.49.0` já admite 4.51.1 na resolução.
3. **Subir só em `packages/agents`.** Rejeitada. O workspace resolveria duas cópias do SDK e o
   `instanceof` sobre a hierarquia de erro — que o M80 vai endurecer — falharia entre elas.

**Decisão.** `^4.49.0` nos três pacotes que declaram a dependência, no mesmo commit.

**Consequência declarada.** Os gates de paridade podem falhar apontando símbolos novos sem veredito.
Isso é o gate funcionando; T5 absorve o trabalho.

### ADR-0061 — O veredito de cobertura passa a incluir a barra root

**Contexto.** A omissão sobreviveu a nove minors porque o gate exige veredito para os subpaths e os
oito símbolos vivem na barra root, que nenhum gate enumera. O buraco era de escopo do gate, não de
disciplina de quem revisou.

**Alternativas consideradas.**
1. **Confiar na revisão humana do PR.** Rejeitada: é o que já existia, e falhou nove vezes seguidas.
2. **`export *` da barra root do SDK.** Rejeitada: arrasta a superfície inteira do SDK para o nosso
   barrel, apaga a fronteira que o M63 desenhou, e torna toda adição upstream automaticamente pública
   aqui — o oposto de um veredito.
3. **Tabela ROOT-BAR só com os oito.** Rejeitada: seria um allowlist do que entra, e o próprio
   cabeçalho do `subpath-coverage.test.ts:10-18` explica por que allowlist falha — "ninguém decidiu
   ainda" fica indistinguível de "decidimos que fica fora".

**Decisão.** Veredito para **todo** símbolo da barra root do SDK, mesma disciplina in/out-com-motivo.

### ADR-0062 — O `presenter` passa a ser testado contra o range que declara

**Contexto.** `packages/presenter/package.json` declara peer `^4.40.0` e dev `^3.8.0`. O pacote é
testado contra uma major que **não pode** conter os símbolos que seu peer promete. Isso já era finding
#20 da cross-validation, atribuído ao M70.

**Alternativas consideradas.**
1. **Deixar para o M70.** Rejeitada: este milestone move todos os ranges de SDK do workspace. Sair
   deixando um pacote testado contra uma major anterior mantém, dentro do commit que fecha a
   fronteira, um pacote cuja suíte verde não prova nada sobre o contrato declarado.
2. **Alinhar o peer ao dev (baixar para `^3.8.0`).** Rejeitada: inverteria o contrato — o peer é a
   promessa ao consumidor, o dev é como a verificamos.

**Decisão.** `devDependencies["@theokit/sdk"]` do presenter passa a `^4.49.0`, igual ao peer. O DoD
correspondente do M70 fica satisfeito por antecipação e será marcado lá (task de correção pós-M67).

## Tasks

### Phase 0 — Design gate

#### T0 — Escrever ADR-0060/0061/0062 (o GATE)

- **Why this step:** o piso de dependência e o escopo do gate são decisões de contrato. Fixá-las antes
  do código impede que a implementação as re-decida por conveniência quando a suíte ficar vermelha.
- **Deliverable:** `.claude/knowledge-base/adrs/0060-m67-sdk-floor-4-49.md`,
  `0061-m67-root-bar-coverage-verdict.md`, `0062-m67-presenter-dev-peer-alignment.md`.
- **TDD:** N/A (artefato de documentação). Aceitação: cada ADR contém ≥ 1 alternativa rejeitada com
  motivo; `test -f` nos três caminhos.

### Phase 1 — Elevar o piso

#### T1 — Bump coordenado para `^4.49.0`

- **Why this step:** sem ele o re-export de T3 não compila — os símbolos não existem no `.d.ts`.
- **Files:** `packages/agents/package.json` (dep), `packages/theo/package.json` (dev + peer),
  `packages/presenter/package.json` (dev **e** peer), `pnpm-lock.yaml` via `pnpm install`.
- **TDD (RED):** `packages/agents/tests/unit/sdk-floor.test.ts` — três testes, não um:
  - `test_every_package_declaring_the_sdk_pins_at_least_4_49`: lê os três `package.json`, extrai todo
    range de `@theokit/sdk` em dep/dev/peer e afirma que **nenhum** admite < 4.49.0. Vermelho hoje em
    três contagens (agents ^4.40, theo ^4.40 ×2, presenter ^3.8/^4.40).
  - `test_the_RESOLVED_sdk_satisfies_the_declared_floor` **(EC-1)**: lê
    `require('@theokit/sdk/package.json').version` e afirma `>= 4.49.0`. Sem ele o teste acima prova a
    **declaração** e não a instalação: com o range subido e o `pnpm install` esquecido, o gate fica
    verde, o `node_modules` continua em 4.40.0 e T3 explode em runtime — o defeito declarado-vs-testado
    que este milestone existe para fechar, reintroduzido pelo gate do próprio milestone.
  - `test_the_workspace_resolves_exactly_one_sdk_copy` **(EC-7)**: exatamente uma entrada
    `@theokit+sdk@*` em `node_modules/.pnpm`. É o cenário que o ADR-0060 usa para rejeitar o bump
    parcial; sem o teste, a rejeição é argumento e não verificação.
- **Parsimony:** rung 4 — dependência já declarada; o milestone move um range, não adiciona pacote.

#### T2 — Medir o salto: suíte + gates sob 4.49.0

- **Why this step:** nove minors aditivas segundo o changelog não é o mesmo que nove minors sem efeito.
  Só a suíte responde, e ela precisa responder **antes** de qualquer código novo, para que uma falha
  seja atribuível ao bump e não ao re-export.
- **Comandos:** `pnpm install`, `pnpm test`, `pnpm typecheck`, `pnpm lint --max-warnings=0`,
  `pnpm check:direction`, `pnpm check:auth-parity`, `node scripts/check-sandbox-parity.mjs`,
  `node scripts/check-wire-parity.mjs`.
- **TDD:** N/A (medição). Aceitação: ou tudo verde, ou cada vermelho classificado como (a) símbolo novo
  sem veredito → vira trabalho de T5, ou (b) mudança de comportamento → vira task nova com teste de
  regressão ANTES do fix. Nenhum vermelho pode ser silenciado.
- **(EC-6) A classificação vai para o log, com evidência.** Cada vermelho é registrado em
  `.claude/knowledge-base/implementations/m67-layered-boundary-passthrough/` com o comando, a saída e o
  motivo da classificação. Sem o registro, "classificamos como benigno" é indistinguível de "não
  olhamos" — e é a única forma de esse gate ser burlado sem deixar rastro.

### Phase 2 — Fazer atravessar

#### T3 — Re-exportar os oito por lista nomeada

- **Why this step:** é o objetivo declarado do milestone, e a forma (lista nomeada, não `export *`)
  é o que preserva a fronteira que o M63 desenhou.
- **Files:** `packages/agents/src/index.ts` — um bloco novo com o mesmo formato dos blocos
  M58/M63/M77, comentando a causa (a família não atravessava porque a dependência não a continha) e
  citando os seis sites do consumidor que a ausência forçou.
- **TDD (RED):** `packages/agents/tests/unit/root-bar-passthrough.test.ts` —
  `test_config_trust_wiring_VALUES_cross_the_barrel`: importa os **seis valores** (`foldLayers`,
  `verifyLayerOrdering`, `applySecurityFloor`, `resolveTrustPosture`, `auditEnvReachability`,
  `recordWiring`) e afirma `expect(barrel.foldLayers).toBe(sdk.foldLayers)` para cada um. `toBe`, não
  `toBeDefined`, pelo motivo registrado em `subpath-coverage.test.ts:24-30`.
  **(EC-2)** Os dois restantes — `WiredEntity` e `ToolResultContentBlock` — são **tipos**, e uma
  asserção de valor sobre eles compara `undefined` com `undefined` e fica verde mesmo se o re-export
  não existir. Eles saem daqui e ficam exclusivamente na asserção de tipo de T4.
- **Parsimony:** rung 6 — o mínimo que resolve é a linha de re-export. Nenhum wrapper.

#### T4 — Provar resolução em runtime, não só em tipo

- **Why this step:** `export { x } from '@theokit/sdk'` compila contra o `.d.ts` e explode em runtime
  se o símbolo não estiver no bundle. O tipo verde é uma prova insuficiente e conhecida.
- **TDD (RED):** no mesmo arquivo de T3, e com a separação de EC-2 respeitada —
  `test_every_reexported_VALUE_is_defined_at_runtime`: para cada um dos **seis valores**,
  `expect(typeof barrel[name]).not.toBe('undefined')`.
  `test_the_two_reexported_TYPES_are_nameable_from_the_barrel`: `expectTypeOf` sobre `WiredEntity` e
  `ToolResultContentBlock` importados de `@theokit/agents` — a única asserção que prova um tipo, já
  que ele não existe em runtime.
- **Parsimony:** rung 5 — uma asserção por símbolo, sem harness.

### Phase 3 — Fechar o buraco do gate

#### T5 — Tabela de veredito ROOT-BAR

- **Why this step:** sem ela, o próximo símbolo de barra root some do mesmo jeito, e o milestone teria
  corrigido a instância sem corrigir a causa.
- **Files:** `packages/agents/tests/unit/subpath-coverage.test.ts` — nova `describe` com um
  `ROOT_BAR_VERDICTS: Record<string, Inside | Outside>` cobrindo **todo** export da barra root do SDK,
  reusando as interfaces `Inside`/`Outside` já definidas no arquivo (DRY — não duplicar o tipo).
- **TDD (RED):**
  - `test_every_root_bar_VALUE_has_a_verdict` **(EC-3)**: enumera a barra root do SDK via
    `createRequire` e afirma que cada nome tem entrada. Vermelho hoje para dezenas de nomes. O nome do
    teste diz `VALUE` porque `createRequire` devolve o objeto de runtime: todo `export type` do SDK é
    apagado na compilação e **não** aparece em `Object.keys`. Prometer "todo export tem veredito" seria
    a mesma classe de buraco que o milestone fecha — um eixo não enumerado — um nível abaixo.
  - `test_root_bar_out_verdict_has_non_empty_reason`: todo `out` tem motivo com > 20 caracteres.
  - `test_root_bar_in_verdict_actually_crosses`: todo `in` é verificado por identidade referencial.
  - `test_the_root_bar_list_does_not_reference_a_nonexistent_export`: o inverso — veredito para um
    nome que o SDK não exporta mais também quebra, senão a tabela apodrece.
- **Parsimony:** rung 4 — reusa as interfaces e o `createRequire` já presentes no arquivo.

### Phase 4 — Registro

#### T6 — CHANGELOG + correção do custo declarado

- **Why this step:** o `ROADMAP-v3.md` afirma que o M67 custa "re-export puro, zero implementação".
  Fechar o milestone deixando a afirmação de pé transforma um erro medido em folclore.
- **Files:** `CHANGELOG.md` (`[Unreleased] § Changed` para o piso, `§ Added` para os oito símbolos);
  nota no `ROADMAP-v3.md` § M67 registrando o custo real; changeset em `.changeset/`.
- **(EC-4) Impacto de release, declarado e não implícito:** `theokit` e `@theokit/presenter` publicam
  `peerDependencies["@theokit/sdk"]`. Elevar o piso de `^4.40.0` para `^4.49.0` faz o `install` de um
  app pinado em 4.4x anterior passar a falhar a resolução de peer. Isso é **mudança de contrato de
  instalação**, não melhoria interna: a entrada do CHANGELOG diz literalmente "consumidores precisam
  de `@theokit/sdk >= 4.49.0`", e o changeset é dimensionado de acordo (minor com nota de breaking de
  peer, ou major se a política do repo exigir — decidido AQUI, com o texto na mão, nunca deixado ao
  default da ferramenta).
- **TDD:** N/A. Aceitação: entrada no CHANGELOG referenciando o milestone E nomeando o piso novo; a
  nota do roadmap cita a tabela de bracket por versão; existe changeset.

## Dependencies

| Dependência | Range atual | Range alvo | Ecossistema | Rule 9 (não reinventar) |
|---|---|---|---|---|
| `@theokit/sdk` | `^4.40.0` (agents, theo) / `^3.8.0` dev (presenter) | `^4.49.0` | npm | Já é a dependência canônica; o milestone move o piso, não troca de fornecedor |

Nenhuma dependência nova é adicionada. Nenhuma é removida. O `@theokit/sdk-tools` e o
`@theokit/sdk-pty` são pares independentes e não são tocados.

## Failure scenarios

Sinais de I/O externo presentes: o `pnpm install` fala com o registry npm.

| Cenário | Comportamento exigido |
|---|---|
| Registry indisponível durante o install | O milestone PARA. Nenhum re-export é escrito contra um `.d.ts` que não foi instalado — seria compilar contra suposição |
| `4.49.0` resolvido mas com um símbolo ausente do bundle (só no `.d.ts`) | T4 pega: a asserção de runtime falha. É exatamente para isso que ela existe |
| Um gate de paridade fica vermelho após o bump | Classificar antes de agir: símbolo novo sem veredito → T5; mudança de comportamento → task nova com teste de regressão ANTES do fix |
| `pnpm install` resolve duas cópias do SDK (ranges divergentes entre pacotes) | T1 falha por construção — o teste afirma que nenhum range admite < 4.49.0 nos três pacotes |

## Concurrency tests

`(none — single-threaded)`. O milestone move ranges de dependência e adiciona linhas de re-export;
não introduz mutex, lock, canal, goroutine, worker nem estado compartilhado mutável. O único
paralelismo presente é o do runner de testes, que já é isolado por arquivo.

## Drawbacks & Risks

| # | Risco / desvantagem | Probabilidade | Impacto se acontecer | Mitigação |
|---|---|---|---|---|
| R1 | O salto de nove minors carrega mudança de comportamento não documentada. As entradas do changelog são todas aditivas, mas changelog não é prova | Média | Suíte vermelha sem causa atribuível, e a tentação de culpar o re-export | T2 mede ANTES de T3 escrever qualquer linha, de modo que a falha seja atribuível ao bump |
| R2 | A tabela ROOT-BAR nasce grande — dezenas de exports, cada um exigindo veredito escrito. A tentação de gerar `out: 'TODO'` em massa é o modo de falha óbvio | Alta | O gate fica verde tendo sido atendido na letra e traído no espírito | Teste exige motivo com mais de 20 caracteres, o que torna preenchimento automático detectável; o resíduo (motivos plausíveis porém irrefletidos) vai para olhar humano no `/review` (EC-9) |
| R3 | Elevar o piso de `peerDependencies` é quebra de contrato de instalação: um app pinado em 4.4x anterior passa a falhar a resolução de peer | Alta (é certo, para quem estiver pinado) | Consumidor quebra no `install` sem aviso | T6 nomeia no CHANGELOG ("consumidores precisam de `>= 4.49.0`") e dimensiona o changeset de acordo, nunca ao default da ferramenta (EC-4) |
| R4 | Permanecer em 4.40.0 tem custo de segurança — 4.41.1 e 4.42.1 corrigem containment de imports `@path` e de symlink | Já materializado | Exposição contínua a duas falhas de containment conhecidas | O bump remove como efeito colateral. Registrado para que ninguém proponha reverter por conservadorismo |
| R5 | O ADR-0062 invade um DoD do M70 (alinhar dev/peer do presenter) | Certa | Sobreposição de escopo entre milestones | Declarado, não escondido. A alternativa era deixar o presenter testado contra uma major que não pode conter o que seu peer promete |
| R6 | (EC-5) `^4.49.0` admite qualquer 4.x futura, inclusive uma que remova um dos oito símbolos | Baixa | Vermelho no CI, e o caminho fácil é afrouxar a asserção em vez de investigar | O teste de T3 roda contra a versão RESOLVIDA, então a remoção fica vermelha. Registrado para que a próxima pessoa saiba que o vermelho é o sinal, não o problema |
| R7 | O gate `symbol_fab_unverifiable_typescript` do `/code-quality` embutido não consegue verificar fabricação de símbolo neste plano | Certa (já observada) | Cap de 70 no score independentemente do conteúdo do plano | Registrada como limitação de ferramenta na seção Unresolved (Q4), não como defeito de plano — e reavaliada no `/code-quality` real, sobre o código, em vez de sobre o markdown |

## Unresolved Questions

- Q1 — **Qual o tamanho real da barra root do SDK?** A enumeração exata só é possível após o install
  de 4.49.0. Se passar de ~80 símbolos, a tabela ROOT-BAR vira arquivo próprio em vez de uma
  `describe` dentro do `subpath-coverage.test.ts`. Decisão a tomar em T5 com o número na mão.
- Q2 — **`ToolResultContentBlock` já existe em 4.40.0** (o único dos oito que existe). Entra no mesmo
  bloco por coesão de domínio, ou separado? Proposta: mesmo bloco, com nota de que não dependia do
  bump — a coesão é do consumidor, não da versão.
- Q3 — **O `scripts/check-wire-parity.mjs` importa `packages/presenter/dist/`.** Se o bump exigir
  rebuild do presenter para o gate rodar, é ordenação de build a resolver em T2; não bloqueia o
  desenho.

## Test Plan

| Nível | O quê | Onde |
|---|---|---|
| Unit | Nenhum range de `@theokit/sdk` admite < 4.49.0 nos três pacotes | `packages/agents/tests/unit/sdk-floor.test.ts` |
| Unit | A versão **resolvida** satisfaz o piso (EC-1) | idem |
| Unit | O workspace resolve exatamente uma cópia do SDK (EC-7) | idem |
| Unit | Os seis **valores** atravessam com identidade referencial (`toBe`) | `packages/agents/tests/unit/root-bar-passthrough.test.ts` |
| Unit | Os seis valores resolvem em runtime; os dois **tipos** por `expectTypeOf` (EC-2) | idem |
| Unit | Todo **valor** da barra root tem veredito; todo `out` tem motivo; todo `in` atravessa; nenhum veredito órfão (EC-3) | `packages/agents/tests/unit/subpath-coverage.test.ts` |
| Integração | Suíte inteira + typecheck + lint + os quatro gates de paridade sob 4.49.0 | `pnpm check:all` |

Nenhum teste toca LLM, rede ou disco fora do workspace. O `createRequire` lê o pacote instalado, que é
o mesmo artefato que o runtime carrega — é a fonte certa para a enumeração.

## Acceptance Criteria / DoD mapping

| DoD do `ROADMAP-v3.md` § M67 | Task | Verificação mecânica |
|---|---|---|
| Os 8 símbolos re-exportados sem wrapper | T3 | `root-bar-passthrough.test.ts` com `toBe` |
| Tabela de veredito ROOT-BAR com disciplina in/out | T5 | 4 testes em `subpath-coverage.test.ts` |
| A próxima omissão de barra root falha o teste | T5 | `test_every_root_bar_export_has_a_verdict` |
| `pnpm test` / `typecheck` / `lint --max-warnings=0` / `knip` verdes | T2 | `pnpm check:all` |
| Entrada no CHANGELOG | T6 | `[Unreleased]` não-vazio citando o milestone |
| **Adicionado pelo DISCOVER:** piso `^4.49.0` nos três pacotes | T1 | `sdk-floor.test.ts` |
| **Adicionado pelo DISCOVER:** dev/peer do presenter alinhados | T1 | `sdk-floor.test.ts` cobre dev e peer |
| **Adicionado pelo DISCOVER:** custo real registrado, corrigindo o roadmap | T6 | nota em `ROADMAP-v3.md` § M67 |
| **EC-1:** a versão resolvida satisfaz o piso, não só a declarada | T1 | `test_the_RESOLVED_sdk_satisfies_the_declared_floor` |
| **EC-2:** tipos não são afirmados por asserção de valor | T3, T4 | teste de valor cobre 6; `expectTypeOf` cobre 2 |
| **EC-3:** o gate ROOT-BAR declara que cobre valores, não tipos | T5 | nome do teste + motivo escrito |
| **EC-4:** o CHANGELOG nomeia o piso novo como quebra de peer | T6 | entrada cita `>= 4.49.0`; changeset existe |
| **EC-7:** uma só cópia do SDK no workspace | T1 | `test_the_workspace_resolves_exactly_one_sdk_copy` |

Critérios não-mecanizáveis, declarados para evidência humana: **um** — EC-9 do relatório de edge cases
(a tabela ROOT-BAR preenchida com motivos plausíveis porém irrefletidos). Não tem defesa mecânica; é
item explícito de olhar humano no `/review`.

**Versão do plano:** v1.1 — absorve os 4 MUST FIX e os 3 SHOULD TEST de
`.claude/knowledge-base/reviews/m67-layered-boundary-passthrough-edge-cases-2026-08-12.md`.
