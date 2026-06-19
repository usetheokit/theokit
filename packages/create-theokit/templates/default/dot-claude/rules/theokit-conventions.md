# TheoKit Conventions

## Imports

- Use `theokit/server/define` for defineRoute, defineAction, defineWebSocket
- Use `theokit/client` for theoFetch, createAppClient
- Use `theokit/server/auth` for session/auth APIs
- NEVER import from `theokit/dist/...` or `theokit/src/...`
- NEVER import internal modules: `theokit/core`, `theokit/vite-plugin`, `theokit/adapters/*`

## Validation

- Zod is the single source of truth for types and validation
- Define schema ONCE with `z.object(...)`, derive types with `z.infer<>`
- NEVER duplicate a Zod schema as a manual TypeScript interface
- NEVER parse request body manually — use `body:` in defineRoute

## Routes

- File at `server/routes/tasks/[id].ts` maps to `/api/tasks/:id`
- Export HTTP method handlers: `export const GET = defineRoute({...})`
- Use `params: z.object({...})` for URL params, `body:` for request body
- Use `status: 201` for creation responses, not manual `res.status()`

## Types

- No `any` in production code
- No `@ts-ignore` or `@ts-expect-error`
- No `as` type assertions — use Zod schemas or type guards

## Database

- Schema lives in `server/db/schema.ts` (Drizzle ORM)
- Connection in `server/db/index.ts`
- Seeds in `server/db/seed.ts`
- Use `npx drizzle-kit push` for dev, `npx drizzle-kit generate` for prod migrations
