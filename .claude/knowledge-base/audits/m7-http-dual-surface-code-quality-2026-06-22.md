# Code-Quality Audit — M7 HTTP dual-surface (theokit slice)

**Date:** 2026-06-22
**Slug:** m7-http-dual-surface
**Effective verdict (M7 slice):** PASS — zero findings in any M7-touched file.
**Raw runner verdict:** FAIL_HARD — entirely from out-of-scope read-only material (see below). NOT caused by M7.

## What the automated runner reported

`run_code_quality.py m7-http-dual-surface --languages-rule <pipe-format>` (the
project's own `code-quality-languages.txt` uses theokit's native
one-identifier-per-line format for `post-edit-check.sh`, which the plan-ecosystem
runner rejects — a pre-existing config-format mismatch between the two tools; not
editable without breaking theokit's native hook):

- `d1_dead_code: typescript = 28966`
- `d2_symbol_fab: typescript = 4`
- Hard caps: `dead_code_unallowlisted_typescript`, `symbol_fabrication_typescript`, `symbol_fab_unverifiable_typescript`.

## Why this is NOT an M7 finding

The runner is **mis-scoped**: it scanned `.claude/knowledge-base/references/**`
(read-only study clones — next.js, workers-sdk, miniflare) and `fixtures/`. The
ecosystem treats `knowledge-base/references/**` as a read-only DEFAULT_SKIP zone
("NEVER scan references/" — code-quality anti-pattern), but this install's runner
did not exclude it, so knip flagged ~28966 "unimported file" findings across the
cloned frameworks, and tree-sitter flagged `virtual:` imports in
`fixtures/define-integration/app/page.tsx` as fabricated.

Filtering every hard-cap finding to M7-touched files yields **0**:

```
grep -cE "handle-request-error|theo-error\.ts|health-route|server/boot|request-handler|server/http/index|server/define/index" report  ->  0
```

Sample of the actual hard-cap sources (all out-of-scope):
- `fixtures/define-integration/app/page.tsx` — `virtual:integration:banner` (fixture virtual import).
- `.claude/knowledge-base/references/workers-sdk/.../http/index.ts` — unimported (read-only clone).
- `.claude/knowledge-base/references/next.js/.../base-http/index.ts` — unimported (read-only clone).

## M7-slice quality verification (manual, FAANG)

- **Symbol fabrication:** `tsc --noEmit` clean across the package — no undefined symbol in M7 code.
- **Dead code:** every new export is public-API surface with a real caller —
  `TheoError`/`fromUnknown`/`NotFoundError`/`serverErrorToEnvelope`/`envelopeCodeToStatus`
  from `theokit/server/http` (used by `handle-request-error.ts` + `boot.ts` + tests);
  `defineHealthRoute`/`defineReadyRoute`/`serveReservedRoute` from `theokit/server/define`
  (used by `request-handler.ts` + `boot.ts`); `createConventionFetchHandler` from
  `theokit/boot` (public subpath + tests). No orphan.
- **Lint:** eslint `--max-warnings=0` clean on all M7 files.
- **Tests:** 15 M7 tests green (4 files); full suite has no M7-introduced failures
  (26 pre-existing failures are docs/changeset/create-theo-dist presence, confirmed at baseline 201d954).
- **Build:** `dist/boot/index.{js,d.ts}` emitted; `publint` "All good!".

## Conclusion

The M7 theokit slice is clean. The raw FAIL_HARD is a pre-existing runner
mis-scoping (auditing read-only `references/` clones) unrelated to this slice —
fixing that runner config is out of M7 scope. For `/review` handoff, the M7 slice
verdict is **PASS**.
