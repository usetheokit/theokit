---
version: 1.0
slug: agent-conversation-in-core
owner: framework
created_at: 2026-07-14
milestone_id: M46
---

# Discovery plan — conversation-state accumulation in a transport-agnostic agent client core

## Context

M46 (`ROADMAP.md`) raises TheoKit's client from per-turn raw `UIMessage[]` to a surface-agnostic
`thread`. The store `packages/theo/src/client/agent-client.ts:137` RESETS `#messages` to
`[userMessage]` on every `send`, so every app hand-rolls conversation history + the
streaming→committed lifecycle + id fabrication (`apps/showcase/app/hooks/use-transcript.ts`, 88 lines,
re-written per surface). Before designing the accumulation, we deep-read the two SOTA patterns for
"conversation state across turns in a framework-free client": **ai-sdk's `AbstractChat`** (the exact
per-turn→conversation machinery — id assignment, message upsert, active-response, status machine) and
**opencode's transport-agnostic client** (one client, per-surface injection). Rule cited:
`.claude/rules/architecture.md` (client → core only; the `thread` must live in the React-free core so
all surfaces inherit it — M44 invariant).

## Objective

Produce a blueprint of the conversation-accumulation patterns (id fabrication, message upsert,
commit-once, abort/error/reconnect lifecycle, React-free-core placement) with file:line citations, so
`/to-plan M46` can design the `thread` in `agent-client.ts` **reusing** ai-sdk primitives (Rule 9) and
matching the opencode "one client, per-surface" shape. Success = every research question answered with
a real citation; the four corners covered.

## In-scope / Out-of-scope

| Project | In scope | Out of scope |
|---|---|---|
| `ai` (node_modules — installed peer) | `node_modules/ai/dist/index.d.ts` (`AbstractChat`, `ChatState`, `readUIMessageStream`, `DirectChatTransport`) — the accumulation contract | the provider/model layer; server `streamText`; RSC |
| `knowledge-base/references/opencode` | `packages/sdk/js/src/v2/client.ts` (transport-agnostic client shape) | the Solid.js/Effect UI bindings; the Go TUI internals |
| TheoKit own (`packages/theo/src/client`) | `agent-client.ts`, `use-agent.ts`, `create-agent-client.ts` (the gap + insertion point) | the transports (M41, done); the server agent path |

## ADRs (how to investigate)

- **DA1 — Depth budget:** ai-sdk `AbstractChat` is a `.d.ts` (types only) — read the CONTRACT (method
  signatures + `ChatState` shape), not a `.js` impl walk (minified). Budget: ai 1h, opencode 30min,
  own-code 30min. Rationale: the goal is the accumulation *contract* + id/lifecycle decisions, not a
  line-by-line port (we reuse `readUIMessageStream`, not re-implement it — Rule 9).
- **DA2 — ai-sdk is a dependency, not a cloned reference:** citing `node_modules/ai/dist/index.d.ts`
  is legitimate evidence (a real, verifiable path); the `discover-confidence` fabricated-citation cap
  checks `knowledge-base/references/` paths only. opencode (the one cloned ref) covers the
  transport-agnostic corner.

## Research questions

| # | Corner | Question | Method | Expected answer shape |
|---|---|---|---|---|
| Q1 | Techniques | How does `AbstractChat` hold the conversation, and how is a new turn's message pushed/committed vs. the in-flight active response? | Read `node_modules/ai/dist/index.d.ts:5481-5650` (`ChatState.pushMessage/popMessage/replaceMessage/snapshot`, `AbstractChat.state/activeResponse/makeRequest/sendMessage`) | The `ChatState` op set (push/pop/replace) + how `activeResponse` holds the streaming turn merged into `messages` on finish |
| Q2 | Techniques | How does ai-sdk assign/keep message ids so a streamed assistant turn commits once with a stable id (TheoKit's SDK leaves ids empty → showcase fabricates them)? | Grep `generateId`/`messageId`/`id:` around `AbstractChat`/`ChatInit`/`CreateUIMessage` in the `.d.ts`; read `CreateUIMessage`/`ChatInit` | Where the id comes from (init `generateId` vs server), and the commit-once mechanism |
| Q3 | Techniques | How does `readUIMessageStream` turn a `ReadableStream<UIMessageChunk>` into accumulating `UIMessage`s, and what are the abort/error terminal states? | Read `readUIMessageStream` signature + `ChatStatus` + `AbstractChat` `stop`/error handling in the `.d.ts` | The accumulation primitive TheoKit already uses + the status machine (submitted/streaming/ready/error) + abort behavior |
| Q4 | Integration tests | How is the streaming→committed accumulation lifecycle tested (so M46's TDD mirrors it)? | `find node_modules/ai -name "*.test.*"` is absent (published) → read TheoKit's own `tests/**/*use-agent*`/`*agent-client*` + `knowledge-base/references/opencode` client tests via grep `test(`/`describe(` in `packages/sdk/js` | The assertion shape for commit-once / abort / error accumulation to reuse in M46 tests |
| Q5 | Dependencies | Which ai-sdk primitives can M46 REUSE for accumulation (Rule 9, no new dep) vs. what must TheoKit own (id fabrication, commit lifecycle)? | Cross-read Q1-Q3 answers against `packages/theo/src/client/agent-client.ts` + `consume-ui-message-stream.ts` | A reuse table: `readUIMessageStream` (reuse) vs `thread` commit/id (TheoKit-owned in the store) |
| Q6 | Tools | How is a React-FREE store tested + how does opencode keep ONE client across surfaces (the placement pattern M46 must match)? | Read `knowledge-base/references/opencode/packages/sdk/js/src/v2/client.ts` (injection shape) + TheoKit `packages/theo/src/client/agent-client.ts` (subscribe/getState/snapshot) | The "one core store, per-surface wrapper" pattern + the headless test harness (no React) |

## Coverage Matrix

| Corner | Questions | Covered? |
|---|---|---|
| Integration tests | Q4 | ✅ |
| Dependencies | Q5 | ✅ |
| Tools | Q6 | ✅ |
| Techniques | Q1, Q2, Q3 | ✅ (3 — at budget cap) |

100% — 6 questions, each mapped to a method + a real path; every corner ≥ 1.

## Halt-loop checkpoints (for /discover-execute)

A sub-task (question) is DONE when: (a) its cited path was actually read/grepped (evidence quoted),
(b) the answer is concrete (a signature / an op name / a line range — not "it accumulates somehow"),
(c) any `knowledge-base/references/` path quoted resolves on disk.

## Acceptance Criteria

- All 6 questions answered with a real citation (ai `.d.ts` line range, opencode client path, or own
  `agent-client.ts` line).
- Blueprint's four coverage corners populated + ≥ 1 ADR (the id-fabrication + commit-once decision).
- No fabricated `knowledge-base/references/` citation.

## Global Definition of Done

Meets `discover-blueprint-golden-rule.md` (four corners populated, no fabricated citation) →
`/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS. Feeds `/to-plan M46`.
