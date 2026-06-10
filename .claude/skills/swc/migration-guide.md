# Migration Guides — Babel → SWC and tsc → SWC

## Migrating from Babel

SWC CLI is a **drop-in replacement** for Babel CLI:

```bash
# Before
npx babel src --out-dir dist

# After
npx swc src -d dist
```

### Feature Coverage

SWC supports:
- All **stage 3** ECMAScript proposals
- `preset-env` equivalent (via `env` config)
- Bugfix transforms

### Babel Config → .swcrc Mapping

| Babel | SWC |
|-------|-----|
| `@babel/preset-env` | `env: { targets: "..." }` |
| `@babel/preset-typescript` | `jsc.parser.syntax: "typescript"` |
| `@babel/preset-react` | `jsc.transform.react` |
| `@babel/preset-flow` | `jsc.parser.syntax: "flow"` |
| `@babel/plugin-transform-runtime` | `jsc.externalHelpers: true` + `@swc/helpers` |
| `@babel/plugin-proposal-decorators` | `jsc.parser.decorators: true` + `jsc.transform.legacyDecorator` |
| `@babel/plugin-proposal-class-properties` | Built-in (controlled by `jsc.transform.useDefineForClassFields`) |
| `@babel/plugin-transform-modules-commonjs` | `module.type: "commonjs"` |
| `@babel/plugin-transform-modules-amd` | `module.type: "amd"` |
| `@babel/plugin-transform-modules-umd` | `module.type: "umd"` |
| `@babel/plugin-transform-modules-systemjs` | `module.type: "systemjs"` |
| `targets` in babel config | `env.targets` in .swcrc |
| `useBuiltIns: "usage"` | `env.mode: "usage"` |
| `useBuiltIns: "entry"` | `env.mode: "entry"` |
| `corejs: 3` | `env.coreJs: "3.22"` |
| `loose: true` | `jsc.loose: true` or `env.loose: true` |

### Example: Full Babel → SWC Migration

**Before (babel.config.json):**
```json
{
  "presets": [
    ["@babel/preset-env", { "targets": "> 0.25%, not dead", "useBuiltIns": "usage", "corejs": 3 }],
    "@babel/preset-typescript",
    ["@babel/preset-react", { "runtime": "automatic" }]
  ],
  "plugins": [
    ["@babel/plugin-proposal-decorators", { "legacy": true }],
    "@babel/plugin-transform-runtime"
  ]
}
```

**After (.swcrc):**
```json
{
  "$schema": "https://swc.rs/schema.json",
  "jsc": {
    "parser": {
      "syntax": "typescript",
      "tsx": true,
      "decorators": true
    },
    "transform": {
      "legacyDecorator": true,
      "decoratorMetadata": true,
      "react": { "runtime": "automatic" }
    },
    "externalHelpers": true
  },
  "env": {
    "targets": "> 0.25%, not dead",
    "mode": "usage",
    "coreJs": "3.22"
  }
}
```

### What SWC Does NOT Support from Babel

- Custom Babel plugins (need SWC Rust WASM plugins instead)
- Some niche stage <3 proposals
- `@babel/register` (use `@swc-node/register` instead)

---

## Migrating from tsc

SWC **transpiles only** — it does NOT type-check. Continue using `tsc --noEmit` for type checking.

### Critical tsconfig.json Settings

Enable these in `tsconfig.json` for SWC compatibility:

#### 1. `isolatedModules: true`

**Required.** SWC works file-by-file (no cross-file type analysis).

Affected features:
- `const enum` — won't be inlined across files (use regular `enum` or string unions)
- `namespace` — may cause runtime issues
- Re-exports of types — must use `export type`

#### 2. `verbatimModuleSyntax: true` (TS 5.0+)

**Recommended.** Unified replacement for `isolatedModules`, `preserveValueImports`, and `importsNotUsedAsValues`. Forces explicit `import type` for type-only imports.

#### 3. `esModuleInterop: true`

**Recommended.** Aligns tsc import interop with SWC/Babel behavior.

#### 4. `useDefineForClassFields`

Controls `[[Define]]` vs `[[Set]]` semantics for class fields:
- Default: `true` for `target >= ES2022`, `false` otherwise
- **Critical for decorator users** — test carefully

### tsc Options → .swcrc Mapping

| tsconfig.json | .swcrc |
|---------------|--------|
| `"target": "es2020"` | `"jsc": { "target": "es2020" }` |
| `"module": "commonjs"` | `"module": { "type": "commonjs" }` |
| `"module": "esnext"` | `"module": { "type": "es6" }` |
| `"jsx": "react-jsx"` | `"jsc.transform.react.runtime": "automatic"` |
| `"jsx": "react"` | `"jsc.transform.react.runtime": "classic"` |
| `"jsx": "preserve"` | `"jsc.transform.react.runtime": "preserve"` |
| `"jsxImportSource": "preact"` | `"jsc.transform.react.importSource": "preact"` |
| `"experimentalDecorators": true` | `"jsc.parser.decorators": true` + `"jsc.transform.legacyDecorator": true` |
| `"emitDecoratorMetadata": true` | `"jsc.transform.decoratorMetadata": true` |
| `"baseUrl": "."` | `"jsc.baseUrl": "."` |
| `"paths": {...}` | `"jsc.paths": {...}` |
| `"useDefineForClassFields": false` | `"jsc.transform.useDefineForClassFields": false` |

### Example: tsc → SWC Migration

**tsconfig.json (keep for type-checking):**
```json
{
  "compilerOptions": {
    "target": "es2020",
    "module": "esnext",
    "jsx": "react-jsx",
    "strict": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "noEmit": true
  }
}
```

**.swcrc (for transpilation):**
```json
{
  "$schema": "https://swc.rs/schema.json",
  "jsc": {
    "parser": { "syntax": "typescript", "tsx": true },
    "transform": { "react": { "runtime": "automatic" } },
    "target": "es2020"
  },
  "module": { "type": "es6" }
}
```

**package.json scripts:**
```json
{
  "scripts": {
    "build": "swc src -d dist",
    "typecheck": "tsc --noEmit",
    "dev": "swc src -d dist -w"
  }
}
```

### Known Gotchas

1. **ES6 import hoisting** — SWC preserves ES module semantics more strictly than tsc. Code relying on tsc's non-standard import ordering may break.

2. **const enum** — Won't be inlined across files. Replace with:
   ```ts
   // Instead of: const enum Direction { Up, Down }
   // Use:
   enum Direction { Up, Down }
   // Or:
   const Direction = { Up: 0, Down: 1 } as const;
   ```

3. **Type-only imports** — Always use `import type` for types:
   ```ts
   import type { MyType } from './types';
   import { myFunction } from './utils';
   ```

4. **Namespace merging** — Avoid namespaces; use ES modules instead.

### Recommended Workflow

1. Enable `isolatedModules: true` (or `verbatimModuleSyntax: true`) in tsconfig
2. Fix all resulting TS errors (this ensures code is SWC-compatible)
3. Create `.swcrc` with equivalent settings
4. Replace `tsc` build with `swc` build
5. Keep `tsc --noEmit` in CI for type checking
6. Test thoroughly — especially decorator and class field behavior
