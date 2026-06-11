# Edge Case Review — link-prefetch

Date: 2026-06-11
Tasks analyzed: 1 (T1.1)
Edge cases found: 3 (MUST FIX: 1, SHOULD TEST: 1, DOCUMENT: 1)

## MUST FIX

### EC-1: `prefetchModule(href)` injects route PATH as modulepreload href — should be chunk URL

- **Affected task:** T1.1
- **Family:** Integration
- **Scenario:** The pseudo-code does `prefetchModule(resolved)` where `resolved` is the route path (e.g., `/contacts`). But `<link rel="modulepreload" href="/contacts">` would try to preload the HTML page, not the JS module. The correct href is the Vite chunk URL (e.g., `/assets/contacts-abc123.js`).
- **Impact:** Modulepreload silently fails (browser fetches HTML, not JS) — prefetch does nothing. No error, no crash, just zero benefit.
- **Suggested fix:** In dev mode, skip modulepreload entirely (Vite handles modules lazily). In production, read from Vite manifest (`dist/.vite/manifest.json`) to resolve route path → chunk URL. For v1, simplify: just use `<link rel="prefetch" href={to}>` which prefetches the page (HTML+JS combined) — works without manifest resolution. Upgrade to modulepreload with manifest in v2.

## SHOULD TEST

### EC-2: SSR — `document` is undefined on server

- **Affected task:** T1.1
- **Suggested test:** `test_link_no_crash_in_ssr()` — rendering `<Link>` in a server environment (no `document` global) must not throw. Fix: guard `prefetchModule` with `if (typeof document === 'undefined') return`. One line.

## DOCUMENT

### EC-3: `prefetched` Set grows unbounded across navigations

- **Accepted risk:** The module-level `const prefetched = new Set<string>()` grows by one entry per unique link hovered. In a CRM with 100 unique routes, that's 100 strings (~5KB). Negligible. No cleanup needed. If an app had 10,000+ unique routes (unlikely), the Set would still be <500KB. Accepted.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 3 | 1 | 1 | 1 |

**Verdict:** PLAN NEEDS ADJUSTMENT

EC-1 is the critical one — the pseudo-code would inject useless modulepreload tags. The fix: use `<link rel="prefetch">` (fetches the full page resource) for v1, defer manifest-based modulepreload to v2.
