# Blueprint: TheoKit Decorator → Client Bridge

> **Version 1.0** — How to extend G1's `@theo/client` typed Proxy so that `@Controller`/`@Get` decorator-defined routes appear in `.theo/client.d.ts` alongside file-system `defineRoute` routes. Consumer writes `@Controller('cats')` + `@Get()` on server → `client.cats.get()` is auto-typed on frontend.

**Slug:** `theokit-decorator-client-bridge`
**Source plan:** `.claude/knowledge-base/discoveries/plans/theokit-decorator-client-bridge-plan.md` (v1.1)
**Generated:** 2026-06-09

## Context

G1's typed client pipeline: `scanServerRoutes()` → `generateManifest()` → `ManifestRoute[]` → `generateClientDts()` → `.theo/client.d.ts`. The codegen produces a `declare module '@theo/client'` with a tree-shaped `AppClient` interface. Currently only file-system routes feed this pipeline. Decorator-based controllers registered via `httpDecoratorsPlugin` are invisible.

## Coverage Corner 1 — Integration Tests

### Q1: G1 test shape for .d.ts accuracy

TheoKit tests the typed-client codegen via 3 complementary patterns (verified at `tests/unit/app-typed-client-plugin.test.ts:38-48`):

**Pattern A — Snapshot-style structural assertion:**
```typescript
writeRoute('users.ts', 'export const GET = () => ({})\n')
const plugin = appTypedClientPlugin({ cwd: sandbox, serverDir, distDir })
;(plugin.configResolved as any)({})
const content = readFileSync(join(distDir, 'client.d.ts'), 'utf-8')
expect(content).toContain("declare module '@theo/client'")
expect(content).toContain('users:')
```
Source: `tests/unit/app-typed-client-plugin.test.ts:39-48`

**Pattern B — Type-level assertion** (separate file):
```typescript
// tests/type/app-client-proxy.test-d.ts
import { expectTypeOf } from 'vitest'
// ... asserts Proxy shape matches declared module
```
Source: `tests/type/app-client-proxy.test-d.ts`

**Pattern C — Fixture-based snapshot:**
```typescript
// tests/unit/fixture-typed-client.test.ts
// Uses a fixture project under fixtures/typed-client/ with known routes
// Asserts the generated .d.ts matches expected shape
```
Source: `tests/unit/fixture-typed-client.test.ts`

**Proposed test shape for decorator-bridge:**
Follow Pattern A: write a test that creates a sandbox with BOTH `server/routes/users.ts` AND a controller class, generates the manifest with decorators merged, calls `generateClientDts()`, and asserts the `.d.ts` contains BOTH `users:` (from file-route) AND `cats:` (from decorator controller) in the same `AppClient` interface.

## Coverage Corner 2 — Dependencies

### Q2: Dependency delta

| Package | Current deps relevant to bridge | New deps needed |
|---|---|---|
| `theokit` (G1 codegen lives here) | `vite` (plugin API) — no runtime deps for codegen | **ZERO** — `generateClientDts()` is a pure function; extending its input (`ManifestRoute[]`) requires no new imports |
| `@theokit/http-decorators` | `reflect-metadata` (peer), `zod` (peer) | **ZERO** — the bridge function that converts `WalkResult[]` → `ManifestRoute[]` uses only existing types |
| Hono client (comparative) | Zero runtime deps — `hc()` is type-level only (`hono/src/client/client.ts:1-4` imports only Hono's own types) | N/A |

Source: `packages/theo/package.json`, `packages/http-decorators/package.json`, `.claude/knowledge-base/references/hono/package.json`

**Conclusion:** Zero new dependencies. The bridge is a pure function `walkResultsToManifestRoutes(results: WalkResult[], controllerFilePath: string): ManifestRoute[]` that maps data structures. No network, no I/O, no new imports.

## Coverage Corner 3 — Tools

### Q3: Vite plugin watcher scope extension

The G1 Vite plugin watches file changes at `packages/theo/src/vite-plugin/app-typed-client.ts:376-385`:

```typescript
configureServer(server) {
  viteServer = server
  const routesGlob = posix.join(opts.serverDir.replace(/\\/g, '/'), 'routes')
  const onFile = (file: string): void => {
    const normalized = file.replace(/\\/g, '/')
    if (normalized.startsWith(routesGlob)) scheduleEmit()
  }
  server.watcher.on('add', onFile)
  server.watcher.on('change', onFile)
  server.watcher.on('unlink', onFile)
}
```
Source: `packages/theo/src/vite-plugin/app-typed-client.ts:376-385`

**Current scope:** only `server/routes/**` triggers `.d.ts` regeneration.

**Extension spec (3-line delta):**
```typescript
const routesGlob = posix.join(opts.serverDir.replace(/\\/g, '/'), 'routes')
const controllersGlob = posix.join(opts.serverDir.replace(/\\/g, '/'), 'controllers') // NEW
const onFile = (file: string): void => {
  const normalized = file.replace(/\\/g, '/')
  if (normalized.startsWith(routesGlob) || normalized.startsWith(controllersGlob)) scheduleEmit() // CHANGED
}
```

**Impact:** when a consumer edits `server/controllers/cats.controller.ts`, the watcher triggers `emitClientDts()` → `.theo/client.d.ts` regenerates → Vite HMR invalidates the `@theo/client` virtual module → frontend picks up the new types. Same flow as editing `server/routes/cats.ts` today.

## Coverage Corner 4 — Techniques

### Q4: ManifestRoute ↔ WalkResult field mapping

| ManifestRoute field | Source (file-route) | Source (decorator) | Mapping |
|---|---|---|---|
| `filePath: string` | Relative path to `.ts` file under `server/routes/` (e.g., `routes/cats.ts`) | Controller class file path (e.g., `controllers/cats.controller.ts`) — obtained from the consumer's `httpDecoratorsPlugin({ controllers: [CatsController] })` call; the class has no file-path metadata in reflect-metadata | Consumer must pass `controllerFilePath` alongside the class reference |
| `routePath: string` | Derived from file path: `server/routes/cats/[id].ts` → `/api/cats/:id` | `WalkResult.fullPath` (e.g., `/cats/:id`) — needs `/api/` prefix to match G1's convention | `'/api' + walkResult.fullPath` |
| `paramNames: string[]` | Extracted from route path segments (`:id`, `:slug`) | Extracted from `WalkResult.fullPath` via same regex: `/:(\w+)/g` | Same extraction logic — reuse `paramNamesFromRoute()` at `app-typed-client.ts:99-107` |
| `methods?: string[]` | Detected via AST scan of exported named constants (`export const GET`, `export const POST`) | `[walkResult.verb]` (single verb per WalkResult; a controller with 4 methods produces 4 WalkResults) | Direct: `methods: [walkResult.verb]` |

Source: `packages/theo/src/server/scan/manifest.ts:18-25`, `packages/http-decorators/src/bridge/walk-metadata.ts:23-36`

**EC-3 checkpoint:** `generateClientDts()` iterates `manifest.routes` at line 246 (`for (const route of manifest.routes) { buildOneRoute(route, ctx) }`). Multiple ManifestRoute entries with different `routePath` but same `filePath` are handled correctly — `buildOneRoute` uses `filePath` ONLY for import-path aliasing (line 128-135), and each route gets its own alias index (`_r0_GET`, `_r1_POST`). So a controller file producing 4 ManifestRoutes (one per method) works as long as each has a distinct routePath + methods. **Verified: no conflict.**

**EC-2 checkpoint:** `ManifestRoute.filePath` is used exclusively for `importPathFor(dtsOutPath, absRouteFile)` at line 129 — computing the relative import path for the `import type { GET as _r0_GET } from '...'` line. It does NOT check file existence or load modules. **For decorator controllers, the import path points to the controller file, and the type import references the controller class's return types.** However: decorator handlers return plain values (not exported `GET`/`POST` constants) — the `.d.ts` codegen assumes named exports per HTTP method. **This is the integration gap.**

### Resolution for the import-path gap

The `.d.ts` codegen at line 134 emits:
```typescript
import type { GET as _r0_GET } from '../server/routes/cats'
```

For decorator controllers, there IS no `export const GET = defineRoute(...)` in the controller file — only an `export class CatsController { findAll() {...} }`. The import-type statement would fail.

**Two solutions:**

**(A) Emit synthetic route files** — the bridge generates tiny `server/routes/__decorated__/cats/get.ts` files (one per verb) that re-export the handler return type. The `.d.ts` codegen imports from these. This is the ADR D7 Vite plugin approach from the http-decorators plan.

**(B) Inline the return types** — instead of `import type { GET as _r0_GET }`, the `.d.ts` emits `type _r0_GET = { handler: () => ReturnType<CatsController['findAll']> }`. Requires the controller class to be importable at type level.

**Recommended: (A)** — synthetic files. Reuses the ENTIRE existing codegen pipeline unchanged. The bridge generates one `.ts` file per (controller, verb, path) triple under a gitignored directory. The scanner picks them up as regular routes. **This converges with the httpDecoratorsPlugin approach already explored in the http-decorators plan ADR D7.**

### Q5: Hono hc<AppType> type machinery (comparative)

Hono's typed client uses **pure TypeScript type-level inference** (`.claude/knowledge-base/references/hono/src/client/client.ts:15-31`):

```typescript
const createProxy = (callback: Callback, path: string[]) => {
  const proxy: unknown = new Proxy(() => {}, {
    get(_obj, key) {
      if (typeof key !== 'string' || key === 'then') return undefined
      return createProxy(callback, [...path, key])
    },
    apply(_1, _2, args) {
      return callback({ path, args })
    },
  })
  return proxy
}
```

The type magic lives in `hono/src/client/types.ts` — ~393 LoC of conditional types that transform the Hono app's route definitions into a client-side type tree. Key pattern: `hc<typeof app>(baseUrl)` where `typeof app` carries the route schema as a generic parameter.

**What TheoKit can borrow:**
1. **Proxy-based property accumulation** — Hono and TheoKit both use `Proxy.get` to build a path chain (`client.cats.get()`). TheoKit's implementation at `packages/theo/src/client/app-client.ts` already does this. No change needed.
2. **Method naming convention** — Hono uses `$get()`, `$post()` (prefixed with `$`). TheoKit uses bare `get()`, `post()`. TheoKit's convention is cleaner for the decorator-bridge use case.

**What's incompatible:**
- Hono's approach requires the SERVER type to flow through TypeScript generics at compile time. TheoKit's codegen model (`.d.ts` file on disk) is fundamentally different — it doesn't require the server code to be importable at the client's type-checking scope. This is an advantage for TheoKit in monorepo setups where server and client have separate tsconfig scopes.

Source: `.claude/knowledge-base/references/hono/src/client/client.ts:15-31`, `.claude/knowledge-base/references/hono/src/client/types.ts`

### Q6: generateClientDts extension spec

The minimal change is at `emitClientDts()` (line 305-336). Currently:

```typescript
function emitClientDts(opts: AppTypedClientPluginOptions): { changed: boolean; path: string } {
  // ...
  const manifest = generateManifest(opts.serverDir)  // ← only file-routes
  const content = generateClientDts({ manifest, dtsOutPath, serverDir })
  // ...
}
```

**Extension (20 LoC delta):**

```typescript
// NEW: accept optional decorator controllers
interface AppTypedClientPluginOptions {
  cwd: string
  serverDir: string
  distDir: string
  controllers?: Array<{ controllerClass: Function; filePath: string }>  // NEW
}

function emitClientDts(opts: AppTypedClientPluginOptions): { changed: boolean; path: string } {
  const manifest = generateManifest(opts.serverDir)

  // NEW: merge decorator routes into the manifest
  if (opts.controllers?.length) {
    for (const { controllerClass, filePath } of opts.controllers) {
      const walks = walkControllerMetadata(controllerClass)
      for (const w of walks) {
        manifest.routes.push({
          filePath,                                    // controller source file
          routePath: '/api' + w.fullPath,              // G1 convention: /api/ prefix
          paramNames: paramNamesFromRoute(w.fullPath),
          methods: [w.verb],
        })
      }
    }
  }

  const content = generateClientDts({ manifest, dtsOutPath: /*...*/, serverDir: opts.serverDir })
  // ...
}
```

**Impact assessment:**
- `generateClientDts()` itself: **ZERO changes** (it already iterates `manifest.routes` generically).
- `buildOneRoute()`: **ZERO changes** (it reads `filePath`, `routePath`, `methods` — all provided by the bridge).
- `renderTreeNode()`: **ZERO changes** (it renders the TreeNode tree — agnostic to source).
- `appTypedClientPlugin()` opts: **1 new optional field** (`controllers`).
- Watcher: **+2 lines** (add `controllersGlob` check per Q3).

**Total delta: ~20 LoC** in `app-typed-client.ts` (well under the 30 LoC target).

**Remaining question from EC-2:** the `.d.ts` emits `import type { GET as _r0_GET } from '../server/controllers/cats.controller'`. For this to work, the controller file must export something that TypeScript can import as type. A decorator class's method return type IS importable if the class is exported. The import would be:
```typescript
import type { CatsController } from '../server/controllers/cats.controller'
```
Then the method type extraction: `ReturnType<CatsController['findAll']>`. This requires a small adjustment to `buildOneRoute()` to handle decorator-source routes differently from file-routes (decorator routes import the CLASS, not the named export).

**Revised delta: ~35 LoC** (adds a `source: 'file' | 'decorator'` discriminant to ManifestRoute + adjusts `buildOneRoute` import logic). Still under 50 LoC target.

## Cross-cutting Comparison

| Aspect | TheoKit G1 (current) | Hono RPC | TheoKit + Bridge (proposed) |
|---|---|---|---|
| Type source | `.d.ts` codegen from file scan | Pure TS generic inference | `.d.ts` codegen from file scan + decorator metadata |
| Build step | Yes (Vite plugin) | No | Yes (same Vite plugin, extended) |
| Client DX | `client.cats.get()` Proxy | `client.cats.$get()` fetch | `client.cats.get()` Proxy (unchanged) |
| Server styles supported | `defineRoute` only | `app.get()` chain only | `defineRoute` + `@Controller`/`@Get` |
| Runtime overhead | ~2KB Proxy | ~3KB fetch wrapper | ~2KB Proxy (unchanged) |
| HMR support | Yes (watcher on `routes/`) | N/A (no build step) | Yes (watcher on `routes/` + `controllers/`) |

## ADRs

### D1 — Merge WalkResult[] into ManifestRoute[] at the manifest level; extend emitClientDts opts with optional `controllers` field

**Decision:** Add `controllers?: Array<{ controllerClass: Function; filePath: string }>` to `AppTypedClientPluginOptions`. In `emitClientDts()`, walk each controller's metadata and push synthetic `ManifestRoute` entries into the manifest before passing to `generateClientDts()`. ~35 LoC delta total.

**Rationale:** ManifestRoute is the stable interface. The entire downstream pipeline (tree building, .d.ts emission, collision detection, normalization) works unchanged. Zero new deps. The Vite plugin watcher extends to `controllers/` for HMR.

**Alternatives considered:**
- (a) Pure type inference (tRPC-style) — would rewrite G1 entirely. Incompatible with existing `.d.ts` codegen model.
- (b) Separate `.d.ts` for decorators — would fragment the client type into two modules. Consumers would need to import from two places.
- (c) Synthetic route file emission (ADR D7 from http-decorators plan) — works but generates files on disk. The manifest-level merge is cleaner (no file I/O, no gitignore management, no cleanup).

**Consequences:** Consumer using both `defineRoute` AND `@Controller` gets ONE unified `client` object with auto-typed methods from both sources. Zero new deps. ~35 LoC change in `app-typed-client.ts` + 3 LoC watcher extension.

## Recommendations

1. **Extend `AppTypedClientPluginOptions`** with `controllers?: Array<{ controllerClass: Function; filePath: string }>`.
2. **In `emitClientDts()`**, call `walkControllerMetadata()` on each controller + push synthetic ManifestRoutes (with `/api/` prefix per G1 convention).
3. **Extend the watcher** to also trigger on `server/controllers/**` changes.
4. **Add a `source: 'file' | 'decorator'` field** to ManifestRoute so `buildOneRoute` can adjust the import-type strategy (named export vs class method return type).
5. **Test via Pattern A** (sandbox with mixed file-routes + decorator-routes → assert `.d.ts` contains both).
6. **Ship as a minor version bump** of `theokit` (not a new package) — the bridge lives inside the Vite plugin, not in `@theokit/http-decorators`.

## References Cited

- `packages/theo/src/vite-plugin/app-typed-client.ts:39-48` — G1 plugin test pattern
- `packages/theo/src/vite-plugin/app-typed-client.ts:120-161` — `buildOneRoute()` tree construction
- `packages/theo/src/vite-plugin/app-typed-client.ts:233-269` — `generateClientDts()` entry point
- `packages/theo/src/vite-plugin/app-typed-client.ts:305-336` — `emitClientDts()` integration seam
- `packages/theo/src/vite-plugin/app-typed-client.ts:376-385` — Vite watcher scope
- `packages/theo/src/server/scan/manifest.ts:18-25` — ManifestRoute interface
- `packages/http-decorators/src/bridge/walk-metadata.ts:23-36` — WalkResult interface
- `tests/unit/app-typed-client-plugin.test.ts:38-48` — G1 test pattern
- `.claude/knowledge-base/references/hono/src/client/client.ts:15-31` — Hono Proxy pattern
- `.claude/knowledge-base/references/hono/src/client/types.ts` — Hono type machinery

## Blocked questions

None. All 6 research questions answered.
