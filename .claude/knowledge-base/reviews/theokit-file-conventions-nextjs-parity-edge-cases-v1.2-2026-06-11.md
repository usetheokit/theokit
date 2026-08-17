# Edge Case Review — theokit-file-conventions-nextjs-parity v1.2 (second pass)

Date: 2026-06-11
Tasks analyzed: 6 (T1.1, T2.1, T2.2, T2.3, T2.4, T3.1)
Edge cases found: 3 (MUST FIX: 1, SHOULD TEST: 1, DOCUMENT: 1)

Previous pass (v1.0): 7 ECs — all absorbed in v1.1.
This pass reviews v1.2 additions (T2.4) and verifies prior absorptions hold.

## Prior EC absorption verification

| EC | Absorbed in | Verified? |
|---|---|---|
| EC-1 (static.ts lost) | T1.1 expanded to CREATE | ✅ T1.1 title says "Create static file handler" |
| EC-2 (app.ts + index.ts) | T1.1 Files to edit | ✅ Lists app.ts and index.ts |
| EC-3 (duplicate globals.css) | T2.1 Acceptance Criteria | ✅ "app/globals.css does NOT exist" |
| EC-4 (URL-encoded) | T1.1 TDD | ✅ test_handler_decodes_url_encoded_path |
| EC-5 (query params) | T1.1 TDD | ✅ test_handler_ignores_query_params |
| EC-6 (--src-dir) | T2.3 Acceptance Criteria | ✅ "--src-dir flag does NOT move public/" |
| EC-7 (FOUC) | ADR D1 Consequences | ✅ Documented |

All prior ECs properly absorbed. No regression.

## MUST FIX

### EC-8: Tailwind CSS path targets app/ but CSS moves to public/
- **Affected task:** T2.3
- **Family:** State
- **Scenario:** The scaffold CLI (cli.ts:253-254) computes `cssDir` as `'src/app'` or `'app'` and writes to `${cssDir}/globals.css`. After T2.1, globals.css lives in `public/`, not `app/`. The cssDir logic must change to target `public/` (or `src/public/` if --src-dir).
- **Impact:** `create-theokit --yes` (with Tailwind) writes `@import "tailwindcss"` to `app/globals.css` which no longer exists. The CSS file in `public/` is untouched. Tailwind breaks silently.
- **Suggested fix:** In T2.3, change cssDir to: `const cssDir = existsSync(resolve(targetDir, 'src/public')) ? 'src/public' : 'public'`

## SHOULD TEST

### EC-9: Static handler with HEAD request returns headers without body
- **Affected task:** T1.1
- **Suggested test:** `test_handler_head_returns_headers_only()` — send HEAD to existing file, verify status 200, Content-Type set, body is null/empty.

## DOCUMENT

### EC-10: favicon.ico is a binary file — scaffold must copy it correctly
- **Accepted risk:** Most scaffold tools copy all files including binaries. The scaffold function uses `cpSync` with `recursive: true` which handles binary files correctly. No special handling needed, but if someone switches to a template-substitution approach (read → replace → write), binary files would be corrupted. Document as known assumption.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 0 | 1 | 0 |
| T2.1 | 0 | 0 | 0 | 0 |
| T2.2 | 0 | 0 | 0 | 0 |
| T2.3 | 1 | 1 | 0 | 0 |
| T2.4 | 1 | 0 | 0 | 1 |
| T3.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN NEEDS MINOR ADJUSTMENT (1 MUST FIX in T2.3 cssDir path)
