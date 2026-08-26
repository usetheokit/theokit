/**
 * The Node-only entry for durable usage storage.
 *
 * Deliberately NOT re-exported from `theokit/server/cost`. That subpath is Web-Standards — it has to
 * import cleanly on Cloudflare Workers and Deno Deploy — and `node:sqlite` does not exist there.
 * Putting this behind the barrel would have made the whole cost subtree unimportable on five of the
 * seven deploy targets, and `tests/unit/r3a-web-crypto-migration-leaf.test.ts` is the invariant that
 * caught it: zero runtime `node:*` imports in `server/` outside documented Node-only leaves.
 *
 * The allowlist was the wrong fix. It records that a file is Node-only; it does not stop a barrel
 * from dragging it onto an edge runtime. A separate import path does, and it also states the cost at
 * the call site — a deployment that writes `theokit/server/cost/sqlite` has said it runs on Node.
 */
export { SqliteUsageStorage } from '../usage-storage-sqlite.js'
