# @theokit/presenter

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
