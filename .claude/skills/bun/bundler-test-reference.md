# Bun Bundler & Test Runner Reference

## Bun.build() / bun build

### JavaScript API

```ts
const result = await Bun.build({
  // Required
  entrypoints: string[];           // ["./index.tsx"]
  
  // Output
  outdir?: string;                 // output directory
  naming?: string;                 // "[dir]/[name]-[hash].[ext]"
  publicPath?: string;             // prefix for asset URLs
  
  // Behavior
  target?: "browser" | "bun" | "node";  // default: "browser"
  format?: "esm" | "cjs" | "iife";     // default: "esm" (cjs/iife experimental)
  splitting?: boolean;             // code splitting (esm only)
  minify?: boolean | { whitespace?: boolean; syntax?: boolean; identifiers?: boolean };
  sourcemap?: "none" | "inline" | "external" | "linked";
  
  // Modules
  external?: string[];             // don't bundle these modules
  packages?: "bundle" | "external"; // treat all packages as external
  
  // Transforms
  define?: Record<string, string>; // { "process.env.NODE_ENV": '"production"' }
  loader?: Record<string, Loader>; // { ".svg": "file", ".txt": "text" }
  drop?: string[];                 // ["console", "debugger"]
  
  // Injection
  banner?: string;                 // prepend to each file
  footer?: string;                 // append to each file
  
  // Advanced
  root?: string;                   // project root
  emitDCEAnnotations?: boolean;    // emit /* @__PURE__ */ annotations
  ignoreDCEAnnotations?: boolean;  // ignore existing annotations
  treeShaking?: boolean;           // default: true
  experimentalCss?: boolean;       // CSS bundling
  
  plugins?: BunPlugin[];           // bundler plugins
});

interface BuildOutput {
  success: boolean;
  outputs: BuildArtifact[];
  logs: Message[];
}

interface BuildArtifact extends Blob {
  path: string;
  loader: Loader;
  hash: string | null;
  kind: "entry-point" | "chunk" | "asset" | "sourcemap";
}
```

### CLI Flags

```bash
bun build ./index.tsx \
  --outdir ./dist \
  --target browser \
  --format esm \
  --splitting \
  --minify \
  --sourcemap external \
  --external react \
  --define 'process.env.NODE_ENV="production"' \
  --loader '.svg:file' \
  --drop console \
  --watch
```

### Supported Loaders

| Extension | Loader |
|-----------|--------|
| `.js` `.jsx` `.ts` `.tsx` `.mjs` `.cjs` `.mts` `.cts` | js/ts transpiler |
| `.json` `.jsonc` | JSON inline |
| `.toml` | TOML inline |
| `.yaml` `.yml` | YAML inline |
| `.txt` | text inline |
| `.html` | HTML processing |
| `.css` | CSS bundling |
| `.node` `.wasm` | asset (copy) |
| other | file (copy + path) |

### Bundler Plugins

```ts
import type { BunPlugin } from "bun";

const myPlugin: BunPlugin = {
  name: "my-plugin",
  setup(build) {
    // Filter imports by namespace and/or path regex
    build.onResolve({ filter: /\.yaml$/ }, (args) => {
      return { path: args.path, namespace: "yaml" };
    });

    build.onLoad({ filter: /.*/, namespace: "yaml" }, async (args) => {
      const text = await Bun.file(args.path).text();
      const data = parseYAML(text);
      return { contents: `export default ${JSON.stringify(data)}`, loader: "js" };
    });
  },
};

await Bun.build({
  entrypoints: ["./index.ts"],
  outdir: "./dist",
  plugins: [myPlugin],
});
```

---

## bun test — Test Runner

### Running Tests

```bash
bun test                          # run all tests
bun test ./src                    # specific directory
bun test --watch                  # watch mode
bun test --coverage               # code coverage
bun test --timeout 10000          # default timeout (ms)
bun test --bail                   # stop on first failure
bun test --bail=5                 # stop after 5 failures
bun test --only                   # only run test.only
bun test --todo                   # run test.todo and report passing ones
bun test --rerun-each 3           # rerun each file 3 times
bun test --retry 2                # retry failed tests
bun test --randomize              # random order
bun test --seed 12345             # reproducible random order
bun test --concurrent             # run tests concurrently within files
bun test --only-failures          # only show failed tests
bun test -t "pattern"             # filter by test name
```

### Test API (bun:test)

```ts
import {
  test, it,           // aliases
  describe,
  expect,
  beforeAll, afterAll,
  beforeEach, afterEach,
  mock, jest,         // mocking
  setSystemTime,      // fake timers
  expectTypeOf,       // type testing (TS only, no-op at runtime)
} from "bun:test";
```

### Test Modifiers

```ts
test("normal", () => {});
test.skip("skipped", () => {});
test.todo("planned", () => {});
test.only("exclusive", () => {});
test.failing("known bug", () => {});  // passes if test fails

// Conditional
test.if(condition)("runs if truthy", () => {});
test.skipIf(condition)("skips if truthy", () => {});
test.todoIf(condition)("todo if truthy", () => {});

// Parametrized
test.each([[1,2,3], [2,3,5]])("%i + %i = %i", (a, b, sum) => {
  expect(a + b).toBe(sum);
});
describe.each([...])("suite %s", (...args) => { test(...) });

// Options object (3rd argument)
test("with options", () => {}, { retry: 3 });
test("with options", () => {}, { repeats: 10 });  // runs 11 times
test("with timeout", () => {}, 500);               // ms
```

### Format Specifiers (test.each)

| Specifier | Description |
|-----------|-------------|
| `%p` | pretty-format |
| `%s` | String |
| `%d` | Number |
| `%i` | Integer |
| `%f` | Float |
| `%j` | JSON |
| `%o` | Object |
| `%#` | Test index |
| `%%` | Literal % |

### Matchers (expect)

**Equality:**
`.toBe()` `.toEqual()` `.toStrictEqual()` `.toBeNull()` `.toBeUndefined()` `.toBeDefined()`
`.toBeNaN()` `.toBeFalsy()` `.toBeTruthy()`

**Numbers:**
`.toBeCloseTo()` `.toBeGreaterThan()` `.toBeGreaterThanOrEqual()`
`.toBeLessThan()` `.toBeLessThanOrEqual()`

**Strings & Arrays:**
`.toContain()` `.toHaveLength()` `.toMatch()` `.toContainEqual()`

**Objects:**
`.toHaveProperty()` `.toMatchObject()`

**Functions:**
`.toThrow()` `.toBeInstanceOf()`

**Promises:**
`.resolves` `.rejects`

**Mocks:**
`.toHaveBeenCalled()` `.toHaveBeenCalledTimes()` `.toHaveBeenCalledWith()`
`.toHaveBeenLastCalledWith()` `.toHaveBeenNthCalledWith()`
`.toHaveReturned()` `.toHaveReturnedWith()` `.toHaveLastReturnedWith()`

**Snapshots:**
`.toMatchSnapshot()` `.toMatchInlineSnapshot()`
`.toThrowErrorMatchingSnapshot()` `.toThrowErrorMatchingInlineSnapshot()`

**Asymmetric:**
`expect.anything()` `expect.any(Constructor)` `expect.stringContaining()`
`expect.stringMatching()` `expect.arrayContaining()` `expect.objectContaining()`

**Assertion counting:**
`expect.assertions(n)` `expect.hasAssertions()`

**Negation:** `.not.` prefix on any matcher

### Mocking

```ts
import { mock, jest } from "bun:test";

// Mock function
const fn = mock(() => 42);
fn(1, 2);
expect(fn).toHaveBeenCalledWith(1, 2);
fn.mockReturnValue(99);
fn.mockImplementation(() => "new");
fn.mockReset();

// Mock module
mock.module("./math", () => ({
  add: mock(() => 0),
}));

// Spy
const spy = jest.spyOn(object, "method");

// Fake timers
jest.useFakeTimers();
jest.setSystemTime(new Date("2025-01-01"));
jest.advanceTimersByTime(1000);
jest.useRealTimers();
```

### Lifecycle Hooks

```ts
beforeAll(() => { /* once before all tests in describe */ });
afterAll(() => { /* once after all tests in describe */ });
beforeEach(() => { /* before each test */ });
afterEach(() => { /* after each test */ });
// All hooks support async
```

### Type Testing

```ts
import { expectTypeOf } from "bun:test";

// Run with: bunx tsc --noEmit (not bun test)
expectTypeOf<string>().toEqualTypeOf<string>();
expectTypeOf(123).toBeNumber();
expectTypeOf(fn).parameters.toEqualTypeOf<[string]>();
expectTypeOf(fn).returns.toEqualTypeOf<string>();
expectTypeOf([1,2]).items.toBeNumber();
expectTypeOf(Promise.resolve(42)).resolves.toBeNumber();
```
