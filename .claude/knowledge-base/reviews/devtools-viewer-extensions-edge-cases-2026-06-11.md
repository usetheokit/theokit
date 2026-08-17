# Edge Case Review — devtools-viewer-extensions

Date: 2026-06-11
Tasks analyzed: 2 (T1.1, T2.1)
Edge cases found: 2 (MUST FIX: 1, SHOULD TEST: 0, DOCUMENT: 1)

## MUST FIX

### EC-1: Route manifest may NOT carry Zod schema data — RoutesTab schema display would be empty

- **Affected task:** T1.1
- **Family:** State / Boundary
- **Scenario:** The plan says "click route → show Zod schema via JSONExplorer". But `route-manifest.ts` does NOT include schema/body/query/params data in the manifest sent to devtools (grep returned zero matches for "schema" in route-manifest.ts). The manifest only carries `path` and `absoluteFilePath`. Without schema data, JSONExplorer would show `undefined`.
- **Impact:** RoutesTab schema viewer renders nothing — feature is DOA.
- **Suggested fix:** T1.1 should ONLY implement the "View API Docs" link (1 line, guaranteed to work). Inline schema display requires extending `route-manifest.ts` to include schema metadata — that's scope creep for this plan. Defer inline schema to a follow-up.

## DOCUMENT

### EC-2: Agent stream events may flood the reducer state array

- **Accepted risk:** A long agent conversation generates 100+ `text_delta` events. The plan mentions "throttle to 10 events/sec" in Drawbacks but doesn't specify how. The dispatcher's `appendCapped()` helper (reducer.ts:27) already caps arrays — same pattern will cap `agentStreamEvents`. The risk is a brief UI jank on very long streams, not a crash. Accepted for v1.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 1 | 0 | 0 |
| T2.1 | 1 | 0 | 0 | 1 |

**Verdict:** PLAN NEEDS ADJUSTMENT

EC-1 is structural — the route manifest doesn't carry schema data. T1.1 should be scoped to ONLY the "View API Docs" link (works today, 1 line). Inline schema viewer deferred.
