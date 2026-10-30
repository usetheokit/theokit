---
"theokit": minor
---

**Behavior change:** `theokit db migrate` now runs `drizzle-kit migrate`, which applies the SQL files `theokit db generate` writes and records them in `drizzle.__drizzle_migrations`. It used to run `drizzle-kit push`, which diffs the schema straight into the database, ignores the generated files and keeps no journal. A script that relied on `db migrate` to push the schema without migration files should call the new `theokit db push`, which runs `drizzle-kit push` as before. `theokit db seed` runs `<serverDir>/db/seed.ts` instead of a hardcoded `server/db/seed.ts`, so it finds the seed file in the scaffold's `src/server` layout. (#1021)
