# Code Quality Audit: agents-stream-chronological-order

**Date:** 2026-06-28
**Mode:** plan-bound
**Verdict:** PASS_WITH_CAVEATS
**Score cap:** 89
**Hard caps triggered:** symbol_fab_unverifiable_typescript

## Summary

- Languages audited: typescript
- Languages skipped: _none_
- Total findings: 7 (0 HARD, 0 SOFT_CAP, 4 SOFT_FLOOR, 3 INFO)

## Findings by detector

### D1 — Dead code
_No findings._

### D2 — Symbol fabrication
| File | Symbol | Severity | Message |
|---|---|---|---|
| `home/paulo/Projetos/usetheo/theokit-tools/theokit/packages/agents/tests/unit/agent-route-generator.test.ts` | `import from '@theokit/http/runtime/node'` | INFO | Could not verify npm package '@theokit/http/runtime/node' (ambiguous response) [allowlisted] |
| `home/paulo/Projetos/usetheo/theokit-tools/theokit/packages/agents/tests/integration/theokit-plugin.test.ts` | `import from '@theokit/http/runtime/node'` | INFO | Could not verify npm package '@theokit/http/runtime/node' (ambiguous response) [allowlisted] |
| `home/paulo/Projetos/usetheo/theokit-tools/theokit/packages/agents/src/loop/run-reflective-loop.ts` | `import from '@theokit/sdk/retry'` | SOFT_FLOOR | Could not verify npm package '@theokit/sdk/retry' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theokit-tools/theokit/packages/agents/src/loop/compaction-strategy.ts` | `import from '@theokit/sdk/compaction'` | SOFT_FLOOR | Could not verify npm package '@theokit/sdk/compaction' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theokit-tools/theokit/packages/agents/src/loop/agent-runner.ts` | `import from '@theokit/sdk/retry'` | SOFT_FLOOR | Could not verify npm package '@theokit/sdk/retry' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theokit-tools/theokit/packages/agents/src/bridge/agent-orchestrator.ts` | `import from '@theokit/sdk/retry'` | SOFT_FLOOR | Could not verify npm package '@theokit/sdk/retry' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theokit-tools/theokit/packages/create-theokit/templates/default/app/layout.tsx` | `import from '@theokit/ui/styles.css'` | INFO | Could not verify npm package '@theokit/ui/styles.css' (ambiguous response) [allowlisted] |

### D3 — Cross-package orphan exports
_No findings._

### D4 — Mutation testing
_No findings._

## Related

- Golden rule: [`.claude/rules/code-quality-golden-rule.md`](../../rules/code-quality-golden-rule.md)
- Allowlist: [`.claude/rules/code-quality-allowlist.txt`](../../rules/code-quality-allowlist.txt)
- Thresholds: [`.claude/rules/code-quality-thresholds.txt`](../../rules/code-quality-thresholds.txt)
