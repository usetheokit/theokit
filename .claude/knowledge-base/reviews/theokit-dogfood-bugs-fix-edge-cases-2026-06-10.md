# Edge Case Review — theokit-dogfood-bugs-fix

Date: 2026-06-10
Tasks analyzed: 8
Edge cases found: 4 (MUST FIX: 1, SHOULD TEST: 2, DOCUMENT: 1)

## MUST FIX

### EC-1: Re-publish with prerelease version creates version gap
- **Affected task:** T4.1 (Re-publish)
- **Family:** State / Versioning
- **Scenario:** T1.1 fixes template to use `0.1.0-alpha.0`. T4.1 bumps packages to `0.1.0` (stable). But the template was already published with `0.1.0-alpha.0` ranges. If we publish `0.1.0` stable, existing `create-theokit@0.5.0` templates still reference `0.1.0-alpha.0`. Users who ran `npx create-theokit` between the two publishes have stale `package.json.tmpl`.
- **Impact:** Race window where old template + new package = version mismatch.
- **Suggested fix:** Publish packages as `0.1.0` (stable, not prerelease). Update template to `^0.1.0` (now resolves because 0.1.0 is stable, not prerelease). Publish create-theokit AFTER packages. One atomic sequence: packages first → template second.

## SHOULD TEST

### EC-2: LLM runner in @theokit/agents imports Web Standard fetch — Deno needs --allow-net
- **Affected task:** T1.2 (Built-in stream factory)
- **Suggested test:** Verify that when OPENROUTER_API_KEY is missing, the error message includes the env var name AND the alternative `llmApiKey` option. Don't just say "no key" — say exactly what to do.

### EC-3: Guard enforcement reads @UseGuards from agent class but metadata stored via http-decorators Symbol
- **Affected task:** T1.3 (Guards on agents)
- **Suggested test:** Verify that `Symbol.for('theokit:http-decorators:use-guards')` resolves across packages (agents + http-decorators). If the Symbol key differs between the two packages' metadata constants, guards will silently not be found. The fix: both packages MUST use the same Symbol.for key string.

## DOCUMENT

### EC-4: Inline HTML in template is not SSR — no React rendering
- **Accepted risk:** The template serves raw HTML string at GET /, not React SSR. `app/page.tsx` and `app/layout.tsx` exist in the template but are NOT rendered server-side — they're documentation of the intended structure for when the user upgrades to Vite plugin. This is honest and acceptable for alpha. Document in README: "Frontend is inline HTML. For React SSR, add theokit Vite plugin."

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 |
| T1.2 | 1 | 0 | 1 (EC-2) | 0 |
| T1.3 | 1 | 0 | 1 (EC-3) | 0 |
| T2.1 | 0 | 0 | 0 | 0 |
| T2.2 | 0 | 0 | 0 | 0 |
| T2.3 | 1 | 0 | 0 | 1 (EC-4) |
| T3.1 | 0 | 0 | 0 | 0 |
| T3.2 | 0 | 0 | 0 | 0 |
| T4.1 | 1 | 1 (EC-1) | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT — 1 MUST FIX (publish order: stable versions first, template second).
