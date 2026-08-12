---
slug: m68-setting-sources-trust-gate
milestone_id: M68
created_at: 2026-08-12
goal: Tornar irrepresentável habilitar o source `project` de `settingSources` — que liga hooks executores de shell vindos do diretório de trabalho — sem passar a `TrustPosture` que o autoriza, usando a primitiva de confiança que o SDK já publica em vez de inventar uma segunda gramática.
---

# M68 — O `settingSources` do repositório exige evidência de confiança

## Goal

`packages/agents/src/bridge/define-agent.ts:76-84` aceita `settingSources?: readonly SettingSource[]`.
Habilitar `'project'` liga a descoberta de `<cwd>/.theokit/`, **incluindo `hooks.json`, que executa
shell**. A JSDoc reconhece o risco e o justifica: *"é opt-in porque `.theokit/` é o repo do próprio
app (consentimento informado)"*.

A premissa vale para um app web cujo `cwd` é o próprio deploy. **Não vale** para a classe de produto
que o framework endereça — um agente cujo `cwd` é um repositório que o usuário acabou de clonar. Ali
`.theokit/` é conteúdo controlado pelo atacante, e habilitar `project` é execução remota de código no
primeiro `build()`.

Este milestone troca documentação por tipo: o source do repositório passa a exigir uma
`TrustPosture` — **a primitiva que o SDK já publica** e que o M67 tornou alcançável — em vez de um
literal de string. Fora de escopo, explicitamente: o motor de hooks (é o M75, e depende deste).

## Coverage Matrix

| # | Afirmação Goal/DoD | Task(s) |
|---|---|---|
| C1 | ADR aceito ANTES do código: a evidência é a `TrustPosture` do SDK, não um tipo novo | T0 |
| C2 | Os três tipos de confiança do SDK atravessam o barrel (`TrustPosture`, `TrustLevel`, `TrustPostureInput`, `TrustSource`) | T1 |
| C3 | Habilitar o source do repositório com um literal de string **não compila** | T2 |
| C4 | Uma posture `untrusted` faz o source do repositório ser **recusado**, não silenciosamente ignorado | T3 |
| C5 | A recusa é observável — canal de aviso, não silêncio | T3 |
| C6 | Uma posture `trusted` habilita o source normalmente (a guarda não proíbe tudo) | T3 |
| C7 | O caminho `user`-only continua funcionando sem posture alguma | T3 |
| C8 | A `SettingSourcesCapability` deixa de ser pass-through cru e passa a interpor a decisão | T4 |
| C9 | O conjunto de capacidades `K` do framework é declarado e justificado | T0, T4 |
| C10 | CHANGELOG + changeset major, com a migração escrita | T5 |

## Baseline Context

**Git sha de partida:** o HEAD de `workspace` após o M67 (`528fc8ca`).

### Files that will be touched

| Arquivo | LoC | Papel |
|---|---:|---|
| `packages/agents/src/bridge/define-agent.ts` | ~400 | Declara `settingSources` e a JSDoc que justifica o risco (linhas 76-84) |
| `packages/agents/src/capability/agent-capabilities.ts` | 843 (dir) | `SettingSourcesCapability` — hoje um `FieldCapability` cru (linhas 136-139) |
| `packages/agents/src/bridge/agent-builder.ts` | — | `.settingSources()` na cadeia fluente (linhas ~152-156) |
| `packages/agents/src/index.ts` | 300 | Onde os tipos de confiança do SDK atravessam |
| `packages/agents/tests/unit/root-bar-coverage.test.ts` | 230 | Vereditos ROOT-BAR — os tipos novos precisam de decisão |
| `packages/agents/tests/type/*.test-d.ts` | — | Onde o controle de tipo fechado é provado |

### Current callers / dependents

- `packages/agents/src/bridge/agent-builder.ts` — `.settingSources(['project','user'])` na cadeia.
- `packages/theo/src/server/agent/**` — monta agentes via o builder; precisa auditar se algum caminho
  passa `'project'`.
- Fora do repo, o **TheoCode** chama `.settingSources(projectSourceAllowed(posture.allows) ? [...] : ['user'])`
  (`chat.ts:386`) — ele **já tem** a posture e já toma a decisão certa; só não consegue passá-la
  adiante. É o consumidor que a mudança desbloqueia, não quebra.

### Domain glossary

- **`TrustPosture<K>`** — o veredito de confiança do SDK: `{ level, source, allows }`. Medido no
  corpo (`dist/index.js`): `allows` é **all-or-nothing**, todo `K` declarado recebe o mesmo booleano.
  O que ela carrega de útil não é granularidade — é **nível, proveniência e o conjunto declarado**.
- **`TrustSource`** — `'env' | 'store' | 'default'`. `default` implica sempre `untrusted`: ausência
  nunca concede.
- **Setting source** — raiz de descoberta de config em disco. `'project'` = `<cwd>/.theokit/`,
  `'user'` = `~/.theokit/`. Só o primeiro é controlado por quem escreveu o repositório aberto.
- **Controle de tipo fechado** — a chamada errada não compila. Distinto de validação em runtime: um
  call site errado não chega a nascer. Precedente no repo: o narrowing de `Agent.list`.

### Architecture boundaries affected

- **Nenhuma fronteira movida.** Opera dentro de `packages/agents`; não cria pacote, não altera o DAG.
- **G2 intacta.** A descoberta e a execução de config continuam sendo do SDK (ADR-0040). O que muda é
  **o que o framework exige antes de pedir ao SDK que descubra** — human gate, que a ADR-0040 aloca
  explicitamente ao core.
- **A fronteira que muda é a de API publicada:** a forma de `settingSources` é breaking.

## Prior Art

- `.claude/knowledge-base/discoveries/blueprints/m68-setting-sources-trust-gate-blueprint.md` — a
  investigação, incluindo a descoberta de que o tipo de evidência já existe.
- `@theokit/sdk` `dist/index.d.ts:3106-3212` — o vocabulário `TrustLevel`/`TrustSource`/`TrustPosture`
  e o consumidor canônico `recordWiring`, cuja doc afirma que *"uma posture é a única coisa neste
  pacote que retém uma capacidade"*.
- `@theokit/sdk` `dist/index.js` `recordWiring` — o **padrão de recusa** a seguir: lança
  `UngatedCapabilityError` quando alguém registra uma capacidade que a posture não gateia. Recusar é
  melhor que ignorar, e o SDK já escolheu esse lado.
- `packages/agents/src/index.ts:94-120` (M103) — o precedente de controle de tipo fechado no repo, com
  o residuo declarado ("liga consumidores TypeScript apenas; um `.js` ou um `as any` escapam").
- `packages/agents/src/bridge/approval-posture.ts:8-14` — o mesmo raciocínio aplicado a aprovação:
  *"uma ausência não tem `match` exaustivo, não aparece em log nenhum e não falha teste nenhum"*.

## ADRs

### ADR-M68-1 — A evidência é a `TrustPosture` do SDK; nenhum `TrustDecision` novo

**Contexto.** O `ROADMAP-v3` § M68 propunha inventar um `TrustDecision`. O SDK já publica
`TrustPosture<K>`, e o M67 a tornou alcançável.

**Alternativas.** (a) Tipo próprio — REJEITADA: cria segunda gramática de confiança ao lado da que o
runtime usa, e `recordWiring` já consome a do SDK; as duas divergiriam no primeiro milestone que
tocasse ambas. (b) `boolean` — REJEITADA: é a forma atual com outro nome, e não carrega quem decidiu
nem por quê. (c) Callback `isTrusted: () => boolean` — REJEITADA: adia a decisão para dentro do build,
onde o erro perde o contexto que o tornaria acionável.

### ADR-M68-2 — A recusa é um erro tipado, não um descarte silencioso

**Contexto.** Duas formas de "não habilitar": ignorar o source e seguir, ou recusar. O SDK já
escolheu — `recordWiring` lança `UngatedCapabilityError`.

**Alternativas.** (a) Ignorar com aviso — REJEITADA: o produto continua rodando acreditando que os
hooks do repositório estão ativos; o modo de falha é silencioso e do lado errado. (b) Ignorar em
silêncio — REJEITADA pelo mesmo motivo, sem sequer o aviso.

### ADR-M68-3 — O conjunto de capacidades `K` do framework é mínimo e declarado

**Contexto.** `resolveTrustPosture<K>` deixa o vocabulário de capacidades a cargo de quem chama. O
TheoCode declara oito nomes próprios.

**Alternativas.** (a) Copiar os oito do TheoCode — REJEITADA: importa vocabulário de produto para
dentro do framework. (b) Um só nome genérico (`'project'`) — a proposta: o framework gateia **a raiz
de descoberta**, e o que essa raiz habilita (hooks, skills, subagentes, MCP) é decisão do SDK. Um
vocabulário mais fino aqui prometeria granularidade que a `allows` all-or-nothing não entrega.

## Tasks

### T0 — Os três ADRs (GATE)

- **Why this step:** a forma da API e a semântica da recusa são contrato. Fixá-las antes impede que a
  implementação as re-decida quando o typecheck reclamar.
- **TDD:** N/A. Aceitação: cada ADR com ≥ 1 alternativa rejeitada e motivo.

### T1 — Os tipos de confiança atravessam o barrel

- **Why this step:** sem eles o consumidor não consegue **nomear** o que precisa passar, e a API nova
  seria inexprimível do lado de fora.
- **Files:** `packages/agents/src/index.ts` (bloco M68), `tests/unit/root-bar-coverage.test.ts`.
- **TDD (RED):** `tests/type/trust-posture-passthrough.test-d.ts` —
  `expectTypeOf<TrustPosture<'project'>>().toEqualTypeOf<SdkTrustPosture<'project'>>()`; vermelho hoje
  porque os nomes não existem no barrel.

### T2 — O literal de string deixa de compilar

- **Why this step:** é o coração do milestone. Documentação não impediu o risco; tipo impede.
- **TDD (RED):** `tests/type/setting-sources-gate.test-d.ts` —
  `// @ts-expect-error` sobre `.settingSources(['project'])`. O teste falha hoje **porque a linha
  compila** e o `@ts-expect-error` fica sem erro para suprimir. Mais o caso positivo: `user`-only
  compila sem posture.

### T3 — A recusa em runtime, com as três lentes

- **Why this step:** um controle de tipo liga só consumidores TypeScript (residuo declarado no M103).
  Um `.js` ou um `as any` escapam, e a recusa em runtime é o que os cobre.
- **TDD (RED):** `tests/unit/setting-sources-gate.test.ts`
  - `test_project_source_is_refused_when_the_posture_is_untrusted` — erro tipado, não descarte.
  - `test_the_refusal_names_the_capability_and_the_trust_source` — a mensagem diz **o que** foi
    recusado e **de onde veio** a decisão (`env`/`store`/`default`).
  - `test_project_source_is_wired_when_the_posture_is_trusted` — a guarda não proíbe tudo.
  - `test_user_source_needs_no_posture` — o caminho seguro segue trivial.

### T4 — `SettingSourcesCapability` interpõe a decisão

- **Why this step:** hoje é `FieldCapability` cru — o valor atravessa como veio. A capability é onde a
  decisão pertence, senão cada site de construção a repete.
- **Parsimony:** rung 6 — o mínimo é a capability validar e projetar; nenhuma classe nova.

### T5 — Registro

- CHANGELOG com a migração escrita (`['project','user']` → a forma nova), changeset **major**, e a
  correção da JSDoc: a pré-condição real é *"seguro apenas quando `cwd` é código que você controla"*.

## Dependencies

| Dependência | Range | Mudança | Rule 9 |
|---|---|---|---|
| `@theokit/sdk` | `^4.49.0` | nenhuma — já no piso desde o M67 | A primitiva de confiança é do SDK; este milestone a **consome**, não a reimplementa |

Nenhuma dependência nova.

## Failure scenarios

Sinais de I/O externo: leitura de `.theokit/` em disco (feita pelo SDK, não por nós).

| Cenário | Comportamento exigido |
|---|---|
| Posture `untrusted` + `.theokit/hooks.json` presente | Nenhum hook instalado; erro tipado nomeando capacidade e `TrustSource` |
| Posture com conjunto `K` que não inclui o source pedido | Recusa, no molde do `UngatedCapabilityError` do SDK — não "assume permitido" |
| `envOverride` ausente | **Não concede.** `undefined` é "o operador não ligou", nunca "desligou" — herdado do SDK |
| Consumidor `.js` (sem tipos) passando a forma antiga | O controle de tipo não o alcança; a recusa de runtime (T3) é o que o cobre |

## Concurrency tests

`(none — single-threaded)`. O milestone valida e projeta um valor no caminho de construção do agente;
não introduz lock, canal, worker nem estado compartilhado mutável.

## Drawbacks & Risks

| # | Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|---|
| R1 | Breaking change numa API de autoria muito usada | Certa | Todo call site com `settingSources` precisa mudar | É `@theokit/agents`, versionado por major; a migração vai escrita no CHANGELOG e o valor de segurança justifica |
| R2 | O time trata a `TrustPosture` como carimbo e sempre passa `trusted` | Média | O gate vira teatro | O tipo força a decisão a **existir num lugar auditável**; o M73 entrega o trust store que a persiste por diretório. Não há defesa mecânica contra alguém que decide mal — só contra quem não decide |
| R3 | `allows` é all-or-nothing e a API pode sugerir granularidade | Média | Consumidor espera gatear hooks sem gatear skills, e não consegue | ADR-M68-3 escolhe um vocabulário mínimo justamente para não prometer o que a primitiva não entrega |
| R4 | O controle de tipo não alcança consumidores `.js` | Certa | Um `as any` escapa | Residuo declarado, no molde do M103; a recusa de runtime (T3) é a cobertura |
| R5 | O M75 (motor de hooks) depende deste, e atrasá-lo atrasa aquele | Certa | Cadeia de dois milestones | É a ordem correta: o motor de execução não pode aterrissar antes do gate que decide se ele roda |

## Unresolved Questions

- Q1 — **A `TrustPosture` deve ser exigida por source, ou uma por build?** Uma por build é mais
  simples e casa com o all-or-nothing da `allows`; por source permitiria `user` sem posture e
  `project` com. Proposta: por source, porque só um dos dois é perigoso.
- Q2 — **O framework deve expor `resolveTrustPosture` como caminho recomendado, ou aceitar qualquer
  `TrustPosture` construída à mão?** Aceitar qualquer uma é mais permissivo e testável; recomendar o
  construtor do SDK dá proveniência (`TrustSource`) de graça.
- Q3 — **Algum caminho interno do `packages/theo` passa `'project'` hoje?** Precisa de auditoria em
  T4; se passar, o milestone tem um call site interno a migrar além do contrato externo.

## Test Plan

| Nível | O quê | Onde |
|---|---|---|
| Tipo | `.settingSources(['project'])` não compila; `user`-only compila | `tests/type/setting-sources-gate.test-d.ts` |
| Tipo | Os tipos de confiança do SDK são nomeáveis pelo barrel | `tests/type/trust-posture-passthrough.test-d.ts` |
| Unit | Recusa com erro tipado sob posture `untrusted`; mensagem nomeia capacidade e `TrustSource` | `tests/unit/setting-sources-gate.test.ts` |
| Unit | Wiring normal sob posture `trusted`; `user`-only sem posture | idem |
| Unit | Veredito ROOT-BAR para os tipos novos | `tests/unit/root-bar-coverage.test.ts` |

## Acceptance Criteria / DoD mapping

| DoD do `ROADMAP-v3` § M68 | Task | Verificação |
|---|---|---|
| Habilitar o source do repositório exige um **valor**, não literal | T2 | `@ts-expect-error` que quebra se a linha voltar a compilar |
| `TrustDecision` é um tipo do framework com proveniência | T0, T1 | **Ajustado pelo DISCOVER:** é a `TrustPosture` do SDK, que já carrega `source` — inventar um seria segunda gramática |
| Sem construtor implícito ("assumeTrusted()") | T0 | Nenhum helper que produza posture concedida sem entrada |
| Teste negativo: hooks.json + sem trust ⇒ nenhum hook, motivo no canal de aviso | T3 | `test_project_source_is_refused_when_the_posture_is_untrusted` |
| JSDoc declara a pré-condição real | T5 | texto revisado |
| CHANGELOG marcando o breaking + linha de migração | T5 | entrada + changeset major |
