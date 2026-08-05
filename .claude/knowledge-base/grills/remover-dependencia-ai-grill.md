---
slug: remover-dependencia-ai
date: 2026-08-05
questions_asked: 5
decisions_resolved: 8
verdict: READY_FOR_PLAN
---

# Grill: remover a dependência `ai` do TheoKit

## Escopo real (medido antes da primeira pergunta)

O pedido original dizia "todos os projetos `@../`". A medição corrige a premissa: **só o `theokit`
usa `ai`**. Levantado com `git ls-files` — as primeiras varreduras com `grep -r` acusaram milhares
de falsos positivos vindos de `.claude/knowledge-base/references/`, que hospeda projetos de
terceiros clonados (Mastra, shadcn-ui) e é gitignorado.

| Repo | Arquivos de fonte com `from 'ai'` | Manifestos com `"ai":` |
|---|---|---|
| **`theokit`** | **44** (18 em `packages/*/src`, 26 em testes) | **6** |
| `theokit-sdk`, `theokit-tui`, `theokit-ui`, `usetheo-ui`, `theokit-studio`, `theokit-tauri`, `theokit-di`, `theokit-gateways`, `theokit-plugins`, `theokit-skill`, `theokit-example` | 0 | 0 |

Correção de anotação prévia: o `theokit-tui` **não** depende mais de `ai` (memória
`project_tui_claude_code_render` está desatualizada nesse ponto).

## Superfície de runtime — medida nos dists PUBLICADOS (não no fonte)

Medição feita contra `theokit@0.44.3` e `@theokit/agents@7.0.0` instalados de verdade num projeto
descartável, separando `.js` de `.d.ts`:

| Pacote | `.js` (runtime) | `.d.ts` (tipos) |
|---|---|---|
| `theokit` | **0** | 2 |
| `@theokit/agents` | **1 chunk, 2 × `import("ai")`** | 5 |

Toda a superfície de runtime do `ai` no TheoKit são **dois `import()` dinâmicos num único arquivo** —
`consume-ui-message-stream.ts:42` (`parseJsonEventStream` + `uiMessageChunkSchema`) e `:67`
(`readUIMessageStream`). Os outros 42 arquivos são `import type`, que evapora na compilação.

**Armadilha de medição, registrada para quem for implementar:** grepar `dist/` inteiro conta as
declarações de tipo como import de runtime e produz a conclusão errada de que o runtime inteiro
depende de `ai` — foi exatamente o engano de uma anotação anterior. Separe `--include="*.js"` de
`--include="*.d.ts"`.

Consequência para o plano: o trabalho de runtime é **um arquivo**. O grosso do esforço é o espelho
de tipos, o schema de validação e o teste diferencial — não a reescrita de caminho de execução.

## Decision tree resolved

1. **Motivação = lock-in de ecossistema** (não peso, não licença). A evidência descarta bundle: o
   único uso de runtime é um `import()` dinâmico (chunk lazy), os 17 restantes são `import type`
   que evaporam na compilação, e o budget de 350KB gzip está verde. `ai` é Apache-2.0, então
   licença também sai.
2. **Manter compatibilidade de wire; remover só a dependência.** Lock-in é não conseguir sair, não
   falar um formato que outros também falam. Emitir as mesmas frames SSE preserva interoperabilidade
   sem exigir o pacote instalado.
3. **Espelhar só o subconjunto usado (~22 variantes), não as 51.** Postura assimétrica: estrito na
   escrita (frame fora do contrato explode alto — `error-handling.md § 2`), tolerante na leitura
   (tipo desconhecido é ignorado com aviso estruturado). Espelhar 51 criaria ~29 variantes sem
   consumidor — código morto que os gates `G7` e `/code-quality` reprovam, e YAGNI direto.
4. **O módulo mora em `@theokit/presenter/wire`.** O `presenter` é a única folha do DAG entre os que
   precisam do wire; qualquer outro lugar cria dependência subindo o grafo, proibido pelo `G1`. É
   também o dono semântico — o presenter já é "the canonical AgentOutputEvent + Presenter Strategy",
   e as frames são o contrato de saída dele.
5. **`ai` permanece como `devDependency`, usado como oráculo em teste diferencial.** Sai de
   `dependencies`/`peerDependencies` (o objetivo — nenhum consumidor o instala por nossa causa), mas
   continua no CI para provar fidelidade: mesmo stream SSE nos dois parsers, saída idêntica ou build
   reprova. Mais fixtures gravadas de frames reais como piso para o dia em que o oráculo sair.
6. **(derivada) Validação com `zod`.** Não perguntado: `G3` do `system-design-guardrails.md` obriga
   Zod como fonte única de tipos, e já é dependência declarada — degrau 4 da escada de parcimônia.
7. **(derivada) Break de consumidor é próximo de zero.** Medido: os brands do `ai` estão em linhas
   3149+, depois de `UIMessage` (1798) e `UIMessageChunk` (2401); os tipos que espelhamos são
   estruturais puros (`{ id: string; role: union; metadata?; parts: Array<...> }`). Um espelho fiel
   é assignment-compatible, então código que continue importando de `ai` segue compilando.
8. **(derivada) O template larga o `ai`.** Verificado que **nenhum template usa `@ai-sdk/react` ou
   `useChat`** — os matches eram do `useChatTranscript`, hook próprio. O único toque real é
   `import type { UIMessage }` em `templates/default/app/hooks/use-transcript.test.ts:4`, mais o pin
   `"ai": "^7.0.0"` em `package.json.tmpl:23`.

## Conflitos que o plano DEVE endereçar com ADR explícito

- **Regra 9 (Não Reinvente)** — o código atual justifica a dependência exatamente por ela
  (`consume-ui-message-stream.ts:7`: *"No reinvented wire parser (Rule 9)"*). A decisão estratégica
  de D1 vence a regra aqui, mas isso precisa estar escrito, não passar de contrabando. A mitigação
  que torna a exceção defensável é D5: o oráculo diferencial compra verificabilidade permanente.
- **ADR-0050 D1** — diz literalmente *"Adopt `ai`'s `ChatTransport<UIMessage>` as the seam (do NOT
  invent a parallel interface)"*. O plano reverte isso e precisa de ADR que o supersede, mencionando
  também 0051–0054, que se apoiam nele.
- **Vazamento de tipo na API pública** — `packages/agents/src/client/transport.ts:44` declara
  `AgentTransport = ChatTransport<UIMessage> & {...}`. É o ponto exato onde o tipo de terceiro vira
  nosso contrato publicado.
- **Mudança no grafo de pacotes** — `theokit` hoje não depende do `presenter`; passaria a depender.
  Precisa passar por `check-package-direction.mjs` e `dependency-cruiser`.

## Ganho colateral

O `@theokit/presenter` declara `ai` como peer **não-opcional** hoje, apesar de seu único uso ser um
`import type` — enquanto `agents` e `theo`, que de fato executam código do `ai`, o declaram
opcional. A inversão some junto com a dependência.

## Q&A log

### Q1: O que motivou o pedido — peso/bundle, cadência de breaking changes, lock-in, licença?
**Recommended**: Lock-in de ecossistema. Evidência contra bundle (uso de runtime é lazy, tipos
evaporam, budget verde) e contra licença (Apache-2.0). Cadência é plausível — `ai` foi de v3 a v7 em
~18 meses, e `consume-ui-message-stream.ts:73` já fixa comportamento específico do `ai@7.0.14`
(`terminateOnError`), cheiro clássico de acoplamento a detalhe interno de versão.
**User decision**: aceito.

### Q2: Manter o mesmo wire SSE, ou definir formato próprio?
**Recommended**: Manter compatibilidade de wire, remover só a dependência. Quebrar o formato custaria
migração de todo app existente sem comprar nada — o acoplamento que incomoda é o `import`, não a
forma da frame. Custo assumido: viramos donos de um mirror de variantes, com manutenção contínua.
**User decision**: aceito.

### Q3: Espelhar as 51 variantes ou só as ~22 usadas?
**Recommended**: Só o subconjunto, estrito na escrita e tolerante na leitura, com gate de paridade
no mesmo padrão de `check-sandbox-parity.mjs` / `subpath-surface`. Sem o gate, a tolerância na
leitura vira buraco: variante nova do SDK sumiria em silêncio.
**User decision**: aceito.

### Q4: Pacote novo `@theokit/wire` ou dentro de um existente?
**Recommended**: `@theokit/presenter/wire`, por ser a única folha do DAG e o dono semântico. Pacote
novo acrescentaria publish, changelog, versionamento e CI para código que já tem casa.
**User decision**: aceito.

### Q5: Como provamos que o espelho é fiel, e continua fiel?
**Recommended**: `ai` como `devDependency` + teste diferencial contra o parser real, por variante,
mais fixtures gravadas. Um espelho divergente é pior que a dependência: a dep falha alto no install,
o espelho falha baixo, em produção. Custo declarado: `ai` continua no lockfile e no CI — se o
objetivo fosse nunca mais ver o nome, a estratégia inteira mudaria.
**User decision**: aceito.

## Não resolvido (levar para `/to-plan` como decisão derivável)

- **Nível do bump semver.** A evidência aponta para `minor` (D7 — espelho estrutural é
  assignment-compatible; remover peer não-opcional é relaxamento, não quebra). Mas `@theokit/agents`
  acabou de sair em 7.0.0, e a decisão final depende de o plano confirmar que nenhuma assinatura
  exportada muda de forma.
- **Destino das 26 ocorrências em testes.** Provavelmente migram junto com o código sob teste, mas
  algumas podem virar parte do próprio oráculo diferencial (D5) e portanto continuar importando de
  `ai` deliberadamente.
