# Code Quality Audit: v4-mainloop-reflective-runtime

**Date:** 2026-06-23
**Mode:** plan-bound
**Verdict:** FAIL_HARD
**Score cap:** 49
**Hard caps triggered:** dead_code_unallowlisted_typescript, symbol_fabrication_typescript, symbol_fab_unverifiable_typescript

## Summary

- Languages audited: typescript
- Languages skipped: _none_
- Total findings: 28 (25 HARD, 0 SOFT_CAP, 3 SOFT_FLOOR, 0 INFO)

## Findings by detector

### D1 — Dead code
| File | Symbol | Severity | Message |
|---|---|---|---|
| `scripts/preflight-native-bindings.d.mts` | `file @ scripts/preflight-native-bindings.d.mts` | HARD | unimported file |
| `scripts/sync-template-versions.d.mts` | `file @ scripts/sync-template-versions.d.mts` | HARD | unimported file |
| `packages/theo/src/cli/cleanup/index.ts` | `file @ packages/theo/src/cli/cleanup/index.ts` | HARD | unimported file |
| `packages/theo/src/core/contracts/index.ts` | `file @ packages/theo/src/core/contracts/index.ts` | HARD | unimported file |
| `packages/theo/src/server/webhook/providers/index.ts` | `file @ packages/theo/src/server/webhook/providers/index.ts` | HARD | unimported file |
| `packages/create-theokit/templates/default/eslint.config.mjs` | `file @ packages/create-theokit/templates/default/eslint.config.mjs` | HARD | unimported file |
| `packages/create-theokit/templates/default/theo.config.ts` | `file @ packages/create-theokit/templates/default/theo.config.ts` | HARD | unimported file |
| `packages/create-theokit/templates/default/app/error.tsx` | `file @ packages/create-theokit/templates/default/app/error.tsx` | HARD | unimported file |
| `packages/create-theokit/templates/default/app/layout.tsx` | `file @ packages/create-theokit/templates/default/app/layout.tsx` | HARD | unimported file |
| `packages/create-theokit/templates/default/app/loading.tsx` | `file @ packages/create-theokit/templates/default/app/loading.tsx` | HARD | unimported file |
| `packages/create-theokit/templates/default/app/not-found.tsx` | `file @ packages/create-theokit/templates/default/app/not-found.tsx` | HARD | unimported file |
| `packages/create-theokit/templates/default/app/page.tsx` | `file @ packages/create-theokit/templates/default/app/page.tsx` | HARD | unimported file |
| `packages/create-theokit/templates/default/types/jobs.d.ts` | `file @ packages/create-theokit/templates/default/types/jobs.d.ts` | HARD | unimported file |
| `packages/create-theokit/templates/default/server/routes/chat.ts` | `file @ packages/create-theokit/templates/default/server/routes/chat.ts` | HARD | unimported file |
| `packages/create-theokit/templates/default/server/routes/health.ts` | `file @ packages/create-theokit/templates/default/server/routes/health.ts` | HARD | unimported file |
| `packages/create-theokit/templates/services/agent-node/src/index.ts` | `file @ packages/create-theokit/templates/services/agent-node/src/index.ts` | HARD | unimported file |
| `packages/http/examples/demo.ts` | `file @ packages/http/examples/demo.ts` | HARD | unimported file |
| `packages/http/examples/full-app.mjs` | `file @ packages/http/examples/full-app.mjs` | HARD | unimported file |
| `packages/http/examples/live-server.mjs` | `file @ packages/http/examples/live-server.mjs` | HARD | unimported file |
| `packages/http/examples/live-server.ts` | `file @ packages/http/examples/live-server.ts` | HARD | unimported file |
| `packages/http/examples/live-test.mjs` | `file @ packages/http/examples/live-test.mjs` | HARD | unimported file |
| `packages/http/tests/benchmark/node-vs-bun.ts` | `file @ packages/http/tests/benchmark/node-vs-bun.ts` | HARD | unimported file |
| `packages/http/src/bridge/runtime/bun.ts` | `file @ packages/http/src/bridge/runtime/bun.ts` | HARD | unimported file |
| `packages/http/src/bridge/runtime/deno.ts` | `file @ packages/http/src/bridge/runtime/deno.ts` | HARD | unimported file |

### D2 — Symbol fabrication
| File | Symbol | Severity | Message |
|---|---|---|---|
| `home/paulo/Projetos/usetheo/theokit-tools/theokit/fixtures/define-integration/app/page.tsx` | `import from 'virtual:integration:banner/text'` | HARD | Fabricated npm package 'virtual:integration:banner' (not found on registry) |
| `home/paulo/Projetos/usetheo/theokit-tools/theokit/packages/agents/tests/unit/agent-route-generator.test.ts` | `import from '@theokit/http/runtime/node'` | SOFT_FLOOR | Could not verify npm package '@theokit/http/runtime/node' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theokit-tools/theokit/packages/agents/tests/integration/theokit-plugin.test.ts` | `import from '@theokit/http/runtime/node'` | SOFT_FLOOR | Could not verify npm package '@theokit/http/runtime/node' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theokit-tools/theokit/packages/create-theokit/templates/default/app/layout.tsx` | `import from '@theokit/ui/styles.css'` | SOFT_FLOOR | Could not verify npm package '@theokit/ui/styles.css' (ambiguous response) |

### D3 — Cross-package orphan exports
_No findings._

### D4 — Mutation testing
_No findings._

## Related

- Golden rule: [`.claude/rules/code-quality-golden-rule.md`](../../rules/code-quality-golden-rule.md)
- Allowlist: [`.claude/rules/code-quality-allowlist.txt`](../../rules/code-quality-allowlist.txt)
- Thresholds: [`.claude/rules/code-quality-thresholds.txt`](../../rules/code-quality-thresholds.txt)
