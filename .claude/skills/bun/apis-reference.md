# Bun APIs Reference — File I/O, SQLite, Spawn, Hashing, Glob, Workers

## BunFile & File I/O

### Bun.file(path, options?) → BunFile

```ts
interface BunFile extends Blob {
  readonly size: number;
  readonly type: string;

  text(): Promise<string>;
  json(): Promise<any>;
  stream(): ReadableStream;
  arrayBuffer(): Promise<ArrayBuffer>;
  bytes(): Promise<Uint8Array>;
  writer(params?: { highWaterMark?: number }): FileSink;
  exists(): Promise<boolean>;
  delete(): Promise<void>;
}
```

Accepts: `string` (path), `number` (fd), `URL` (file://)

```ts
const file = Bun.file("data.txt");
const file = Bun.file(1234);  // fd
const file = Bun.file(new URL(import.meta.url));  // current file
const file = Bun.file("data.json", { type: "application/json" });
```

### Bun.write(destination, data) → Promise<number>

Destination: `string | URL | BunFile`
Data: `string | Blob | BunFile | ArrayBuffer | TypedArray | Response`

Uses optimal syscalls per platform: `copy_file_range` (Linux), `clonefile`/`fcopyfile` (macOS).

### FileSink (incremental writer)

```ts
const writer = Bun.file("out.txt").writer({ highWaterMark: 1024 * 1024 });
writer.write("data");           // string | ArrayBufferView | ArrayBuffer
writer.flush();                 // flush to disk, returns byte count
writer.end();                   // flush + close
writer.ref() / writer.unref();  // control process lifetime
```

### Stdio

```ts
Bun.stdin;   // readonly BunFile
Bun.stdout;  // BunFile
Bun.stderr;  // BunFile
```

---

## bun:sqlite

### Database

```ts
import { Database, constants } from "bun:sqlite";

new Database(filename?: string, options?: {
  readonly?: boolean;
  create?: boolean;
  readwrite?: boolean;
  safeIntegers?: boolean;   // return bigint instead of number
  strict?: boolean;         // throw on missing params, allow binding without prefix
});

// Methods
db.query<R, P>(sql: string): Statement<R, P>;    // cached prepared statement
db.prepare<R, P>(sql: string): Statement<R, P>;  // uncached
db.run(sql: string, ...params): { lastInsertRowid: number; changes: number };
db.exec(sql: string, ...params);                  // alias for run

db.transaction(fn: (...args) => T): TransactionFn<T>;
db.close(throwOnError?: boolean): void;
db.serialize(): Uint8Array;
Database.deserialize(data: Uint8Array): Database;
db.loadExtension(name: string): void;
db.fileControl(cmd: number, value: any): void;

// ES module import
import db from "./app.sqlite" with { type: "sqlite" };
```

### Statement

```ts
interface Statement<R, P> {
  all(...params: P[]): R[];
  get(...params: P[]): R | undefined;
  run(...params: P[]): { lastInsertRowid: number; changes: number };
  values(...params: P[]): unknown[][];
  iterate(...params: P[]): IterableIterator<R>;
  as<T>(Class: new () => T): Statement<T, P>;
  finalize(): void;
  toString(): string;

  readonly columnNames: string[];
  readonly columnTypes: string[];
  readonly declaredTypes: (string | null)[];
  readonly paramsCount: number;
}
```

### Transactions

```ts
const tx = db.transaction(fn);
tx(args);              // BEGIN ... COMMIT (rollback on throw)
tx.deferred(args);     // BEGIN DEFERRED
tx.immediate(args);    // BEGIN IMMEDIATE
tx.exclusive(args);    // BEGIN EXCLUSIVE
// Nested = savepoints
```

### Type Mapping

| JS | SQLite |
|----|--------|
| `string` | TEXT |
| `number` | INTEGER / DECIMAL |
| `boolean` | INTEGER (1/0) |
| `Uint8Array` / `Buffer` | BLOB |
| `bigint` | INTEGER |
| `null` | NULL |

---

## Bun.spawn / Bun.spawnSync

### Bun.spawn(cmd, options?) → Subprocess

```ts
interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdin?: null | "pipe" | "inherit" | BunFile | TypedArray | Response | Request | ReadableStream | Blob | number;
  stdout?: "pipe" | "inherit" | "ignore" | BunFile | number;
  stderr?: "pipe" | "inherit" | "ignore" | BunFile | number;
  onExit?(proc, exitCode, signalCode, error): void;
  ipc?(message, subprocess): void;
  serialization?: "json" | "advanced";
  signal?: AbortSignal;
  timeout?: number;        // ms
  killSignal?: string | number;
  terminal?: { cols?, rows?, name?, data?, exit?, drain? };
}

interface Subprocess {
  readonly pid: number;
  readonly stdin: FileSink | null;
  readonly stdout: ReadableStream | null;
  readonly stderr: ReadableStream | null;
  readonly terminal: Terminal | undefined;
  readonly exited: Promise<number>;
  readonly exitCode: number | null;
  readonly signalCode: string | null;
  readonly killed: boolean;

  kill(signal?: number | string): void;
  ref() / unref(): void;
  send(message: any): void;
  disconnect(): void;
  resourceUsage(): ResourceUsage | undefined;
}
```

### Bun.spawnSync(cmd, options?) → SyncSubprocess

```ts
interface SyncSubprocess {
  stdout: Buffer | undefined;
  stderr: Buffer | undefined;
  exitCode: number;
  success: boolean;
  resourceUsage: ResourceUsage;
  pid: number;
}
```

### IPC

```ts
// Parent
const child = Bun.spawn(["bun", "child.ts"], {
  ipc(message, child) { child.send("reply"); },
  serialization: "json",  // use "json" for Node.js interop
});
child.send("hello");

// Child (child.ts)
process.on("message", msg => console.log(msg));
process.send("hello from child");
```

### PTY (Terminal)

```ts
const proc = Bun.spawn(["bash"], {
  terminal: {
    cols: 80, rows: 24,
    data(terminal, data) { process.stdout.write(data); },
  },
});
proc.terminal.write("ls\n");
proc.terminal.resize(120, 40);
proc.terminal.setRawMode(true);
proc.terminal.close();

// Reusable terminal
await using terminal = new Bun.Terminal({ cols: 80, rows: 24, data(t, d) {} });
Bun.spawn(["cmd1"], { terminal });
Bun.spawn(["cmd2"], { terminal });
```

---

## Hashing

### Bun.password (cryptographic, for passwords)

```ts
// Argon2 (default)
await Bun.password.hash(password, {
  algorithm: "argon2id",  // "argon2id" | "argon2i" | "argon2d"
  memoryCost: 65536,      // kibibytes (min 8)
  timeCost: 2,
});

// Bcrypt
await Bun.password.hash(password, {
  algorithm: "bcrypt",
  cost: 12,               // 4-31
});
// Bcrypt: passwords >72 bytes auto SHA-512 hashed first

await Bun.password.verify(password, hash);  // auto-detects algorithm

// Sync versions
Bun.password.hashSync(password, options);
Bun.password.verifySync(password, hash);
```

### Bun.hash (non-cryptographic, for data)

```ts
Bun.hash("data");               // bigint (Wyhash, 64-bit)
Bun.hash("data", seed);         // optional seed

// Algorithm variants
Bun.hash.wyhash("data");
Bun.hash.crc32("data");
Bun.hash.adler32("data");
Bun.hash.cityHash32("data") / Bun.hash.cityHash64("data");
Bun.hash.xxHash32("data") / Bun.hash.xxHash64("data") / Bun.hash.xxHash3("data");
Bun.hash.murmur32v2("data") / Bun.hash.murmur32v3("data") / Bun.hash.murmur64v2("data");
Bun.hash.rapidhash("data");

// Input: string | TypedArray | DataView | ArrayBuffer | SharedArrayBuffer
```

### Bun.CryptoHasher (cryptographic, for data)

```ts
const h = new Bun.CryptoHasher("sha256");  // or sha512, sha1, md5, blake2b256, sha3-256, etc.
h.update("data");                           // string | TypedArray | ArrayBuffer
h.update("hex data", "hex");               // with encoding
h.digest();                                 // Uint8Array
h.digest("hex");                            // string
h.digest("base64");
h.digest(existingUint8Array);              // write into buffer

// HMAC
const hmac = new Bun.CryptoHasher("sha256", "secret-key");
hmac.update("data").digest("hex");

// Copy
const copy = h.copy();

// Supported: blake2b256, blake2b512, md4, md5, ripemd160, sha1, sha224, sha256,
//            sha384, sha512, sha512-224, sha512-256, sha3-224/256/384/512, shake128/256
```

---

## Bun.Glob

```ts
import { Glob } from "bun";

const glob = new Glob("**/*.ts");

// Async scan
for await (const file of glob.scan({
  cwd: ".",
  dot: false,              // match dotfiles
  absolute: false,         // return absolute paths
  followSymlinks: false,
  onlyFiles: true,
})) { console.log(file); }

// Sync scan
for (const file of glob.scanSync(".")) { }

// Match string
glob.match("src/index.ts");  // true

// Patterns
// ?          single char
// *          zero+ chars (not path separator)
// **         zero+ chars (including path separator)
// [abc]      char class
// [a-z]      char range
// [^ab]      negated class
// {a,b,c}    alternatives (nestable, max 10 levels)
// !pattern   negate at start
// \*         escape special chars
```

---

## Workers

```ts
// Create
const worker = new Worker("./worker.ts", {
  smol?: boolean;        // reduce memory (smaller JSC heap)
  ref?: boolean;         // keep process alive (default true)
  preload?: string[];    // modules to load before worker starts
});

// Events
worker.postMessage(data);                     // send (structured clone)
worker.onmessage = (e: MessageEvent) => {};   // receive
worker.addEventListener("open", () => {});    // Bun extension: worker ready
worker.addEventListener("close", (e) => {});  // Bun extension: exitCode in e.code
worker.terminate();
worker.ref() / worker.unref();

// Worker thread
declare var self: Worker;
self.onmessage = (e) => { postMessage("reply"); };
process.exit();  // terminates worker only

// Check thread
Bun.isMainThread;  // boolean

// Blob URL workers
const blob = new Blob([`self.onmessage = e => postMessage(e.data)`], { type: "application/typescript" });
const worker = new Worker(URL.createObjectURL(blob));

// Environment data (shared)
import { setEnvironmentData, getEnvironmentData } from "worker_threads";
setEnvironmentData("key", value);  // main thread
getEnvironmentData("key");          // worker

// Performance: postMessage has fast paths for strings and simple objects
// 2-241x faster than Node.js for common cases
```
