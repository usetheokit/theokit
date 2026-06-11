# Bun Configuration Reference — bunfig.toml, Environment, Package Manager

## bunfig.toml

Optional configuration file. Place in project root (local) or `$HOME/.bunfig.toml` (global).
Local overrides global. CLI flags override bunfig.

### Runtime

```toml
# Scripts to run before bun run (plugins, setup)
preload = ["./preload.ts"]

# JSX configuration (also configurable in tsconfig.json)
jsx = "react"                  # "react" | "react-jsx" | "react-jsxdev" | "preserve"
jsxFactory = "h"               # default: "React.createElement"
jsxFragment = "Fragment"       # default: "React.Fragment"
jsxImportSource = "react"      # for automatic runtime

# Reduce memory at cost of performance
smol = true

# Log level
logLevel = "debug"             # "debug" | "warn" | "error"

# Telemetry (crash reports)
telemetry = false

# Disable auto .env loading
env = false
# Or: [env] file = false

# Global defines
[define]
"process.env.bagel" = "'lox'"

# Custom file loaders
[loader]
".bagel" = "tsx"

# Console settings
[console]
depth = 3                      # console.log object depth (default 2)
```

### Serve

```toml
[serve]
port = 3000                    # default port for Bun.serve
```

### Test Runner

```toml
[test]
root = "./__tests__"           # test root directory
preload = ["./setup.ts"]       # test-specific preload
smol = true                    # reduce memory for tests
coverage = true                # enable coverage
coverageThreshold = 0.9        # or { line = 0.7, function = 0.8, statement = 0.9 }
coverageSkipTestFiles = false
coverageIgnoreSourcemaps = false
coveragePathIgnorePatterns = ["**/*.spec.ts", "src/utils/**"]
coverageReporter = ["text", "lcov"]
coverageDir = "coverage"
randomize = true               # random test order
seed = 2444615283              # reproducible random (requires randomize)
rerunEach = 3                  # rerun each file N times
retry = 3                      # retry failed tests
onlyFailures = true            # show only failed tests
pathIgnorePatterns = ["vendor/**", "fixtures/**"]
concurrentTestGlob = "**/concurrent-*.test.ts"

[test.reporter]
dots = true                    # compact dot output
junit = "test-results.xml"     # JUnit XML output
```

### bun run

```toml
[run]
shell = "bun"                  # "bun" | "system" (default: "bun" on Windows, "system" elsewhere)
bun = true                     # alias node → bun (auto-enabled if node not in $PATH)
silent = true                  # suppress "Running..." messages
elide-lines = 10               # truncate filtered output lines
noOrphans = true               # kill orphan processes on parent exit (Linux/macOS)
```

### Package Manager

```toml
[install]
optional = true                # install optional deps
dev = true                     # install devDeps
peer = true                    # install peerDeps
production = false             # production mode (no devDeps)
exact = false                  # exact versions in package.json
ignoreScripts = false          # skip lifecycle scripts
concurrentScripts = 16         # max concurrent lifecycle scripts
saveTextLockfile = true        # bun.lock (text) vs bun.lockb (binary)
frozenLockfile = false         # don't update lockfile (CI)
dryRun = false                 # simulate install
globalDir = "~/.bun/install/global"
globalBinDir = "~/.bun/bin"
logLevel = "warn"              # "debug" | "warn" | "error"
linker = "hoisted"             # "hoisted" | "isolated"
globalStore = false            # global virtual store for isolated linker
publicHoistPattern = ["*eslint*", "*prettier*"]
hoistPattern = ["*"]
minimumReleaseAge = 259200     # seconds (3 days) — filter new versions
minimumReleaseAgeExcludes = ["@types/bun"]

# Auto-install behavior
auto = "auto"                  # "auto" | "force" | "disable" | "fallback"

# Resolve preference
prefer = "online"              # "online" | "offline" | "latest"

# Registry
registry = "https://registry.npmjs.org"
# Or with auth:
# registry = { url = "https://registry.npmjs.org", token = "123456" }

# Scoped registries
[install.scopes]
myorg = { token = "$npm_token", url = "https://registry.myorg.com/" }

# CA certificates
[install]
ca = "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
cafile = "path/to/cafile"

# Cache settings
[install.cache]
dir = "~/.bun/install/cache"
disable = false
disableManifest = false

# Lockfile behavior
[install.lockfile]
save = true
print = "yarn"                 # generate yarn.lock alongside bun.lock

# Workspace linking
[install]
linkWorkspacePackages = true

# Security scanner
[install.security]
scanner = "@acme/bun-security-scanner"
```

---

## Environment Variables

### Auto-loaded .env files (in order of precedence)

1. `.env`
2. `.env.production` / `.env.development` / `.env.test` (based on `NODE_ENV`)
3. `.env.local`

### Features

- Variable expansion: `BAR=hello$FOO` → `BAR=helloworld`
- Escape expansion: `BAR=hello\$FOO` → literal `$FOO`
- Quotes: single `'`, double `"`, backtick `` ` ``
- Comments: `# comment`
- No need for `dotenv` package

### Access

```ts
process.env.FOO;        // standard
Bun.env.FOO;            // Bun alias
import.meta.env.FOO;    // Vite-compatible alias
```

### CLI Flags

```bash
bun --env-file=.env.custom index.ts      # specific file
bun --env-file=.env.a --env-file=.env.b  # multiple files
bun run --no-env-file index.ts           # disable auto-loading
```

### TypeScript Typing

```ts
declare module "bun" {
  interface Env {
    DATABASE_URL: string;
    API_KEY: string;
  }
}
```

### Bun-specific Environment Variables

| Variable | Description |
|----------|-------------|
| `BUN_PORT` | Default port for Bun.serve |
| `NODE_TLS_REJECT_UNAUTHORIZED=0` | Disable SSL validation |
| `BUN_CONFIG_VERBOSE_FETCH=curl` | Log fetch requests with curl format |
| `BUN_RUNTIME_TRANSPILER_CACHE_PATH` | Cache dir (empty/"0" to disable) |
| `BUN_CONFIG_MAX_HTTP_REQUESTS` | Max concurrent HTTP requests (default 256) |
| `BUN_CONFIG_NO_CLEAR_TERMINAL_ON_RELOAD` | Don't clear on --watch reload |
| `BUN_OPTIONS` | Prepend CLI args to all bun commands |
| `NO_COLOR=1` | Disable ANSI colors |
| `FORCE_COLOR=1` | Force ANSI colors |
| `DO_NOT_TRACK=1` | Disable crash reports/telemetry |
| `TMPDIR` | Temp directory for bundling |

---

## Package Manager CLI

```bash
# Install
bun install                      # all dependencies
bun install --frozen-lockfile    # CI (error if lockfile needs update)
bun install --production         # no devDependencies
bun install --prefer-offline     # use cache
bun install --prefer-latest      # latest versions
bun install --ignore-scripts     # skip lifecycle scripts

# Add/Remove
bun add react                    # dependency
bun add -d typescript            # devDependency
bun add -p @types/bun            # peerDependency
bun add --optional fsevents      # optionalDependency
bun add react@18                 # specific version
bun add react@latest             # latest
bun remove lodash
bun update                       # update all

# Global
bun add -g typescript
bun remove -g typescript

# Execute
bunx create-next-app@latest      # like npx
bun x cowsay hello               # alternative syntax

# Other
bun pm ls                        # list installed
bun pm cache                     # show cache info
bun pm cache rm                  # clear cache
bun pm hash                      # lockfile hash
bun pm hash-string               # lockfile hash as string
bun audit                        # security audit
```

### Lockfile

- `bun.lock` — human-readable text format (default since v1.2)
- `bun.lockb` — binary format (set `saveTextLockfile = false` for this)
- Both deterministic and reproducible

### Workspaces

```json
// package.json
{
  "workspaces": ["packages/*"]
}
```

Bun supports npm-compatible workspaces with:
- Automatic linking of workspace packages
- Hoisted and isolated linker strategies
- `bun install` at root installs all workspace deps
