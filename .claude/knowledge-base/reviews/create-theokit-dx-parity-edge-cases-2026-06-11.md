# Edge Case Review — create-theokit-dx-parity

Date: 2026-06-11
Tasks analyzed: 4 (T1.1, T1.2, T1.3, T1.4)
Edge cases found: 2 (MUST FIX: 1, SHOULD TEST: 0, DOCUMENT: 1)

## MUST FIX

### EC-1: `build` script `npx tsc` emits JS but app.ts uses decorators — tsc can't compile without SWC

- **Affected task:** T1.1
- **Family:** Integration
- **Scenario:** The plan proposes `"build": "npx tsc"`. But the template uses `experimentalDecorators` + `emitDecoratorMetadata` with parameter decorators (`@Body`, `@Param`). Plain `tsc` emits JS but does NOT emit decorator metadata — the compiled code will crash at runtime with "metadata not emitted" errors. This is the same esbuild limitation that forced SWC in the first place.
- **Impact:** `npm run build && npm run start` crashes in production. The "build" script is broken from day 1.
- **Suggested fix:** Change build to `"build": "npx tsup app.ts --format esm --dts false"` (tsup uses esbuild + handles decorators via the SWC loader already in devDeps). Or simpler: `"build": "echo 'Use bun or tsx for production — tsc does not support parameter decorators'"` and document that TheoKit apps run via tsx/bun, not compiled JS.

## DOCUMENT

### EC-2: ESLint flat config requires eslint 9+ — template devDeps must pin it

- **Accepted risk:** The plan adds `eslint.config.mjs` (flat config, per D1) but the template `package.json.tmpl` needs `"eslint": "^9.0.0"` in devDeps. ESLint 8 ignores flat config silently. This is trivial to fix in T1.2 by adding the devDep — just noting it's not explicitly in the plan.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 1 | 0 | 0 |
| T1.2 | 1 | 0 | 0 | 1 |
| T1.3 | 0 | 0 | 0 | 0 |
| T1.4 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT

EC-1 is structural — `tsc` cannot compile parameter decorators to working JS. The build script must use tsup or be documented as "run via tsx".
