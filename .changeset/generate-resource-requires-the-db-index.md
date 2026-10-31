---
"theokit": patch
---

`theokit generate resource` refuses a project without `<serverDir>/db/index.ts` (or `.tsx`/`.js`) before writing anything. The routes it writes import `db` from that file, and the command neither created nor checked it, so it reported `Created resource` and the next `theokit build` failed with `Could not resolve "../../db/index.js"`. The refusal names the file and prints a minimal `export const db` for the project's dialect (Drizzle over `better-sqlite3` for SQLite, `node-postgres` for PostgreSQL). (#1038)
