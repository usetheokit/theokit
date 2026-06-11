# @swc/core — Programmatic API Reference

## Installation

```bash
pnpm add -D @swc/core
```

## Transform Methods

### transform(code, options) → Promise<{ code, map }>

Asynchronous transformation of source code.

```js
const swc = require("@swc/core");

const { code, map } = await swc.transform(`
  const x: number = 1;
  export default x;
`, {
  filename: "input.ts",
  jsc: {
    parser: { syntax: "typescript" },
    target: "es2020",
  },
  module: { type: "commonjs" },
  sourceMaps: true,
});
```

### transformSync(code, options) → { code, map }

Synchronous version of `transform`.

```js
const { code, map } = swc.transformSync(source, options);
```

### transformFile(path, options) → Promise<{ code, map }>

Transform file from disk.

```js
const result = await swc.transformFile("./src/index.ts", {
  jsc: { parser: { syntax: "typescript" }, target: "es2020" },
});
```

### transformFileSync(path, options) → { code, map }

Synchronous version of `transformFile`.

## Parsing Methods

### parse(code, options) → Promise<Script | Module>

Parse source code into AST.

```js
const ast = await swc.parse(`const x = 1;`, {
  syntax: "ecmascript",  // "ecmascript" | "typescript" | "flow"
  comments: true,
  script: false,
  target: "es2020",
  isModule: true,
});
```

### parseSync(code, options) → Script | Module

### parseFile(path, options) → Promise<Script | Module>

### parseFileSync(path, options) → Script | Module

## Minification Methods

### minify(code, options) → Promise<{ code, map }>

```js
const { code, map } = await swc.minify(`
  const foo = "bar";
  function unused() { return 1; }
  console.log(foo);
`, {
  compress: {
    dead_code: true,
    unused: true,
    drop_console: false,
  },
  mangle: true,
  sourceMap: true,
});
```

### minifySync(code, options) → { code, map }

```js
const { code } = swc.minifySync(source, {
  compress: false,
  mangle: true,
});
```

## Minify Options (for standalone minify API)

| Option | Type | Description |
|--------|------|-------------|
| `compress` | bool/object | Compression options |
| `mangle` | bool/object | Mangling options |
| `ecma` | number | Target ECMAScript version |
| `keep_classnames` | boolean | Preserve class names |
| `keep_fnames` | boolean | Preserve function names |
| `module` | boolean | Enable module-level optimizations |
| `sourceMap` | boolean | Generate source map |

## Terser Drop-in Replacement

Use yarn resolutions to replace Terser with SWC:

```json
{
  "resolutions": {
    "terser": "npm:@swc/core"
  }
}
```

Then: `rm -rf node_modules yarn.lock && yarn`

## Transform Options Reference

All options accepted by `transform` / `transformSync` / `transformFile`:

| Option | Type | Description |
|--------|------|-------------|
| `filename` | string | Input filename (for source maps/errors) |
| `sourceMaps` | bool/string | `true`, `false`, `"inline"` |
| `sourceFileName` | string | Override source file name |
| `sourceRoot` | string | Root for source map paths |
| `isModule` | bool/string | `true`, `false`, `"unknown"` |
| `jsc` | object | Compiler options (see swcrc-reference.md) |
| `module` | object | Module output options |
| `minify` | boolean | Enable minification |
| `env` | object | Browserslist targeting |
| `inputSourceMap` | string | Input source map for chaining |

## CLI Programmatic API (swcDir)

```js
const { swcDir } = require("@swc/cli");

swcDir({
  cliOptions: {
    outDir: "./dist",
    watch: true,
    filenames: ["./src"],
    extensions: [".ts", ".tsx"],
    stripLeadingPaths: true,
  },
  swcOptions: {
    jsc: { target: "esnext", externalHelpers: true },
    module: { type: "commonjs" },
    sourceMaps: true,
  },
  callbacks: {
    onSuccess: (e) => console.log("Compiled:", e),
    onFail: (e) => console.error("Error:", e),
    onWatchReady: () => console.log("Watching..."),
  },
});
```

Note: When using callbacks, `--quiet` is automatically enabled.

## @swc/wasm-web (Browser)

```js
import initSwc, { transformSync } from "@swc/wasm-web";

// MUST initialize before any transform
await initSwc();

const { code } = transformSync(`const x: number = 1;`, {
  jsc: { parser: { syntax: "typescript" } }
});
```

Key: always `await initSwc()` before calling `transformSync`. Use `useEffect` + state flag in React.
