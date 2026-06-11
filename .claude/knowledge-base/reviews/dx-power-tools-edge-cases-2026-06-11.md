# Edge Case Review — dx-power-tools

Date: 2026-06-11
Tasks analyzed: 2 (T1.1, T2.1)
Edge cases found: 2 (MUST FIX: 1, SHOULD TEST: 0, DOCUMENT: 1)

## MUST FIX

### EC-1: `@theokit/agents/testing` sub-path needs tsup entry + package.json exports entry

- **Affected task:** T2.1
- **Family:** Integration
- **Scenario:** The plan says "export from `@theokit/agents/testing` sub-path" but tsup only builds entries declared in `tsup.config.ts`. Without adding `testing: 'src/testing/index.ts'` to the entry map AND `"./testing"` to `package.json#exports`, consumers get `ERR_PACKAGE_PATH_NOT_EXPORTED` when importing `@theokit/agents/testing`.
- **Impact:** `import { createMockAgentStream } from '@theokit/agents/testing'` fails at runtime.
- **Suggested fix:** Add `testing: 'src/testing/index.ts'` to `packages/agents/tsup.config.ts` entry map AND add `"./testing": { "import": "./dist/testing.js", "types": "./dist/testing.d.ts" }` to `packages/agents/package.json#exports`.

## DOCUMENT

### EC-2: Generated agent file imports `@theokit/agents` which may not be installed

- **Accepted risk:** If a user runs `theokit generate agent assistant` in a project without `@theokit/agents` in deps, the generated file won't compile. The existing `generate.ts` already handles this for `@theokit/http` — it checks `theo.config.ts` exists (`not_a_project` status). Adding a dep check for `@theokit/agents` in package.json is trivial but not urgent — the compiler error is clear enough: "Cannot find module '@theokit/agents'". Accepted.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 0 | 0 | 1 |
| T2.1 | 1 | 1 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT

EC-1 is structural — without the tsup entry + exports map, the testing sub-path is unreachable. Trivial fix (2 lines in config files).
