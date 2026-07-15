# Deps-audit — ecosystem-integration-guarantee (M48)

**Date:** 2026-07-15 · **Verdict:** PASS · **New runtime dependencies:** 0

## Manifest changes proposed by the plan

| Change | Kind | CVE surface |
|---|---|---|
| `packages/agents/package.json` peer `@theokit/sdk-tools` `>=0.11.0` → `^0.11.0` | Range TIGHTENING (no version change) | None — same package, narrower range |
| root `package.json` devDep `@theokit/sdk` `^3.5.0` → `^4.0.1` | Version BUMP to an already-installed, already-vetted version (4.0.2 in theo/agents) | None new — 4.0.x already resolved + tested in the SDK-4 migration (PR #134) |

## New dependencies

**None.** The plan explicitly avoids adding `semver` (parsimony rung 4 — reuses the proven inline `||`-aware caret checker copied from the theo-ui contract test). No new package enters the dependency tree.

## Rule 9 (Don't Reinvent) check

The one piece of hand-rolled logic (`satisfiesSdkRange` caret checker) is a deliberate, documented choice (ADR D1) matching the existing theo-ui precedent (`contract-usetheo-ui-vite-plugin.test.ts:66-105`) to avoid a `semver` dependency for a ~15-line need. Not a Rule-9 violation — it is the same trade-off the reference seam already made and the framework's convention.

## Conclusion

No CVE scan required — zero new packages. The two manifest edits tighten/align to already-vetted versions. **PASS** — no blocker for `/plan-confidence`.
