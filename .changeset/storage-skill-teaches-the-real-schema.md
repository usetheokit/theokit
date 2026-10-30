---
"create-theokit": patch
---

The scaffolded `theokit-config` skill shows the `storage` format the schema accepts (`servers`, `databases` and `redis` records with `host`, `user` and `password` fields) and how route code gets a pool with `getStorageManager().usePostgres(...)`. It taught `storage: { postgres: [{ url }], redis: [{ url }] }` and the `DATABASE_URL`/`REDIS_URL` variables, none of which theokit reads. The `theokit-database` skill says up front that its examples are SQLite, adds a PostgreSQL section (schema, connection through the storage manager, awaited queries), follows `serverDir`, and lists `theokit db generate`, `migrate`, `push` and `seed`. (#1023)
