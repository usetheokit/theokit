# @theokit/presenter

## 0.18.3

### Patch Changes

- 6b21aee: Widen the declared `@theokit/sdk` range to `<16`, so these packages install next to SDK 14 and 15 (15.2.0 is the one tested).

## 0.18.2

### Patch Changes

- 0c21fb4: The declared `@theokit/sdk` range now admits 12.x, which adds log export to `registerTelemetry`.
- e600f00: Widen the declared `@theokit/sdk` range to `<14`, so SDK 12 and 13 are admitted (#2861).
- 3cf41ee: The `@theokit/sdk` peer range is widened to `<13`, so `@theokit/sdk@12.0.0` is supported. The capability map is measured against it, and TheoClaw flushes its output mask through the `flush` of the `wrapStreams` handle that 12.0.0 adds.

## 0.18.1

### Patch Changes

- 194e124: Widen the `@theokit/sdk` range to `<12` so projects on SDK 10 and 11 install without `--force`.

## 0.18.0

### Minor Changes

- 88d3d87: The optional `@theokit/sdk` peer is now `>=5.3.0 <10`, so npm installs the presenter next to SDK 6 through 9 without `--legacy-peer-deps`. The presenter imports only the `InteractionUpdate` and `BuiltinToolName` types from the SDK, and 9.1.0 still exports both.

## 0.17.0

### Minor Changes

- 4a234f3: Add `foldTranscript`, `EMPTY_TRANSCRIPT` and the `TranscriptState`, `TranscriptItem` and `TranscriptTool` types: a pure, terminal-final fold of `AgentOutputEvent` into render state (messages, reasoning, tool cards with a status and a `ToolResultView`, and an error).
- c5e3952: Added `readTurnMetadata` to `@theokit/presenter/wire`, which reads a `finish` chunk's usage, cost, model and `stopReason` as a typed `WireTurnMetadata`, dropping fields of the wrong type. A client can now tell a turn cut at `step_limit` or `no_progress` from one that finished.

### Patch Changes

- e28f5b8: Tighten the SDK `RunTimelineEvent` compatibility test so it translates a real event.

## 0.16.0

### Minor Changes

- 6e1791d: Add `fromRunTimelineEvent`, `createRunTimelineState` and `flushRunTimeline`: the door from the SDK's `run.events()` timeline into `AgentOutputEvent`. Streamed text and reasoning are not repeated, tool lifecycle points are deduplicated by id, and a tool result is held until the other report can mark it failed.

## 0.15.0

### Minor Changes

- 5f102db: Mark the `@theokit/sdk` and `zod` peers optional so the UI kits can import the root entry, which loads neither at runtime. Only `@theokit/presenter/wire` needs `zod`.
- c46c058: `@theokit/presenter` now exports `pendingApprovals`, `readPendingApproval` and `PendingApproval`, the one projection of outstanding approvals off the wire thread. `@theokit/agents` imports it instead of keeping a private copy; `PendingApproval` is still exported from `@theokit/agents/client`.
- 8d53eb9: `foldTurnLifecycle` takes `messageBoundary: 'tool-call'` to emit the preamble before a tool call as its own message item, and a failed tool result closes its item with `isError`. New `contentChunkFromEvent` and `finalMessageOf` convert canonical events and return the text after the last tool call.
- 8f1f165: A tool result the SDK reported as `permission_denied` now carries a typed `refusal` (`ToolRefusal`: `by`, `reason?`). `@theokit/presenter` adds `ToolRefusal`, `AgentToolResultEvent.refusal` and the transient `WIRE_TOOL_REFUSAL_PART` (`data-tool-refusal`); `readMessageStream` sets `refusal` on the tool part. `@theokit/agents` maps the SDK `source` (`file_hook` → `hook`; `plugin`, `fork_whitelist` → `plugin`) onto `ToolResultEvent.refusal`. The message the model reads is unchanged.

## 0.14.0

### Minor Changes

- 3811739: Add the `@theokit/presenter/diff` subpath: one unified-diff model (`parseUnifiedDiff`, `foldDiffLines`, `segmentWords`, `pairIntraLines`, `DiffParseError`) for both UI kits. The root entry stays dependency-free.
- 8d43d6a: Add `TOOL_KINDS` and `toolKindOf`: one exact-match table of known tool names (the TUI's measured list plus the SDK builtins `shell`, `memory_search`, `memory_get`) giving each tool's kind and target input keys.

## 0.13.0

### Minor Changes

- 27de3e9: Add `readToolResult`, which reads any tool result (a string or an object, in either shell dialect) into one `ToolResultView`: shell output with an exit code, a diff, an error, or text.

## 0.12.0

### Minor Changes

- 5d55198: Add `createWireReader`, a stateful wire reader that attaches the `data-error-code` code to the next `error` event and tracks tool names, and export `WIRE_ERROR_CODE_PART` from `@theokit/presenter/wire`.

### Patch Changes

- 2aacc53: `fromSdkMessage` now reports a tool call with a non-zero `result.exitCode` (failed, timed out, vetoed, unknown tool) as `isError: true`, matching `@theokit/agents`. It used to read only `status`, which the SDK sets to `completed` for every finished call.

## 0.11.0

### Minor Changes

- 1c3553b: `ChatPresenter` can stream previews. Set `supportsEdit: true` when the channel can edit a sent message: text events then emit provisional `ChatMessage`s marked `preview: true`, at most one per `previewIntervalMs` (default 1000; `now` injects a clock), and the turn's final message carries `replacesPreview: true` so the adapter edits the earlier message instead of sending a new one. Without `supportsEdit` a turn still emits one message.

## 0.10.0

### Minor Changes

- 54d87cf: Add `ChatPresenter` — the fourth surface, beside `ui-message-stream`, `terminal` and `json`.

  The defect it closes was observed on a real phone: a reply arrived as `"TheOi! 👋"`, the `"The"`
  being a fragment of the model's reasoning, because a hand-written loop took every frame carrying a
  delta. `AgentOutputEvent` is a discriminated union of eight variants and the presenter switches over
  it, so the compiler refuses to let a variant be forgotten. The guarantee is structural rather than
  disciplinary, which is the whole argument for a presenter on this surface.

  It emits exactly ONE message per turn and never splits. A chat surface has no line to rewrite, so
  there is nothing to emit until `finish()`; and all eight gateway splitters already split inside
  `sendMessage`, so a presenter that pre-split would double-split — a no-op almost always, changing
  behaviour only when a chunk lands exactly on the boundary, in production, with no signal from
  either side. Length is the adapter's decision and always was.

  It knows nothing about any platform. Dialect translation is injected, so `@theokit/presenter` keeps
  `dependencies: {}` and the framework acquires no dependency on a gateway package;
  `OutboundMessage` is matched structurally for the same reason. `@theokit/gateway` exports
  `toDialect(text, platform)` for callers that want the pairing, done at the composition root.

  An `error` event becomes a fixed sentence — neither `message` nor `code` reaches the channel, since
  both may carry internal detail, and silence on a channel is indistinguishable from an agent that
  ignored the person. `tool-call`, `tool-result` and `status` are dropped by default; whether a chat
  surface should show them is a product decision, and adding them later breaks nothing.

## 0.9.0

### Minor Changes

- cfe7f4c: **`@theokit/sdk@5.x` is now supported, alongside 4.x**
  ([#654](https://github.com/usetheokit/theokit/issues/654)).

  The declared range becomes `^4.52.1 || ^5.0.0` (`^4.49.0 || ^5.0.0` for `@theokit/presenter`), and
  the full suite passes on both halves: 7533 tests against `4.52.1` and 7533 against `5.0.1`.

  This unblocks plugins whose open-ended `@theokit/sdk` peer resolves to 5.x. Until now `theokit` was
  the package that **refused** that resolution — the ERESOLVE named the plugin, but the bound that
  could not be satisfied was this one.

  **What had to change, and why it was not a version bump.** SDK 5.x writes a transcript to
  `${sessionUuidFor(sessionId)}.jsonl` where 4.x wrote `${safeSessionId(sessionId)}.jsonl` — a
  SHA-256 over a namespace, so the filename stopped being the session id and the mapping does not
  invert. `listSessions` derived ids from filenames, so listing, protection, GC and deletion all
  returned UUIDs where callers passed ids. One defect, twenty-nine failing tests.

  The id is now read from the transcript **record**, which the SDK writes on both majors and which is
  authoritative where the name was only a convention. The filename stem remains the fallback, so a
  truncated transcript still appears in a listing rather than dropping out of GC's sight.

  `LiveTranscriptError` — 5.x's new name for `LiveSessionError` — deliberately does not cross the
  `@theokit/agents` layer: it does not exist on the 4.x half, and 5.x keeps the old name working and
  deprecated, so the name that crosses is the one both majors have.

## 0.9.0-next.0

### Minor Changes

- cfe7f4c: **`@theokit/sdk@5.x` is now supported, alongside 4.x**
  ([#654](https://github.com/usetheokit/theokit/issues/654)).

  The declared range becomes `^4.52.1 || ^5.0.0` (`^4.49.0 || ^5.0.0` for `@theokit/presenter`), and
  the full suite passes on both halves: 7533 tests against `4.52.1` and 7533 against `5.0.1`.

  This unblocks plugins whose open-ended `@theokit/sdk` peer resolves to 5.x. Until now `theokit` was
  the package that **refused** that resolution — the ERESOLVE named the plugin, but the bound that
  could not be satisfied was this one.

  **What had to change, and why it was not a version bump.** SDK 5.x writes a transcript to
  `${sessionUuidFor(sessionId)}.jsonl` where 4.x wrote `${safeSessionId(sessionId)}.jsonl` — a
  SHA-256 over a namespace, so the filename stopped being the session id and the mapping does not
  invert. `listSessions` derived ids from filenames, so listing, protection, GC and deletion all
  returned UUIDs where callers passed ids. One defect, twenty-nine failing tests.

  The id is now read from the transcript **record**, which the SDK writes on both majors and which is
  authoritative where the name was only a convention. The filename stem remains the fallback, so a
  truncated transcript still appears in a listing rather than dropping out of GC's sight.

  `LiveTranscriptError` — 5.x's new name for `LiveSessionError` — deliberately does not cross the
  `@theokit/agents` layer: it does not exist on the 4.x half, and 5.x keeps the old name working and
  deprecated, so the name that crosses is the one both majors have.

## 0.8.0

### Minor Changes

- bbdfc15: The server's raw error text no longer reaches the browser by default.

  Every failure the framework reported to a browser carried the server's own words: a tool handler's
  stderr verbatim in `tool-output-error.errorText`, a run failure's message verbatim in
  `error.errorText` — whatever a driver, an HTTP client or a filesystem call put in the exception.
  `ai@7`, speaking the same UIMessage protocol, masks by default and says why in its own comment:
  "prevent leaking server error details to the client by default". There was no equivalent here, and
  no seam to add one.

  Both are masked now, through one `onError` hook on the serving boundary
  (`streamAgentUIMessages`, `streamAgentTurnInProcess`, and `mountAgent` by pass-through), defaulting
  to a fixed string. The full text is not lost: it still reaches the server's logs and the
  `agent.run` span, and the hook receives it — what stops is it reaching a browser unless the host
  decides otherwise.

  **A tool's error text masks by the same default as a run's**, which the report that raised this
  deliberately left open. The deciding fact is that masking costs the model nothing: the presenter is
  downstream of the SDK loop, observing events the model has already consumed, so the copy being
  masked is the browser's and only the browser's. Two different defaults for "server text reaching a
  browser" would be a rule nobody could hold.

  The failure `code` keeps travelling on its own data part, so consumers still distinguish failures
  without matching on text — masking that removed the discriminator would push them back into the
  habit that part exists to have removed.

  **Breaking** for `@theokit/agents`: an application that read the server's message out of
  `errorText` now reads `'An error occurred.'`. Pass `onError: (e) => e.message` to restore the old
  behaviour explicitly, which is the point — it becomes a decision instead of a default.

### Patch Changes

- 4411a59: A web application can now render a human-in-the-loop approval prompt. `useAgent` returns
  `pendingApprovals` — one entry per decision the run is parked on, carrying the `approvalId` that
  `approve()` takes, the gated tool's name, the arguments it is about to run with, the question
  declared on the gate, and the window before it settles itself.

  Before this the hook exposed the settle half of the gate and no way to reach the other half. The
  store dropped the `tool-approval-request` frame on the way in, so its whole snapshot while a human
  was deciding was `messages`, `thread`, `status: 'streaming'` and `error` — and the paused tool sat in
  `state: 'input-available'`, which is exactly what an ungated tool looks like while it runs. An
  application could not tell "working" from "waiting for you", and could not have named the decision if
  it could. The only path left was polling `GET /api/agents/<name>/approvals` out of band.

  The transcript carries it too: the gated call's own part moves to `state: 'approval-requested'` with
  the id under `approval.id` while the decision is outstanding, and leaves that state when it is
  settled. That is the ai-sdk reader's own vocabulary, not a new one — the differential oracle compares
  the two readers on the paused run and the denied run and they reconstruct identically.

  What the gate is asking travels as a transient `data-approval` part rather than on the approval frame
  itself. The frame is shared vocabulary and `ai`'s validator for it is strict: a `question` added
  there would not give an ai-sdk client a poorer prompt, it would delete the whole approval frame for
  that client and re-create this defect on the other side of the wire. The tool's name and its
  resolved input are not repeated anywhere — the `tool-input-available` frame already announces both
  under the same call id, and both readers fold the frames into one part.

  `approve(approvalId, decision)` is unchanged; what changes is that the store now hands the id over.
  A tool with no gate produces exactly the same frames and exactly the same snapshot as before, with
  `pendingApprovals` empty.

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
