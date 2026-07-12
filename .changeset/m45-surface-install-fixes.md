---
"create-theokit": patch
---

**M45 fix — the scaffolded `--surface tui|desktop` apps now install + type-check.** Found by running every
`--surface` scenario end-to-end (real `npm install` resolution + `tsc`):

- **`react-router` was wrongly dropped** for tui/desktop. `theokit` declares it a REQUIRED peer, so removing
  it broke `npm install` (unsatisfied peer). It is kept now (unused by tui/desktop, but the peer must resolve).
- **`ai` was missing** from the tui/desktop deps. It was transitive via `@theokit/ui` (dropped for those
  surfaces), but the unified client (`useAgent` / `createAgentClient`) consumes the `ai` UIMessageStream
  reader at runtime. Declared explicitly now.
- **`JSX.Element` → `ReactElement`** in the Ink `App.tsx` template. React 19 removed the global `JSX`
  namespace, so `JSX.Element` failed to type-check; the component returns `ReactElement` now.

A comprehensive `surface-matrix` test now exercises every scenario (all `--surface` forms + invalid,
web/tui/desktop full trees, `--surface` composing with `--backend`, forced-error rollback) and asserts
the deps, scripts, tsconfig `include`, and unified-client wiring. The tui `InProcessTransport` run binding
(`streamAgentTurnInProcess`) is type-sound: the client `ApprovalDecision` is structurally identical to the
SDK's `HitlDecision`.
