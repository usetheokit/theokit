---
slug: remover-dependencia-ai
created_at: 2026-08-05
goal: Remover `ai` da superfície publicada do TheoKit, mantendo o wire compatível
---

# Plan: Remover a dependência `ai` da superfície publicada

> **Version 1.1** — absorve os 8 MUST FIX de
> [`reviews/remover-dependencia-ai-edge-cases-2026-08-05.md`](../reviews/remover-dependencia-ai-edge-cases-2026-08-05.md).
> O mais grave (EC-1) invalidava a v1.0: o `JSON.parse` sem guarda quebraria no frame `[DONE]` que o
> nosso próprio servidor emite ao final de **todo** stream. Também entram: normalização de
> terminador SSE (EC-2), guarda de chunk após `finish` (EC-3), asserção de tipo em uma direção só
> (EC-4), decisão explícita sobre bundling do presenter (EC-5, novo **D7**), gate que falha sem
> `dist/` (EC-6), e o canal de erro isento da leniência (EC-8, que resolve a antiga Q4).
>
> O TheoKit fala o wire `UIMessageStream` do ai-sdk e, por isso, obriga todo app
> consumidor a ter o pacote `ai` instalado. Este plano transfere a propriedade do wire para o
> TheoKit — espelhando as ~22 variantes de chunk que de fato usamos, com validação zod própria — e
> remove `ai` de `dependencies`/`peerDependencies` de todos os pacotes publicáveis, mantendo-o
> apenas como `devDependency` na função de **oráculo de teste diferencial**. O formato da frame não
> muda, então nenhum app existente quebra e a interoperabilidade com clientes ai-sdk sobrevive. O
> resultado observável: instalar `theokit` deixa de trazer o ai-sdk junto.

## Goal

> Remover `ai` da superfície publicada do TheoKit para que instalar `theokit` traga zero pacotes
> ai-sdk, medido por `scripts/check-ai-free-surface.mjs` reportando **0 referências de runtime em
> `dist/**/*.js`** e **0 declarações em `dependencies`/`peerDependencies`** nos 6 pacotes publicáveis.

## Context

O pedido original foi "remover a dependência `ai` de todos os projetos". A medição corrigiu duas
premissas: (a) apenas o `theokit` usa `ai` — os outros 11 repos irmãos estão em zero; (b) a
superfície de runtime são **dois `import()` dinâmicos num único arquivo**, não o runtime inteiro do
agente como uma anotação anterior afirmava.

A motivação, resolvida no grill, é **lock-in de ecossistema** — não peso (o uso de runtime é lazy e
o budget de 350KB gzip está verde), não licença (`ai` é Apache-2.0). O sintoma concreto do
acoplamento está em `packages/agents/src/client/consume-ui-message-stream.ts:73`, que fixa
comportamento interno de uma versão específica (`terminateOnError` sob `ai@7.0.14`), e em
`packages/agents/src/client/transport.ts:44`, onde o tipo de terceiro (`ChatTransport<UIMessage>`)
vira parte do nosso contrato publicado.

Este plano reverte deliberadamente a decisão D1 do [ADR-0050](../adrs/0050-m41-unified-agent-client-chattransport.md)
("Adopt `ai`'s `ChatTransport<UIMessage>` as the seam — do NOT invent a parallel interface") e abre
uma exceção consciente à Unbreakable Rule 9. Ambas exigem ADR próprio, registrado abaixo em D1 e D6.

Todas as decisões vêm de [`grills/remover-dependencia-ai-grill.md`](../grills/remover-dependencia-ai-grill.md)
(5 perguntas, 8 decisões).

## Baseline Context (deep review of current state)

### Superfície de runtime — medida nos dists PUBLICADOS

Medido em `theokit@0.44.3` e `@theokit/agents@7.0.0` instalados via `npm install` num projeto
descartável, separando `.js` de `.d.ts`:

| Pacote | `.js` (runtime) | `.d.ts` (tipos) |
|---|---|---|
| `theokit` | **0** | 2 |
| `@theokit/agents` | **1 chunk, 2 × `import("ai")`** | 5 |

**Armadilha registrada:** grepar `dist/` inteiro conta declarações de tipo como import de runtime e
produz a conclusão errada de que o runtime inteiro depende de `ai`. Sempre separe
`--include="*.js"` de `--include="*.d.ts"`.

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/presenter/src/wire/chunk-schema.ts` (NEW) | 0 | — | (a criar — união + schema zod das ~22 variantes) | — |
| `packages/presenter/src/wire/parse-wire-stream.ts` (NEW) | 0 | — | (a criar — substitui `parseJsonEventStream`) | — |
| `packages/presenter/src/wire/read-message-stream.ts` (NEW) | 0 | — | (a criar — substitui `readUIMessageStream`) | — |
| `packages/presenter/src/wire/types.ts` (NEW) | 0 | — | (a criar — `WireMessage`, `WireChunk`, `WireTransport`) | — |
| `packages/presenter/src/wire/index.ts` (NEW) | 0 | — | (a criar — barril do subpath `@theokit/presenter/wire`) | — |
| `packages/presenter/src/presenters/ui-message-stream.ts` | 186 | `bb1f4a51` (2026-07-23) | Traduz `AgentOutputEvent` → chunk do wire | Conjunto de variantes emitidas não pode encolher |
| `packages/agents/src/client/consume-ui-message-stream.ts` | 88 | `058ed095` (2026-07-27) | Consome SSE → `UIMessage` reconstruída; **único uso de runtime do `ai`** | `#136` — chunk `error` deve terminar o stream em `status='error'`, nunca ser engolido |
| `packages/agents/src/client/transport.ts` | 46 | `058ed095` (2026-07-27) | Declara `AgentTransport` — o seam público | Forma estrutural idêntica (assignment-compatible) |
| `packages/agents/src/client/http-transport.ts` | 132 | `058ed095` (2026-07-27) | Transport web sobre SSE | `implements` continua satisfeito estruturalmente |
| `packages/agents/src/client/in-process-transport.ts` | 218 | `191aef8a` (2026-07-27) | Transport in-process | idem |
| `packages/agents/src/client/channel-transport.ts` | 154 | `058ed095` (2026-07-27) | Transport Tauri (push) | idem |
| `packages/agents/src/client/agent-client.ts` | 319 | `191aef8a` (2026-07-27) | Store framework-agnóstico | `#drive` catch deve continuar superficiando erro |
| `packages/agents/src/client/use-agent.ts` | 126 | `058ed095` (2026-07-27) | Hook React | Assinatura pública inalterada |
| `packages/agents/src/client/last-user-text.ts` | 19 | `058ed095` (2026-07-27) | Extrai último texto do usuário | — |
| `packages/agents/src/bridge/present-ui-message-stream.ts` | 196 | `cc86ac8a` (2026-08-04) | Compõe sobre `@theokit/presenter` | — |
| `packages/agents/src/bridge/agent-endpoint.ts` | 284 | `d26ced47` (2026-08-04) | Endpoint HTTP do agente | Caminho in-process e HTTP passam pelo mesmo translator |
| `packages/agents/src/in-process-turn.ts` | 179 | `2fb70dd4` (2026-07-28) | Turno in-process | — |
| `packages/theo/src/server/agent/build-agent-streamer.ts` | 67 | `f3c022bc` (2026-07-12) | Monta o streamer | — |
| `packages/theo/src/server/agent/render-terminal.ts` | 150 | `54c3167a` (2026-07-24) | Presenter de terminal | — |
| `packages/theo/src/server/agent/durable-ui-message-stream-response.ts` | 74 | `54c3167a` (2026-07-24) | SSE resumível (M37) | Reconexão por `Last-Event-ID` preservada |
| `packages/theo/src/server/agent/thread-dispatcher.ts` | 86 | `54c3167a` (2026-07-24) | Dispatcher de thread (M39) | — |
| `packages/theo/src/server/define/ui-message-stream-response.ts` | 52 | `683c0a8c` (2026-07-04) | `Response` Web-Standards do wire | Content-Type + shape SSE inalterados |
| `packages/theo/src/client/create-agent-client.ts` | 129 | `058ed095` (2026-07-27) | Client SDK standalone (M44) | `theokit/client/core` continua React-free |
| `packages/presenter/package.json` | — | — | Manifesto | — |
| `packages/agents/package.json` | — | — | Manifesto | — |
| `packages/theo/package.json` | — | — | Manifesto | — |
| `package.json` (raiz) | — | — | Manifesto | — |
| `packages/create-theokit/templates/default/package.json.tmpl` | — | — | Manifesto do app scaffoldado | Demais pins intactos |
| `packages/create-theokit/templates/default/app/hooks/use-transcript.test.ts` | — | `—` | Teste do hook do template | — |
| `scripts/check-ai-free-surface.mjs` (NEW) | 0 | — | (a criar — gate do Goal) | — |
| `scripts/check-wire-parity.mjs` (NEW) | 0 | — | (a criar — detecta variante nova no `ai`) | — |
| `.github/workflows/architecture-guards.yml` | — | `b0789558` (2026-08-05) | Guards de arquitetura em CI | Jobs existentes continuam verdes |

### Current callers / dependents

- **Símbolo:** `consumeUIMessageStream` / `responseToChunkStream` / `consumeChunkStream` em `packages/agents/src/client/consume-ui-message-stream.ts`
- **Callers (produção):** `packages/agents/src/client/http-transport.ts`, `packages/agents/src/client/agent-client.ts`
- **Callers (testes):** `tests/unit/consume-chunk-stream.test.ts`, `tests/unit/http-transport.test.ts`, `tests/integration/http-transport-reconnect.test.ts`
- **External (API pública consumida por outros repos):** **sim** — exportado via `theokit/client`; nenhum repo irmão o consome hoje (medido: 0 ocorrências fora do `theokit`)

- **Símbolo:** `AgentTransport` em `packages/agents/src/client/transport.ts:44`
- **Callers (produção):** os três transports (`http`, `in-process`, `channel`), `agent-client.ts`, `packages/theo/src/client/create-agent-client.ts`
- **Callers (testes):** `tests/unit/agent-transport-types.test-d.ts`, `tests/unit/transport-context.test.ts`
- **External:** **sim** — é o seam público do ADR-0050; um app que implementa transport próprio tipa contra ele

- **Importadores de tipo do `ai` (17 em `src`, 26 em testes):** enumerados via
  `git ls-files '*.ts' '*.tsx' | xargs grep -l "from 'ai'"`. A lista completa de testes está no grill.

### Domain glossary

- **wire** — o formato SSE de frames que trafega entre o servidor do agente e o cliente; hoje o `UIMessageStream` do ai-sdk
- **chunk (variante)** — uma frame do wire, discriminada por `type` (`text-delta`, `tool-call`, `finish`…)
- **reconstrução** — o processo de acumular chunks em uma mensagem de assistente coerente
- **transport** — a abstração que entrega chunks ao store, independente do meio (HTTP SSE, in-process, Tauri Channel)
- **oráculo diferencial** — o `ai` mantido como devDependency, usado em teste para provar que nossa implementação produz saída idêntica à dele
- **espelho (mirror)** — nossa reimplementação dos tipos + schema do wire

### Architecture boundaries affected

- **`G1` (direção de dependência, `system-design-guardrails.md`)** — `theokit` passa a depender de `@theokit/presenter`, direta ou transitivamente via `@theokit/agents`. O `presenter` é folha (zero deps intra-monorepo), então **nenhum ciclo é criado**. Verificação obrigatória por `check-package-direction.mjs` + `dependency-cruiser`.
- **`G3` / `type-safety.md`** — o schema do wire passa a ser Zod, com os tipos derivados por `z.infer`, nunca duplicados à mão.
- **`G7`** — todo export novo do subpath `wire` precisa de consumidor ou teste; é o que impede o espelho de crescer além do usado.

## Prior Art & Related Work

- **ADR interno** — [`adrs/0050-m41-unified-agent-client-chattransport.md`](../adrs/0050-m41-unified-agent-client-chattransport.md) § "D1 — Adopt `ai`'s `ChatTransport<UIMessage>` as the seam (do NOT invent a parallel interface)". Este plano **supersede** essa decisão; ADR D1 abaixo registra a reversão. Os ADRs 0051–0054 se apoiam nela e precisam de nota de atualização.
- **Grill desta feature** — [`grills/remover-dependencia-ai-grill.md`](../grills/remover-dependencia-ai-grill.md), 8 decisões resolvidas; este plano implementa todas.
- **Patterns skill** — `skills/theokit-http-decorators-pattern-from-nestjs-patterns`, consumida pelo invariante que sua `description` declara: *"bridging DTO classes to Zod schemas while preserving the 'Zod is the Single Source of Truth' invariant from `.claude/rules/type-safety.md`"*. Aplicado em **D5**: o schema do wire é Zod e os tipos saem de `z.infer`, nunca declarados em paralelo. As demais recomendações da skill (decorators, `defineRoute`, `@UseGuards`) não se aplicam — este plano não toca a camada HTTP de decorators.
- **Padrão de gate já praticado neste repo** — `scripts/check-sandbox-parity.mjs` e `packages/agents/tests/unit/subpath-surface.test.ts` comparam a nossa superfície contra a do SDK e reprovam na divergência. `check-wire-parity.mjs` (T3.3) reusa o mesmo desenho.
- **Externa** — [Server-Sent Events, WHATWG HTML §9.2](https://html.spec.whatwg.org/multipage/server-sent-events.html): o transporte é SSE padrão; o parser precisa respeitar o framing de `data:`/`event:`/`id:` e a regra de linha em branco como terminador de evento.

## Objective

- [ ] `@theokit/presenter/wire` exporta a união de chunks (~22 variantes) + schema Zod + tipos, com `z.infer` como fonte única
- [ ] Parser e reconstrutor próprios substituem `parseJsonEventStream` e `readUIMessageStream`
- [ ] Teste diferencial prova saída idêntica à do `ai` para **toda** variante espelhada
- [ ] `dist/**/*.js` dos 6 pacotes publicáveis tem **zero** referências a `ai`
- [ ] `ai` sai de `dependencies`/`peerDependencies` em todos os pacotes; permanece só como `devDependency`
- [ ] App scaffoldado instala sem `ai` e roda um turno de agente ponta a ponta
- [ ] `check-ai-free-surface.mjs` e `check-wire-parity.mjs` rodam em CI e reprovam na regressão

## ADRs

### D1 — O TheoKit passa a ser dono do wire, mantendo o formato (supersede ADR-0050 D1)

**Decisão.** O seam público deixa de ser `ChatTransport<UIMessage>` do `ai` e passa a ser um tipo
nosso, estruturalmente idêntico. O **formato da frame não muda**: continuamos emitindo e lendo o
mesmo SSE do `UIMessageStream`.

**Rationale.** Lock-in é não conseguir sair, não falar um formato que outros também falam. Manter o
formato preserva interoperabilidade (um cliente ai-sdk continua conversando com um servidor TheoKit)
enquanto elimina a obrigação de ter o pacote instalado. Medição que sustenta a viabilidade: os
brands do `ai` estão em linhas 3149+ do seu `index.d.ts`, **depois** de `UIMessage` (1798) e
`UIMessageChunk` (2401); os tipos que espelhamos são estruturais puros, logo assignment-compatible.

**Alternativas rejeitadas.**
- *Definir formato próprio* — quebraria todo app existente e o template, sem ganho: o incômodo é o `import`, não a forma da frame.
- *Manter tudo como está* — não atende a motivação (lock-in) resolvida em D1 do grill.
- *Vendorizar o pacote inteiro* — arrastaria `@ai-sdk/{gateway,provider,provider-utils}` e 51 variantes, das quais 29 sem consumidor.

**Consequências.** Habilita a remoção da dep sem migração de consumidor. Restringe: passamos a ter
obrigação de acompanhar mudanças do formato upstream — mitigada por D4.

### D2 — Espelhar só o subconjunto usado; estrito na escrita, tolerante na leitura

**Decisão.** Espelhamos as ~22 variantes que o TheoKit emite/lê, não as 51 do `ai`. Escrita valida
contra o schema estrito e falha alto; leitura ignora variante desconhecida com aviso estruturado —
**exceto no canal de erro** (ver abaixo).

**Exceção obrigatória (EC-8, v1.1).** A leniência **NUNCA** se aplica a um frame cujo `type` é
`error`. O `type` é lido **antes** da validação de schema; se for `error`, o stream rejeita sempre —
com `errorText` quando presente, com mensagem genérica quando ausente. Sem essa exceção, as duas
regras deste plano se combinam no pior resultado possível: um `{"type":"error"}` malformado (campo
faltando, ou campo extra de um provider) falha o schema, cai na regra de descarte, e uma falha real
de 401/429/5xx vira silêncio — reintroduzindo pela porta lateral exatamente a regressão `#136` que
este plano se propõe a proteger. **Isto resolve a antiga Q4.**

**Rationale.** As 29 variantes não usadas seriam exports sem consumidor — reprovadas por `G7` e pelo
detector de dead-code do `/code-quality`, e YAGNI direto (Regra 11). A assimetria evita que a
economia vire fragilidade: emitir frame fora do contrato é bug nosso e deve explodir
(`error-handling.md § 2`), enquanto receber frame novo de um cliente mais recente não deve derrubar
o stream do usuário.

**Alternativas rejeitadas.**
- *Espelhar as 51* — código morto por construção, reprovado por gate existente.
- *Estrito nos dois lados* — um cliente ai-sdk mais novo derrubaria o stream por uma variante que não nos diz respeito.
- *Tolerante nos dois lados* — perderíamos a detecção de bug próprio na emissão.

**Consequências.** Habilita superfície mínima e verificável. Restringe: variante nova do SDK some em
silêncio na leitura — risco endereçado pelo gate de paridade em T3.3.

### D3 — O módulo mora em `@theokit/presenter/wire`

**Decisão.** Tipos, schema, parser e reconstrutor vivem num subpath novo do `@theokit/presenter`.

**Rationale.** Medido, o `presenter` é a **única folha** do DAG entre os pacotes que precisam do
wire (`presenter` → nada intra-monorepo; `agents` → sdk-*; `theokit` → agents, http). Qualquer outro
lugar cria dependência subindo o grafo, o que `G1` proíbe. É também o dono semântico: o presenter já
é *"the canonical AgentOutputEvent + Presenter Strategy"*, e as frames são o contrato de saída dele.

**Alternativas rejeitadas.**
- *Pacote novo `@theokit/wire`* — acrescentaria publish, changelog, versionamento e CI para código com dono natural; degrau 4 da escada de parcimônia manda reusar o já instalado.
- *Dentro de `@theokit/agents`* — `presenter` passaria a depender de `agents`, invertendo o grafo.

**Consequências.** Habilita consumo por todos sem ciclo, e conserta de graça a inversão atual (o
`presenter` declara `ai` como peer **não-opcional** só por um `import type`). Restringe: `theokit`
passa a depender do `presenter`, mudança de grafo que precisa passar pelos gates de direção.

### D4 — `ai` permanece como `devDependency`, na função de oráculo diferencial

**Decisão.** `ai` sai de `dependencies`/`peerDependencies` e fica só em `devDependencies`. Para cada
variante espelhada, um teste alimenta o mesmo stream SSE nos dois parsers e afirma saída idêntica.

**Rationale.** É a decisão que faz o plano viver ou morrer. Um espelho divergente é **pior que a
dependência**: a dep falha alto no install; o espelho falha baixo, em produção, num frame que
ninguém testou. O oráculo torna a reimplementação verificável, e reusa o padrão que este repo já
confia (`check-sandbox-parity.mjs`, `subpath-surface`).

**Alternativas rejeitadas.**
- *Só testes unitários próprios* — provam que o código faz o que escrevemos, não que bate com o wire real.
- *Remover `ai` totalmente, inclusive do lockfile* — perderíamos o oráculo; ficaríamos com fixtures congeladas que envelhecem em silêncio.

**Consequências.** Habilita verificação contínua de fidelidade. Restringe: `ai` continua no lockfile
e no CI — se o objetivo fosse *nunca mais ver o nome*, esta decisão não atende (declarado e aceito
no grill, Q5).

### D5 — O schema é Zod, com tipos derivados por `z.infer`

**Decisão.** A união de chunks é declarada uma vez como schema Zod; os tipos TypeScript saem de
`z.infer`, nunca escritos em paralelo.

**Rationale.** `G3` do `system-design-guardrails.md` e `type-safety.md` obrigam Zod como fonte única
— o mesmo invariante que a skill `theokit-http-decorators-pattern-from-nestjs-patterns` cita na sua
`description`. Zod já é dependência declarada (`zod ^4.4.3`, com override no root), então o degrau 4
da escada de parcimônia se aplica: reusar o instalado.

**Alternativas rejeitadas.**
- *Tipos à mão + validação manual* — duas representações do mesmo conhecimento; violação direta de DRY e de `G3`.
- *Outra lib de validação* — dep nova para problema já resolvido por uma presente.

**Consequências.** Habilita validação e tipos em sincronia por construção. Restringe: o custo de
runtime do zod entra no caminho de leitura — mensurável em T1.2.

### D6 — Exceção consciente à Unbreakable Rule 9, paga com o oráculo

**Decisão.** Este plano reimplementa um parser de wire que hoje é fornecido por biblioteca, o que a
Regra 9 desaconselha. A exceção é aberta explicitamente, não por omissão.

**Rationale.** O código atual justifica a dependência exatamente pela Regra 9
(`consume-ui-message-stream.ts:7`: *"No reinvented wire parser (Rule 9)"*). A decisão estratégica de
remover o lock-in vence a regra **neste caso**, e o que torna a exceção defensável é D4: compramos
um oráculo permanente que mantém a reimplementação verificável. Sem D4, esta exceção não se
sustentaria e o plano deveria ser recusado.

**Alternativas rejeitadas.**
- *Não abrir exceção e arquivar o plano* — legítimo, mas contraria a decisão de produto tomada no grill.
- *Abrir a exceção sem oráculo* — trocaria uma dependência auditável por um espelho não-auditável; pior que o estado atual.

**Consequências.** Habilita a remoção. Restringe: assumimos manutenção contínua do espelho; a dívida
é real e deve constar no CHANGELOG e no ADR, não ser silenciada.

### D7 — `@theokit/presenter` vira dependency externalizada, não bundle inlinado (EC-5, v1.1)

**Decisão.** `@theokit/presenter` entra em `dependencies` do `@theokit/agents` **e** na lista
`external` do `packages/agents/tsup.config.ts`. Deixa de ser inlinado no bundle.

**Rationale.** Hoje o presenter é `devDependency` e o tsup o **inlina** (verificado:
`UIMessageStreamPresenter` aparece em `@theokit/agents@7.0.0/dist/chunk-3YPKTOJ6.js`; a lista
`external` em `tsup.config.ts:38` cobre `@theokit/http`, `@theokit/sdk`, `@theokit/sdk-pty`,
`@theokit/sdk-tools` e `zod`, mas **não** o presenter). Promover a dependency sem tocar no `external`
faria o consumidor instalar o pacote **e** receber uma cópia embutida — duas instâncias do mesmo
schema Zod no mesmo processo, com peso duplicado e comparação de identidade quebrando de forma
difícil de diagnosticar. Externalizar alinha o presenter ao tratamento que os outros pacotes
`@theokit/*` já recebem.

**Alternativas rejeitadas.**
- *Manter inlinado e como devDependency* — funciona para o caso de uso atual, mas duplicaria o wire em cada pacote que o consumir (agents hoje, theo amanhã), e o schema Zod duplicado é justamente o tipo de estado que não tolera cópias.
- *Promover a dependency sem mexer no `external`* — é o defeito que o EC-5 aponta; a inconsistência é o bug.

**Consequências.** Habilita uma única instância do wire em runtime. Restringe: `@theokit/presenter`
passa a ser instalado por quem instala `@theokit/agents` — superfície pública maior, aceitável
porque ele já é publicado e versionado.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| O espelho diverge do wire real com o tempo e falha em produção, não no build | **Alta** | D4 — teste diferencial por variante contra o `ai` real, em CI; fixtures gravadas como piso quando o oráculo sair | Implementador |
| Variante nova do `ai` não espelhada some em silêncio na leitura (consequência de D2) | Média | `check-wire-parity.mjs` (T3.3) enumera a união do `ai` e reprova quando aparece variante que não temos, no padrão do `check-sandbox-parity.mjs` | Implementador |
| Reversão do ADR-0050 D1 deixa 0051–0054 citando uma decisão superseded | Média | T1.4 adiciona nota de supersede nos quatro ADRs, no mesmo commit que muda o seam | Implementador |
| `theokit` passa a depender de `@theokit/presenter` — mudança no grafo de pacotes | Média | Validado por `check-package-direction.mjs` + `dependency-cruiser` no CI; `presenter` é folha, então ciclo é impossível por construção | Implementador |
| Custo de runtime do zod no caminho de leitura do stream | Baixa | Medir antes/depois em T1.2; se regredir, validar só em dev e confiar em produção (decisão a registrar, não a assumir) | Implementador |
| Dívida de manutenção permanente do espelho (consequência assumida de D6) | Média | Registrada no ADR e no CHANGELOG; revisitar se o custo de acompanhamento superar o de reinstalar a dep | Owner do produto |

## Unresolved Questions

- Q1 — Nível do bump semver. A evidência aponta `minor`: o espelho é assignment-compatible (tipos estruturais) e remover um peer não-opcional é relaxamento, não quebra. Precisa ser confirmado em T2.2 verificando que nenhuma assinatura exportada muda de forma. Se alguma mudar, vira `major` em `@theokit/agents` (que acabou de sair em 7.0.0).
- Q2 — Destino das 26 ocorrências em testes. A maioria migra junto com o código sob teste, mas as de `tests/unit/consume-chunk-stream.test.ts` e as novas do harness devem **continuar** importando de `ai` deliberadamente, por serem o próprio oráculo. A separação precisa estar explícita, senão um gate futuro "zero imports de ai" apagaria o oráculo.
- Q3 — O `presenter` deve reexportar o `wire` no barril principal?** Reexportar facilita consumo mas aumenta a superfície pública do `presenter` (`G6` — 30 exports por pacote). A recomendação é **não** reexportar: subpath dedicado mantém o barril enxuto.
- Q4 — RESOLVIDA na v1.1 pelo EC-8. Frame malformado que passa no framing mas falha no zod é **descartado com aviso**, *exceto* quando seu `type` é `error` — nesse caso rejeita sempre, porque a leniência aplicada ao canal de erro transforma uma falha real de provider em silêncio, reintroduzindo o `#136`. A regra está em **D2 § Exceção obrigatória**, com RED em T1.2 (`test_chunk_error_rejeita_mesmo_malformado`) e T1.3 (`test_error_sem_start_rejeita_sem_crashar`).
- Q5 (nova, v1.1) — o limite de frame de 1MB é arbitrário. `MAX_FRAME_BYTES` foi escolhido por ordem de grandeza, não por medição. Um frame legítimo grande (tool output volumoso) pode passar disso. Medir o maior frame real observado antes de fixar o número, ou tornar configurável com default medido.

## Dependencies

Este plano **não adiciona nenhuma dependência externa nova**. Ele remove uma da superfície publicada
e reusa duas já declaradas — degrau 4 da escada de parcimônia (`parsimony-ladder.md`).

| Pacote | Versão | Ecossistema | Movimento | Rule 9 — por que não escrever do zero / por que não adicionar |
|---|---|---|---|---|
| `ai` | `7.0.14` (pin exato — EC-13) | npm | **`dependencies`/`peerDependencies` → `devDependencies`** | Não é adição: é a remoção que motiva o plano. Permanece como **oráculo** do teste diferencial (D4); sem ele a reimplementação fica não-verificável e a exceção à Regra 9 (D6) deixa de se sustentar. Pin exato, não `^`, para que um bump seja ato deliberado. |
| `zod` | `^4.4.3` (já declarada, com override na raiz) | npm | **reuso, sem mudança** | `G3` e `type-safety.md` obrigam Zod como fonte única de tipos. Escrever validação à mão duplicaria conhecimento (DRY) e violaria o invariante. Adicionar outra lib de validação seria dep redundante com uma já presente. |
| `@theokit/presenter` | `workspace:*` | npm (interno) | **`devDependencies` → `dependencies`** em `@theokit/agents`, com externalização no tsup (D7) | Pacote interno já publicado e versionado; não é dep de terceiro. A promoção é consequência de D3 (o wire mora nele). |

**Sem CVE a auditar por adição** — nenhuma dependência externa entra. A auditoria relevante é sobre
o `ai` que **permanece** em `devDependencies`: por ser dev-only, um CVE nele não alcança consumidor,
mas alcança nosso CI.

## Dependency Graph

```
Phase 0 (oráculo) ──▶ Phase 1 (o espelho) ──▶ Phase 2 (troca de consumidores) ──▶ Phase 3 (manifests + gates)
                            │                          │                                    │
                            │  T1.1 ─▶ T1.2 ─▶ T1.3    │  T2.1 e T2.2 em paralelo           │  T3.1 ─▶ T3.2
                            │      └──▶ T1.4           │                                    │  T3.3 em paralelo
                            ▼                          ▼                                    ▼
                                            Final Phase: Integration Validation
```

- **Phase 0 bloqueia tudo**: o harness diferencial precisa existir antes do espelho, senão a primeira variante é escrita sem oráculo.
- **T1.1 → T1.2 → T1.3** é sequencial (schema antes do parser, parser antes do reconstrutor). **T1.4** só depende de T1.1.
- **T2.1 e T2.2** paralelizam (runtime e tipos são independentes).
- **T3.3** paraleliza com T3.1/T3.2.

---

## Phase 0: Oráculo antes do espelho

**Objective:** Ter um harness que compara nossa implementação contra o `ai` real, funcionando e
vermelho, antes de escrever uma linha do espelho.

### T0.1 — Gravar fixtures do wire e montar o harness diferencial

#### Objective
Criar o conjunto de fixtures SSE (uma por variante emitida) e o harness que roda o mesmo input nos
dois parsers, afirmando saída idêntica.

#### Why this step (action + reasoning)

**O que faz.** Enumera as variantes que o `presenter` emite hoje, grava uma fixture SSE real para
cada uma, e escreve um harness que alimenta a fixture no `parseJsonEventStream`+`readUIMessageStream`
do `ai` e (futuramente) no nosso, comparando as saídas.

**Por que agora.** É o único momento em que o oráculo pode ser construído sem viés: escrito depois do
espelho, o harness tende a ser moldado para passar no que já foi implementado. Escrito antes, ele é o
RED que guia. Justificativa em **D4** e no risco de severidade Alta da tabela de Drawbacks.

#### Evidence
- Variantes emitidas hoje, medidas em `packages/presenter/src/presenters/ui-message-stream.ts` (186 LoC, `bb1f4a51`): `start`, `finish`, `error`, `status`, `text`, `text-start`, `text-delta`, `text-end`, `reasoning`, `reasoning-start`, `reasoning-delta`, `reasoning-end`, `tool-call`, `tool-input-available`, `tool-output-available`, `tool-output-error`, `tool-result`, `partial-tool-call`
- Mais, do lado do bridge (`packages/agents/src/bridge/agent-endpoint.ts`, 284 LoC, `d26ced47`): `tool-approval-request`
- O oráculo existe em `node_modules/ai` (`7.0.14`), disponível como devDependency

#### Files to edit
```
packages/presenter/tests/wire/fixtures/            — (NEW) uma fixture .sse por variante
packages/presenter/tests/wire/differential.test.ts — (NEW) RED: harness que compara os dois parsers
packages/presenter/package.json                    — adiciona `ai` em devDependencies (oráculo)
```

#### Deep file dependency analysis
- `packages/presenter/package.json` hoje declara `ai` como peer **não-opcional** `^7.0.0` + devDep `^7.0.0` (ver Baseline). Esta task **mantém** o devDep e não mexe no peer ainda — a remoção do peer é T3.1, para manter cada commit reversível.
- Nenhum arquivo de produção é tocado nesta task; o harness é puramente aditivo.

#### Deep Dives
- **Formato da fixture:** texto SSE cru, exatamente como sai do `ui-message-stream-response.ts` — linhas `data: {json}` separadas por linha em branco, **incluindo o frame terminal `data: [DONE]`** (`:27`). Gravar o byte real, não um JSON reconstruído, para que o teste exercite também o framing e o sentinela.
- **Invariante do harness:** a comparação é sobre a **sequência de mensagens reconstruídas**, não sobre os chunks intermediários — é o que o consumidor observa.
- **Edge cases a cobrir desde já:** stream vazio (body nulo), frame partido entre dois `chunk`s do `ReadableStream`, `data:` com espaço opcional, evento terminando sem linha em branco final, **uma variante CRLF de pelo menos uma fixture** (EC-2), e **uma fixture com `error` malformado** (EC-8).

#### Pseudo-code / Signatures
```pseudocode
function differential(fixture: string): void
  streamA = toReadable(fixture)
  streamB = toReadable(fixture)          -- dois readers: um stream só é consumível uma vez
  outA = collect(readUIMessageStream(parseJsonEventStream(streamA, aiSchema)))   -- oráculo
  outB = collect(readMessageStream(parseWireStream(streamB)))                    -- nosso (ainda não existe → RED)
  assert deepEqual(outA, outB)

# Example
input:  "data: {\"type\":\"start\"}\n\ndata: {\"type\":\"text-delta\",\"delta\":\"oi\"}\n\n"
output: ambos produzem [{ id, role:'assistant', parts:[{type:'text', text:'oi'}] }]
```

#### Tasks
1. Enumerar as variantes emitidas, a partir do `presenter` e do `agent-endpoint` (comando no Evidence)
2. Gravar uma fixture SSE por variante, capturando saída real do endpoint
3. Escrever o harness `differential.test.ts` chamando os dois lados
4. Confirmar que o teste falha por ausência do nosso parser (RED legítimo, não por erro de import)

#### TDD
```
RED:     test_differential_harness_falha_sem_nosso_parser() — o harness importa `parseWireStream` e o módulo não existe; a falha DEVE ser "module not found", provando que o oráculo está montado e esperando a implementação
RED:     test_toda_variante_emitida_tem_fixture() — enumera as variantes do presenter e afirma que existe uma fixture para cada; falha hoje (0 fixtures)
GREEN:   Gravar as fixtures até o segundo teste passar; o primeiro permanece RED até T1.2
REFACTOR: Extrair o leitor de fixtures para um helper se houver duplicação entre os dois testes
VERIFY:  pnpm --filter @theokit/presenter test
```

#### Concurrency tests
(none — single-threaded)
As fixtures são lidas de disco e alimentadas em `ReadableStream` sintéticos, sem concorrência real.
A concorrência do caminho de stream é exercitada em T1.2.

#### Acceptance Criteria
- [ ] Existe uma fixture SSE para cada variante emitida hoje — `test_toda_variante_emitida_tem_fixture` passa em `pnpm --filter @theokit/presenter test`; a contagem é afirmada por teste, não por inspeção
- [ ] O harness roda o oráculo com sucesso e falha apenas por ausência do nosso parser — a saída de `pnpm --filter @theokit/presenter test` contém `module not found: parseWireStream` e nenhum outro erro
- [ ] Pass: lint — `pnpm lint` sem warnings nos arquivos alterados
- [ ] Pass: size — todo arquivo alterado ≤ 500 linhas (`architecture.md`)

#### DoD
- [ ] `pnpm --filter @theokit/presenter test` mostra o RED esperado e nenhum erro inesperado
- [ ] Zero type errors — `pnpm typecheck`
- [ ] Zero lint warnings — `pnpm lint`

---

## Phase 1: O espelho

**Objective:** Implementar tipos, schema, parser e reconstrutor próprios, cada um validado pelo
oráculo da Phase 0.

### T1.1 — Schema Zod das variantes + tipos derivados

#### Objective
Declarar a união de chunks do wire uma única vez, em Zod, com os tipos TypeScript saindo de `z.infer`.

#### Why this step (action + reasoning)

**O que faz.** Cria `packages/presenter/src/wire/chunk-schema.ts` com o schema Zod das ~22 variantes
e exporta `WireChunk = z.infer<typeof wireChunkSchema>`.

**Por que agora.** É a raiz da árvore: parser (T1.2) e reconstrutor (T1.3) consomem este tipo, e
nenhum dos dois pode ser escrito antes. A escolha do Zod vem de **D5** e do invariante "Zod is the
Single Source of Truth" que a patterns skill cita.

#### Evidence
- Variantes enumeradas em T0.1 a partir de `packages/presenter/src/presenters/ui-message-stream.ts` (186 LoC, `bb1f4a51`)
- `zod ^4.4.3` já é dependência declarada, com override no `package.json` raiz — degrau 4 da escada de parcimônia
- `type-safety.md` § "Zod is the Single Source of Truth": *"NEVER duplicate a type that exists as Zod schema"*

#### Files to edit
```
packages/presenter/src/wire/chunk-schema.ts — (NEW) schema Zod + tipos derivados
packages/presenter/src/wire/index.ts        — (NEW) barril do subpath
packages/presenter/package.json             — declara o export `./wire`
packages/presenter/tests/wire/chunk-schema.test.ts — (NEW) RED primeiro
```

#### Deep file dependency analysis
- Todos os arquivos são novos; nada quebra a jusante nesta task.
- `packages/presenter/package.json` ganha uma entrada em `exports` — precisa espelhar o padrão dos subpaths existentes (`types` + `import`), senão o consumidor recebe `.d.ts` errado.

#### Deep Dives
- **Estrutura:** `z.discriminatedUnion('type', [...])` — discriminada, não `z.union`, para que o erro de validação aponte a variante e não liste 22 falhas.
- **Invariante:** o conjunto de variantes aqui é o contrato de escrita (D2, lado estrito). Toda variante que o `presenter` emite DEVE existir aqui, e o teste de T0.1 (`test_toda_variante_emitida_tem_fixture`) tem um irmão aqui afirmando o mesmo contra o schema.
- **Edge cases:** campos opcionais (`providerMetadata`, `title`) precisam ser `.optional()`, não omitidos — um frame real do `ai` os traz e a validação estrita rejeitaria.

#### Pseudo-code / Signatures
```pseudocode
export const wireChunkSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), messageId: z.string().optional() }),
  z.object({ type: z.literal('text-delta'), id: z.string(), delta: z.string() }),
  ...
])
export type WireChunk = z.infer<typeof wireChunkSchema>

# Example
input:  { type: 'text-delta', id: 'a', delta: 'oi' }
output: parse OK → WireChunk estreitado para a variante text-delta
```

#### Tasks
1. Escrever o teste RED que afirma o conjunto de variantes suportadas
2. Declarar o schema Zod discriminado
3. Derivar `WireChunk` por `z.infer` e exportar do barril
4. Adicionar o export `./wire` no `package.json` do presenter

#### TDD
```
RED:     test_schema_aceita_toda_variante_emitida() — para cada fixture de T0.1, `wireChunkSchema.parse` de cada frame não lança
RED:     test_schema_rejeita_variante_desconhecida() — `{type:'inexistente'}` falha o parse (lado estrito da D2)
RED:     test_campos_opcionais_de_frame_real_sao_aceitos() — frame com `providerMetadata`/`title` passa
GREEN:   Implementar o schema até os três passarem
REFACTOR: Agrupar variantes da mesma família (text-*, reasoning-*, tool-*) em builders para reduzir repetição
VERIFY:  pnpm --filter @theokit/presenter test
```

#### Concurrency tests
(none — single-threaded)
Schema de validação é função pura sobre um objeto.

#### Acceptance Criteria
- [ ] Toda variante emitida hoje passa no `parse`
- [ ] Variante desconhecida é rejeitada — `wireChunkSchema.safeParse({type:'inexistente'})` returns false em `.success`
- [ ] `WireChunk` é derivado por `z.infer` — nenhum tipo escrito à mão duplicando o schema (`type-safety.md`)
- [ ] Pass: complexity — `npx eslint --max-warnings=0` retorna exit 0; complexidade ciclomática < 11 em cada arquivo alterado
- [ ] Pass: coverage — `pnpm test:coverage` ≥ 90% nos arquivos alterados
- [ ] Pass: lint / size — `pnpm lint` limpo; arquivos ≤ 500 linhas

#### DoD
- [ ] `pnpm --filter @theokit/presenter test` verde
- [ ] Zero type errors — `pnpm typecheck`
- [ ] Zero lint warnings — `pnpm lint`

### T1.2 — Parser SSE próprio (`parseWireStream`)

#### Objective
Substituir `parseJsonEventStream` por implementação própria que transforma um `ReadableStream` de
bytes SSE em `ReadableStream<WireChunk>` validado.

#### Why this step (action + reasoning)

**O que faz.** Implementa o framing SSE (acumular até linha em branco, extrair `data:`) e valida cada
frame contra o schema de T1.1, descartando variante desconhecida com aviso (D2, lado tolerante).

**Por que agora.** É a metade do runtime que hoje vem do `ai` (`consume-ui-message-stream.ts:42`).
Sem ele, T2.1 não pode remover o `import("ai")`.

#### Evidence
- `packages/agents/src/client/consume-ui-message-stream.ts:42` — `const { parseJsonEventStream, uiMessageChunkSchema } = await import('ai')`
- `packages/agents/src/client/consume-ui-message-stream.ts:46` — o `ai` valida cada frame contra o schema estrito e devolve `{ success, value }`; só os válidos seguem
- SSE framing: [WHATWG HTML §9.2](https://html.spec.whatwg.org/multipage/server-sent-events.html)

#### Files to edit
```
packages/presenter/src/wire/parse-wire-stream.ts — (NEW) o parser
packages/presenter/src/wire/index.ts             — exporta `parseWireStream`
packages/presenter/tests/wire/parse-wire-stream.test.ts — (NEW) RED primeiro
```

#### Deep file dependency analysis
- Consome `wireChunkSchema` de T1.1.
- A jusante, T2.1 substituirá a chamada em `consume-ui-message-stream.ts` (88 LoC, `058ed095`).

#### Deep Dives
- **Algoritmo:** `TextDecoderStream` → normalização de EOL → acumulador de linhas → ao encontrar linha em branco, monta o evento, extrai `data:`, guarda o sentinela, `JSON.parse` protegido, checa canal de erro, valida com Zod.
- **Invariante:** frame partido entre dois chunks do stream de bytes DEVE ser remontado — é a falha clássica de parser SSE ingênuo e a razão de não usar `split('\n\n')` sobre o texto inteiro.
- **EC-1 — o sentinela `[DONE]`.** `packages/theo/src/server/define/ui-message-stream-response.ts:27` emite `data: [DONE]\n\n` ao final de **todo** stream, e a linha 12 documenta que o parser deve ignorá-lo. `JSON.parse('[DONE]')` lança. Este não é um extremo raro — é o caminho comum de toda resposta. O sentinela é descartado **antes** do parse, e o `JSON.parse` restante fica sob guarda: frame com JSON inválido é descartado com aviso, nunca derruba o stream.
- **EC-2 — terminadores de linha.** [WHATWG HTML §9.2](https://html.spec.whatwg.org/multipage/server-sent-events.html) admite CRLF, LF **e** CR. Nosso servidor emite `\n\n` (`ui-message-stream-response.ts:38`), mas um proxy reverso ou um servidor de terceiros falando o mesmo wire pode emitir CRLF. Sem normalizar, o buffer nunca fecha um evento e o resultado é **silêncio total** — nenhum erro, nenhuma renderização, o pior modo de falha possível. A normalização acontece antes do split.
- **EC-8 — o canal de erro é isento da leniência.** `type` é lido antes da validação de schema; `error` sempre rejeita. Ver a exceção obrigatória em **D2**.
- **Edge cases:** `data:` com e sem espaço após os dois-pontos; múltiplas linhas `data:` no mesmo evento (concatenar com `\n`); comentário SSE (`:heartbeat`) ignorado; stream terminando sem linha em branco final; body nulo → stream vazio (preserva o comportamento de `consume-ui-message-stream.ts:34`); frame sem terminador que cresce sem limite → erro tipado, não OOM (EC-10).
- **Custo do Zod:** medir com um stream de 10k frames; registrar o número no PR (risco de severidade Baixa na tabela).

#### Pseudo-code / Signatures
```pseudocode
const DONE_SENTINEL = '[DONE]'         -- EC-1: emitido por ui-message-stream-response.ts:27
const MAX_FRAME_BYTES = 1_000_000      -- EC-10: buffer não cresce sem limite

function parseWireStream(bytes: ReadableStream<Uint8Array>): ReadableStream<WireChunk>
  buffer = ""
  for await (text of bytes.pipeThrough(new TextDecoderStream())):
    buffer += normalizeEol(text)             -- EC-2: \r\n e \r viram \n ANTES do split
    if buffer.length > MAX_FRAME_BYTES: throw new WireFrameTooLargeError(...)
    while (evento, resto = splitOnBlankLine(buffer)) is not null:
      buffer = resto
      payload = joinDataLines(evento)         -- múltiplas `data:` juntam com \n (EC-9)
      if payload is empty: continue
      if payload === DONE_SENTINEL: continue  -- EC-1: sentinela, não é JSON

      raw = tryJsonParse(payload)             -- EC-1: JSON.parse NUNCA sem guarda
      if raw is PARSE_ERROR:
        warn('frame com JSON inválido descartado'); continue

      -- EC-8: o canal de erro é isento da leniência. `type` é lido ANTES do schema.
      if raw?.type === 'error':
        throw new WireStreamError(raw.errorText ?? 'agent stream failed without a message')

      parsed = wireChunkSchema.safeParse(raw)
      if parsed.success: enqueue(parsed.data)
      else: warn('variante desconhecida ou inválida descartada')   -- D2 leitura-tolerante

# Example
input:  bytes de "data: {\"type\":\"start\"}\r\n\r\n:hb\n\ndata: [DONE]\n\n"
output: stream com [ {type:'start'} ] — CRLF normalizado, comentário e sentinela ignorados,
        sem exceção de JSON.parse
```

#### Tasks
1. Escrever os RED cobrindo framing, frame partido, comentário e body nulo
2. Implementar o acumulador + extração de `data:`
3. Plugar a validação Zod com descarte tolerante
4. Medir o custo com 10k frames e registrar o número

#### TDD
```
RED:     test_sentinela_done_nao_derruba_o_stream() — EC-1, o BLOQUEADOR: `data: [DONE]\n\n` (o frame terminal real do nosso servidor) é ignorado; sem a guarda este teste falha com SyntaxError
RED:     test_json_invalido_e_descartado_sem_derrubar() — EC-1, complemento: `data: {quebrado` vira aviso, não exceção
RED:     test_crlf_produz_os_mesmos_chunks_que_lf() — EC-2: a MESMA fixture em \r\n\r\n e \n\n produz saída idêntica; sem normalizar, a versão CRLF emite ZERO chunks
RED:     test_cr_isolado_tambem_e_terminador() — EC-2: \r puro, conforme WHATWG §9.2
RED:     test_chunk_error_rejeita_mesmo_malformado() — EC-8: `{"type":"error"}` sem `errorText` REJEITA (não é descartado pela leniência); assertar a mensagem genérica
RED:     test_frame_partido_entre_chunks_e_remontado() — o mesmo frame chega em dois pushes; um chunk é emitido, não zero
RED:     test_comentario_sse_e_ignorado() — `:heartbeat` não vira chunk
RED:     test_data_com_e_sem_espaco_sao_equivalentes() — `data:{}` e `data: {}` produzem o mesmo
RED:     test_multiplas_linhas_data_sao_concatenadas_com_newline() — EC-9: JSON repartido em duas linhas `data:` remonta em UM chunk
RED:     test_frame_sem_terminador_nao_cresce_sem_limite() — EC-10: assertar `WireFrameTooLargeError` específico, não apenas "lança"
RED:     test_body_nulo_produz_stream_vazio() — preserva consume-ui-message-stream.ts:34
RED:     test_variante_desconhecida_e_descartada_com_aviso() — não derruba o stream (D2)
RED:     test_diferencial_parser_bate_com_o_ai() — o harness de T0.1, agora exercitando o nosso lado
GREEN:   Implementar o parser até todos passarem
REFACTOR: Extrair o framing SSE do mapeamento para chunk, se o arquivo passar de ~120 linhas
VERIFY:  pnpm --filter @theokit/presenter test
```

#### Concurrency tests
Este task manipula `ReadableStream` com `await` sobre um reader — há estado mutável (`buffer`)
atravessando iterações assíncronas.

- **cancellation propagation** — cancelar o stream de saída DEVE cancelar o de entrada e liberar o reader; assertar que o reader do input fica `closed` após `cancel()` no output.
- **Backpressure observada:** consumidor lento (await entre leituras) não pode fazer o parser acumular sem limite; assertar que o buffer interno não cresce além de um evento pendente com um consumidor que lê devagar.
- **parallel test sem interleaving corrompendo o buffer:** dois `parseWireStream` concorrentes sobre streams distintos não compartilham estado — assertar saídas independentes ao rodá-los com `Promise.all`.

#### Acceptance Criteria
- [ ] Todos os edge cases de framing passam — `pnpm --filter @theokit/presenter test parse-wire-stream` retorna exit 0
- [ ] **O sentinela `[DONE]` é ignorado e nenhum `JSON.parse` roda sem guarda** (EC-1 — bloqueador da v1.0)
- [ ] **Fixture CRLF produz saída idêntica à LF** (EC-2) — `test_crlf_produz_os_mesmos_chunks_que_lf` assertEquals sobre as duas saídas
- [ ] **`{"type":"error"}` malformado REJEITA em vez de ser descartado** (EC-8)
- [ ] Frame sem terminador falha com erro tipado, não OOM (EC-10) — o teste assertRaises `WireFrameTooLargeError`, não um erro genérico
- [ ] Teste diferencial verde contra o `ai` para todas as fixtures
- [ ] Cancelamento propaga ao stream de origem — após `output.cancel()`, `input.reader.closed` returns true
- [ ] Custo de parse com 10k frames registrado no PR — o comentário do PR contains o número em `ms`, não um adjetivo
- [ ] Pass: complexity ≤ 10 / coverage ≥ 90% / lint limpo / size ≤ 500

#### DoD
- [ ] `pnpm --filter @theokit/presenter test` verde
- [ ] Zero type errors e zero lint warnings — `pnpm typecheck` e `pnpm lint` retornam exit 0

### T1.3 — Reconstrutor de mensagens (`readMessageStream`)

#### Objective
Substituir `readUIMessageStream` por implementação própria que acumula chunks em mensagens de
assistente, preservando a semântica de erro fixada pelo `#136`.

#### Why this step (action + reasoning)

**O que faz.** Implementa a máquina de reconstrução: `start` abre a mensagem, `text-delta` acumula,
`tool-*` monta as partes de ferramenta, `finish` fecha, `error` termina em erro.

**Por que agora.** É a outra metade do runtime (`consume-ui-message-stream.ts:67`) e depende do
parser de T1.2 para receber chunks já validados.

#### Evidence
- `packages/agents/src/client/consume-ui-message-stream.ts:67-75` — o comentário do `#136` documenta a armadilha: com o default (`onError` ausente, `terminateOnError` off), um chunk `error` é **engolido em silêncio** e o store assenta em `done` em vez de `error`
- `packages/agents/src/client/agent-client.ts` (319 LoC, `191aef8a`) — o `#drive` tem um catch que superficia o erro; o reconstrutor precisa fazer o stream rejeitar para que ele dispare

#### Files to edit
```
packages/presenter/src/wire/read-message-stream.ts — (NEW) o reconstrutor
packages/presenter/src/wire/index.ts               — exporta `readMessageStream`
packages/presenter/tests/wire/read-message-stream.test.ts — (NEW) RED primeiro
```

#### Deep file dependency analysis
- Consome `WireChunk` (T1.1) e é alimentado pelo `parseWireStream` (T1.2).
- A jusante: `consume-ui-message-stream.ts` (T2.1) e, indiretamente, `agent-client.ts` — cujo tratamento de erro depende desta semântica.

#### Deep Dives
- **Invariante crítico (`#136`):** um chunk `type:'error'` DEVE fazer o stream **rejeitar**, não terminar limpo. É o defeito que o comentário atual documenta e a razão de o `ai` precisar de `onError`+`terminateOnError` explícitos. Na nossa implementação isso é o comportamento **padrão**, não um opt-in — é a simplificação que a propriedade do código nos compra.
- **Snapshot por passo:** `onMessage` dispara a cada passo de reconstrução com o snapshot mais recente, para o `useAgent` renderizar streaming. Assertar que dispara N vezes para N deltas, não uma vez no fim.
- **Edge cases:** `finish` sem `start`; dois `start` seguidos; `text-delta` com id desconhecido; stream terminando sem `finish` (conexão caiu).

#### Pseudo-code / Signatures
```pseudocode
async function* readMessageStream(chunks: ReadableStream<WireChunk>): AsyncIterable<WireMessage>
  msg = null
  for await (chunk of chunks):
    -- #136 + EC-12: erro rejeita SEMPRE, inclusive antes de qualquer `start`
    if chunk.type === 'error':
      throw new WireStreamError(chunk.errorText ?? 'agent stream failed without a message')

    if chunk.type === 'start':
      if msg !== null: yield snapshot(msg)      -- EC-11: fecha a anterior, não a perde
      msg = { id: chunk.messageId ?? newId(), role:'assistant', parts: [] }
      continue

    -- EC-3: chunk fora de mensagem (após `finish`, ou reentregue pela reconexão do M37)
    if msg === null:
      warn('chunk fora de mensagem descartado', chunk.type); continue

    if chunk.type === 'finish':
      yield snapshot(msg); msg = null; continue

    applyPart(msg, chunk); yield snapshot(msg)

# Example
input:  [start, text-delta("o"), text-delta("i"), finish, text-delta("tardio")]
output: 3 snapshots; o último = { role:'assistant', parts:[{type:'text', text:'oi'}] }
        o delta tardio é descartado com aviso, sem TypeError (EC-3)
```

#### Tasks
1. Escrever os RED, com o do `#136` primeiro (é regressão conhecida)
2. Implementar a máquina de reconstrução
3. Garantir snapshot por passo
4. Rodar o diferencial contra o `ai` com `onError`+`terminateOnError` configurados como hoje

#### TDD
```
RED:     test_chunk_error_rejeita_o_stream() — regressão do #136: um chunk error faz o consumo lançar, não terminar limpo
RED:     test_chunk_apos_finish_nao_estoura() — EC-3: `text-delta` após `finish` é descartado com aviso; sem a guarda isto é TypeError em `msg` nulo
RED:     test_error_sem_start_rejeita_sem_crashar() — EC-12: falha de auth antes de qualquer conteúdo; assertar erro tipado + mensagem, e nenhum acesso a `msg` nulo
RED:     test_start_duplicado_nao_perde_a_mensagem_anterior() — EC-11: o segundo `start` fecha a mensagem em curso antes de abrir a nova
RED:     test_snapshot_por_passo() — N deltas produzem N snapshots, não 1
RED:     test_stream_sem_finish_nao_trava() — conexão caindo encerra o iterador
RED:     test_finish_sem_start_nao_quebra() — frame fora de ordem é tolerado
RED:     test_diferencial_reconstrutor_bate_com_o_ai() — harness de T0.1 sobre a saída final
GREEN:   Implementar até todos passarem
REFACTOR: Extrair `applyPart` por família de chunk se o switch passar de ~40 linhas
VERIFY:  pnpm --filter @theokit/presenter test
```

#### Concurrency tests
O reconstrutor é um async generator sobre um stream — estado (`msg`) atravessa iterações assíncronas.

- **cancellation propagation** — abandonar o `for await` (break) DEVE cancelar o stream de chunks a montante; assertar que o reader fica `closed`.
- **parallel test sem estado compartilhado entre instâncias:** dois `readMessageStream` concorrentes sob `Promise.all` produzem mensagens independentes, sem vazamento de `msg` entre eles.

#### Acceptance Criteria
- [ ] `#136` coberto por teste de regressão que falha antes da implementação
- [ ] Diferencial verde contra o `ai` para todas as fixtures
- [ ] Cancelamento propaga — abandonar o `for await` fecha o stream a montante; `reader.closed` returns true
- [ ] Pass: complexity < 11 / coverage 100% neste arquivo (caminho crítico, `pnpm test:coverage`) / `pnpm lint` exit 0 / size < 500 linhas

#### DoD
- [ ] `pnpm --filter @theokit/presenter test` verde
- [ ] Zero type errors e zero lint warnings — `pnpm typecheck` e `pnpm lint` retornam exit 0

### T1.4 — Tipos públicos do seam + nota de supersede nos ADRs

#### Objective
Declarar `WireMessage` e `WireTransport` (o substituto estrutural de `ChatTransport<UIMessage>`) e
registrar nos ADRs 0050–0054 que a decisão D1 do 0050 foi superseded.

#### Why this step (action + reasoning)

**O que faz.** Cria os tipos públicos do seam e adiciona nota de supersede nos quatro ADRs que se
apoiam no `ChatTransport` do `ai`.

**Por que agora.** No mesmo commit que muda o seam, para que a história não fique com um ADR vigente
contradizendo o código — o risco de severidade Média na tabela de Drawbacks.

#### Evidence
- `packages/agents/src/client/transport.ts:44` — `export type AgentTransport = ChatTransport<UIMessage> & {...}`
- `adrs/0050-m41-unified-agent-client-chattransport.md` § D1 — *"do NOT invent a parallel interface"*
- Estrutura de `UIMessage` medida em `node_modules/ai/dist/index.d.ts:1798`: `{ id: string; role: 'system'|'user'|'assistant'; metadata?: METADATA; parts: Array<UIMessagePart<...>> }` — sem brand, logo espelhável

#### Files to edit
```
packages/presenter/src/wire/types.ts — (NEW) WireMessage, WireTransport
packages/presenter/src/wire/index.ts — exporta os tipos
.claude/knowledge-base/adrs/0050-m41-unified-agent-client-chattransport.md — nota de supersede em D1
.claude/knowledge-base/adrs/0051-m42-tauri-channel-transport.md — nota de atualização
.claude/knowledge-base/adrs/0052-m43-transport-request-context.md — nota de atualização
.claude/knowledge-base/adrs/0053-m44-standalone-agent-client-sdk.md — nota de atualização
packages/presenter/tests/wire/types.test-d.ts — (NEW) RED de tipo
```

#### Deep file dependency analysis
- `transport.ts` (46 LoC, `058ed095`) é o consumidor direto; será alterado em T2.2.
- Os três transports e `create-agent-client.ts` tipam contra `AgentTransport` — a compatibilidade estrutural é o que os mantém compilando sem alteração.

#### Deep Dives
- **Invariante (corrigido em v1.1, EC-4):** a compatibilidade exigida é **de uma direção só** — nossos transports concretos devem satisfazer `ChatTransport<UIMessage>`, porque é isso que protege um consumidor que ainda tipa contra o `ai`. Exigir equivalência **bidirecional**, como a v1.0 fazia, é inalcançável por construção: a D2 escolheu espelhar só o subconjunto usado, então `WireTransport` tem menos membros que `ChatTransport` e a atribuição inversa falha. A v1.0 teria travado esta task numa contradição interna. A equivalência bidirecional continua valendo para `WireMessage` ↔ `UIMessage`, cuja forma foi medida como idêntica (`index.d.ts:1798`) — e é essa que sustenta Q1.
- **Edge case:** genéricos. `ChatTransport<UI_MESSAGE extends UIMessage>` é genérico; se espelharmos sem o parâmetro, perdemos a capacidade de tipar metadata customizada. Manter o genérico.

#### Pseudo-code / Signatures
```pseudocode
export interface WireMessage<METADATA = unknown> {
  id: string
  role: 'system' | 'user' | 'assistant'
  metadata?: METADATA
  parts: WireMessagePart[]
}
export interface WireTransport<M extends WireMessage = WireMessage> {
  sendMessages(options): Promise<ReadableStream<WireChunk>>
  reconnectToStream(options): Promise<ReadableStream<WireChunk> | null>
}
```

#### Tasks
1. Escrever o teste de tipo RED afirmando compatibilidade bidirecional com o `ai`
2. Declarar `WireMessage`/`WireTransport` espelhando a forma medida
3. Adicionar as notas de supersede nos quatro ADRs

#### TDD
```
RED:     test_nossos_transports_satisfazem_ChatTransport() — EC-4: `expectTypeOf<HttpTransport>().toMatchTypeOf<ChatTransport<UIMessage>>()` para os TRÊS transports; é a direção que protege o consumidor
RED:     test_WireMessage_e_atribuivel_a_UIMessage() — a forma da mensagem (não do transport) É equivalente e sustenta a resposta de Q1
GREEN:   Declarar os tipos até ambos passarem
REFACTOR: None expected
VERIFY:  pnpm test:types
```

#### Concurrency tests
(none — single-threaded)
Declarações de tipo; nada executa.

#### Acceptance Criteria
- [ ] Compatibilidade estrutural bidirecional afirmada por `expectTypeOf` (`type-safety.md` § Type Tests)
- [ ] Os quatro ADRs carregam nota de supersede/atualização — `grep -l 'superseded' .claude/knowledge-base/adrs/005{0,1,2,3}-*.md` returns os 4 arquivos
- [ ] Pass: lint + size — `pnpm lint` retorna exit 0 e nenhum arquivo alterado excede 500 linhas (`wc -l`)

#### DoD
- [ ] `pnpm test:types` verde
- [ ] Zero type errors e zero lint warnings — `pnpm typecheck` e `pnpm lint` retornam exit 0

---

## Phase 2: Trocar os consumidores

**Objective:** Apontar runtime e tipos para o espelho, zerando as referências a `ai` no código de
produção.

### T2.1 — `consume-ui-message-stream.ts` passa a usar o espelho

#### Objective
Remover os dois `await import('ai')` e usar `parseWireStream` + `readMessageStream`.

#### Why this step (action + reasoning)

**O que faz.** Troca as duas importações dinâmicas por importação estática do
`@theokit/presenter/wire`, e simplifica o tratamento de erro — o `#136` deixa de precisar de
configuração explícita porque a semântica correta é o padrão do nosso reconstrutor (T1.3).

**Por que agora.** É a única task que mexe em runtime de produção; isolá-la mantém o commit
reversível e o diff auditável. Após ela, `dist/**/*.js` fica em zero referências a `ai`.

#### Evidence
- `packages/agents/src/client/consume-ui-message-stream.ts:42,67` — os dois `await import('ai')`
- Medido no dist publicado: `@theokit/agents@7.0.0/dist/chunk-FCGL2PEC.js` contém `2 × import("ai")` — a única referência de runtime da superfície inteira
- `consume-ui-message-stream.ts:9-12` — o comentário explica que o import é dinâmico porque `ai` é peer **opcional**; com o espelho sendo dependência real do presenter, o import volta a ser estático

#### Files to edit
```
packages/agents/src/client/consume-ui-message-stream.ts — troca os 2 import() por import estático do wire
packages/agents/package.json — adiciona `@theokit/presenter` em dependencies (era devDependency)
packages/agents/tsup.config.ts — adiciona `@theokit/presenter` a `external` (EC-5 / D7)
tests/unit/consume-chunk-stream.test.ts — ajusta expectativas; mantém um caso contra o `ai` como oráculo (Q2)
```

#### Deep file dependency analysis
- `consume-ui-message-stream.ts` (88 LoC, `058ed095`) é consumido por `http-transport.ts` e `agent-client.ts`; as assinaturas exportadas **não mudam**, então nenhum caller precisa de alteração.
- `packages/agents/package.json` hoje declara `@theokit/presenter` só como devDependency, e o tsup **inlina** o presenter no bundle (verificado: `chunk-3YPKTOJ6.js` contém `UIMessageStreamPresenter`, e a lista `external` em `tsup.config.ts:38` cobre `@theokit/http`, `@theokit/sdk`, `@theokit/sdk-pty`, `@theokit/sdk-tools` e `zod`, mas **não** o presenter).
- **EC-5 / D7 — as duas edições andam juntas.** Promover a dependency **sem** adicionar ao `external` faria o consumidor instalar o pacote *e* receber uma cópia embutida: duas instâncias do mesmo schema Zod no mesmo processo. As duas mudanças (`package.json` + `tsup.config.ts`) DEVEM sair no mesmo commit; separá-las produz exatamente o defeito.

#### Deep Dives
- **Invariante preservado (`#136`):** o chunk `error` continua terminando o stream em erro. A diferença é que agora é o padrão, não um par de flags.
- **Simplificação esperada:** o comentário de 8 linhas em `:68-75` que documenta a armadilha do `ai` some junto com a armadilha.
- **Edge case:** body nulo continua produzindo stream vazio (`:34`) — coberto por teste em T1.2.

#### Tasks
1. Ajustar os testes existentes para o novo caminho (RED)
2. Trocar os dois `await import('ai')` por importação estática
3. Remover o comentário/configuração que existia só para contornar o default do `ai`
4. Promover `@theokit/presenter` a dependency real do `agents`

#### TDD
```
RED:     test_consume_nao_importa_mais_ai() — grep no fonte do arquivo afirma zero ocorrência de `import('ai')`
RED:     test_regressao_136_continua_valendo() — chunk error termina em erro (o mesmo caso de T1.3, agora pelo caminho público)
RED:     test_presenter_e_externalizado_no_dist() — EC-5/D7: após build, `dist/**/*.js` referencia `@theokit/presenter` como import externo e NÃO contém `UIMessageStreamPresenter` inlinado
GREEN:   Trocar as importações até ambos passarem
REFACTOR: Remover o comentário obsoleto sobre `terminateOnError`
VERIFY:  pnpm --filter @theokit/agents test
```

#### Concurrency tests
Herda o caminho de stream de T1.2/T1.3.

- **cancellation propagation ponta a ponta:** abortar o consumo pelo `AgentClient` DEVE propagar até o reader do `Response.body`; assertar que o reader fica `closed` (é o caminho que o `abort()` do theokit-sdk#145 exercita).

#### Acceptance Criteria
- [ ] Zero `import('ai')` no arquivo
- [ ] Regressão `#136` coberta e verde
- [ ] Assinaturas exportadas inalteradas (sustenta Q1 = `minor`)
- [ ] Pass: complexity ≤ 10 / coverage ≥ 90% / lint / size

#### DoD
- [ ] `pnpm --filter @theokit/agents test` verde
- [ ] Zero type errors e zero lint warnings — `pnpm typecheck` e `pnpm lint` retornam exit 0

### T2.2 — Repontar os 17 `import type` de produção

#### Objective
Trocar `import type { UIMessage, UIMessageChunk, ChatTransport } from 'ai'` pelos tipos do
`@theokit/presenter/wire` nos 17 arquivos de produção.

#### Why this step (action + reasoning)

**O que faz.** Substituição mecânica de importação de tipo em `agents`, `theo` e `presenter`,
incluindo o ponto onde o tipo de terceiro vazava para a API pública (`transport.ts:44`).

**Por que agora.** Paraleliza com T2.1 (tipos e runtime são independentes) e é pré-requisito de T3.1
— não dá para remover a declaração do manifesto enquanto o fonte ainda importa dela.

#### Evidence
- 17 arquivos de produção enumerados no Baseline; lista completa obtida por `git ls-files '*.ts' | xargs grep -l "from 'ai'"`
- `packages/agents/src/client/transport.ts:44` — `AgentTransport = ChatTransport<UIMessage> & {...}`, o vazamento na API pública
- Compatibilidade estrutural provada em T1.4, o que torna a troca não-quebrante

#### Files to edit
```
packages/agents/src/client/{transport,http-transport,in-process-transport,channel-transport,agent-client,use-agent,last-user-text,consume-ui-message-stream}.ts
packages/agents/src/bridge/{present-ui-message-stream,agent-endpoint}.ts
packages/agents/src/in-process-turn.ts
packages/theo/src/server/agent/{build-agent-streamer,render-terminal,durable-ui-message-stream-response,thread-dispatcher}.ts
packages/theo/src/server/define/ui-message-stream-response.ts
packages/theo/src/client/create-agent-client.ts
packages/presenter/src/presenters/ui-message-stream.ts
```

#### Deep file dependency analysis
- Cada arquivo está no Baseline com LoC e sha. A mudança é de uma linha de import por arquivo, exceto `transport.ts`, onde o tipo composto muda de base.
- Downstream: os 26 testes que importam de `ai` — a maioria migra por consequência; os que são oráculo permanecem (Q2).

#### Deep Dives
- **Invariante:** `theokit/client/core` DEVE continuar React-free (ADR-0053). O `wire` não importa React, então o invariante se mantém — mas o teste de grafo de import existente precisa continuar verde.
- **Edge case:** `packages/theo` passa a depender de `@theokit/presenter`. Verificar se precisa ser dependency direta ou se a transitiva via `agents` basta — a resposta muda o `package.json` e o resultado do `check-package-direction.mjs`.

#### Tasks
1. Repontar os imports arquivo a arquivo
2. Ajustar `transport.ts:44` para compor sobre `WireTransport`
3. Rodar `check-package-direction.mjs` e `dependency-cruiser`; ajustar manifests se acusarem
4. Migrar os testes afetados, preservando os que são oráculo

#### TDD
```
RED:     test_nenhum_fonte_de_producao_importa_ai() — varre `packages/*/src` e afirma zero ocorrências de `from 'ai'`
RED:     test_client_core_continua_react_free() — o teste de grafo de import existente (ADR-0053) continua verde
GREEN:   Repontar até ambos passarem
REFACTOR: None expected — substituição mecânica
VERIFY:  pnpm test && pnpm typecheck
```

#### Concurrency tests
(none — single-threaded)
Troca de importação de tipo; nenhuma mudança de comportamento em runtime.

#### Acceptance Criteria
- [ ] Zero `from 'ai'` em `packages/*/src`
- [ ] `dependency-cruiser` e `check-package-direction.mjs` verdes (nenhum ciclo, direção respeitada — `G1`)
- [ ] `theokit/client/core` continua React-free
- [ ] Nenhuma assinatura exportada muda de forma (fecha Q1) — `pnpm test:types` retorna exit 0 sem alterar os testes de tipo existentes
- [ ] Pass: lint + size — `pnpm lint` retorna exit 0 e nenhum arquivo alterado excede 500 linhas (`wc -l`)

#### DoD
- [ ] `pnpm test` verde / `pnpm typecheck` zero erros / `pnpm lint` zero warnings

---

## Phase 3: Manifests, template e gates

**Objective:** Remover as declarações e instalar os gates que impedem a regressão.

### T3.1 — `ai` sai de `dependencies`/`peerDependencies`

#### Objective
Deixar `ai` apenas como `devDependency`, e remover o peer não-opcional do `presenter`.

#### Why this step (action + reasoning)

**O que faz.** Edita os manifests dos pacotes publicáveis, removendo `ai` de `dependencies` e
`peerDependencies` e mantendo-o em `devDependencies` (o oráculo, D4).

**Por que agora.** Só depois de T2.1/T2.2 o fonte deixa de precisar dele; remover antes quebraria o
build.

#### Evidence
- Estado atual medido: `agents` peer `>=7.0.0` opcional + devDep `^7.0.14`; `theo` idem; `presenter` peer `^7.0.0` **NÃO-opcional** + devDep `^7.0.0`; raiz devDep `^7.0.14`
- A inversão do presenter (peer obrigatório para um `import type`) some junto — ganho colateral registrado no grill

#### Files to edit
```
packages/presenter/package.json — remove peer `ai`; mantém devDep
packages/agents/package.json    — remove peer `ai` + peerDependenciesMeta; mantém devDep
packages/theo/package.json      — remove peer `ai` + peerDependenciesMeta; mantém devDep
package.json (raiz)             — mantém devDep (oráculo do CI)
```

#### Deep file dependency analysis
- Remover um peer **opcional** não quebra consumidor. Remover o peer **não-opcional** do presenter é relaxamento (deixa de exigir), também não-quebrante — sustenta Q1 = `minor`.

#### Deep Dives
- **Edge case:** o `pnpm-lock.yaml` precisa refletir a mudança; rodar `pnpm install` e commitar o lock no mesmo commit, senão o CI com `--frozen-lockfile` reprova.

#### Tasks
1. Editar os quatro manifests
2. `pnpm install` e commitar o lock atualizado
3. Rodar o gate de pack para confirmar que nada vazou

#### TDD
```
RED:     test_nenhum_pacote_publicavel_declara_ai() — varre dependencies+peerDependencies dos 6 publicáveis; afirma zero
GREEN:   Editar os manifests até passar
REFACTOR: None expected
VERIFY:  pnpm test && pnpm check:pack-no-workspace
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Zero `ai` em `dependencies`/`peerDependencies` dos 6 publicáveis
- [ ] `ai` presente em `devDependencies` (oráculo preservado)
- [ ] `pnpm install --frozen-lockfile` verde
- [ ] Pass: lint — `pnpm lint` retorna exit 0 nos arquivos alterados

#### DoD
- [ ] `pnpm test` verde / `pnpm typecheck` zero erros

### T3.2 — O template scaffolda sem `ai`

#### Objective
Remover o pin `"ai": "^7.0.0"` do template e repontar o único import de tipo do app gerado.

#### Why this step (action + reasoning)

**O que faz.** Edita `package.json.tmpl` e o único arquivo do template que importa de `ai`.

**Por que agora.** É o entregável visível do Goal: um app novo deixa de instalar o ai-sdk. Depende de
T3.1 para que os pacotes que ele consome já não exijam `ai`.

#### Evidence
- `packages/create-theokit/templates/default/package.json.tmpl:23` — `"ai": "^7.0.0"`
- `packages/create-theokit/templates/default/app/hooks/use-transcript.test.ts:4` — `import type { UIMessage } from 'ai'`, o **único** toque real
- Verificado: nenhum template usa `@ai-sdk/react` ou `useChat` — os matches eram do `useChatTranscript`, hook próprio

#### Files to edit
```
packages/create-theokit/templates/default/package.json.tmpl — remove o pin `ai`
packages/create-theokit/templates/default/app/hooks/use-transcript.test.ts — reponta o import de tipo para `theokit/client`
packages/theo/src/client/index.ts — reexporta os tipos do wire (EC-7: dá ao app um caminho que ele já tem)
packages/create-theokit/tests/unit/scaffold-surface.test.ts — ajusta expectativa
packages/create-theokit/tests/integration/surface-matrix.test.ts — ajusta expectativa
```

#### Deep file dependency analysis
- O template é sincronizado por `scripts/sync-template-versions.mjs`, com gate no pre-commit (`check:templates`). Remover uma linha do `.tmpl` não conflita com o sync, que só reescreve versões de pacotes `@theokit/*`.

#### Deep Dives
- **Invariante:** o app scaffoldado precisa **rodar um turno de agente** sem `ai` — não basta instalar. É o que a Final Phase valida.
- **EC-7 — o caminho de import do template.** Repontar o teste do template direto para `@theokit/presenter/wire` quebraria o app: o `package.json.tmpl` fixa `theokit`, `@theokit/agents` e `@theokit/ui`, **não** o presenter. O tipo é reexportado por `theokit/client` — caminho que o app já tem — e o teste aponta para lá. Declarar `@theokit/presenter` no template é a alternativa pior: expõe um pacote interno ao usuário para resolver um problema nosso.
- **Edge case:** apps já scaffoldados continuam com `ai` no manifesto; não quebram (o pacote continua existindo no npm), apenas carregam uma dep que deixou de ser necessária. Documentar no CHANGELOG como removível.

#### Tasks
1. Ajustar os testes de superfície do scaffold (RED)
2. Remover o pin do `.tmpl`
3. Repontar o import de tipo do teste do template
4. Scaffoldar um app real e rodar `npm install` + um turno

#### TDD
```
RED:     test_template_nao_declara_ai() — lê o `.tmpl` e afirma ausência de `"ai"`
RED:     test_template_so_importa_pacotes_que_declara() — EC-7: todo especificador bare importado pelo template consta no `package.json.tmpl`; sem o reexport em `theokit/client`, o import do wire falha aqui
RED:     test_app_scaffoldado_typecheck_sem_ai() — scaffold em temp dir, install, `tsc --noEmit` verde
GREEN:   Editar até todos passarem
REFACTOR: None expected
VERIFY:  pnpm --filter create-theokit test
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `package.json.tmpl` sem `ai`
- [ ] App scaffoldado instala e typechecka sem `ai`
- [ ] Pass: lint + size — `pnpm lint` retorna exit 0 e nenhum arquivo alterado excede 500 linhas (`wc -l`)

#### DoD
- [ ] `pnpm --filter create-theokit test` verde

### T3.3 — Gates: superfície ai-free + paridade de wire

#### Objective
Instalar os dois gates que tornam a remoção permanente e detectam variante nova do `ai`.

#### Why this step (action + reasoning)

**O que faz.** Cria `check-ai-free-surface.mjs` (o gate do Goal) e `check-wire-parity.mjs` (o gate do
risco de D2), e os liga ao CI.

**Por que agora.** Sem eles, a remoção regride no próximo PR e a variante nova some em silêncio —
os dois riscos de severidade Alta/Média da tabela.

#### Evidence
- Padrão já praticado: `scripts/check-sandbox-parity.mjs` compara nossa superfície contra a do SDK e reprova na divergência; `scripts/check-pack-no-workspace.mjs` empacota e inspeciona o tarball
- Armadilha de medição a codificar no gate: separar `--include="*.js"` de `--include="*.d.ts"`, senão o gate acusa falso positivo em declaração de tipo

#### Files to edit
```
scripts/check-ai-free-surface.mjs — (NEW) o gate do Goal
scripts/check-wire-parity.mjs     — (NEW) enumera a união do `ai` vs a nossa
package.json (raiz)               — scripts `check:ai-free` e `check:wire-parity`
.github/workflows/architecture-guards.yml — dois jobs novos
tests/unit/check-ai-free-surface.test.ts  — (NEW) RED primeiro
```

#### Deep file dependency analysis
- `architecture-guards.yml` foi corrigido em `b0789558` (2026-08-05) para buildar antes de testar. Os jobs novos precisam do mesmo cuidado: `check-ai-free-surface` lê `dist/`, então **exige build antes**.

#### Deep Dives
- **`check-ai-free-surface.mjs`:** para cada pacote publicável, (a) lê `package.json` e afirma ausência de `ai` em `dependencies`/`peerDependencies`; (b) varre `dist/**/*.js` (nunca `.d.ts`) por `from 'ai'`/`import("ai")` e afirma zero. Falha com mensagem nomeando pacote e arquivo.
- **`check-wire-parity.mjs`:** enumera as variantes do `uiMessageChunkSchema` do `ai` instalado e compara com o nosso schema. Variante presente lá e ausente aqui → **aviso** com razão exigida (mesma mecânica de decisão escrita do `check-sandbox-parity.mjs`), não falha automática: nem toda variante nova nos diz respeito.
- **Edge case:** o gate de paridade depende do `ai` estar instalado; num ambiente sem devDeps ele deve **pular com aviso explícito**, nunca passar em silêncio (`error-handling.md` — ausência de oráculo é falha de medição, não sucesso).

#### Pseudo-code / Signatures
```pseudocode
function checkAiFreeSurface(): exitCode
  problemas = []
  for pkg in publicaveis:
    if 'ai' in pkg.dependencies or 'ai' in pkg.peerDependencies:
      problemas.push(`${pkg.name} declara ai`)

    -- EC-6: ausência de dist é FALHA DE MEDIÇÃO, nunca sucesso silencioso.
    -- Sem isto o glob volta vazio, a lista fica limpa e o gate afirma a métrica do Goal
    -- sem ter medido nada — o modo de falha que deixou `surface parity` vermelho por semanas.
    arquivos = glob(`${pkg.dir}/dist/**/*.js`)       -- .js APENAS, nunca .d.ts
    if arquivos.isEmpty():
      problemas.push(`${pkg.name}: sem dist/ — rode o build; este gate não mede nada sem ele`)
      continue

    for f in arquivos:
      if matches(f, /from ['"]ai['"]|import\(['"]ai['"]\)/):
        problemas.push(`${pkg.name}: ${f} referencia ai em runtime`)

  return problemas.empty ? 0 : 1
```

#### Tasks
1. Escrever o RED do gate (afirma que ele detecta um pacote plantado com `ai`)
2. Implementar `check-ai-free-surface.mjs`
3. Implementar `check-wire-parity.mjs` no padrão do sandbox-parity
4. Ligar os dois no `architecture-guards.yml`, com build antes do que lê `dist/`

#### TDD
```
RED:     test_gate_detecta_dep_plantada() — fixture com `ai` em dependencies faz o gate sair 1
RED:     test_gate_ignora_referencia_em_dts() — fixture com `from 'ai'` só em `.d.ts` faz o gate sair 0 (a armadilha de medição, codificada)
RED:     test_gate_falha_sem_dist() — EC-6: pacote sem `dist/` faz o gate sair 1 com mensagem apontando o build; sem isto o gate passa medindo ZERO arquivos
RED:     test_paridade_avisa_variante_nova() — schema do `ai` com variante extra produz aviso, não silêncio
RED:     test_paridade_falha_sem_oraculo() — sem `ai` instalado, o gate avisa que não mediu, em vez de passar
GREEN:   Implementar os dois scripts até passarem
REFACTOR: Extrair o walker de dist se duplicar com `check-pack-no-workspace.mjs`
VERIFY:  node scripts/check-ai-free-surface.mjs && node scripts/check-wire-parity.mjs
```

#### Concurrency tests
(none — single-threaded)
Scripts de inspeção de arquivos, execução sequencial.

#### Acceptance Criteria
- [ ] `check-ai-free-surface.mjs` sai 0 no estado final e 1 com dep plantada
- [ ] O gate **não** confunde `.d.ts` com runtime (armadilha codificada em teste)
- [ ] `check-wire-parity.mjs` avisa em variante nova e falha honestamente sem oráculo
- [ ] Ambos rodam em CI, com build antes do que lê `dist/`
- [ ] Pass: lint + size — `pnpm lint` retorna exit 0 e nenhum arquivo alterado excede 500 linhas (`wc -l`)

#### DoD
- [ ] Os dois scripts verdes localmente
- [ ] CI verde no PR

---

## Coverage Matrix

| # | Gap / Requirement (origem) | Task(s) | Resolution |
|---|---|---|---|
| 1 | Motivação = lock-in; `ai` sai da superfície publicada (grill, decisão 1) | T3.1, T3.3 | Removido de deps/peers; gate impede regressão |
| 2 | Manter compatibilidade de wire (grill, decisão 2) | T1.1, T1.2, T1.3, T0.1 | Espelho do mesmo formato, provado por teste diferencial |
| 3 | Espelhar só o subconjunto usado (grill, decisão 3) | T1.1 | Schema com as ~22 variantes emitidas |
| 4 | Estrito na escrita, tolerante na leitura (grill, decisão 3) | T1.1, T1.2 | `parse` estrito no schema; descarte com aviso no parser |
| 5 | Gate de paridade contra variante nova (grill, decisão 3) | T3.3 | `check-wire-parity.mjs` |
| 6 | Módulo mora em `@theokit/presenter/wire` (grill, decisão 4) | T1.1–T1.4 | Subpath novo no pacote folha |
| 7 | `ai` vira devDependency oráculo (grill, decisão 5) | T0.1, T3.1 | Harness diferencial; devDep preservada |
| 8 | Validação com Zod, `z.infer` como fonte única (grill, decisão 6, `G3`) | T1.1 | `z.discriminatedUnion` + `z.infer` |
| 9 | Break de consumidor ≈ zero (grill, decisão 7) | T1.4, T2.2 | Compatibilidade estrutural afirmada por `expectTypeOf` nos dois sentidos |
| 10 | Template larga o `ai` (grill, decisão 8) | T3.2 | Pin removido; app scaffoldado validado ponta a ponta |
| 11 | Zero referências de runtime em `dist/**/*.js` (Goal) | T2.1, T3.3 | Import dinâmico eliminado; gate afirma |
| 12 | Reversão do ADR-0050 D1 registrada | T1.4 | Nota de supersede nos ADRs 0050–0054 |
| 13 | Regressão `#136` (chunk error não pode ser engolido) | T1.3, T2.1 | Teste de regressão; semântica vira o padrão |
| 14 | Mudança no grafo de pacotes validada (`G1`) | T2.2 | `check-package-direction.mjs` + `dependency-cruiser` |
| 15 | Armadilha de medição `.js` vs `.d.ts` não se repete | T3.3 | Codificada como teste do gate |
| 16 | **EC-1** — sentinela `[DONE]` + `JSON.parse` sem guarda (bloqueador da v1.0) | T1.2, T0.1 | Sentinela descartado antes do parse; `JSON.parse` sob guarda; fixture inclui o frame terminal real |
| 17 | **EC-2** — terminador CRLF/CR faz o parser emitir silêncio | T1.2, T0.1 | `normalizeEol` antes do split; fixture CRLF com saída idêntica à LF |
| 18 | **EC-3** — chunk após `finish` estoura em `msg` nulo | T1.3 | Guarda de mensagem ausente; descarte com aviso |
| 19 | **EC-4** — asserção de tipo bidirecional inalcançável travaria T1.4 | T1.4 | Exigência reduzida à direção que protege o consumidor; equivalência mantida só em `WireMessage` |
| 20 | **EC-5** — presenter promovido a dependency mas inlinado pelo tsup | T2.1 (ADR **D7**) | `package.json` + `tsup.config.ts` no mesmo commit; teste afirma externalização no dist |
| 21 | **EC-6** — gate passa por vacuidade sem `dist/` | T3.3 | Ausência de dist é falha de medição; RED dedicado |
| 22 | **EC-7** — template importa pacote que não declara | T3.2 | Tipos reexportados por `theokit/client`; teste afirma que todo bare import consta no `.tmpl` |
| 23 | **EC-8** — `error` malformado descartado vira silêncio (reintroduz `#136`) | T1.2, T1.3 (ADR **D2**) | Canal de erro isento da leniência; `type` lido antes do schema |
| 24 | **EC-9/10/11/12** — SHOULD TEST absorvidos como RED | T1.2, T1.3 | Multi-`data:`, limite de buffer, `start` duplicado, `error` sem `start` |

**Coverage: 24/24 gaps covered (100%)**

## Global Definition of Done

- [ ] Todas as fases completas
- [ ] Todos os testes passando — `pnpm test` verde
- [ ] Zero type errors — `pnpm typecheck`
- [ ] Zero lint warnings — `pnpm lint`
- [ ] Budget de tamanho respeitado (`architecture.md`, 500 linhas)
- [ ] `CHANGELOG.md` atualizado em `[Unreleased]` (Regra Inquebrável 6), incluindo a dívida assumida em D6
- [ ] Compatibilidade retroativa preservada na API pública (afirmada por `expectTypeOf` bidirecional em T1.4)
- [ ] **`scripts/check-ai-free-surface.mjs` sai 0** — a métrica do Goal
- [ ] **Teste diferencial verde para toda variante espelhada** — a garantia de D4
- [ ] **Os 8 MUST FIX da v1.1 têm RED correspondente e verde** — em especial EC-1 (sentinela `[DONE]`), EC-8 (canal de erro isento da leniência) e EC-6 (gate falha sem `dist/`), que são os três que reintroduziriam defeitos já pagos por este repo
- [ ] `dependency-cruiser` e `check-package-direction.mjs` verdes (`G1`, nenhum ciclo)
- [ ] **Runtime-metric proof** — o app scaffoldado roda um turno de agente real ponta a ponta sem `ai` instalado; "instala e typechecka" NÃO é prova suficiente
- [ ] **Plan archived** — após `/review` retornar `READY_TO_MERGE` **e** o PR ser mergeado, mover para `knowledge-base/plans/completed/`

## Failure scenarios

O plano toca I/O externo: o parser consome o corpo de uma `Response` HTTP (SSE) que pode falhar no
meio.

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| SSE do endpoint do agente (HTTP) | Conexão cai no meio do stream, sem `finish` | `ReadableStream` que emite 2 frames e depois `controller.error()` | O iterador encerra; `AgentClient` assenta em `status='error'` com a causa; nenhum snapshot parcial é perdido |
| SSE do endpoint do agente (HTTP) | Frame truncado no fim do buffer (bytes cortados) | fixture terminando no meio de um JSON, sem linha em branco | O frame incompleto é descartado; os anteriores foram entregues; sem exceção não-tratada |
| SSE do endpoint do agente (HTTP) | Provider devolve chunk `error` (401/429/5xx) | fixture com `{type:'error', errorText:'...'}` | Stream **rejeita** (regressão `#136`); `status='error'`; a mensagem chega ao usuário |
| SSE do endpoint do agente (HTTP) | Frame válido no framing mas inválido no schema | fixture com `{type:'text-delta'}` sem `delta` | Descartado com aviso estruturado; stream continua (D2 leitura-tolerante) |
| SSE do endpoint do agente (HTTP) | **Frame `error` malformado** (EC-8) | fixture com `{"type":"error"}` sem `errorText` | **REJEITA** com mensagem genérica — a leniência não se aplica ao canal de erro; sem isso, um 401/429 real viraria silêncio |
| SSE do endpoint do agente (HTTP) | **Frame terminal `[DONE]`** (EC-1) | fixture terminando em `data: [DONE]\n\n` — o que o nosso servidor emite sempre | Ignorado; o stream fecha limpo. Sem a guarda, `JSON.parse` lança em **toda** resposta |
| SSE do endpoint do agente (HTTP) | **Terminador CRLF de um proxy** (EC-2) | a mesma fixture reescrita com `\r\n\r\n` | Saída idêntica à versão LF. Sem normalizar: zero chunks, silêncio total |
| SSE do endpoint do agente (HTTP) | Frame que nunca termina (EC-10) | 10MB sem linha em branco | `WireFrameTooLargeError` tipado, não OOM |
| `Response.body` nulo | Servidor responde sem corpo | `new Response(null)` | Stream vazio, sem exceção (preserva `consume-ui-message-stream.ts:34`) |

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Provar que a remoção funciona num app real, não só em teste isolado.

### Execution

```
pnpm test                      # unit + integration
pnpm test:coverage             # ≥ 90% nos arquivos alterados
pnpm typecheck                 # zero erros
pnpm lint                      # zero warnings
pnpm test:types                # os testes de compatibilidade estrutural de T1.4
node scripts/check-ai-free-surface.mjs   # a métrica do Goal
node scripts/check-wire-parity.mjs       # paridade contra o oráculo
pnpm check:deps && pnpm check:direction  # G1
```

Chaos pass (as linhas de `## Failure scenarios`):

```
pnpm vitest run packages/presenter/tests/wire/failure/
```

Prova de runtime real (não substituível por teste):

```
# scaffold limpo, install estrito com npm (estrito em peers onde o pnpm é leniente)
npx create-theokit@<versão-local> smoke-app && cd smoke-app && npm install
# afirmar que `ai` NÃO está na árvore
ls node_modules/ai 2>/dev/null && echo "FALHOU: ai instalado" || echo "ok: ai ausente"
# rodar um turno de agente real contra um provider
npm run dev  # e exercitar um turno com streaming + tool call
```

### Acceptance Criteria

- [ ] Todas as suítes verdes — `pnpm test` e `pnpm test:types` retornam exit 0
- [ ] Coverage ≥ 90% nos arquivos alterados; 100% em `read-message-stream.ts` (caminho crítico)
- [ ] Zero type errors e zero lint warnings — `pnpm typecheck` e `pnpm lint` retornam exit 0
- [ ] `check-ai-free-surface.mjs` sai 0
- [ ] Teste diferencial verde para toda variante — `pnpm --filter @theokit/presenter test differential` retorna exit 0
- [ ] **Runtime-metric proof** — app scaffoldado sem `ai` na árvore roda um turno com streaming **e** uma tool call, observados ao vivo
- [ ] Failure scenarios — `pnpm vitest run packages/presenter/tests/wire/failure/` retorna exit 0 com as 8 linhas da tabela exercitadas

### If Validation Fails

1. Separar falhas causadas por este plano das **12 pré-existentes** já mapeadas (diagnóstico no PR #166 — apodrecimento de gate/fixture, medido idêntico com e sem mudanças via baseline por `git stash`)
2. Corrigir todas as causadas pelo plano antes de declarar completo
3. Re-rodar a cadeia
4. Pré-existentes são documentadas na descrição do PR e não bloqueiam
