# G6 T4.1 — create-theokit templates router convention audit

Date: 2026-06-04 madrugada
Plan: `.claude/knowledge-base/plans/g6-router-convention-plan.md` v1.1

## Summary

All 5 `create-theokit` templates **already use the directory-nested
convention**. Zero migrations needed.

| Template | Routes | Dotted basenames | Scanner verdict |
|---|---:|---:|---|
| `default` | 2 | 0 | ✓ PASS |
| `saas` | 5 | 0 | ✓ PASS |
| `dashboard` | 1 | 0 | ✓ PASS |
| `api-only` | 3 | 0 | ✓ PASS |
| `postgres` | 2 | 0 | ✓ PASS |

Total: **13/13 routes pass** the new scanner without modification.

## Evidence

Ran `planRouterMigration()` against every template's `server/routes/`
directory + `scanServerRoutes()` for verification:

```
default    | plan=0 pending | scan ok (2 routes)
saas       | plan=0 pending | scan ok (5 routes)
dashboard  | plan=0 pending | scan ok (1 routes)
api-only   | plan=0 pending | scan ok (3 routes)
postgres   | plan=0 pending | scan ok (2 routes)
```

## Sampled route files (representative — no dotted basenames present)

- `default/server/routes/{chat,health}.ts`
- `saas/server/routes/{me,logout,agent,login}.ts`
- `saas/server/routes/billing/stripe-webhook.ts` (already directory-nested)
- `dashboard/server/routes/health.ts`
- `api-only/server/routes/{users,health}.ts`
- `api-only/server/routes/webhooks/echo.ts` (already directory-nested)
- `postgres/server/routes/{users,health}.ts`

## Implications for T4.2

- No template content needs to change.
- The migration guide (T4.2) can mention: "create-theokit scaffolds
  already produce 0.4-compliant routes — only existing 0.2.x apps need
  the codemod."
- The CHANGELOG can list `create-theokit` template surface as
  unchanged in 0.4.0-beta.0 (no template version bump required beyond
  the standard linked-version bump with theokit).
