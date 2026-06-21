# Edge Case Review — m5-client-stream

Date: 2026-06-21
Plan analyzed: knowledge-base/plans/m5-client-stream-plan.md
Tasks analyzed: 3 (T1.1 liveText/error, T1.2 fold/hook, T2.1 barrel)
Edge cases found: 4 (MUST FIX: 0, SHOULD TEST: 2, DOCUMENT: 2)

## Boundary map

Pure reducers over the `AgentEvent[]` the hook already holds — no I/O, no new transport. The live edges are correlation corner cases (orphan/duplicate ids) and the envelope resolver's input shape (sdk-tools return JSON STRINGS, not objects).

## MUST FIX

(none — additive derived fields + pure reducers; existing `useAgentStream` untouched.)

## SHOULD TEST

### EC-1: the default envelope resolver must handle a JSON-STRING `tool_result.data`
- **Affected task:** T1.2
- **Family:** Format
- **Scenario:** sdk-tools handlers return a JSON STRING (`'{"ok":false,"error":"not_found"}'`), not an object. The default `resolveEnvelope` must parse a string before checking `ok===false`, else every sdk-tools error renders as `success`.
- **Suggested test:** `defaultResolveEnvelope_parses_json_string` — `'{"ok":false}'` → `{error:true}`; `'{"ok":true}'` → `{error:false}`; non-JSON string → `{error:false}` (conservative).

### EC-2: orphan / unmatched `tool_result` (no prior `tool_call`)
- **Affected task:** T1.2
- **Family:** State
- **Scenario:** a `tool_result` arrives with no matching `tool_call` (id or name) — the fold must still surface a finished card (not drop it), so a result is never invisible.
- **Suggested test:** `fold_orphan_result_creates_finished_card` (already in T1.2 TDD) — assert the orphan becomes a card with its status from the resolver.

## DOCUMENT

### EC-3: duplicate `tool_call` ids — last write wins for correlation
- **Accepted risk:** if two `tool_call` events share an `id`, `byId` keeps the latest; a subsequent `tool_result` correlates to the latest. Malformed/non-conforming server output; documented. No action.

### EC-4: `liveText` concatenation assumes delta/append semantics
- **Accepted risk:** `liveText` joins ALL `message` contents. A server that emits full-snapshot messages (not deltas) would see them concatenated; such a server uses `events` directly. Documented on the field (D1 drawback). No action.

## Summary

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T1.1 | 1 | 0 | 0 | EC-4 |
| T1.2 | 3 | 0 | EC-1, EC-2 | EC-3 |
| T2.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN OK (2 SHOULD TEST — JSON-string envelope + orphan result — fold into T1.2 TDD; EC-3/EC-4 docstring notes; no MUST FIX)
