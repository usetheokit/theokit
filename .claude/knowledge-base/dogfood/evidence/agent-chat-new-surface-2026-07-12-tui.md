---
scenario: agent-chat-new-surface
date: 2026-07-12
operator: claude
outcome: pass
summary: create-theokit --surface tui scaffolds→installs→runs→streams a real OpenRouter response in the terminal; found+fixed 3 bugs en route.
---

# Dogfood — `agent-chat-new-surface` on the terminal (TUI) surface

Ran the anchor scenario end-to-end on **real infrastructure** (maintainer machine + OpenRouter), driving
the newly-shipped `create-theokit --surface tui` path from `npx` to a live streamed agent reply in a
terminal, inside the `theokit` tmux session.

## Steps exercised (each on published bits)

1. `npx create-theokit@1.2.x theo-tui --yes --surface=tui` → scaffolds the Ink TUI app.
2. `npm install` → resolves `theokit@0.30.1` + `@theokit/tui@0.30.0` + `ink@7.1.0` (155 packages, no error).
3. `npm run dev` (`tsx tui/main.tsx`) → the Ink TUI renders with the `›` composer.
4. Typed `"Reply with exactly one short sentence: what is TheoKit?"` + Enter → the agent ran
   (`streamAgentTurnInProcess` over `useAgent(InProcessTransport)`), streamed a `UIMessage`, which the
   `@theokit/tui/ai-sdk` adapter (`uiMessagesToChatThread`) projected onto `<ChatThread>`:
   `✦ TheoKit is an open-source toolkit for developing and analyzing the performance of edge computing applications.`
5. Second turn `"Now reply with just the number 42 and nothing else."` → `✦ 42` (multi-turn works).

## Outcome: PASS — but only after fixing 3 bugs the test harness never caught

Running it for real (M45 only ever ran the test harness) surfaced a full chain of "works from source /
install ≠ runs" defects, each fixed + republished + regression-tested:

1. **`__dirname is not defined`** — `scaffold-surface.ts` used the CJS global, undefined in the published
   ESM bundle → scaffold rolled back. Fixed (`import.meta.url`) + `built-cli.test.ts` runs the real bundle.
   `create-theokit@1.2.1`.
2. **`EUNSUPPORTEDPROTOCOL "workspace:"`** — `theokit` 0.24.0–0.30.0 shipped raw `workspace:^` (published
   with `npm publish`). Republished via `pnpm publish` → `theokit@0.30.1`; guard `pnpm verify:published`.
   Issue #115.
3. **`Cannot read properties of undefined (reading 'ReactCurrentOwner')`** — tui surface pinned `ink@5`
   (React-18 internals) against the template's `react@19`. Moved forward to `ink@^7.1.0` (matches
   `@theokit/tui`). `create-theokit@1.2.2`. Regression assertion locks `ink` to `^7`+.

## Known caveats (non-blocking, follow-ups)

- The runtime emits `[THEO_AGENT_M7_RUN_CONTEXT]` to **stdout**, which interleaves with the Ink render
  (console logs corrupt a TUI). Candidate: route run-context observability to stderr or gate it in TUI.
- `<ChatThread header={…}>` did not show the header while the thread was empty (cosmetic first-run UX).
- `streamAgentTurnInProcess` is only exported from the **deprecated** `theokit/server` umbrella (no
  `theokit/server/agent` sub-path yet) — the deprecation warning prints on every run. theo-core gap.
