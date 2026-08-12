# @theokit/presenter

## 0.7.0

### Minor Changes

- ed9197d: M67 — the config/trust/wiring family crosses the layered boundary, and the `@theokit/sdk` floor rises
  to `^4.49.0` to make that possible.

  **Installation-contract change.** `theokit` and `@theokit/presenter` publish `@theokit/sdk` as a
  `peerDependency`; raising the floor means a consumer pinned below 4.49.0 will now fail peer
  resolution. Sized as a minor rather than a major because the change is additive at the API level —
  nothing is removed or renamed — but the peer floor is a real break at install time and is called out
  explicitly here rather than left for the consumer to discover.

  Six values (`foldLayers`, `verifyLayerOrdering`, `applySecurityFloor`, `resolveTrustPosture`,
  `auditEnvReachability`, `recordWiring`) and two types (`WiredEntity`, `ToolResultContentBlock`) now
  cross `@theokit/agents`. Four more arrived with the floor: `classifySessionArtifact` +
  `SessionArtifact`, `atomicWriteTempTarget`, `writableRootsFor`, `assertSecureModes`.

## 0.5.0

### Minor Changes

- a6dd4c1: O piso de `@theokit/sdk` passa a ser o mesmo em todo o monorepo — `^4.40.0` (#183).

  Três pacotes declaravam o mesmo requisito de três formas: `@theokit/agents` exigia `^4.40.0` como
  dependência direta, `theokit` aceitava `^4.0.1` no peer, e `@theokit/presenter` aceitava `>=3.5.0` —
  uma major inteira abaixo.

  Um app que **honrasse o peer** e instalasse, digamos, `@theokit/sdk@4.5.0` satisfazia `theokit` e não
  satisfazia o `agents`, então o resolvedor instalava uma **segunda cópia**. Duas cópias produzem dois
  tipos nominalmente idênticos e estruturalmente incompatíveis, com a mensagem mais confusa do
  ecossistema:

  ```
  SandboxBackend is not assignable to SandboxBackend
  ```

  Isso já custou uma sessão de debug a um consumidor.

  **Nenhuma configuração que funciona hoje quebra.** Quem já está em `>= 4.40.0` não é afetado; quem
  está abaixo já recebia a cópia dupla — a mudança troca uma falha confusa de tipo por um erro claro
  de instalação. O que a declaração permitia e não funcionava, ela deixa de permitir.

## 0.4.0

### Minor Changes

- O TheoKit passa a ser dono do wire `UIMessageStream`: instalar `theokit` não traz mais o `ai`.

  Schema, parser e reconstrutor vivem em `@theokit/presenter/wire`. **O formato da frame não muda** —
  um cliente ai-sdk continua conversando com um servidor TheoKit, e nenhum app existente precisa
  migrar. `ai` deixa de ser `peerDependency`; quem o declarava só por causa do TheoKit pode removê-lo.

  Por que **minor** e não major: nada que um consumidor faz deixa de funcionar. Remover um peer é
  relaxamento, não quebra; os tipos são estruturalmente compatíveis (medido: as declarações do ai-sdk
  não têm brand), então código que ainda importa de `ai` segue compilando. O `@theokit/presenter` ganha
  `zod` como peer — a única exigência nova, e ele está em 0.x.

  Correções que vêm junto, todas de defeitos que existiriam em qualquer parser de wire escrito sem
  elas:

  - O frame terminal `data: [DONE]` não é JSON. Sem guarda, um parser quebraria no **último frame de
    toda resposta**.
  - Terminadores CRLF/CR passam a ser normalizados. Sem isso, um proxy que os reescreve produzia
    silêncio total — nem erro, nem renderização.
  - Um erro de provider no meio do stream preserva o texto já entregue e só então falha.

  `ai` permanece como `devDependency`: um teste diferencial alimenta o mesmo stream nele e no nosso
  parser, exigindo saída idêntica variante por variante. É o que torna a reimplementação verificável
  em vez de uma aposta.

## 0.2.0

### Minor Changes

- 70a4daa: Presentation layer (M49): new `@theokit/presenter` package — the canonical `AgentOutputEvent` (narrow-waist normalized event) + the `Presenter` Strategy contract + registry + `UIMessageStreamPresenter` (the web surface) + `fromSdk` source translator. `@theokit/agents` now composes its web `UIMessageStream` path over the shared presenter (`presentUIMessageStream`), replacing the inline `translateToUIMessageStream` (removed — the public export is now `presentUIMessageStream`). Behavior is byte-identical (the full existing web test corpus — unit + M1 E2E — passes unchanged against the new path). This closes the web/terminal translation duplication surfaced by dogfooding agent-builder; terminal/JSON presenters follow in M50/M51. No backward-compat shim (owner-approved clean break).
