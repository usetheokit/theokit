---
'theokit': patch
---

A scaffolded app deploys to Cloudflare, boots without an unresolvable dependency, and `theo-cloud` builds what it says it built

Three defects found by exercising all nine `VALID_TARGETS` from one `create-theokit` scaffold installed from npm. None was reachable by the test suite: two needed a scaffold rather than this repository, and one needed the platform.

**Cloudflare could not bundle a scaffold at all.** `@theokit/sdk` reaches its optional storage backends through `overrides?.betterSqlite3?.() ?? import('better-sqlite3')`. The override seam is correct and the fallback is statically resolvable, so wrangler's esbuild resolved it at BUILD time and a project that never installed the package failed before a request existed — `Could not resolve "better-sqlite3"`. `my-test` in this repository deployed throughout because it resolves those names through the workspace.

The generated `wrangler.toml` now carries an `[alias]` table DERIVED from every direct dependency's `peerDependenciesMeta.<name>.optional`, each absent one pointing at a stub that throws and names the remedy. Derived rather than listed: the first attempt hardcoded the three names a grep produced and was already incomplete, since the SDK declares seven optional peers and `@lancedb/lancedb` was not among them. An installed optional peer is left alone, so the table shrinks by itself when a consumer adds one.

**Every `theokit dev` boot warned about a dependency it could not resolve.** The Vite plugin pushed the bare specifier `devalue` into `optimizeDeps.include`, under a comment that already said why that cannot work — the package lives in theokit's subtree and Vite resolves those entries from its root, which is the consumer. Now `theokit > devalue`, Vite's documented form for a dependency reached through another one.

**`theo-cloud` reported `Bundle ready for upload` and built nothing.** After it, the dist directory held four manifests and no application; because a build empties its output first, running the target destroyed whatever the previous build left. The thinness is the documented design and is unchanged — TheoKit does not emit a proprietary platform's orchestration format — but two documents in this repository declared that it hands over a bundle. It now delegates to the node build and leaves exactly what the `node` target leaves.
