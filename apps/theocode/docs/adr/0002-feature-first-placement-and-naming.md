# 0002 — Feature-first placement and one meaning per name

- Status: accepted
- Date: 2026-09-10

## Context

The 2026-09-10 architecture review measured the packages as feature-first everywhere except their
own roots: `packages/agent/src` held 13 loose files spanning six domains beside 12 well-named
feature folders, and `packages/tui/src` held 10 — two of them sitting beside a folder that names
their own domain (`backtrack-select.ts` beside `backtrack/`, `use-tui-composition.ts` beside
`composition/`). Separately, the term "composition" named three distinct concepts in six
locations across three packages, `packages/tui/tools/` collided with the repository-root
`tools/` (build gates) for an unrelated purpose, and three folders answered the findability
probe "where is session persistence?".

## Decision

1. **Feature files live in feature folders.** `chat/`, `memory/`, `doctor/` in the agent package;
   `session-ui/` in the TUI for the session-presentation modules (`session-items`,
   `statusline-session`, `title-session`). Root keeps entrypoints (`index.ts`, `App.tsx`,
   `main.tsx`) and genuinely cross-cutting single files only.
2. **One meaning for "composition" per package.** In `packages/agent`, `composition/` is how the
   chat agent's composition is declared and recorded (`agent-spec.ts`, `composition-record.ts`).
   In `packages/tui`, `composition/` is the DI seam (`composer-deps.ts`, `use-tui-session.ts`,
   `use-tui-composition.ts`); `agent-session/composition-root.ts` keeps the DDD composition-root
   name for the one place concretes are wired. In `packages/cli`, `run-composition.ts` is the
   composed run entry.
3. **Package-local scripts live in `scripts/`,** never in a package-level `tools/` — the
   repository root owns `tools/` for build gates, and tab-completion hitting two unrelated
   `tools/` directories was the measured cost.
4. **A file adapting a shared primitive does not reuse its basename.** The TUI's process holder
   over `@theocode/shared/retry-record` is `retry-record-holder.ts`, so a grep or jump-to-file
   distinguishes the contract from the adapter. `formatting/turn-error.ts` keeps its name — the
   folder already carries the role.
5. **Session vocabulary.** `agent/src/session` = engine state (ops, history, GC, artifacts);
   `tui/src/persistence` = what survives a restart; `tui/src/agent-session` = the live bridge
   between the running agent and the UI.

## Consequences

- Imports were re-anchored mechanically; `@theocode/agent/chat` now points at
  `src/chat/chat.ts`, and `build:acp` at `src/chat/chat-acp.ts`.
- Historical citations (CHANGELOG, BACKLOG, dated review records) keep the old paths — they
  quote where a file WAS when something was measured, per `rules/testing.md § 5`.
- The backlog cross-validation gate will report the moved paths as stale citations on closed
  items; that is the gate doing its job on a relocation, not a regression.
