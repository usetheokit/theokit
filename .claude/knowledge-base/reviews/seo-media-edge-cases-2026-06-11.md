# Edge Case Review — seo-media

Date: 2026-06-11
Tasks analyzed: 2 (T1.1, T1.2)
Edge cases found: 1 (MUST FIX: 0, SHOULD TEST: 1, DOCUMENT: 0)

## SHOULD TEST

### EC-1: XSS via Metadata title/description props

- **Affected task:** T1.1
- **Suggested test:** `test_metadata_escapes_html_in_title()` — pass `title='<script>alert("xss")</script>'`, assert rendered output does NOT contain executable `<script>` tag. React 19's JSX escaping handles this automatically (`<title>{props.title}</title>` escapes by default), but worth a test to confirm the contract — especially because `dangerouslySetInnerHTML` would bypass it. Assert that `<Metadata>` NEVER uses `dangerouslySetInnerHTML`.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 0 | 1 | 0 |
| T1.2 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN OK

These are trivially simple React components — pure JSX, no state, no I/O, no side effects. React 19's built-in escaping covers XSS. The one SHOULD TEST is defense-in-depth, not a gap in the plan.
