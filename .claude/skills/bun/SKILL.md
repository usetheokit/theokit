---
name: bun
description: >
  Bun runtime, package manager, test runner, and bundler expert. Use when working with Bun.serve,
  bun:sqlite, bun:test, Bun.build, Bun.spawn, Bun.file, Bun.write, Bun.password, Bun.hash,
  Bun.Glob, Workers, WebSockets, bunfig.toml, or migrating from Node.js to Bun.
  Covers the complete Bun toolkit: runtime APIs, HTTP server, SQLite, file I/O, hashing,
  child processes, bundler, test runner, and package manager configuration.
when_to_use: >
  User mentions Bun, bun.sh, Bun.serve, bun:sqlite, bun:test, Bun.build, Bun.spawn, Bun.file,
  Bun.write, bunfig.toml, bun install, bun run, bun test, bun build, BunFile, Bun.password,
  Bun.hash, Bun.Glob, Bun.CryptoHasher, migrating from Node.js to Bun, drop-in replacement
  for Node.js, bun websocket, bun workers
allowed-tools: Read Grep Glob Bash(bun *) Bash(bunx *)
---

# Bun — Complete Runtime & Toolkit Reference

You are an expert in Bun. Use the reference below to answer questions, generate code, configure
projects, debug issues, and migrate from Node.js.

Bun is an all-in-one JavaScript/TypeScript toolkit: runtime, package manager, test runner, and
bundler. Written in Zig, powered by JavaScriptCore. Drop-in replacement for Node.js.

For detailed reference on specific topics, consult:
- [server-reference.md](server-reference.md) — Bun.serve, routes, WebSockets, TLS, SSE
- [apis-reference.md](apis-reference.md) — File I/O, SQLite, spawn, hashing, glob, workers
- [bundler-test-reference.md](bundler-test-reference.md) — Bun.build, bun test, bundler plugins
- [config-reference.md](config-reference.md) — bunfig.toml, env vars, package manager

---

## Quick Start

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Run a file (TS/JSX supported out of the box)
bun run index.tsx

# Install packages (30x faster than npm)
bun install

# Run tests (Jest-compatible)
bun test

# Bundle for browser/server
bun build ./index.tsx --outdir ./out

# Run package.json scripts
bun run dev

# Execute a package
bunx cowsay 'Hello!'
```

## Core Concepts

| Feature | Description |
|---------|-------------|
| **Runtime** | JavaScriptCore engine, TS/JSX native, ESM+CJS, Web APIs (fetch, WebSocket, etc.) |
| **Package Manager** | `bun install` — global cache, workspaces, 30x faster than npm |
| **Test Runner** | `bun test` — Jest-compatible API, snapshots, mocking, coverage |
| **Bundler** | `bun build` — JS/TS/JSX/CSS, tree-shaking, splitting, plugins |
| **HTTP Server** | `Bun.serve` — 2.5x faster than Node, routes, WebSocket, HTTP/3 |
| **SQLite** | `bun:sqlite` — native driver, 3-6x faster than better-sqlite3 |
| **File I/O** | `Bun.file` / `Bun.write` — optimized with zero-copy syscalls |
| **Child Processes** | `Bun.spawn` — 60% faster than Node child_process, PTY support |

---

## HTTP Server (Bun.serve)

```ts
const server = Bun.serve({
  port: 3000,  // defaults to $BUN_PORT, $PORT, $NODE_PORT, or 3000

  // Route-based API (v1.2.3+)
  routes: {
    "/api/status": new Response("OK"),
    "/users/:id": req => new Response(`User ${req.params.id}`),
    "/api/posts": {
      GET: () => Response.json({ posts: [] }),
      POST: async req => Response.json(await req.json(), { status: 201 }),
    },
    "/api/*": Response.json({ error: "Not found" }, { status: 404 }),
    "/favicon.ico": Bun.file("./favicon.ico"),
    "/blog": Response.redirect("/blog/latest"),
  },

  // Fallback for unmatched routes
  fetch(req) {
    return new Response("Not Found", { status: 404 });
  },

  // Error handler
  error(error) {
    return new Response(`Error: ${error.message}`, { status: 500 });
  },
});

console.log(`Server: ${server.url}`);
```

### Key server features:
- **HTML imports**: `import app from "./index.html"` for full-stack apps
- **WebSocket**: Built-in pub/sub, compression, 7x faster than ws on Node
- **HTTP/3 (QUIC)**: `http3: true` (experimental, requires TLS)
- **TLS**: `tls: { key, cert }` options
- **Hot reload**: `server.reload({ routes, fetch })` — zero downtime
- **Idle timeout**: `idleTimeout: 30` (seconds, default 10, max 255)
- **Unix sockets**: `unix: "/tmp/my.sock"`
- **Per-request timeout**: `server.timeout(req, 60)` or `0` to disable
- **Client IP**: `server.requestIP(req)` returns `{ address, port }`
- **Metrics**: `server.pendingRequests`, `server.pendingWebSockets`
- **Export default**: `export default { fetch(req) { ... } }` works as server

---

## File I/O

```ts
// Read (lazy-loaded BunFile, conforms to Blob)
const file = Bun.file("data.json");
file.size;                    // bytes
file.type;                    // MIME type
await file.exists();          // boolean
await file.text();            // string
await file.json();            // parsed JSON
await file.arrayBuffer();     // ArrayBuffer
await file.bytes();           // Uint8Array
await file.stream();          // ReadableStream
await file.delete();          // delete file

// Write (uses fastest syscalls per platform)
await Bun.write("out.txt", "Hello");
await Bun.write("copy.txt", Bun.file("in.txt"));
await Bun.write("page.html", await fetch("https://bun.sh"));
await Bun.write(Bun.stdout, Bun.file("in.txt"));

// Incremental writing (FileSink)
const writer = Bun.file("log.txt").writer({ highWaterMark: 1024 * 1024 });
writer.write("line 1\n");
writer.write("line 2\n");
writer.flush();
writer.end();

// Stdio
Bun.stdin;   // readonly BunFile
Bun.stdout;  // BunFile
Bun.stderr;  // BunFile

// Directories — use node:fs
import { readdir, mkdir } from "node:fs/promises";
const files = await readdir(".", { recursive: true });
await mkdir("path/to/dir", { recursive: true });
```

---

## SQLite (bun:sqlite)

```ts
import { Database } from "bun:sqlite";

const db = new Database("app.db");          // file-based
const db = new Database(":memory:");        // in-memory
const db = new Database("ro.db", { readonly: true });
const db = new Database("strict.db", { strict: true }); // throw on missing params

// Import attribute
import db from "./app.sqlite" with { type: "sqlite" };

// Enable WAL mode (recommended)
db.run("PRAGMA journal_mode = WAL;");

// Prepared statements (cached)
const stmt = db.query("SELECT * FROM users WHERE id = ?");
stmt.get(1);              // first row as object
stmt.all();               // all rows as array of objects
stmt.values(1);           // rows as arrays
stmt.run();               // execute, return { lastInsertRowid, changes }
for (const row of stmt.iterate()) { ... } // streaming

// Map to class (no constructor call, uses Object.create)
class User { get isAdmin() { return this.role === "admin"; } }
db.query("SELECT * FROM users").as(User).all();

// Transactions (auto begin/commit/rollback)
const insertMany = db.transaction(items => {
  const insert = db.prepare("INSERT INTO items (name) VALUES (?)");
  for (const item of items) insert.run(item);
  return items.length;
});
insertMany(["a", "b", "c"]);
insertMany.deferred(items);   // BEGIN DEFERRED
insertMany.immediate(items);  // BEGIN IMMEDIATE
insertMany.exclusive(items);  // BEGIN EXCLUSIVE

// Serialize/deserialize
const bytes = db.serialize();          // Uint8Array
const restored = Database.deserialize(bytes);

// BigInt support
const db = new Database(":memory:", { safeIntegers: true });

// Load extensions
db.loadExtension("myext");

// using statement (auto-close)
{ using db = new Database("app.db"); }
```

---

## Child Processes (Bun.spawn)

```ts
// Async
const proc = Bun.spawn(["bun", "--version"], {
  cwd: "./dir",
  env: { ...process.env, FOO: "bar" },
  stdin: "pipe",       // null | "pipe" | "inherit" | Bun.file() | ReadableStream
  stdout: "pipe",      // "pipe" | "inherit" | "ignore" | Bun.file()
  stderr: "inherit",
  timeout: 5000,       // ms, then killed
  killSignal: "SIGTERM",
  signal: abortController.signal,
  onExit(proc, exitCode, signalCode, error) { },
});

proc.pid;
await proc.stdout.text();
await proc.exited;     // exit code
proc.kill();
proc.unref();          // detach from parent

// Sync
const result = Bun.spawnSync(["echo", "hi"]);
result.stdout.toString();  // Buffer
result.success;            // boolean
result.exitCode;

// IPC between Bun processes
const child = Bun.spawn(["bun", "child.ts"], {
  ipc(message, subprocess) { subprocess.send("reply"); },
  serialization: "json",  // "json" for Node.js interop, "advanced" (default)
});
child.send("hello");

// PTY (terminal)
const proc = Bun.spawn(["bash"], {
  terminal: { cols: 80, rows: 24, data(term, data) { process.stdout.write(data); } }
});
proc.terminal.write("echo hello\n");
```

---

## Hashing

```ts
// Password hashing (argon2 default, bcrypt supported)
const hash = await Bun.password.hash("password");
const ok = await Bun.password.verify("password", hash);

await Bun.password.hash("pwd", { algorithm: "argon2id", memoryCost: 8, timeCost: 3 });
await Bun.password.hash("pwd", { algorithm: "bcrypt", cost: 12 });

// Non-cryptographic hashing (Wyhash default)
Bun.hash("data");                    // bigint (64-bit)
Bun.hash.crc32("data");
Bun.hash.xxHash64("data");
Bun.hash.cityHash64("data");
Bun.hash.murmur32v3("data");

// Cryptographic hashing
const hasher = new Bun.CryptoHasher("sha256");
hasher.update("hello");
hasher.digest("hex");
// Algorithms: sha256, sha512, sha1, md5, blake2b256, blake2b512, sha3-256, sha3-512, etc.

// HMAC
const hmac = new Bun.CryptoHasher("sha256", "secret-key");
hmac.update("data");
hmac.digest("hex");
```

---

## Glob

```ts
import { Glob } from "bun";

// Scan directory
const glob = new Glob("**/*.ts");
for await (const file of glob.scan({ cwd: ".", dot: false, absolute: false })) {
  console.log(file);
}

// Sync
for (const file of glob.scanSync(".")) { }

// Match string
new Glob("*.ts").match("index.ts");     // true
new Glob("*.ts").match("src/index.ts"); // false

// Patterns: ? * ** [ab] [a-z] {a,b} ! \escape
```

---

## Workers

```ts
// Main thread
const worker = new Worker("./worker.ts", {
  smol: true,       // reduce memory usage
  ref: false,       // don't keep process alive
  preload: ["./setup.js"],
});
worker.postMessage("hello");
worker.onmessage = e => console.log(e.data);
worker.terminate();

// Worker thread (worker.ts)
declare var self: Worker;
self.onmessage = (event) => {
  postMessage(`echo: ${event.data}`);
};

// Check thread
Bun.isMainThread; // boolean
```

---

## Environment Variables

```ts
// Automatically loaded: .env → .env.{production|development|test} → .env.local
process.env.FOO;
Bun.env.FOO;           // alias
import.meta.env.FOO;   // alias

// TypeScript typing
declare module "bun" { interface Env { MY_VAR: string; } }

// CLI flags
// bun --env-file=.env.custom index.ts
// bun run --no-env-file index.ts
```

---

## Bundler (Bun.build)

```ts
const result = await Bun.build({
  entrypoints: ["./index.tsx"],
  outdir: "./dist",
  target: "browser",       // "browser" | "bun" | "node"
  format: "esm",           // "esm" | "cjs" | "iife" (cjs/iife experimental)
  splitting: true,          // code splitting
  minify: true,             // or { whitespace: true, syntax: true, identifiers: true }
  sourcemap: "external",    // "none" | "inline" | "external" | "linked"
  external: ["react"],      // don't bundle these
  naming: "[dir]/[name]-[hash].[ext]",
  publicPath: "/static/",
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".svg": "file", ".txt": "text" },
  drop: ["console", "debugger"],
  banner: "/* built with bun */",
  footer: "/* end */",
});

if (!result.success) {
  for (const msg of result.logs) console.error(msg);
}
```

CLI equivalent: `bun build ./index.tsx --outdir ./dist --target browser --minify --splitting`

---

## Test Runner (bun test)

```ts
import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";

describe("math", () => {
  test("adds", () => expect(2 + 2).toBe(4));

  test("async", async () => {
    const r = await Promise.resolve(42);
    expect(r).toBe(42);
  });

  test("timeout", () => { /* ... */ }, 500); // ms

  test.skip("skip this", () => {});
  test.todo("implement later");
  test.only("run only this");
  test.if(process.platform === "linux")("linux only", () => {});
  test.each([[1,2,3], [2,3,5]])("%i + %i = %i", (a, b, sum) => {
    expect(a + b).toBe(sum);
  });
});

// Mocking
const fn = mock(() => 42);
fn(); fn();
expect(fn).toHaveBeenCalledTimes(2);

// Snapshots
expect({ foo: "bar" }).toMatchSnapshot();
```

Run: `bun test`, `bun test --watch`, `bun test --coverage`, `bun test --timeout 10000`

---

## Package Manager (bun install)

```bash
bun install                  # install all deps
bun add react                # add dependency
bun add -d typescript        # add devDependency
bun remove lodash            # remove
bun update                   # update all
bun install --frozen-lockfile # CI mode
bun install --production     # no devDependencies
bunx create-next-app         # execute package
```

Lockfile: `bun.lock` (text, v1.2+) or `bun.lockb` (binary).

---

## Key Differences from Node.js

| Node.js | Bun |
|---------|-----|
| V8 engine | JavaScriptCore engine |
| `node:http` createServer | `Bun.serve()` with routes |
| `better-sqlite3` | `bun:sqlite` (native, 3-6x faster) |
| `jest` / `vitest` | `bun test` (built-in) |
| `webpack` / `esbuild` | `bun build` (built-in) |
| `npm` / `yarn` / `pnpm` | `bun install` (built-in) |
| `.env` requires `dotenv` | Auto-loaded |
| No TS support | TS/JSX/TSX native |
| `child_process.spawn` | `Bun.spawn` (60% faster) |
| `fs.readFile` | `Bun.file().text()` (or `node:fs` compat) |
| `crypto.createHash` | `Bun.CryptoHasher` (or `node:crypto` compat) |
| `bcrypt` / `argon2` packages | `Bun.password` (built-in) |
| `glob` package | `Bun.Glob` (built-in) |
| `ws` package | Built-in WebSocket server in Bun.serve |
