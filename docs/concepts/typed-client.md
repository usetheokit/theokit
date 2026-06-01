# Typed Client (`@theo/client`)

> The typed client is TheoKit's facade for calling your own `server/routes/` from the frontend with full type inference. One import per app — no `import type { GET }` per call site.

## At a glance

```typescript
// app/posts-page.tsx
import { client } from '@theo/client'

const data = await client.posts.get({ query: { limit: 10 } })
//    ^? — fully typed from `server/routes/posts.ts` defineRoute<...>
```

The client is a Vite virtual module emitted at dev start and on every change inside `server/routes/`. The corresponding `.d.ts` lands in `.theo/client.d.ts` — your IDE picks it up automatically (TS server includes the `.theo` directory by default).

## How it works

1. **Scanner** (`server/scan/`) walks `server/routes/*.ts` and detects which HTTP-method exports each file declares (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`). Detection uses the TypeScript compiler API (not regex) so comments and template literals never produce false positives.
2. **Codegen** (`vite-plugin/app-typed-client.ts → generateClientDts`) emits `.theo/client.d.ts` mapping each route file to its `import type` and exposing a tree-shaped `AppClient` interface. Path segments are normalized: `user-profiles` becomes `userProfiles`; dynamic segments (`[id]`) become typed `params: { id: string }`; safety/edge cases (digit-prefix, hyphens in unsafe positions) fall back to bracket-access keys.
3. **Runtime** (`client/app-client.ts → createAppClient`) is a Proxy facade ~100 LoC over `theoFetch`. Property access traverses the path tree; calling an HTTP method (`get / post / put / patch / delete`) invokes `theoFetch` with the correct URL + method, passing `query`, `body`, `signal`, `headers` straight through.
4. **Virtual module** `@theo/client` is registered by `appTypedClientPlugin` (wired via `theoPlugin()` automatically). The module's default export is `createAppClient()` already instantiated against the default `/api` baseUrl.

## Type inference end-to-end

`defineRoute` carries the response type via the handler's return type. `theoFetch`'s `InferResponse<T>` utility extracts it. The typed client wires both together:

```typescript
// server/routes/posts.ts
import { defineRoute } from 'theokit/server'
import { z } from 'zod'

export const GET = defineRoute({
  query: z.object({ limit: z.coerce.number().min(1).max(100).default(20) }),
  handler: ({ query }) => ({ items: [], total: 0, limit: query.limit }),
})
```

```typescript
// app/posts-page.tsx
import { client } from '@theo/client'

const data = await client.posts.get({ query: { limit: 10 } })
//    ^? { items: never[]; total: number; limit: number }
```

Change the handler return shape → TS errors in the consumer in <1 second (HMR + tsserver).

## Error handling

The typed client never invents an error shape — it propagates whatever `theoFetch` throws. The canonical error class is `TheoFetchError`:

```typescript
import { client } from '@theo/client'
import { TheoFetchError } from 'theokit/client'

try {
  await client.posts.post({ body: { title: '' } })
} catch (err) {
  if (err instanceof TheoFetchError) {
    if (err.code === 'VALIDATION_ERROR') {
      // err.issues is the Zod issue list (or any structured array sent by the server)
      renderFieldErrors(err.issues)
      return
    }
    if (err.status === 401) {
      // session expired — redirect to login
      window.location.href = '/login'
      return
    }
  }
  throw err
}
```

Fields on `TheoFetchError`:
- `status: number` — HTTP status code (or `0` for client-side runtime errors like `MISSING_PARAM`).
- `code?: string` — application code from `body.error.code` (e.g. `VALIDATION_ERROR`, `UNAUTHORIZED`).
- `issues?: unknown[]` — extra structured data from `body.error.issues` (Zod issues, validation details).
- `message: string` — falls back to `HTTP <status>` when no body envelope is present.

Network errors (failed `fetch`, timeout, abort) propagate as their native type (`TypeError`, `DOMException AbortError`) — they are NOT wrapped in `TheoFetchError`.

## Escape hatch — calling `theoFetch` directly

When you need finer control (custom URL builder, third-party API, etc.), the typed client is opt-in. Import `theoFetch` directly and pass `import type { GET } from '~/server/routes/posts'` the legacy way:

```typescript
import { theoFetch } from 'theokit/client'
import type { GET } from '~/server/routes/posts'

const data = await theoFetch<typeof GET>('/api/posts', { query: { limit: 10 } })
```

This is fully supported and is the same machinery the typed client uses internally — there is zero coupling cost.

## Edge cases — what the codegen handles

- **kebab-case file names** (`user-profiles.ts`) → camelCase property (`client.userProfiles.get`).
- **Path collision between an HTTP method and a sub-namespace** (route `/api/posts` declares `GET` AND a file at `/api/posts/get/...` declares `POST`) → the HTTP method wins; the sub-namespace is renamed with a trailing underscore (`get_`) and a WARNING comment is emitted at the top of `client.d.ts`.
- **Dynamic params** (`/api/posts/:id`) → `client.posts.id.get({ params: { id: '42' } })`. Params are URL-encoded automatically. Missing or empty required params throw `TheoFetchError({ code: 'MISSING_PARAM' })` at runtime.
- **Windows path separators** are normalized — import paths use POSIX `/` regardless of OS.
- **Re-exports with rename** (`export { handler as GET } from './shared'`) are detected.
- **Comments and template literals** that contain text like `export const GET = ...` are never false-positives — detection uses the TypeScript AST.

## Edge cases — what the codegen does NOT handle

- **JSON Schema serialization for external clients.** This is intentional (ADR D2 of plan `g1-client-codegen`). External consumers — Postman collections, mobile/Go/Python SDKs — should consume the OpenAPI spec emitted by G2 (`theokit build` → `openapi.json`). The typed client is for the same-codebase developer who already has the TypeScript types via Vite's dependency graph.
- **Apps without Vite.** The virtual module pattern depends on Vite. SSR/Node CLI usage that bypasses Vite must use `theoFetch` directly. The runtime Proxy itself (`createAppClient`) is framework-agnostic, but the `.d.ts` codegen is Vite-coupled.

## Bundle impact

Runtime overhead for the Proxy: ≤ 2KB gzipped (verified in bundle analyzer). No new peer dependencies — the typed client reuses `theoFetch`, CSRF handling, batching, transformer negotiation, error envelope, all of it.
