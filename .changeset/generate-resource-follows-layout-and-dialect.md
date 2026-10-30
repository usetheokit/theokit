---
"theokit": patch
---

`theokit generate resource` writes under the `serverDir` from `theo.config.ts` (the scaffold's `src/server`) instead of a hardcoded `server/`. When it refuses, the CLI prints the real reason, such as `src/server/db/schema.ts not found`, where it used to print "Not a Theo project" next to an existing `theo.config.ts`. The generated code follows the project's dialect, read from `dialect` in `drizzle.config.ts` or from the core module `schema.ts` already imports: PostgreSQL gets `pgTable`, `serial`, `boolean` and `timestamp` columns and handlers that await the query (the Postgres drivers have no `.all()`, `.get()` or `.run()`), SQLite keeps the previous output. The table builders are now imported into `schema.ts` (they were appended without an import), and a dialect the generator cannot write for, such as MySQL, is refused by name with nothing written. (#1022)
