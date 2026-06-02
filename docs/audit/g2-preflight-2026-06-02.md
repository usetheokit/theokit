# G2 Pre-flight Audit (T0.1)

**Date:** 2026-06-02
**Task:** T0.1 from `.claude/knowledge-base/plans/g2-theokit-build-openapi-emit-plan.md` v1.1
**Purpose:** Confirm G1 manifest reusable + record Zod-version reality (in-house algorithm is PRIMARY per EC-1).

## Invariants verified

### Installed Zod version

`theokit/node_modules/zod/package.json`: **3.25.76** (NOT v4).

`z.object({a: z.string()}).toJSONSchema` → `undefined` (native API NOT available in 3.x).

**Decision (plan v1.1 ADR D1 + EC-1):** in-house Zod→OpenAPI algorithm is the PRIMARY path. Translate encore's `pkg/clientgen/openapi/schema.go` recursive descent + seen-map to TS. Future-readiness: when peerDep bumps to Zod 4 in a follow-up minor, evaluate swap.

### G1 manifest shape (canonical)

`packages/theo/src/server/scan/manifest.ts:18`:

```ts
export interface ManifestRoute {
  filePath: string
  routePath: string
  paramNames: string[]
  methods?: string[]  // G1 Phase 5 enrichment — REUSABLE for G2
}

export interface TheoManifest {
  version: 1
  generatedAt: string
  routes: ManifestRoute[]
  actions: ManifestAction[]
  websockets: ManifestWebSocket[]
}
```

`generateManifest(serverDir)` already walks routes + emits the structured shape. G2 reuses this manifest as INPUT to its emit step — does NOT re-scan disk.

The Zod schemas live inside each route's `defineRoute({body, query, params, ...})` config object. The emit step needs to LOAD each route module at build-time (via the existing build's module loader) and extract the schemas. That's T2.1 orchestrator scope, not T1.1.

### `RouteConfig<TQuery, TBody, TParams, TCtx, TResponse>` (consumed by defineRoute)

`packages/theo/src/core/contracts/route-config.ts`: 5-arity generic. The `body?: TBody`, `query?: TQuery`, `params?: TParams` fields are the Zod schemas G2 must convert.

### Decision matrix

| Question | Answer |
|---|---|
| Zod 4 native `.toJSONSchema()` available? | NO (3.25.76 installed) |
| In-house algorithm needed? | YES (primary path per EC-1) |
| Manifest reusable? | YES (`TheoManifest.routes[]` ready) |
| Schema extraction strategy | Load route module at build-time; extract `body`/`query`/`params` from `defineRoute()` config |
| Bundle impact | ZERO (build-time only; nothing ships to runtime) |

## Verdict

✅ **PASS — Phase 1 unblocked.** Plan v1.1 reframing of T0.1+T1.1 to in-house-as-primary is consistent with measured state at HEAD.
