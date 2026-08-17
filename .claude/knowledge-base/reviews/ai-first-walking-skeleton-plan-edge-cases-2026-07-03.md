# Edge Case Review — ai-first-walking-skeleton (implementation plan)

Date: 2026-07-03
Plan analyzed: .claude/knowledge-base/plans/ai-first-walking-skeleton-plan.md
Tasks analyzed: 3 (T0.1, T1.1, T2.1, T3.1)
Edge cases found: 5 (MUST FIX: 2, SHOULD TEST: 2, DOCUMENT: 1)

## MUST FIX

### EC-1: T3.1 fixture must NOT depend on the `server/agents/` convention (that's M2, not M0)
- **Affected task:** T3.1
- **Family:** Scope
- **Scenario:** T3.1 says the fixture exposes an agent "via a single `server/agents/*.ts`-style file". The zero-config `server/agents/` file-based convention is Eixo B = M2; it does not exist at M0. Implementing it here is scope creep that pulls M2 into M0.
- **Impact:** Either an out-of-scope build of the convention, or a broken reference to a non-existent surface.
- **Suggested fix:** M0's fixture wires the endpoint **manually** (a route/handler that calls `translateToUIMessageStream` + `uiMessageStreamResponse` directly). The "no custom adapter" claim M0 proves is **client-side** (`useChat` needs no adapter); the server wiring is explicit/manual until M2.

### EC-2: `theokit` package also needs `ai` as a devDependency (T2 imports the type)
- **Affected task:** T0.1, T2.1
- **Family:** Dependency
- **Scenario:** T2.1's `ui-message-stream-response.ts` does `import type { UIMessageChunk } from 'ai'`, but T0.1 only adds `ai` to `@theokit/agents`. `theokit` typecheck fails to resolve `ai`.
- **Impact:** `pnpm --filter theokit typecheck` fails.
- **Suggested fix:** T0.1 also adds `ai@^7.0.14` as a devDependency of `theokit` (`packages/theo/package.json`), same import-type-only rationale (D2).

## SHOULD TEST

### EC-3: Frame chunks (`start`/`finish`) required fields
- **Affected task:** T1.1
- **Suggested checkpoint:** The schema-conformance test must `uiMessageChunkSchema.parse` the `start` and `finish` chunks too (not only text-*), so any required field (e.g. a `messageId` on `start`) is caught. If `start` needs a `messageId`, inject it deterministically like `textId`.

### EC-4: `useChat`/transport parse in a node test env
- **Affected task:** T3.1
- **Suggested checkpoint:** Assert at the transport layer (`DefaultChatTransport.processResponseStream` / `parseJsonEventStream`) against the Response body first (node-native); only add a JSDOM `useChat` render if a stream/fetch polyfill is stable. (Already the Q1 resolution — keep it as the primary path.)

## DOCUMENT

### EC-5: Two agent wire formats coexist at M0
- **Accepted risk:** M0 adds the UIMessageStream path beside the old proprietary `AgentEvent` SSE; the clean break (removal) is M3. This temporary coexistence is intentional and scoped (already a Drawback in the plan).

## Summary

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T0.1 | 1 | 1 (EC-2) | 0 | 0 |
| T1.1 | 1 | 0 | 1 (EC-3) | 0 |
| T2.1 | 1 | 1 (EC-2) | 0 | 0 |
| T3.1 | 3 | 1 (EC-1) | 1 (EC-4) | 1 (EC-5) |

**Verdict:** PLAN NEEDS ADJUSTMENT (2 MUST FIX absorbed into plan v1.1)
