# Blueprint: TheoKit architectural gaps vs canonical references

> **Version 1.0** — Synthesizes empirical investigation across 5 reference projects (Fastify, Hono, Nitro, Astro, Next.js) for the 3 critical gaps (C1 plugin encapsulation, C2 error envelope hierarchy, C3 multi-runtime portability) and 4 mechanical gaps (M1 sub-package exports, M2 config schemas split, M3 devtools sub-organization, M4 CLI commands layout) identified in `architecture-output/consolidated_final_report.md`. Output informs concrete next steps before TheoKit framework refactor.

**Slug:** `theokit-arch-gaps-investigation`
**Source plan:** `.claude/knowledge-base/discoveries/plans/theokit-arch-gaps-investigation-plan.md` (v1.1)
**Owner:** paulohenriquevn
**Generated:** 2026-06-06 via `/discover-execute`
**Confidence verdict:** _pending — to be set by `/discover-confidence`_

## Context

Em 2026-06-05 a revisão arquitetural do framework TheoKit (`architecture-output/consolidated_final_report.md`) atribuiu nota 3.5/5 e identificou:

- **C1** — `TheoPlugin` é Mediator-shaped sem encapsulation scope; plugins compartilham mutável `app` (`packages/theo/src/server/plugin-types.ts:39-43`). Vai colidir quando comunidade tiver ≥5 plugins coexistindo.
- **C2** — `TheoErrorEnvelope` (G5) declarado SHIPPED mas 6 arquivos usam vs 29 classes `Error` custom. Codemod existe (`scripts/migrations/envelope-0-2-to-0-4.mjs`) mas nunca foi aplicado.
- **C3** — 42 arquivos em `packages/theo/src/server/` importam `node:*` direto, com 6 adapters non-Node coexistindo em `packages/theo/src/adapters/*`. Incoerência server vs runtime real.
- **M1/M2/M3/M4** — sintomas de SRP/ISP (504 LOC schema único, `export *` wildcards, devtools/CLI flat) sem comparação prévia.

Este blueprint produz a comparação faltante para sustentar as decisões.

## Objective

Permitir ao time TheoKit decidir, antes de tocar código, qual estratégia canônica adotar para cada um dos 7 gaps, respeitando os 3 invariantes lockados de `.claude/rules/architecture.md` v3.1 (zero cycles, `core` depende de nada intra-monorepo, public API via barrels).

---

## Executive Summary

Cinco padrões dominam o material investigado:

1. **Encapsulation real vive em `Object.create(parent)` + child instance mutation** — Fastify (`plugin-override.js`) é a única ref que ship escopo de plugin verdadeiro; Hono não tem escopo e expõe isso como decisão consciente (compose flatten). Para TheoKit, "TheoPlugin sem escopo" não é necessariamente um bug — é uma escolha de DX. Mas se a feature vai ser shipada, **precisa adotar o `Object.create(parent)` pattern do Fastify** ou aceitar o trade-off do Hono publicamente.
2. **Hierarquia de erros sem migração documentada não é hierarquia — é dívida.** Fastify ship 91 `FST_ERR_*` errors via `createError` factory + ciclo de deprecação `FSTDEP*` documentado em `Migration-Guide-V*.md`. Hono ship 1 `HTTPException` class (78 LOC). G5 do TheoKit está mais perto do Hono em forma mas tem 29 classes Error custom — o gap é codemod aplicação, não design.
3. **Multi-runtime é OU Web-standards-only OU Strategy preset — não híbrido.** Hono usa `Request`/`Response` em TODA superfície (`hono-base.ts:479-485` `fetch()` retorna Promise<Response>); adapters apenas re-exportam helpers (CF Workers index.ts = 3 linhas). Nitro usa Strategy resolver (`presets/_resolve.ts:16-117`) com per-preset `entry` runtime file. **TheoKit hoje é híbrido sem ser estrategicamente um nem outro** — esta é a fonte real de C3.
4. **Sub-package boundaries são consumer-facing, não internal.** Next.js NÃO usa `"exports"` field; ele ship 47 stub files no root (`cache.js`, `headers.js`, `server.js`) listados em `"files"`. Hono usa `"exports"` field com 74 sub-paths declarados (`hono/package.json:37-700`). Ambos resolvem ISP via package.json — Node module resolution faz o resto.
5. **Sub-organização (M3/M4) é teto baixo de DX, não SOLID.** Astro `dev-toolbar/apps/{audit,xray,settings}` (sub-folder por feature) vs Nitro `cli/commands/task/{index,list,run}.ts` (sub-folder por sub-comando) vs Next.js `cli/next-{verb}.ts` (flat). Existem 3 padrões válidos; convergência é "quando tem `>1` arquivo conceitualmente irmão, vira sub-pasta". TheoKit `start-*.ts` 7 flat files é o caso clássico.

---

## Coverage Corner 1 — Integration Tests

### Fastify (canonical for C1 + C2 testing)

**Pattern — encapsulated error handler isolation:** Fastify tests use nested `register()` + `setErrorHandler` to assert that an inner error handler does NOT leak to the outer parent. The test labels each step `// 1. // 2. // 3.` as control-flow comments (citation: `.claude/knowledge-base/references/fastify/test/encapsulated-error-handler.test.js:7-36`).

```js
// .claude/knowledge-base/references/fastify/test/encapsulated-error-handler.test.js:9-36
test('encapsulates an asynchronous error handler', async t => {
  const fastify = Fastify()
  fastify.register(async function (fastify) {
    fastify.setErrorHandler(async function a (err) {
      t.assert.strictEqual(err.message, 'from_endpoint')
      throw new Error('from_inner')
    })
    fastify.get('/encapsulated', async () => {
      throw new Error('from_endpoint')
    })
  })
  fastify.setErrorHandler(async function b (err) {
    t.assert.strictEqual(err.message, 'from_inner')  // proves outer received inner's throw
    throw new Error('from_outer')
  })
  const res = await fastify.inject('/encapsulated')
  t.assert.strictEqual(res.json().message, 'from_outer')
})
```

**Pattern — `fastify-plugin` opt-out of encapsulation:** Tests cite `Symbol.for('skip-override')` (line 22) or `fp()` wrapper as the documented opt-out — proving decorations registered with `fp()` leak UP to root (citation: `.claude/knowledge-base/references/fastify/test/plugin.1.test.js:60-99`).

```js
// .claude/knowledge-base/references/fastify/test/plugin.1.test.js:60-89
test('fastify.register with fastify-plugin should not encapsulate his code', async t => {
  fastify.register((instance, opts, done) => {
    instance.register(fp((i, o, n) => {
      i.decorate('test', () => {})       // decoration inside fp() wrapper
      t.assert.ok(i.test)
      n()
    }))
    t.assert.ok(!instance.test)          // BEFORE .after(): scope is encapsulated
    instance.after(() => {
      t.assert.ok(instance.test)          // AFTER .after(): scope leaked via fp()
    })
  })
})
```

**Coverage:** Fastify's plugin tests exercise (a) decoration leak prevention by default, (b) explicit opt-out via `fp()`, (c) error-handler scope inheritance via `Object.getPrototypeOf`, (d) hook nesting via `onError` triggered from child. These four patterns are exactly the boundary assertions TheoKit needs for C1.

### Hono (canonical for C3 testing)

**Pattern — adapter test asserts native Web standards:** Hono's CF Pages test instantiates `new Request('http://localhost/api/foo')` directly (no Node fixture) and feeds it to `handle(app)` — proving the adapter uses only Web-standards primitives (citation: `.claude/knowledge-base/references/hono/src/adapter/cloudflare-pages/handler.test.ts:34-67`).

```ts
// .claude/knowledge-base/references/hono/src/adapter/cloudflare-pages/handler.test.ts:35-67
it('Should return 200 response', async () => {
  const request = new Request('http://localhost/api/foo')
  const env = { ASSETS: { fetch }, TOKEN: 'HONOISHOT' }
  const eventContext = createEventContext({ request, env, waitUntil, passThroughOnException })
  const app = new Hono<Env>()
  app.get('/api/foo', (c) => c.json({ TOKEN: c.env.TOKEN, requestURL: c.req.url }))
  const handler = handle(app)
  const res = await handler(eventContext)            // returns Response (Web-standard)
  expect(res.status).toBe(200)
})
```

**Pattern — Bun server probe via Context env duck-typing:** the trivial-looking `bun/server.test.ts` (15 LOC) tests dual-form: env-as-server vs env-as-`{server}` wrapper (citation: `.claude/knowledge-base/references/hono/src/adapter/bun/server.test.ts:1-15`). Small test, big design statement: there is no Bun-specific fixture; runtime is duck-typed through Context env. **This IS the test pattern TheoKit needs for the C3 Hono-shape path.**

```ts
// .claude/knowledge-base/references/hono/src/adapter/bun/server.test.ts:5-14
it('Should success to pick Server', () => {
  const server = {}
  expect(getBunServer(new Context(new Request('http://localhost/'), { env: server }))).toBe(server)
  expect(getBunServer(new Context(new Request('http://localhost/'), { env: { server } }))).toBe(server)
})
```

### Boundary tests TheoKit DEVE escrever ANTES de tocar C1/C3

Cross-referenced with Q1 (plugin scope) and Q3 (multi-runtime) recommendations:

| Test | Source pattern | What it asserts | Gap closed |
|---|---|---|---|
| `theo-plugin-encapsulation-leak.test.ts` | Fastify `plugin.1.test.js:71-75` | Plugin A decorates `instance` → plugin B (sibling) MUST NOT see it; child Object.create(parent) chain proves prototype isolation | C1 |
| `theo-plugin-fp-opt-out.test.ts` | Fastify `plugin.1.test.js:60-90` | Explicit opt-out symbol (mirror `Symbol.for('skip-override')`) lets a plugin leak UP to root; default is encapsulated | C1 |
| `theo-error-handler-scope.test.ts` | Fastify `encapsulated-error-handler.test.js:9-36` | Inner `setErrorHandler` catches inner throw; outer catches inner's re-throw; ordering deterministic via Object.getPrototypeOf | C1 + C2 |
| `theo-adapter-cloudflare-workers.test.ts` | Hono `cloudflare-pages/handler.test.ts:35-67` | `new Request()` → adapter → `Response`; zero `node:*` imports in test setup | C3 (Hono-shape) |
| `theo-adapter-bun-server.test.ts` | Hono `bun/server.test.ts:5-14` | Duck-type env via Context; no Bun-specific fixture import | C3 (Hono-shape) |
| `theo-preset-resolve.test.ts` | _no direct ref in plan; would mirror Nitro `presets/_resolve.ts` matching logic_ | If TheoKit goes Nitro-shape: `resolvePreset('cloudflare-pages')` returns expected entry file; falls back to runtime default when name absent | C3 (Nitro-shape) |

### Compatibility com TheoKit invariants (architecture.md v3.1)

- **Invariant 1 (zero cycles):** Test patterns above são puramente leaf — não introduzem ciclo.
- **Invariant 2 (`core` depende de nada intra-monorepo):** Tests rodam em `packages/theo/tests/`; boundary tests para C3 podem mover dispatch para adapter-specific test file, mantendo core test puro.
- **Invariant 3 (public API via barrels):** Tests devem importar via barrel `theokit/server` para falhar se barrel for quebrado (consumer-facing safety net).

---

## Coverage Corner 2 — Dependencies

### Fastify

| Dependency | Why | Citation |
|---|---|---|
| `@fastify/error` | createError factory used by `errors.js` to ship 91 typed errors | `.claude/knowledge-base/references/fastify/lib/errors.js:3` |
| `semver` | plugin version checking (`checkVersion`) | `.claude/knowledge-base/references/fastify/lib/plugin-utils.js:3` |
| `avvio` (transitive via `kAvvioBoot` symbol) | encapsulated boot sequence; provides `ready()` per child instance | `.claude/knowledge-base/references/fastify/lib/plugin-override.js:5,40` |
| `node:assert`, `node:http` | runtime primitives | `.claude/knowledge-base/references/fastify/lib/plugin-utils.js:4`, `error-handler.js:3` |

### Hono

Hono's `package.json` declares 74 sub-path exports (counted via grep `"\./[^"]*":'`). Sub-path examples (citation `.claude/knowledge-base/references/hono/package.json:37-200`):

| Sub-path | Module shape | Why |
|---|---|---|
| `.` | barrel | main `Hono` class |
| `./hono-base` | leaf | abstract base for custom routers |
| `./http-exception` | leaf | the single error class (78 LOC) |
| `./request` / `./types` | leaf | typing surface |
| `./tiny`, `./quick` | preset | bundle-optimized variants |
| `./basic-auth`, `./bearer-auth`, `./csrf`, `./cors`, etc. | leaf middleware | one sub-path per middleware (24 middleware names visible) |
| `./jsx`, `./jsx/jsx-dev-runtime`, `./jsx/jsx-runtime` | nested | JSX runtime config |

Each export entry carries `types` + `import` + `require` keys (citation `.claude/knowledge-base/references/hono/package.json:38-47`):

```json
".": {
  "types": "./dist/types/index.d.ts",
  "import": "./dist/index.js",
  "require": "./dist/cjs/index.js"
}
```

### Nitro

Per `.claude/knowledge-base/references/nitro/AGENTS.md` (project doc): "Avoid barrel files (`index.ts` re-exports); import directly from specific modules." Nitro philosophically rejects the strict-exports `package.json` field in favor of direct file path imports.

### Astro

| Dependency | Why | Citation |
|---|---|---|
| `zod/v4` | schema validation across 4 schema files | `.claude/knowledge-base/references/astro/packages/astro/src/core/config/schemas/base.ts:16`, `refined.ts:1`, `relative.ts:4` |
| `vite` (`mergeConfig`) | recursive merge of Vite sub-config inside Astro config | `.claude/knowledge-base/references/astro/packages/astro/src/core/config/merge.ts:1` |
| `@astrojs/markdown-remark` | markdown processor (dynamic import to keep cold start low) | `.claude/knowledge-base/references/astro/packages/astro/src/core/config/validate.ts:77` |

### Next.js

Next.js packages does NOT use `"exports"` field. Instead, it ships **47 stub files** in the package root (`cache.js`, `headers.js`, `server.js`, `image.js`, etc.) listed in the `"files"` array of `package.json` (citation `.claude/knowledge-base/references/next.js/packages/next/package.json:11-79`). Each stub does runtime branching:

```js
// .claude/knowledge-base/references/next.js/packages/next/cache.js:1-9
let cacheExports
if (process.env.NEXT_RUNTIME === '') {
  const notAvailableInClient = (name) => {
    return function notAvailable() {
      throw new Error(`\`${name}\` is only available in a Server Component.`)
    }
  }
  cacheExports = { ... }
}
```

This is an alternative to `"exports"`: ship per-subpath JS files at the root, use Node module resolution (`next/cache` resolves to `next/cache.js`), do runtime branching inside the stub. Trade-off: no compile-time gate, but no transpile-time `"exports"` complexity either.

---

## Coverage Corner 3 — Tools

### Fastify

- **Build/test:** `node:test` (built-in test runner); fixtures via `Fastify()` factory + `fastify.inject()` (no separate fixture lib).
- **Migration tooling:** `Migration-Guide-V{3,4,5}.md` under `docs/Guides/` track every deprecation cycle. V5 guide explicitly references `FSTDEP011` through `FSTDEP021` as warnings that became errors in major version (citation `.claude/knowledge-base/references/fastify/docs/Guides/Migration-Guide-V5.md:189-282`).
- **CI shape:** GitHub Actions (not deep-investigated; out of Q-scope).

### Hono

- **Build:** `bun` (via `bun ./build/build.ts`) per `.claude/knowledge-base/references/hono/package.json:30-35`.
- **Test runner:** Vitest with `--coverage`; Deno cross-tested via `bun test:deno`.
- **Release tool:** `np` for npm publish; `publint` post-build to validate `"exports"` keys.

### Nitro

Per `.claude/knowledge-base/references/nitro/AGENTS.md`: `pnpm fmt`, `pnpm typecheck`, `pnpm test`, `pnpm vitest run`. CLI commands defined via `citty` framework (`defineCommand({ meta, args, run })` — citation `.claude/knowledge-base/references/nitro/src/cli/commands/build.ts:29-55`).

### Astro

- **CLI verbs:** `astro dev`, `astro build`, `astro preview`, with file-based command resolution (not deep-investigated).
- **Dev toolbar loading:** runtime client-side dynamic imports via `Promise.all([loadDevToolbarApps(), import('./apps/audit/index.js'), ...])` (citation `.claude/knowledge-base/references/astro/packages/astro/src/runtime/client/dev-toolbar/entrypoint.ts:10-38`).

### Next.js

- **CLI orchestrator:** root `bin/next.ts` dispatches to per-verb files via flat `cli/next-*.ts` naming convention (11 files in `packages/next/src/cli/`).
- **Each verb file is self-contained:** `next-start.ts` (93 LOC) imports `startServer` from `server/lib/start-server` and orchestrates port logic (citation `.claude/knowledge-base/references/next.js/packages/next/src/cli/next-start.ts:1-50`).

---

## Coverage Corner 4 — Techniques

### Q1 — Plugin scope encapsulation: Fastify (canonical) vs Hono (no scope)

#### Fastify-shape (canonical)

**The encapsulation magic** lives in 47 lines of `plugin-override.js` (citation `.claude/knowledge-base/references/fastify/lib/plugin-override.js:28-73`):

```js
// .claude/knowledge-base/references/fastify/lib/plugin-override.js:28-50
module.exports = function override (old, fn, opts) {
  const shouldSkipOverride = pluginUtils.registerPlugin.call(old, fn)
  // ...
  if (shouldSkipOverride) {
    old[kPluginNameChain].push(fnName)
    return old                               // ← `fp()` opt-out: return parent, no child
  }
  const instance = Object.create(old)        // ← THE encapsulation primitive
  old[kChildren].push(instance)
  instance.ready = old[kAvvioBoot].bind(instance)
  instance[kChildren] = []
  instance[kReply] = Reply.buildReply(instance[kReply])
  instance[kRequest] = Request.buildRequest(instance[kRequest])
  // ... each subsystem gets a child copy
  instance[kHooks] = buildHooks(instance[kHooks])
  instance[kRoutePrefix] = buildRoutePrefix(instance[kRoutePrefix], opts.prefix)
  instance[kSchemaController] = SchemaController.buildSchemaController(old[kSchemaController])
  return instance
}
```

The key insight: **`Object.create(old)` creates a child instance whose prototype IS the parent.** Anything the child sets via `instance[name] = fn` is a child-only own property; anything the parent has is visible by prototype lookup. When the child finishes registration, it dies, and the parent is untouched — that's the "encapsulation magic" cited verbatim at line 27.

Decoration is gated by `assertNotStarted` (citation `.claude/knowledge-base/references/fastify/lib/decorate.js:136-140`):

```js
// .claude/knowledge-base/references/fastify/lib/decorate.js:136-140
function assertNotStarted (instance, name) {
  if (instance[kState].started) {
    throw new FST_ERR_DEC_AFTER_START(name)
  }
}
```

And by `FST_ERR_DEC_ALREADY_PRESENT` if the same name is double-decorated in the same scope (citation `.claude/knowledge-base/references/fastify/lib/decorate.js:20-22`).

#### Hono-shape (no scope, by design)

Hono has zero encapsulation. Middleware compose runs flat (citation `.claude/knowledge-base/references/hono/src/compose.ts:15-71`):

```ts
// .claude/knowledge-base/references/hono/src/compose.ts:15-50
export const compose = <E extends Env = Env>(
  middleware: [[Function, unknown], unknown][] | [[Function]][],
  onError?: ErrorHandler<E>,
  onNotFound?: NotFoundHandler<E>
): ((context: Context, next?: Next) => Promise<Context>) => {
  return (context, next) => {
    let index = -1
    return dispatch(0)
    async function dispatch(i: number): Promise<Context> {
      if (i <= index) throw new Error('next() called multiple times')
      index = i
      // ... handler call sequence
      if (handler) {
        try { res = await handler(context, () => dispatch(i + 1)) }
        catch (err) { if (err instanceof Error && onError) { ... } }
      }
    }
  }
}
```

This is the Koa pattern: middleware array, dispatch by index, each middleware gets `(context, next)`. No `instance`, no `Object.create`, no children — just a flat array.

The Hono **app routing** that comes closest to "scope" is `route()` (citation `.claude/knowledge-base/references/hono/src/hono-base.ts:208-232`) which mounts a sub-Hono instance under a path prefix. But this is sub-routing, not decoration scope — sub-apps share `errorHandler` reference unless explicitly overridden (lines 221-227 fold sub-errorHandler into compose). The encapsulation is **routing-only, not decoration-scoped**.

#### Comparison analysis (honest framing — EC-9 acknowledged)

Forcing a single table here would hide that these are **opposed philosophies**, not minor variations.

**Fastify-shape strengths:**
- Sibling plugins cannot collide (default-safe).
- Hierarchical error handlers naturally compose (parent catches child re-throw).
- Decoration validation gates fail-fast on conflict.

**Fastify-shape costs:**
- Adds ~80 LoC of prototype-chain machinery + `avvio` dependency for boot sequencing.
- Every sub-system (Reply, Request, ContentTypeParser, SchemaController, hooks) needs a `build*` constructor that takes the parent and returns a child.
- `Symbol.for('skip-override')` opt-out is a foot-gun: users must understand that `fp()` breaks the very encapsulation Fastify ships.

**Hono-shape strengths:**
- 73 LoC `compose.ts` + zero prototype gymnastics.
- Web-standards only (no Node-specific bootstrap).
- DX simpler: `app.use(fn)` reads as Express.

**Hono-shape costs:**
- Plugin A decorating `c.X` and plugin B decorating `c.X` will collide silently — last write wins.
- No hierarchical error handlers; `onError` is a flat replace.

#### Compatibility com TheoKit invariants

- **Invariant 1 (zero cycles):** Fastify-shape requires `plugin-override` → `hooks` → `plugin-utils` chain. As long as those live in `core/contracts/`, no cycle. Hono-shape adds no new modules.
- **Invariant 2 (`core` depende de nada intra-monorepo):** Both shapes respect this — they live in framework core.
- **Invariant 3 (public API via barrels):** Fastify-shape requires `Symbol.for('skip-override')` exposed publicly; would extend `theokit/server` barrel. Hono-shape requires nothing new.

**Recommendation (Q1):** If TheoKit prioritizes plugin ecosystem safety, adopt the Fastify `Object.create(parent)` pattern in `TheoPlugin.register()` lifecycle (estimated cost: 80–120 LoC + `avvio`-equivalent boot dependency or in-house equivalent). If TheoKit prioritizes minimal core, document the Hono trade-off publicly ("plugins share `app` mutably; sibling plugins MUST namespace decorations"). **Do not ship a third hybrid** — the two are mutually-exclusive design centers and a halfway implementation will mislead plugin authors.

### Q2 — Error envelope hierarchy + migration strategy

#### Fastify FastifyError + createError factory

Fastify ships 91 errors via `createError(code, message, statusCode?, ConstructorClass?)` (citation `.claude/knowledge-base/references/fastify/lib/errors.js:1-528`). The factory pattern produces tree-like categorization via code prefixes:

| Prefix | Concern | Example | Citation |
|---|---|---|---|
| `FST_ERR_` (root) | base namespace | `FST_ERR_NOT_FOUND` 404 | `errors.js:9-13` |
| `FST_ERR_CTP_` | content type parser | `FST_ERR_CTP_BODY_TOO_LARGE` 413 + RangeError | `errors.js:105-110` |
| `FST_ERR_DEC_` | decoration | `FST_ERR_DEC_ALREADY_PRESENT` | `errors.js:141-144` |
| `FST_ERR_HOOK_` | hooks | `FST_ERR_HOOK_INVALID_TYPE` 500 + TypeError | `errors.js:171-176` |
| `FST_ERR_PLUGIN_` | plugin lifecycle | `FST_ERR_PLUGIN_VERSION_MISMATCH` | `errors.js:471-474` |
| `FST_ERR_VALIDATION` | request validation | 400 | `errors.js:50-54` |

EC-5 representative subset (≤7):
1. `FST_ERR_NOT_FOUND` 404 — basic 4xx
2. `FST_ERR_VALIDATION` 400 — request 4xx
3. `FST_ERR_CTP_BODY_TOO_LARGE` 413 RangeError — content 4xx
4. `FST_ERR_OPTIONS_NOT_OBJ` 500 TypeError — config 5xx
5. `FST_ERR_DEC_ALREADY_PRESENT` 500 — plugin/decorate
6. `FST_ERR_HOOK_INVALID_HANDLER` 500 TypeError — hooks
7. `FST_ERR_PLUGIN_VERSION_MISMATCH` 500 — plugin

The default error handler (citation `.claude/knowledge-base/references/fastify/lib/error-handler.js:83-102`) sets status code, logs at info (`<500`) or error (`≥500`), then calls `reply.send(error)`. The `fallbackErrorHandler` (lines 104-141) is invoked when user error handler throws — it serializes via `error-serializer.js` or a schema-bound serializer.

The serializer separates the envelope shape from the class hierarchy entirely — error is just `{ error, code, message, statusCode }` (citation `error-handler.js:112-117`).

#### Hono HTTPException

Hono ships **one** error class (`HTTPException` extends `Error`, 78 LOC total) with `status` + optional `res` (citation `.claude/knowledge-base/references/hono/src/http-exception.ts:46-78`):

```ts
// .claude/knowledge-base/references/hono/src/http-exception.ts:46-78
export class HTTPException extends Error {
  readonly res?: Response
  readonly status: ContentfulStatusCode
  constructor(status: ContentfulStatusCode = 500, options?: HTTPExceptionOptions) {
    super(options?.message, { cause: options?.cause })
    this.res = options?.res
    this.status = status
  }
  getResponse(): Response {
    if (this.res) { return new Response(this.res.body, { status: this.status, headers: this.res.headers }) }
    return new Response(this.message, { status: this.status })
  }
}
```

The default error handler in `hono-base.ts:35-42` checks `'getResponse' in err` to call `err.getResponse()`, falling back to console + 500. **No hierarchy. No codes. No categorization.** The shape IS the contract.

#### Migration history (via git log + Migration-Guide-V*.md)

EC-1 absorbed — `git log` against `lib/errors.js` returned 1 commit (`fc9eafd docs(Warnings): remove retired FSTWRN002 warning code`) but `find` discovered 3 explicit migration guides:

- `.claude/knowledge-base/references/fastify/docs/Guides/Migration-Guide-V3.md`
- `.claude/knowledge-base/references/fastify/docs/Guides/Migration-Guide-V4.md`
- `.claude/knowledge-base/references/fastify/docs/Guides/Migration-Guide-V5.md`

V5 explicitly references the deprecation cycle (citation `.claude/knowledge-base/references/fastify/docs/Guides/Migration-Guide-V5.md:5-6,189,218,254,282,346,369`):

> "Before migrating to v5, please ensure that you have fixed all deprecation warnings from v4. All v4 deprecations have been removed and will no longer..."

The pattern: deprecation warnings ship in major N as `FSTDEPxxx` codes (e.g. `FSTDEP011`, `FSTDEP013`, `FSTDEP015`-`FSTDEP019`, `FSTDEP021`), then become errors / removals in major N+1. The codes are stable string IDs that survive across releases for grep-ability in user codebases.

**Strategy extracted:** Fastify treats migration as a 2-major-version contract: (1) ship deprecation warning with stable `FSTDEPxxx` code; (2) document each in migration guide with PR link; (3) remove in next major. The codemod is implicit — users grep their CI logs for `FSTDEPxxx` warnings.

#### Compatibility com TheoKit invariants

- **Invariant 1 (zero cycles):** A flat enum of `THEO_ERR_*` codes in `core/contracts/error-codes.ts` adds zero cycle pressure.
- **Invariant 2 (`core` depende de nada intra-monorepo):** Codes live in core; serializer is a leaf.
- **Invariant 3 (public API via barrels):** Codes export through `theokit/errors` barrel.

**Recommendation (Q2):** TheoKit C2 should NOT replicate Fastify's 91-error hierarchy. Instead:
1. Adopt Hono's flat `TheoError` class (already shipped as `TheoErrorEnvelope` G5) as the single contract.
2. Apply the existing codemod (`scripts/migrations/envelope-0-2-to-0-4.mjs`) to drain the 29 custom Error classes — this is **execution discipline**, not design redesign.
3. Add a stable code field (`THEO_ERR_*`) — Fastify-style prefix grouping — as a soft taxonomy. Not a class hierarchy.
4. Document a Fastify-style 2-major-version deprecation cycle in `CHANGELOG.md` for any future error envelope change. The "migration story not documented" outcome from git log is honest signal: most frameworks under-document this.

### Q3 — Multi-runtime portability (Hono Web-standards vs Nitro Strategy preset)

EC-6 stop — read end-to-end: cloudflare-workers + deno + bun (3 of 9). Other 6 adapters enumerated below by path only.

#### Hono Web standards model

**The decision lives in the base class itself**: `Hono.fetch()` returns `Response | Promise<Response>` and is typed `(request: Request, Env?, executionCtx?) => Response | Promise<Response>` (citation `.claude/knowledge-base/references/hono/src/hono-base.ts:479-485`). Every adapter is a thin re-export at the leaf — Cloudflare Workers index is 3 lines (citation `.claude/knowledge-base/references/hono/src/adapter/cloudflare-workers/index.ts:1-9`):

```ts
// .claude/knowledge-base/references/hono/src/adapter/cloudflare-workers/index.ts:6-8
export { serveStatic } from './serve-static-module'
export { upgradeWebSocket } from './websocket'
export { getConnInfo } from './conninfo'
```

Bun index (citation `.claude/knowledge-base/references/hono/src/adapter/bun/index.ts:6-11`):

```ts
export { serveStatic } from './serve-static'
export { bunFileSystemModule, toSSG } from './ssg'
export { createBunWebSocket, upgradeWebSocket, websocket } from './websocket'
export type { BunWebSocketData, BunWebSocketHandler } from './websocket'
export { getConnInfo } from './conninfo'
export { getBunServer } from './server'
```

Deno index (citation `.claude/knowledge-base/references/hono/src/adapter/deno/index.ts:6-9`):

```ts
export { serveStatic } from './serve-static'
export { toSSG, denoFileSystemModule } from './ssg'
export { upgradeWebSocket } from './websocket'
export { getConnInfo } from './conninfo'
```

The runtime-specific code is in `conninfo.ts` per adapter — and it is **tiny**:

```ts
// .claude/knowledge-base/references/hono/src/adapter/cloudflare-workers/conninfo.ts:3-7
export const getConnInfo: GetConnInfo = (c) => ({
  remote: {
    address: c.req.header('cf-connecting-ip'),
  },
})
```

That's the entire CF Workers connection-info adapter. Three lines. The differentiation between runtimes is the header name (`cf-connecting-ip`) — and that's it.

**Remaining 6 Hono adapters (enumerated only per EC-6):**

- `.claude/knowledge-base/references/hono/src/adapter/cloudflare-pages/` — Pages Functions handler signature differs from Workers (EventContext-based)
- `.claude/knowledge-base/references/hono/src/adapter/aws-lambda/` — APIGatewayProxyEvent → Request translation
- `.claude/knowledge-base/references/hono/src/adapter/lambda-edge/` — Lambda@Edge CloudFront event shape
- `.claude/knowledge-base/references/hono/src/adapter/netlify/` — Netlify Edge Functions
- `.claude/knowledge-base/references/hono/src/adapter/service-worker/` — Browser Service Worker `fetch` event
- `.claude/knowledge-base/references/hono/src/adapter/vercel/` — Vercel Edge Functions

#### Nitro Strategy preset model

Nitro resolves the preset at build time via `resolvePreset(name, opts)` (citation `.claude/knowledge-base/references/nitro/src/presets/_resolve.ts:16-117`). The decision logic:

1. Filter `allPresets` by matching `name` against `preset._meta.name` OR `preset._meta.stdName` OR `preset._meta.aliases` (lines 35-39).
2. Filter dev-vs-prod via `preset._meta.dev` (line 44).
3. Filter by compatibility date (lines 48-62) — `compatibilityDate` is a hard gate that lets the resolver reject older presets.
4. Sort by compatibility date descending (lines 66-70).
5. Auto-detect runtime when no name passed: `runtimeMap[runtime] || "node"` (line 98).

Each preset declares **entry, exports, runtime-specific commands, hooks** via `defineNitroPreset(...)` (citation `.claude/knowledge-base/references/nitro/src/presets/node/preset.ts:1-27`):

```ts
// .claude/knowledge-base/references/nitro/src/presets/node/preset.ts:4-16
const nodeServer = defineNitroPreset(
  {
    entry: "./node/runtime/node-server",   // ← per-preset entry file
    serveStatic: true,
    commands: { preview: "node ./server/index.mjs" },
  },
  { name: "node-server" as const, aliases: ["node"] }
);
```

The Cloudflare preset (citation `.claude/knowledge-base/references/nitro/src/presets/cloudflare/preset.ts:61-111`) shows the full Strategy hook surface:

```ts
// .claude/knowledge-base/references/nitro/src/presets/cloudflare/preset.ts:61-105
const cloudflarePages = defineNitroPreset(
  {
    extends: "base-worker",                                 // ← preset inheritance
    entry: "./cloudflare/runtime/cloudflare-pages",
    exportConditions: ["workerd", "worker"],
    rollupConfig: {
      output: { entryFileNames: "index.js", format: "esm", inlineDynamicImports: false },
      plugins: [guardCreateRequire(), stripBareNodeImports()],     // ← bundler hooks per preset
    },
    hooks: {
      "build:before": async (nitro) => { ... },
      async compiled(nitro: Nitro) { await writeWranglerConfig(nitro, "pages"); ... },
    },
  },
  { name: "cloudflare-pages" as const, stdName: "cloudflare_pages" }
);
```

Note the per-preset Rollup plugin (`stripBareNodeImports`, lines 47-56) — Nitro at the build layer rewrites `import "node:buffer"` style imports OUT of chunks targeted at CF Workers. This is **Strategy + bundler co-design**: the runtime-specific behavior is enforced at compile time.

#### R3a — Hono-shape recommendation para TheoKit

**Migration steps if TheoKit adopts Web-standards-only:**

1. **Audit + migrate the 42 `node:*` imports** in `packages/theo/src/server/` to Web standards equivalents:
   - `node:http` request/response → `Request`/`Response`
   - `node:url` URL parsing → global `URL` (already Web-standard)
   - `node:fs` file reads → adapter-specific helpers per runtime (CF uses bindings, Bun has `Bun.file()`, Deno has `Deno.readFile()`)
   - `node:crypto` → `crypto.subtle` (Web Crypto API)
   - `node:buffer` → `Uint8Array` + `TextEncoder/Decoder`
2. **Refactor `core/server-types` to use `(req: Request) => Response | Promise<Response>`** as the canonical handler shape.
3. **Collapse the 6 adapters to thin re-exports** mirroring Hono's `index.ts` pattern (3-11 lines each).
4. **Plugin compat impact:** plugins that decorate `req`/`res` via `node:http` shape break; plugins that use `Request.headers.get(name)` stay.
5. **Bundle size impact:** removing 42 `node:*` imports cuts ~80-150 KB from worker bundle (estimate based on Hono's 12 KB minified vs Express equivalent).
6. **Time-to-1.0 cost:** estimated 4-6 weeks (audit + migrate + adapter refactor + plugin migration guide).

#### R3b — Nitro-shape recommendation para TheoKit

**Migration steps if TheoKit isolates `node:*` to per-preset adapter files:**

1. **Introduce `theo.presets/<name>/preset.ts`** mirroring Nitro's `defineTheoPreset({ entry, hooks, ... })` factory.
2. **Move ALL 42 `node:*` imports into `packages/theo/src/presets/node/runtime/`** — server core stops importing `node:*` directly; presets do.
3. **Add a preset resolver** (`resolvePreset(name)` mirroring `_resolve.ts`) that:
   - Looks up preset by name OR alias OR `std-env` runtime detection.
   - Selects per-preset entry file at build time.
   - Allows hooks per preset (build:before, compiled).
4. **Bundle layer:** ship Rollup/Vite plugins per preset (e.g., `stripBareNodeImports` for CF Workers; identity for Node).
5. **Plugin compat impact:** plugins now author against a "runtime-neutral" Theo API and the preset hands them the runtime-specific helpers. Existing `node:*`-using plugins get adapted via a `compat` package.
6. **Hierarchy impact:** introduces a `presets/` top-level alongside `adapters/` — explicit replacement of the current hybrid.
7. **Time-to-1.0 cost:** estimated 6-9 weeks (preset infrastructure + resolver + per-preset adapter migration + plugin migration guide).

#### ADR-no-blueprint Q3-decision-deferred — trade-off matrix

| Dimension | R3a Hono-shape | R3b Nitro-shape | TheoKit-today hybrid |
|---|---|---|---|
| Blast radius (LoC changed) | ~42 imports + 6 adapters | ~42 imports + new presets/ tree + adapters/ refactor | 0 (status quo) |
| Plugin ecosystem compat | Breaks `node:http`-shaped plugins | Adapts via compat package | Works but inconsistent |
| Runtime perf overhead | Lowest (Web standards native everywhere) | Moderate (Strategy resolver at build) | Moderate (in-tree adapters paid at runtime) |
| Bundle size (CF Workers est.) | -80 to -150 KB | -50 to -100 KB | Current |
| Time-to-1.0 | 4-6 weeks | 6-9 weeks | 0 (but C3 unresolved at 1.0) |
| Multi-runtime correctness | High (single source of truth) | High (build-time gated) | Medium (relies on in-tree adapter discipline) |

**Decision:** DEFERRED to human. Both R3a and R3b are valid; current hybrid is not. Recommend reading this section + invariant check section below + revisiting in cycle-plan.

#### Compatibility com TheoKit invariants (R3a + R3b)

- **Invariant 1 (zero cycles):** R3a — handlers depend on Web standards only; zero new cycle pressure. R3b — `presets/` MUST NOT import from `server/` (only `server/contracts/`); enforced via dep-cruiser rule.
- **Invariant 2 (`core` depende de nada intra-monorepo):** R3a respects; R3b requires `presets/` and `core/` to be siblings, not parent-child.
- **Invariant 3 (public API via barrels):** R3a — barrel `theokit/server` stays as today. R3b — adds `theokit/presets/<name>` as a NEW barrel surface; consumer-facing.

### Q4 — Sub-package exports field

#### Hono `exports` field shape

74 sub-paths, each with `types` + `import` + `require` (citation `.claude/knowledge-base/references/hono/package.json:37-700`). Sample structural shape (5 representative keys):

```json
{
  "exports": {
    ".": { "types": "./dist/types/index.d.ts", "import": "./dist/index.js", "require": "./dist/cjs/index.js" },
    "./hono-base":      { ... "./dist/hono-base.js" ... },
    "./http-exception": { ... "./dist/http-exception.js" ... },
    "./cors":           { ... "./dist/middleware/cors/index.js" ... },
    "./cookie":         { ... "./dist/helper/cookie/index.js" ... }
  }
}
```

Categories visible:
- Core (`.`, `./hono-base`, `./request`, `./types`)
- Errors (`./http-exception`)
- Presets (`./tiny`, `./quick`)
- Middleware (`./basic-auth`, `./bearer-auth`, `./body-limit`, `./cache`, `./compress`, `./context-storage`, `./cors`, `./csrf`, `./etag`, `./ip-restriction`, `./jsx`, ...)
- Helpers (`./accepts`, `./cookie`, `./route`)
- JSX runtime (`./jsx`, `./jsx/jsx-dev-runtime`, `./jsx/jsx-runtime`)

Validation tooling: `publint` runs as `postbuild` script (citation `.claude/knowledge-base/references/hono/package.json:30`).

#### Next.js `exports` field shape — IT DOES NOT USE ONE

EC-8 finding (architectural surprise): Next.js `packages/next/package.json` does NOT declare `"exports"` (0 occurrences of `"./` sub-path keys per grep). Instead, it lists **47 stub `.js`/`.d.ts` files** in the `"files"` array (citation `.claude/knowledge-base/references/next.js/packages/next/package.json:11-79`):

```json
"files": [
  "AGENTS.md", "dist",
  "app.js", "app.d.ts",
  "babel.js", "babel.d.ts",
  "cache.js", "cache.d.ts",
  "constants.js", "constants.d.ts",
  "document.js", "document.d.ts",
  ...
  "headers.js", "headers.d.ts",
  "image.js", "image.d.ts",
  "navigation.js", "navigation.d.ts",
  "server.js", "server.d.ts",
  ...
  "experimental/testmode/proxy.js", "experimental/testmode/proxy.d.ts"
]
```

Each stub does its own runtime branching (citation `.claude/knowledge-base/references/next.js/packages/next/cache.js:1-9`):

```js
let cacheExports
if (process.env.NEXT_RUNTIME === '') {
  const notAvailableInClient = (name) => {
    return function notAvailable() {
      throw new Error(`\`${name}\` is only available in a Server Component.`)
    }
  }
  cacheExports = { ... }
}
```

This is a fundamentally different approach: instead of `"exports"`-field-as-compile-time-gate, Next.js uses **per-subpath stub files as runtime gates**. The trade-off:

| Approach | Compile-time gate | Runtime overhead | Tooling needs |
|---|---|---|---|
| Hono `"exports"` field (74 keys) | Yes — Node resolution rejects undeclared paths | Zero | `publint` post-build |
| Next.js stub files (47 files) | No — but throws helpful error at first call | One module load + branch | None (Node default resolution) |

#### Comparison + recommendation para TheoKit M1

TheoKit has 18 sub-domains in `server/index.ts` consumed via `export *` wildcards. ISP says each consumer should depend only on what it uses. Two options:

**Option A — Adopt Hono shape:** Add `"exports"` field to `packages/theo/package.json` with ~18 sub-path keys. Build-time gate prevents accidental deep imports. `publint` runs in CI. Tree-shaking improves (sub-paths point to per-domain entry files).

**Option B — Adopt Next.js shape:** Ship per-domain stub files in `packages/theo/`. No compile-time gate but lower complexity. Stub files do runtime version/environment checks (mirrors Next.js's `NEXT_RUNTIME` branching).

**Recommendation:** **Option A for TheoKit.** Reasoning: TheoKit has fewer entry points than Next.js (18 vs 47), so the `"exports"` field stays maintainable. Strict typing via `types` key matters more for framework consumers than Next.js (who consume `next` directly and expect stability). Estimate: 18 sub-path keys + 4 internal aliases (`#core/*`, `#util/*`) = ~22 entries, ~50 LoC in `package.json`, `publint` adds to CI.

#### Compatibility com TheoKit invariants

- **Invariant 1 (zero cycles):** `"exports"` enforcement HELPS catch cycle attempts at install time.
- **Invariant 2 (`core` depende de nada intra-monorepo):** `"exports"` is intra-package; orthogonal.
- **Invariant 3 (public API via barrels):** `"exports"` formalizes the barrel surface — they become the named entry points users can resolve.

### Q5 — Config schemas split (Astro)

Astro splits the AstroConfig schema across 4 files in `schemas/`:

| File | LOC | Purpose | Citation |
|---|---|---|---|
| `base.ts` | 613 | Pure Zod shape — every config field default + validator (EC-10 honest: still 613 LOC despite split) | `.claude/knowledge-base/references/astro/packages/astro/src/core/config/schemas/base.ts` |
| `refined.ts` | 43 | Cross-field validators that need the full parsed config (i18n + image + outDir/publicDir collision) | `.claude/knowledge-base/references/astro/packages/astro/src/core/config/schemas/refined.ts` |
| `refined-validators.ts` | 251 | Implementation of the validators called from `refined.ts` (kept separate for testability) | `.claude/knowledge-base/references/astro/packages/astro/src/core/config/schemas/refined-validators.ts` |
| `relative.ts` | 152 | Path-resolution layer that transforms string paths into `URL` instances after `root` is known | `.claude/knowledge-base/references/astro/packages/astro/src/core/config/schemas/relative.ts` |
| `index.ts` | 7 | Barrel re-export | `.claude/knowledge-base/references/astro/packages/astro/src/core/config/schemas/index.ts` |

The barrel is literally 7 lines (citation `.claude/knowledge-base/references/astro/packages/astro/src/core/config/schemas/index.ts:1-7`):

```ts
export {
  ASTRO_CONFIG_DEFAULTS,
  AstroConfigSchema,
  type AstroConfigType,
} from './base.js';
export { AstroConfigRefinedSchema } from './refined.js';
export { createRelativeSchema } from './relative.js';
```

`refined.ts` (43 LOC) uses `z.custom<AstroConfig>().superRefine(...)` — cross-field validation as a separate Zod pass (citation `.claude/knowledge-base/references/astro/packages/astro/src/core/config/schemas/refined.ts:15-43`).

`relative.ts` extends the base schema via Zod `extend()` with path transforms (citation `.claude/knowledge-base/references/astro/packages/astro/src/core/config/schemas/relative.ts:16-50`):

```ts
export function createRelativeSchema(cmd: string, fileProtocolRoot: string) {
  const AstroConfigRelativeSchema = AstroConfigSchema.extend({
    root: z.string().default(ASTRO_CONFIG_DEFAULTS.root).transform((val) => resolveDirAsUrl(val, fileProtocolRoot)),
    srcDir: ...transform((val) => resolveDirAsUrl(val, fileProtocolRoot)),
    publicDir: ...transform(...),
    outDir: ...transform(...),
    ...
  });
}
```

`validate.ts` orchestrates the 3 passes (citation `.claude/knowledge-base/references/astro/packages/astro/src/core/config/validate.ts:6-29`):

```ts
export async function validateConfig(userConfig: any, root: string, cmd: string): Promise<AstroConfig> {
  const AstroConfigRelativeSchema = createRelativeSchema(cmd, root);
  await coerceLegacyMarkdownPlugins(userConfig);
  warnDeprecatedMarkdownOptions(userConfig);
  return await validateConfigRefined(
    await AstroConfigRelativeSchema.parseAsync(userConfig, {
      error(issue) { ... return errorMap(issue); }
    }),
  );
}
```

`merge.ts` is a separate concern (88 LOC) — recursively merges user config over defaults with special handling for `vite`, `server`, `allowedHosts`, `markdown.processor` (citation `.claude/knowledge-base/references/astro/packages/astro/src/core/config/merge.ts:6-89`).

#### EC-10 honest framing

The split helps but does NOT make any single file small. `base.ts` is **still 613 LOC** — bigger than TheoKit's current 504 LOC `schema.ts`. The split's value is not size — it's **concern separation**: pure shape (base) vs cross-field validation (refined) vs path resolution (relative) vs composition (validate.ts/merge.ts). Tests can target each.

For TheoKit, two-axis split is more compelling than Astro's 3-pass model:
- **By domain** (auth, csrf, cors, csp, plugins, openapi, ratelimit, services, security-headers) — like sister files already exist (`CacheSchema` imported from `../cache/config.js`, `SessionSchema` from `../session/config.js` — citation `.claude/knowledge-base/references/astro/packages/astro/src/core/config/schemas/base.ts:21,23`).
- **By phase** (pure shape vs cross-field vs path-resolved) — Astro's pattern.

#### Recommendation para TheoKit M2

Split `packages/theo/src/config/schema.ts` (504 LOC) along **domain axis** mirroring how Astro already imports `CacheSchema`/`SessionSchema` from neighbor modules:

```
packages/theo/src/config/
  schemas/
    auth.ts          # AuthSchema (~50 LOC)
    csrf.ts          # CsrfSchema (~30 LOC)
    cors.ts          # CorsSchema (~30 LOC)
    csp.ts           # CspSchema (~40 LOC)
    plugins.ts       # PluginsSchema (~30 LOC)
    openapi.ts       # OpenApiSchema (~30 LOC)
    rate-limit.ts    # RateLimitSchema (~30 LOC)
    services.ts      # ServicesSchema (~80 LOC)
    security-headers.ts # SecurityHeadersSchema (~40 LOC)
    index.ts         # barrel re-export (~20 LOC)
  schema.ts          # composer: extends + cross-field validators (~80 LOC)
  validate.ts        # parse + errorMap orchestration (~30 LOC)
  merge.ts           # recursive merge utilities (~40 LOC)
```

Estimated `schema.ts` after split: **<100 LOC** (per plan goal). No single per-domain file >80 LOC.

Cross-field validators (e.g., CSP + auth interactions, CORS + CSRF interactions) live in `schema.ts` as `.superRefine(...)` — mirrors Astro's `AstroConfigRefinedSchema`.

#### Compatibility com TheoKit invariants

- **Invariant 1 (zero cycles):** `schemas/{domain}.ts` are leaves; `schemas/index.ts` is barrel; `schema.ts` is composer. Dependency direction: composer → barrel → leaves. Zero cycle.
- **Invariant 2 (`core` depende de nada intra-monorepo):** Schemas live in `packages/theo/src/config/`; orthogonal.
- **Invariant 3 (public API via barrels):** `schemas/index.ts` IS the barrel — formalizes ISP per domain.

### Q6 — Devtools sub-org + CLI commands layout

#### Astro `dev-toolbar/` structure (recommendation source for M3)

```
.claude/knowledge-base/references/astro/packages/astro/src/runtime/client/dev-toolbar/
├── apps/                         # ← sub-folder PER built-in tool
│   ├── astro.ts                  # Astro tool
│   ├── audit/                    # Audit tool (nested because >1 file)
│   │   └── (utils/)
│   ├── settings.ts               # Settings tool
│   ├── utils/                    # shared util across apps
│   └── xray.ts                   # Xray tool
├── ui-library/                   # ← sub-folder for UI components
├── entrypoint.ts                 # ← root orchestrator (loads everything via Promise.all)
├── helpers.ts                    # cross-cutting helpers
├── settings.ts                   # toolbar-level settings (different from apps/settings.ts)
└── toolbar.ts                    # AstroDevToolbar class
```

`entrypoint.ts` loads via `Promise.all` (citation `.claude/knowledge-base/references/astro/packages/astro/src/runtime/client/dev-toolbar/entrypoint.ts:10-38`):

```ts
document.addEventListener('DOMContentLoaded', async () => {
  const [customAppsDefinitions, { default: astroDevToolApp }, { default: astroAuditApp },
    { default: astroXrayApp }, { default: astroSettingsApp },
    { AstroDevToolbar, DevToolbarCanvas, getAppIcon }, { DevToolbarCard, ... }
  ] = await Promise.all([
    loadDevToolbarApps() as DevToolbarAppDefinition[],
    import('./apps/astro.js'),
    import('./apps/audit/index.js'),
    import('./apps/xray.js'),
    import('./apps/settings.js'),
    import('./toolbar.js'),
    import('./ui-library/index.js'),
  ]);
});
```

Pattern: **concern-based sub-folders + 4-5 root files for orchestration.** `audit/` is a sub-folder because it spans multiple files; `xray.ts`/`astro.ts`/`settings.ts` are single files. Convergence: "promote to sub-folder when conceptual siblings exist."

#### Nitro `cli/commands/` (recommendation source for M4)

```
.claude/knowledge-base/references/nitro/src/cli/commands/
├── build.ts        (55 LOC)
├── deploy.ts       (56 LOC)
├── dev.ts          (71 LOC)
├── docs.ts         (32 LOC)
├── prepare.ts      (19 LOC)
├── preview.ts      (48 LOC)
└── task/           # ← sub-folder because task has 2 sub-commands
    ├── index.ts
    ├── list.ts
    └── run.ts
```

Each command file uses `citty` `defineCommand({ meta, args, run })` pattern (citation `.claude/knowledge-base/references/nitro/src/cli/commands/build.ts:29-55`). The `task/` sub-folder is justified because `task list` + `task run` are sub-commands of `task` — Nitro nests when the verb has sub-verbs.

#### Next.js `cli/` (flat pattern)

```
.claude/knowledge-base/references/next.js/packages/next/src/cli/
├── internal/                    # ← internal helpers (not user-facing)
├── next-analyze.ts
├── next-build.ts                (178 LOC)
├── next-dev.ts
├── next-export.ts
├── next-info.ts
├── next-post-build.ts
├── next-start.ts                (93 LOC)
├── next-telemetry.ts
├── next-test.ts
├── next-typegen.ts
└── next-upgrade.ts
```

11 files at root, `next-` prefix, no sub-folders for user verbs. Each verb is self-contained — `next-start.ts` imports from `server/lib/start-server` (citation `.claude/knowledge-base/references/next.js/packages/next/src/cli/next-start.ts:1-50`).

#### Recommendation M3 (devtools) + M4 (CLI)

**M3 — TheoKit `devtools/` sub-organization (mirror Astro):**

```
packages/theo/src/devtools/
├── apps/                        # ← concern-based sub-folders per tool
│   ├── inspector.ts             # single-file tool
│   ├── routes/                  # multi-file tool
│   │   ├── index.ts
│   │   └── helpers.ts
│   ├── network.ts
│   └── csrf.ts
├── ui-library/                  # shared UI primitives
├── bridge/                      # IPC / HMR bridge
├── format/                      # output formatters
├── helpers.ts                   # cross-cutting
├── settings.ts                  # toolbar-level settings
└── entrypoint.ts                # root orchestrator
```

Promote to sub-folder when a tool has >1 file. Keep entrypoint thin (mirror `entrypoint.ts:10-38` shape).

**M4 — TheoKit `cli/commands/start/` sub-folder (mirror Nitro `task/`):**

If `start-*.ts` is 7 sub-verbs (server, watch, prod, profile, dev, ...), it MEETS the "verb has sub-verbs" trigger that Nitro uses for `task/`. Move to:

```
packages/theo/src/cli/commands/
├── build.ts
├── start/                       # ← sub-folder (mirror Nitro task/)
│   ├── index.ts                 # `theo start` entry; dispatches to subverbs
│   ├── server.ts                # `theo start server`
│   ├── dev.ts                   # `theo start dev`
│   ├── prod.ts                  # `theo start prod`
│   └── ...
├── migrate/                     # ← already a sub-folder; consistency win
│   └── ...
└── ...
```

Trigger documented: "when a single verb has 2+ sub-verbs OR ≥3 conceptual siblings, promote to sub-folder." This makes `start/` consistent with sibling `migrate/`.

If on inspection the 7 `start-*.ts` files are actually 7 INDEPENDENT verbs (not sub-verbs of `start`), the recommendation flips — keep them flat AND rename them to remove the misleading `start-` prefix (Next.js flat pattern). This is an investigation finding to verify in cycle-plan.

#### Compatibility com TheoKit invariants

- **Invariant 1 (zero cycles):** sub-folders are pure leaves; orchestrator (`entrypoint.ts`, `commands/start/index.ts`) imports from leaves only.
- **Invariant 2 (`core` depende de nada intra-monorepo):** orthogonal.
- **Invariant 3 (public API via barrels):** devtools is not consumer-facing; CLI is consumer-facing via the `theokit` bin entry — `commands/start/index.ts` becomes the named import resolution.

### Q7 — Integration test patterns para boundary (cross-ref with Q1+Q3)

Already covered in Coverage Corner 1. Cross-referenced patterns produce 6 boundary tests TheoKit should ship BEFORE touching C1 and C3:

| Test | Asserts | Closes gap | R3a / R3b applies? |
|---|---|---|---|
| `theo-plugin-encapsulation-leak.test.ts` | Default-encapsulated decoration scope | C1 | Both |
| `theo-plugin-fp-opt-out.test.ts` | Explicit opt-out symbol | C1 | Both |
| `theo-error-handler-scope.test.ts` | Inner/outer error handler chain | C1 + C2 | Both |
| `theo-adapter-cloudflare-workers.test.ts` | `new Request()` → adapter → `Response` zero `node:*` | C3 | R3a (preferred) |
| `theo-adapter-bun-server.test.ts` | Duck-type env via Context | C3 | R3a (preferred) |
| `theo-preset-resolve.test.ts` | `resolvePreset('cloudflare-pages')` returns expected entry | C3 | R3b only |

#### Compatibility com TheoKit invariants

Per `testing.md` (TDD-first), these tests MUST land BEFORE the C1/C3 implementation. Each test imports through public barrels (`theokit/server`, `theokit/plugins`, `theokit/adapter-{name}` per Q4 recommendation) — failure here proves barrel discipline. Per `architecture.md` v3.1 Invariant 3, tests double as barrel safety net.

---

## ADRs sintetizadas pelo blueprint

### D1 — Plugin scope mechanism: `Object.create(parent)` IS the canonical encapsulation primitive

**Context:** TheoKit `TheoPlugin` is Mediator-shaped sem encapsulation; comunidade futura com ≥5 plugins vai colidir silently. Investigation revealed Fastify is the only reference of the 5 that ships true scope; Hono and the others (Nitro, Astro, Next.js) don't have a comparable plugin shape.

**Decision:** If TheoKit decides to ship plugin scope, adopt Fastify's `Object.create(parent)` pattern (citation `.claude/knowledge-base/references/fastify/lib/plugin-override.js:38`) verbatim — child instances inherit via prototype chain, decorations are child-own, `Symbol.for('skip-override')` opt-out documented publicly. If TheoKit decides NOT to ship plugin scope, document the Hono trade-off (sibling plugins MUST namespace decorations) in the plugin authoring guide.

**Alternatives considered:**
- **Map-based namespace** (each plugin gets `app.plugins.set(name, decorations)`): rejected because it forces plugin authors to do `app.plugins.get('foo').bar()` instead of `app.foo.bar()`, hurting DX.
- **Class extension** (each plugin extends Fastify class): rejected; conflicts with `theokit/server` barrel design.
- **Status quo Mediator**: viable IF documented honestly; otherwise rejected (silent collision in production).

**Consequences:** Adopting Fastify-shape adds ~80-120 LoC to framework core + `avvio`-equivalent boot sequencing. Adopting Hono-shape requires a public ADR + migration of existing in-tree plugins to non-colliding decoration names.

### D2 — Error envelope: flat `TheoError` class + stable code field, NOT 91-class hierarchy

**Context:** G5 envelope shipped; 6 files use it; 29 custom Error classes coexist; codemod exists but un-applied. Fastify ships 91 errors via `createError` factory — but its pattern is **codes + factory + serializer**, not 91 distinct classes.

**Decision:** TheoKit keeps the flat `TheoError` class (already shipped as `TheoErrorEnvelope`) as the single error contract. Add a stable `TheoErrorCode` enum (`THEO_ERR_*` prefix, Fastify-style) for soft taxonomy and grep-ability in user CI logs. Apply the existing codemod (`scripts/migrations/envelope-0-2-to-0-4.mjs`) to drain the 29 custom classes — this is execution discipline, not redesign.

**Alternatives considered:**
- **Replicate Fastify's `createError` factory**: rejected; 91 errors is over-engineering for TheoKit's surface; the factory adds complexity without clear DX win.
- **Status quo (envelope + 29 classes coexisting)**: rejected; explicitly the C2 gap.
- **Only `TheoError` + no code field**: rejected; loses grep-ability for users debugging in production logs.

**Consequences:** TheoKit users get one class + one code field — matches modern conventions (Hono, AWS SDK, Stripe SDK all use code-string + status-int + cause). CHANGELOG.md gets a Fastify-style deprecation cycle documented (`[Unreleased] § Deprecated` per Inquebrável Rule 6). Codemod application becomes a SHIPPABLE_WITH_CAVEATS gate.

### D3 — Multi-runtime: Q3 deferred to human cycle-plan with explicit trade-off matrix

**Context:** 42 `node:*` imports in `server/`; 6 non-Node adapters in `adapters/`. Hono and Nitro represent the two coherent options (Web-standards-everywhere vs Strategy-per-preset). Status quo hybrid is incoherent.

**Decision:** This blueprint emits **two recommendations (R3a Hono-shape, R3b Nitro-shape)** + trade-off matrix; DOES NOT pick one. Per EC-2, the choice is deferred to human at cycle-plan with the matrix as input. The unbreakable invariant is: **no third hybrid**. Either commit to R3a or R3b; do not partially adopt either.

**Alternatives considered:**
- **Pick one in this blueprint**: rejected; the architecture decision deserves explicit human gate, not blueprint-author preference.
- **Refuse to recommend**: rejected; the trade-off matrix IS the value-add.

**Consequences:** cycle-plan must produce an ADR formally choosing R3a or R3b before the C3 work begins. Until then, the 42 `node:*` imports + 6 in-tree adapters remain — documented honestly as "C3 unresolved at 0.x".

### D4 — Sub-package boundary: adopt `"exports"` field (Hono-shape) for TheoKit M1

**Context:** 18 sub-domains in `server/index.ts` re-exported via `export *` wildcards. ISP says each consumer should depend on what it uses.

**Decision:** Add `"exports"` field to `packages/theo/package.json` with ~18 sub-path keys mirroring Hono's pattern (`.claude/knowledge-base/references/hono/package.json:37-700`). Run `publint` post-build. Internal aliases (`#core/*`) supplement for intra-repo imports.

**Alternatives considered:**
- **Next.js stub-files-at-root pattern**: rejected; 18 stub files in `packages/theo/` increases repo noise without compile-time gate benefit.
- **Status quo `export *`**: rejected; explicit M1 gap; defeats ISP.

**Consequences:** Users can no longer `import { foo } from "theokit/server/internal/private"` — compile-time gate makes private code private. Bundle tree-shaking improves because sub-paths point to per-domain entry files. CI adds `publint` (~1 second overhead). One-time migration effort: ~22 entry points + tsup config update.

### D5 — Sub-organization heuristic: promote to sub-folder when ≥2 conceptual siblings exist

**Context:** M3 (devtools 13 files flat) + M4 (`start-*.ts` 7 files flat) are sister symptoms — both are SRP signals at the directory level.

**Decision:** Adopt the **convergent heuristic** observed across Astro `dev-toolbar/apps/audit/` (sub-folder when tool has multiple files), Nitro `cli/commands/task/` (sub-folder when verb has sub-verbs), and Next.js `cli/next-*.ts` (flat is OK when verbs are independent):

> "When ≥2 conceptual siblings exist under a single name (a tool, a verb, a domain), promote to sub-folder with `index.ts` orchestrator. When N independent siblings exist, keep flat with descriptive prefix."

**Alternatives considered:**
- **Always flat (Next.js shape)**: rejected; doesn't handle the multi-file tool case.
- **Always nested (Astro shape)**: rejected; doesn't handle simple single-file verbs.

**Consequences:** TheoKit `devtools/` becomes `devtools/{apps,bridge,format,ui-library}/` + 3-4 root orchestrator files. TheoKit `cli/commands/start/` becomes a sub-folder IFF the 7 `start-*.ts` files are sub-verbs of `start` (verify in cycle-plan). Sister directory `migrate/` already follows this pattern — consistency win.

---

## Recommendations for the project

| # | Recommendation | Linked to | Priority |
|---|---|---|---|
| 1 | Apply existing `scripts/migrations/envelope-0-2-to-0-4.mjs` codemod to drain 29 custom Error classes; add `TheoErrorCode` enum | Q2, D2, architecture.md § 13.1 SRP | HIGH |
| 2 | Ship 6 boundary tests (C1 + C3 patterns) BEFORE writing implementation; mirror Fastify `encapsulated-error-handler.test.js` and Hono `cloudflare-pages/handler.test.ts` shapes | Q1, Q3, Q7, D1, testing.md TDD-first | HIGH |
| 3 | Convene human cycle-plan to decide R3a (Hono-shape) vs R3b (Nitro-shape) for C3; use trade-off matrix from Q3 as input | Q3, D3, architecture.md Invariant 2 | HIGH |
| 4 | Decide C1: adopt Fastify `Object.create(parent)` or document Hono-style "no scope" trade-off publicly | Q1, D1, architecture.md § 13.4 ISP | HIGH |
| 5 | Add `"exports"` field to `packages/theo/package.json` with ~18 sub-path keys; add `publint` to CI | Q4, D4, architecture.md Invariant 3 | MEDIUM |
| 6 | Split `packages/theo/src/config/schema.ts` along domain axis into `schemas/{auth,csrf,cors,csp,plugins,openapi,rate-limit,services,security-headers}.ts` + barrel + composer | Q5, architecture.md § 13.1 SRP | MEDIUM |
| 7 | Re-organize `devtools/` mirroring Astro `dev-toolbar/{apps,ui-library}/` — promote multi-file tools to sub-folders | Q6, D5, architecture.md § 13.1 SRP | LOW |
| 8 | Investigate whether 7 `start-*.ts` files are sub-verbs of `start` or independent verbs; if former, mirror Nitro `task/` sub-folder; if latter, keep flat | Q6, D5, architecture.md § 13.1 SRP | LOW |

---

## Cross-cutting Comparison

| Dimension | Fastify | Hono | Nitro | Astro | Next.js |
|---|---|---|---|---|---|
| Plugin scope mechanism | `Object.create(parent)` + `avvio` boot | Flat compose (no scope) | N/A (preset-shaped) | N/A (integrations-shaped) | N/A (framework-shaped) |
| Error envelope shape | 91 codes via `createError` factory + serializer | Single `HTTPException` class | N/A | `errorMap` + Zod issue mapping | Runtime branching via stub files |
| Multi-runtime model | Node-only by design | Web-standards-only + thin adapters (`index.ts` 3-9 lines) | Strategy preset (`resolvePreset` + per-preset hooks) | Node-only with platform integrations | Node-only with edge runtime branching |
| Sub-package exports | Single entry (`.`) | 74 sub-paths via `"exports"` field | Direct file imports (philosophy: no barrels) | Domain-based imports w/ no `"exports"` field | 47 stub files at root + `"files"` array |
| Config schemas split | N/A (no canonical schema lib) | N/A | `src/config/{defaults,resolvers,normalizers}` | Domain-split: `schemas/{base,refined,relative}` + barrel | Single `config-schema.ts` |
| Devtools sub-org | N/A | N/A | N/A | `dev-toolbar/{apps,ui-library}` + `entrypoint.ts` | `next-devtools/` (out-of-scope) |
| CLI commands layout | N/A | N/A | `cli/commands/<verb>.ts` + sub-folder when sub-verbs (`task/`) | `astro/src/cli/` (out-of-scope) | `cli/next-<verb>.ts` flat |

---

## Blocked questions (if any)

None. All 7 questions answered. EC-3 order constraint respected (Q7 ran after Q1+Q3 emitted citations). EC-5/EC-6/EC-7/EC-8 scope limits applied.

---

## Halt-loop progress (audit trail)

- Iterations used: 1 / N (sequential single-pass within wall-time budget)
- Questions answered: 7 / 7
- Questions blocked: 0
- Citations verified: 60+ file:line citations all resolve under `.claude/knowledge-base/references/`
- Coverage corners populated: 4/4 (tests, deps, tools, techniques)
- Time budget per-project: Fastify ≤4h ✓, Hono ≤4h ✓, Nitro ≤4h ✓, Astro ≤5h ✓, Next.js ≤5h ✓
- Compatibility-with-invariants sub-section: present in every question (Q1-Q7)
- Promise emitted at iteration: 1

---

## Related

- Discovery plan: `.claude/knowledge-base/discoveries/plans/theokit-arch-gaps-investigation-plan.md` (v1.1)
- Edge-case review absorbed: `.claude/knowledge-base/reviews/theokit-arch-gaps-investigation-edge-cases-2026-06-05.md`
- Confidence report: `.claude/knowledge-base/reviews/theokit-arch-gaps-investigation-confidence-{date}.md` (to be generated by `/discover-confidence`)
- Linked project rules:
  - `.claude/rules/architecture.md` v3.1 (Invariants 1-3)
  - `.claude/rules/testing.md` (TDD-first; Q7 boundary tests)
  - `.claude/rules/backend.md` (`defineRoute`/`defineAction` contract context)
  - `CLAUDE.md` root § 9 (don't reinvent) — Q1/Q2/Q3 borrow vs custom
  - `CLAUDE.md` root § 13 SOLID — D1 (SRP+OCP), D2 (DIP), D4 (ISP), D5 (SRP)
