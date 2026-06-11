---
name: swc
description: >
  SWC (Speedy Web Compiler) expert. Use when configuring, troubleshooting, or migrating to SWC
  for JavaScript/TypeScript compilation, minification, bundling, Jest integration, webpack loader,
  plugin development, or migrating from Babel/tsc. Covers .swcrc, @swc/core, @swc/cli, @swc/jest,
  swc-loader, @swc/wasm, and Rust plugin authoring.
when_to_use: >
  User mentions SWC, .swcrc, swc-loader, @swc/core, @swc/cli, @swc/jest, @swc/wasm,
  spack, swcpack, migrating from Babel to SWC, migrating from tsc to SWC,
  SWC plugins, SWC minification, SWC compilation config
allowed-tools: Read Grep Glob Bash(npx swc *) Bash(npm *) Bash(pnpm *) Bash(yarn *) Bash(cargo *)
---

# SWC — Speedy Web Compiler — Complete Reference

You are an expert in SWC. Use the reference below to answer questions, generate configurations,
write code, debug issues, migrate from Babel/tsc, and build SWC plugins.

Always prefer the simplest configuration that solves the problem. Do not add options the user
did not ask for. When generating `.swcrc`, always include `"$schema": "https://swc.rs/schema.json"`.

For detailed API types and edge cases not covered here, consult:
- [swcrc-reference.md](swcrc-reference.md)
- [api-reference.md](api-reference.md)
- [plugin-guide.md](plugin-guide.md)
- [migration-guide.md](migration-guide.md)

---

## Quick Start

```bash
# Install
pnpm add -D @swc/cli @swc/core

# Transpile a file
npx swc ./file.js

# Transpile to output file
npx swc ./file.js -o output.js

# Transpile directory
npx swc ./src -d dist

# Watch mode (requires chokidar)
npx swc ./src -d dist -w
```

## Core Concepts

SWC is a Rust-based compiler that handles:
1. **Transpilation** — ES6+/TS/JSX/Flow to target JS (replaces Babel)
2. **Minification** — compress + mangle (replaces Terser)
3. **Bundling** — via spack (deprecated in v2, use Rspack/Turbopack/Parcel 2 instead)
4. **Plugin system** — Rust WASM plugins for custom transforms

SWC works **file-by-file** (like `isolatedModules: true`). It does NOT type-check.

## Configuration Hierarchy

1. `.swcrc` in project root (JSON, supports `$schema`)
2. CLI flags (`-C` overrides)
3. Programmatic options via `@swc/core` API
4. `swc-loader` options in webpack config
5. `@swc/jest` transform options in `jest.config.js`

---

## CLI Reference (@swc/cli)

| Flag | Purpose |
|------|---------|
| `-o, --out-file` | Output to single file |
| `-d, --out-dir` | Output directory |
| `-w, --watch` | Watch mode (needs chokidar) |
| `-s, --source-maps` | `true\|false\|inline\|both` |
| `-C, --config` | Override .swcrc (e.g. `-C module.type=amd`) |
| `--config-file` | Path to .swcrc |
| `--no-swcrc` | Skip .swcrc lookup |
| `--ignore` | Glob paths to exclude |
| `--only` | Glob paths to include |
| `-D, --copy-files` | Copy non-compilable files |
| `--extensions` | File extensions to process |
| `--out-file-extension` | Custom output extension (e.g. `.mjs`) |
| `--strip-leading-paths` | Remove leading dirs from output |
| `-q, --quiet` | Suppress output |
| `--sync` | Synchronous mode (debugging) |
| `-f, --filename` | Filename for stdin |
| `--env-name` | Environment (SWC_ENV > NODE_ENV > 'development') |
| `--source-map-target` | Source map file location |
| `--source-file-name` | Set sources[0] in source map |
| `--source-root` | Root for relative sources |
| `--include-dotfiles` | Include dotfiles when copying |
| `--log-watch-compilation` | Log watch recompilations |

---

## Integrations

### swc-loader (webpack)

```bash
pnpm i -D @swc/core swc-loader
```

```js
// webpack.config.js
module.exports = {
  module: {
    rules: [{
      test: /\.m?[jt]sx?$/,
      exclude: /node_modules/,
      use: {
        loader: "swc-loader",
        options: {
          // Same as .swcrc options
          jsc: { parser: { syntax: "typescript", tsx: true } },
          env: { targets: "defaults", debug: true }
        }
      }
    }]
  }
};
```

Notes:
- `jsc.transform.react.development` is auto-set based on webpack `mode`
- When chaining with `babel-loader`, set `parseMap: true`

### @swc/jest

```bash
pnpm i -D jest @swc/core @swc/jest
```

```js
// jest.config.js
module.exports = {
  transform: {
    "^.+\\.(t|j)sx?$": "@swc/jest",
  },
};
```

Custom options:

```js
module.exports = {
  transform: {
    "^.+\\.(t|j)sx?$": [
      "@swc/jest",
      {
        jsc: {
          target: "es2021",
          parser: { syntax: "typescript", decorators: true },
          transform: { legacyDecorator: true, decoratorMetadata: true }
        }
      }
    ],
  },
};
```

ESM support:
- JS: add `"type": "module"` to package.json
- TS: add `extensionsToTreatAsEsm: ['.ts', '.tsx']` + run with `NODE_OPTIONS=--experimental-vm-modules`

Default `jsc.target` per Node version: 12→es2018, 13→es2019, 14→es2020, 15-16→es2021, 17→es2022, 18+→es2023.

### @swc/wasm-web (browser)

```js
import initSwc, { transformSync } from "@swc/wasm-web";

// Must initialize before use
await initSwc();
const { code } = transformSync(source, { jsc: { parser: { syntax: "typescript" } } });
```

### @swc/core Node.js API

```js
const swc = require("@swc/core");

// Async transform
const { code, map } = await swc.transform(source, {
  filename: "input.ts",
  jsc: { parser: { syntax: "typescript" }, target: "es2020" },
  sourceMaps: true
});

// Sync transform
const result = swc.transformSync(source, options);

// File transform
const result = await swc.transformFile("./input.ts", options);

// Parse to AST
const ast = await swc.parse(source, { syntax: "typescript", tsx: true });

// Minify
const { code } = await swc.minify(source, { compress: true, mangle: true });
```

### Node.js API for CLI (swcDir)

```js
const { swcDir } = require("@swc/cli");

swcDir({
  cliOptions: {
    outDir: "./dist",
    watch: true,
    filenames: ["./src"],
    extensions: [".ts"],
    stripLeadingPaths: true,
  },
  swcOptions: {
    jsc: { target: "esnext", externalHelpers: true },
    module: { type: "commonjs" },
    sourceMaps: true,
  },
  callbacks: {
    onSuccess: (e) => console.log(e),
    onFail: (e) => console.error(e),
    onWatchReady: () => {},
  },
});
```

---

## Common .swcrc Patterns

### TypeScript + React (automatic runtime)

```json
{
  "$schema": "https://swc.rs/schema.json",
  "jsc": {
    "parser": { "syntax": "typescript", "tsx": true },
    "transform": {
      "react": { "runtime": "automatic" }
    },
    "target": "es2020"
  },
  "module": { "type": "es6" }
}
```

### TypeScript with decorators

```json
{
  "$schema": "https://swc.rs/schema.json",
  "jsc": {
    "parser": { "syntax": "typescript", "decorators": true },
    "transform": {
      "legacyDecorator": true,
      "decoratorMetadata": true
    },
    "target": "es2020"
  }
}
```

### CommonJS output with browserslist

```json
{
  "$schema": "https://swc.rs/schema.json",
  "env": {
    "targets": { "chrome": "79", "firefox": "68", "safari": "13.1" },
    "mode": "usage",
    "coreJs": "3.22"
  },
  "module": { "type": "commonjs" }
}
```

### Minification

```json
{
  "$schema": "https://swc.rs/schema.json",
  "minify": true,
  "jsc": {
    "minify": {
      "compress": { "dead_code": true, "drop_console": true, "unused": true },
      "mangle": true
    }
  }
}
```

### Flow syntax

```json
{
  "$schema": "https://swc.rs/schema.json",
  "jsc": {
    "parser": { "syntax": "flow" }
  }
}
```

### Multiple configs per file type

```json
[
  { "test": ".*\\.ts$", "jsc": { "parser": { "syntax": "typescript" } }, "module": { "type": "commonjs" } },
  { "test": ".*\\.jsx$", "jsc": { "parser": { "syntax": "ecmascript", "jsx": true } }, "module": { "type": "es6" } }
]
```

---

## Supported Binaries

| Platform | Package |
|----------|---------|
| macOS Apple Silicon | `@swc/core-darwin-arm64` |
| macOS x64 | `@swc/core-darwin-x64` |
| Linux x86_64 (glibc) | `@swc/core-linux-x64-gnu` |
| Linux x86_64 (musl/Alpine) | `@swc/core-linux-x64-musl` |
| Linux aarch64 | `@swc/core-linux-arm64-gnu` |
| Linux armv7 | `@swc/core-linux-arm-gnueabihf` |
| Windows x64 | `@swc/core-win32-x64-msvc` |
| Windows ia32 | `@swc/core-win32-ia32-msvc` |
| Android aarch64 | `@swc/core-android-arm64` |
