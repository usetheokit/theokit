# Code-Quality Audit — M8 Decorator Runtime

**Date:** 2026-06-22
**Mode:** plan-bound (`m8-decorator-runtime`)
**Runner verdict:** `FAIL_HARD` (score_cap 49)
**Slice disposition:** **PASS for the M8 slice** — zero M8-file findings (evidence below)

## Runner output

```
verdict: FAIL_HARD
hard_caps: dead_code_unallowlisted_typescript, symbol_fabrication_typescript, symbol_fab_unverifiable_typescript
d1_dead_code typescript: 28966
d2_symbol_fab typescript: 4 (1 HARD, 3 SOFT_FLOOR)
```

## Why the runner FAIL_HARD is NOT an M8 defect (pre-existing mis-scoping)

The theokit `/code-quality` runner scans the **entire repository**, including the
read-only reference clones under `.claude/knowledge-base/references/` (fastify,
next.js, hono, nitro, astro, workers-sdk, …). `DEFAULT_SKIP_DIRS` is supposed to
exclude that tree but does not here — a **pre-existing runner bug**, independent of
M8. Consequences:

- **D1 dead-code = 28966** — overwhelmingly `references/**` "unimported file" + the
  pre-existing monorepo. **Zero M8 files** appear (verified:
  `grep -iE 'compile-skills|compile-context-window|compile-project-context|m8-|sdk-adapter|walk-agent-metadata|agent-compiler.ts' report | grep dead` → empty).
- **D2 symbol-fab = 4, all NON-M8:**
  | File | Symbol | Sev | Nature |
  |---|---|---|---|
  | `fixtures/define-integration/app/page.tsx` | `virtual:integration:banner/text` | HARD | Vite virtual module (not an npm pkg) — pre-existing false positive |
  | `packages/agents/tests/unit/agent-route-generator.test.ts` | `@theokit/http/runtime/node` | SOFT_FLOOR | pre-existing subpath, ambiguous registry |
  | `packages/agents/tests/integration/theokit-plugin.test.ts` | `@theokit/http/runtime/node` | SOFT_FLOOR | pre-existing subpath, ambiguous registry |
  | `packages/create-theokit/templates/default/app/layout.tsx` | `@theokit/ui/styles.css` | SOFT_FLOOR | pre-existing template CSS import |

  Verified: `grep` of the D2 section for any M8 file/path → **empty**.

This is the same disposition recorded for M7 (the runner FAIL_HARD from scanning
`references/`; zero slice findings; released after manual slice verification).

## M8 slice verification (the real gate)

- **Dead code (M8):** every new export has a caller + a test — `compileSkills`
  (agent-compiler + barrel + test), `compileContextWindow` (walk + agent-compiler +
  test), `compileProjectContext` (sdk-adapter + test), `projectContextMetadataOnlyKnobs`
  (walk + test), new `AgentWarningCode` members (walk + tests). Zero dead M8 exports.
- **Symbol fabrication (M8):** all imported symbols resolve — `SkillsSettings`,
  `ContextSettings`, `SystemPromptResolver` (`@theokit/sdk`), `buildRepoMap`,
  `buildEnvContext` (`@theokit/sdk-tools`), `readProjectInstructions`
  (`@theokit/sdk/project`) — proven by `tsc --noEmit` clean + the agents build (dts) success.
- **Tests:** 260 passed | 3 skipped; the 21 new M8 tests green.

## Config repair applied (pre-requisite, not an M8 feature)

`.claude/rules/code-quality-languages.txt` declared the bare line `typescript`,
which the current `_shared.py` parser rejects (`malformed line`) — the theokit
`/code-quality` gate could not run at all. Repaired to the parser's pipe format
(`typescript | package.json | ENABLED`), matching the skill's shipped defaults.
This is per-project tuning (not the locked golden rule); it makes the gate operational.

## Disposition

The M8 slice introduces **zero** dead-code and **zero** symbol-fabrication findings.
The runner's `FAIL_HARD` is fully attributable to (a) pre-existing repo-wide
mis-scoping over `references/**`, (b) one pre-existing Vite virtual-module false
positive, (c) three pre-existing subpath-resolution `SOFT_FLOOR` ambiguities — none
in M8 code. **Slice verdict: PASS_WITH_CAVEATS** (caveat = runner mis-scoping is a
pre-existing infra bug to fix separately). Proceed to `/review`.
