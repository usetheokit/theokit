---
slug: issue-80-page-ui-1.0-migration
milestone_id:
created_at: 2026-07-05
goal: Migrate the create-theokit default template app/page.tsx to the @theokit/ui@1.0.0 auto-dispatch chat API so a pristine scaffold passes strict tsc, builds, and renders a correct chat.
---

# Plan — issue #80: template page.tsx → @theokit/ui@1.0.0

## Goal

A pristine `create-theokit` app must pass `tsc --noEmit` (0 errors), `theokit build`, and render a
working chat. Today `app/page.tsx` fails `tsc` with 7 errors because it targets the pre-1.0
`@theokit/ui` API (manual part-flattening + old `Message`/`ToolCallStatus`/`AgentErrorKind`/
`AgentErrorCard` shapes).

## Discover (verified against @theokit/ui@1.0.0 real .d.ts + README)

- `ChatMessage` now takes `message: UIMessage` and **auto-dispatches** text/tool/reasoning parts —
  the page's manual `ConversationItem`/`items` flatten + `ToolCallCard` rendering is obsolete.
- `useAgent().messages` is **assistant-only** `UIMessage[]`; user turns must be constructed locally
  as `UIMessage` (`{ id, role:'user', parts:[{type:'text', text}] }`) and interleaved.
- `AgentErrorCard`: `{ kind?: AgentErrorKind, title: ReactNode, detail?, actions? }`;
  `AgentErrorKind = 'rate-limit'|'context-overflow'|'auth'|'tool-failure'|'network'|'generic'`.
- `ContextWindowBar`, `ChatComposer`, `QuickActionChips`, `AgentStreaming`, `EmptyState`,
  `CommandPalette`, `Avatar`, `Tooltip`, `Button`, `ScrollArea` — unchanged shapes the page already used.

## Coverage matrix

| Goal claim | Task |
|---|---|
| page.tsx uses the 1.0 auto-dispatch API (UIMessage) | T1 |
| Pristine scaffold passes strict `tsc` (0 errors) | T2 gate |
| Pristine scaffold `theokit build` succeeds | T2 gate |
| The chat renders (empty state + a real streamed assistant message with a tool card) | T3 gate |

## Tasks

### T1 — Rewrite `app/page.tsx` to the 1.0 API
- Drop `Message` import + the `ConversationItem` type + the `items` useMemo flatten + manual
  `ToolCallCard`. Track user turns as `UIMessage[]`; interleave with `useAgent().messages`; render
  each via `<ChatMessage message={m} />` inside `<ChatThread>` (auto-dispatch).
- `AgentErrorCard` → `kind="network"`, `detail`, `actions`. Keep ContextWindowBar/ChatComposer/
  QuickActionChips/CommandPalette/⌘K/EmptyState as-is.

### T2 — Type + build gate (pristine scaffold)
- Fresh `create-theokit` scaffold (from the fixed template) → `tsc --noEmit` = **0 errors** AND
  `theokit build` exits 0. This is the #80 DoD.

### T3 — Functional render gate (100% functional evidence)
- `theokit dev` serves the page; load it in a real browser (chrome-devtools-mcp): the empty state +
  quick-action chips render with no console errors. With a provider key, send a message and confirm
  the streamed assistant text + a tool-call card render via the auto-dispatch `ChatMessage`.

## Acceptance criteria (evidence required)

- **AC-1** pristine scaffold `tsc --noEmit` → 0 errors (was 7). Wall evidence.
- **AC-2** pristine scaffold `theokit build` → exit 0.
- **AC-3** page renders in a real browser: empty state visible, zero console errors on load.
- **AC-4** (with key) a sent message streams and renders assistant text + tool card via ChatMessage.

## Drawbacks & risks

1. `tsc` proves types, not rendering — hence AC-3/AC-4 run the real app in a browser.
2. `useAgent.messages` assistant-only → interleave user turns by index (correct for turn-based flow).

## Unresolved questions

- (none) — the full @theokit/ui@1.0.0 API is mapped from its shipped .d.ts.
