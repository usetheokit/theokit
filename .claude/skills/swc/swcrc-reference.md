# .swcrc Complete Configuration Reference

Schema: `https://swc.rs/schema.json`

## Top-Level Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `$schema` | string | — | JSON schema URL |
| `jsc` | object | — | JavaScript/TypeScript compiler options |
| `module` | object | — | Module output format |
| `minify` | boolean | `false` | Enable minification |
| `env` | object | — | Browserslist-based targeting (alternative to jsc.target) |
| `test` | string | — | Regex to match files (for array configs) |
| `exclude` | string/string[] | — | Regex patterns to exclude files |
| `isModule` | bool/string | `true` | `true`, `false`, or `"unknown"` (auto-detect) |
| `sourceMaps` | bool/string | `false` | `true`, `false`, or `"inline"` |
| `inlineSourcesContent` | boolean | `true` | Include file contents in source maps |

## jsc — JavaScript Compiler

### jsc.parser

**For ECMAScript (`syntax: "ecmascript"`):**

| Field | Default | Description |
|-------|---------|-------------|
| `syntax` | `"ecmascript"` | Parser mode |
| `jsx` | `false` | Enable JSX |
| `dynamicImport` | `false` | Enable `import()` |
| `privateMethod` | `false` | Private class methods |
| `functionBind` | `false` | `::` bind operator |
| `exportDefaultFrom` | `false` | `export v from 'mod'` |
| `exportNamespaceFrom` | `false` | `export * as ns from 'mod'` |
| `decorators` | `false` | Decorator syntax |
| `decoratorsBeforeExport` | `false` | `@dec export class` |
| `topLevelAwait` | `false` | Top-level await |
| `importMeta` | `false` | `import.meta` |

**For TypeScript (`syntax: "typescript"`):**

| Field | Default | Description |
|-------|---------|-------------|
| `syntax` | — | `"typescript"` |
| `tsx` | `false` | Enable TSX |
| `decorators` | `false` | Decorator syntax |

**For Flow (`syntax: "flow"`):**

| Field | Default | Description |
|-------|---------|-------------|
| `syntax` | — | `"flow"` |
| `jsx` | `false` | Enable JSX |
| `enums` | `false` | Flow enums |
| `components` | `false` | Component syntax |
| `patternMatching` | `false` | Pattern matching |

### jsc.target

Target output environment. Disables unnecessary transforms.

Values: `"es3"`, `"es5"`, `"es2015"` through `"es2024"`, `"esnext"`

### jsc.loose

Type: `boolean` (default: `false`)

Enables loose transformations (Babel-compatible). Assumptions:
- Private fields as properties
- Mutable class instances
- Constant super references
- Pure getters
- No symbol iteration
- Class methods as enumerable

### jsc.externalHelpers

Type: `boolean` (default: `false`)

Imports helpers from `@swc/helpers` instead of inlining. Reduces bundle size.
Requires: `pnpm add @swc/helpers`

### jsc.keepClassNames

Type: `boolean` (default: `false`)

Preserves original class names. Requires v1.2.50+ and target es2016+.

### jsc.baseUrl / jsc.paths

Path mapping for module resolution (mirrors tsconfig `baseUrl` and `paths`).

```json
{
  "jsc": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@components/*": ["src/components/*"]
    }
  }
}
```

### jsc.preserveAllComments

Type: `boolean` (default: `false`)

Maintains all comments during compilation.

### jsc.output.charset

Values: `"utf8"` (default) or `"ascii"`

### jsc.experimental

| Field | Description |
|-------|-------------|
| `plugins` | Array of `["@swc/plugin-name", { options }]` |
| `keepImportAttributes` | Preserve import attributes |
| `cacheRoot` | Plugin cache directory (default: `.swc`) |

---

## jsc.transform — Transform Options

### jsc.transform.react

| Field | Default | Description |
|-------|---------|-------------|
| `runtime` | `"classic"` | `"classic"`, `"automatic"`, or `"preserve"` |
| `importSource` | `"react"` | Package for automatic runtime |
| `pragma` | `"React.createElement"` | Function for classic runtime |
| `pragmaFrag` | `"React.Fragment"` | Fragment component |
| `development` | `false` | Adds `__self` and `__source` debug props |
| `useBuiltins` | `false` | Use `Object.assign()` instead of helpers |
| `refresh` | `false` | Enable react-refresh |
| `throwIfNamespace` | `true` | Error on XML namespace tags |

### jsc.transform.legacyDecorator

Type: `boolean` — Enable stage 1 decorators

### jsc.transform.decoratorMetadata

Type: `boolean` — TypeScript `emitDecoratorMetadata`

### jsc.transform.decoratorVersion

Values: `"2021-12"` (legacy), `"2022-03"`, `"2023-11"`

### jsc.transform.constModules

Inline constants from module imports:

```json
{
  "jsc": {
    "transform": {
      "constModules": {
        "globals": {
          "@ember/env-flags": { "DEBUG": "true" }
        }
      }
    }
  }
}
```

### jsc.transform.optimizer

| Field | Default | Description |
|-------|---------|-------------|
| `simplify` | `true` | Apply simplifications |
| `globals.vars` | — | Inline global variables |
| `globals.typeofs` | — | Inline typeof checks |
| `jsonify.minCost` | — | Convert object literals to JSON.parse() |

### jsc.transform.useDefineForClassFields

Type: `boolean`

`true` = uses `Object.defineProperty` for class fields
`false` = uses assignment

---

## jsc.minify — Minification Options

### jsc.minify.compress

Type: `boolean | object` — Enable compression.

Key compress options:

| Option | Default | Description |
|--------|---------|-------------|
| `dead_code` | `true` | Remove unreachable code |
| `drop_console` | `false` | Remove `console.*` calls |
| `drop_debugger` | `true` | Remove `debugger` statements |
| `unused` | `true` | Drop unreferenced vars/fns |
| `collapse_vars` | `true` | Collapse single-use variables |
| `comparisons` | `true` | Optimize comparisons |
| `conditionals` | `true` | Optimize conditionals |
| `evaluate` | `true` | Evaluate constant expressions |
| `if_return` | `true` | Optimize if/return sequences |
| `inline` | `true` | Inline single-use functions |
| `join_vars` | `true` | Join var declarations |
| `loops` | `true` | Optimize loops |
| `negate_iife` | `true` | Negate IIFEs for smaller output |
| `passes` | `1` | Number of compress passes |
| `pure_getters` | `false` | Assume getters have no side effects |
| `pure_funcs` | `[]` | Functions to treat as pure (e.g. `["console.log"]`) |
| `sequences` | `true` | Join consecutive statements with comma |
| `toplevel` | `false` | Compress top-level vars/fns |
| `top_retain` | `[]` | Top-level names to preserve |
| `global_defs` | `{}` | Global definitions to inline |
| `ecma` | `5` | Target ecma version |
| `keep_classnames` | `false` | Preserve class names |
| `keep_fargs` | `true` | Keep unused function args |
| `keep_infinity` | `false` | Keep `Infinity` (don't convert to `1/0`) |
| `hoist_funs` | `false` | Hoist function declarations |
| `hoist_props` | `true` | Hoist properties from objects |
| `hoist_vars` | `false` | Hoist var declarations |
| `side_effects` | `true` | Drop side-effect-free statements |
| `reduce_vars` | `true` | Reduce single-use vars |
| `reduce_funcs` | `true` | Reduce single-use functions |
| `switches` | `true` | De-duplicate/remove switch branches |
| `arrows` | `true` | Convert functions to arrows |
| `booleans` | `true` | Optimize boolean expressions |
| `defaults` | `true` | Apply default optimizations |
| `directives` | `true` | Remove redundant directives |
| `properties` | `true` | Rewrite property access (dot notation) |
| `typeofs` | `true` | Optimize typeof comparisons |
| `unsafe*` | `false` | Various unsafe optimizations |

### jsc.minify.mangle

Type: `boolean | object` — Enable name mangling.

| Option | Default | Description |
|--------|---------|-------------|
| `toplevel` | `true` | Mangle top-level names |
| `keep_classnames` | `false` | Preserve class names |
| `keepFnNames` | `false` | Preserve function names |
| `keep_private_props` | `false` | Preserve private properties |
| `reserved` | `[]` | Names to exclude |
| `safari10` | `false` | Safari 10 workaround |
| `props` | `false` | Enable property mangling |
| `props.reserved` | `[]` | Property names to preserve |
| `props.undeclared` | `false` | Mangle undeclared props |
| `props.regex` | — | Pattern for selective mangling |

### jsc.minify.format

| Option | Default | Description |
|--------|---------|-------------|
| `comments` | `"some"` | `false`, `"some"`, `"all"` |
| `asciiOnly` | `false` | Escape non-ASCII |
| `beautify` | `false` | Beautify output |
| `ecma` | `5` | Target ecma |
| `indentLevel` | — | Indentation level |
| `inlineScript` | — | Escape `</script>` |
| `preserveAnnotations` | — | Preserve `@__PURE__` etc |
| `safari10` | `false` | Safari 10 workaround |
| `semicolons` | `true` | Use semicolons |
| `preamble` | — | Prepend string to output |
| `wrapIife` | `false` | Wrap IIFEs |

---

## module — Module Configuration

### module.type

Values: `"es6"`, `"commonjs"`, `"amd"`, `"umd"`, `"systemjs"`

### Shared module options

| Field | Default | Description |
|-------|---------|-------------|
| `strict` | `false` | Don't export `__esModule` |
| `strictMode` | `true` | Emit `'use strict'` |
| `lazy` | `false` | Lazy initialization (`boolean` or `string[]` of sources) |
| `noInterop` | `false` | Disable interop helpers |
| `ignoreDynamic` | `false` | Preserve `import()` |
| `preserveImportMeta` | `false` | Keep `import.meta` |
| `importInterop` | `"swc"` | `"swc"`, `"babel"`, `"node"`, `"none"` |
| `resolveFully` | `false` | Fully resolve module paths |
| `outFileExtension` | `"js"` | Output extension for resolved paths |

### AMD-specific

| Field | Description |
|-------|-------------|
| `moduleId` | Named module ID |

### UMD-specific

| Field | Description |
|-------|-------------|
| `globals` | Object mapping module names to global variable names |

---

## env — Browserslist-based Targeting

Alternative to `jsc.target`. Uses browserslist for automatic polyfill and transform selection.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `targets` | string/object | `{}` | Browser query or version map |
| `path` | string | `.` | Directory for browserslist config |
| `mode` | string | — | `"usage"`, `"entry"`, or `undefined` |
| `coreJs` | string | — | core-js version (use minor: `"3.22"`) |
| `skip` | string[] | — | core-js modules to skip |
| `include` | string[] | — | Force-include transforms |
| `exclude` | string[] | — | Force-exclude transforms |
| `loose` | boolean | `false` | Loose transformations |
| `debug` | boolean | `false` | Debug output |
| `dynamicImport` | boolean | `false` | Dynamic import support |
| `shippedProposals` | boolean | `false` | Include shipped proposals |
| `forceAllTransforms` | boolean | `false` | Force all transforms |
| `bugfixes` | boolean | — | Enable bugfix transforms |

### Target formats

```json
// String query
{ "env": { "targets": "> 0.25%, not dead" } }

// Version map
{ "env": { "targets": { "chrome": "79", "firefox": "68", "safari": "13.1" } } }

// Array
{ "env": { "targets": ["Chrome >= 48", "Firefox >= 45"] } }
```

Supported environments: `chrome`, `opera`, `edge`, `firefox`, `safari`, `ie`, `ios`, `android`, `node`, `electron`.
