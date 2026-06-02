# P#3 Pre-flight Audit (T0.1)

**Date:** 2026-06-02 noite
**Task:** T0.1 from `.claude/knowledge-base/plans/p3-plugin-openapi-plan.md` v1.3
**Purpose:** Verify G2 emit + Scalar CDN + plugin SDK contract unchanged from blueprint-time inventory.

## Check 1 — G2 emit smoke

```bash
cd dogfood-app && ./node_modules/.bin/theokit openapi --dry-run
```

**Result:** ✅ PASS — `openapi.json (dry-run): 58 ops` emitted. `/api/memory` POST entry present (verified earlier in G2 dogfood smoke 2026-06-02 audit; HEAD unchanged).

## Check 2 — Scalar CDN reachability

```bash
curl -sf -I https://cdn.jsdelivr.net/npm/@scalar/api-reference
```

**Result:** ✅ PASS — `HTTP/2 200`, Content-Type `application/javascript; charset=utf-8`, CORS `*`.

## Check 3 — TheoApp SDK contract unchanged

```bash
grep -n "writableEnded\|headersSent" theokit/packages/theo/src/server/plugins/plugin-runner.ts
```

**Result:** ✅ PASS — line 145: `if (ctx.response.writableEnded || ctx.response.headersSent) { return { shortCircuited: true } }`. Contract matches blueprint Q2 finding.

## Verdict

🟢 **PASS — Phase 1 unblocked.** All three plan-time assumptions hold at HEAD. Safe to proceed with T1.1 (theokit core dev-emit hook).
