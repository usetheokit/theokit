---
paths:
  - "packages/**/*.ts"
  - "packages/**/*.tsx"
---

# System Design Guardrails (INQUEBRAVEL)

Validated on EVERY interaction that touches `packages/`. These are not guidelines — they are constraints enforced by hooks and quality gates. Violating any produces a BLOCK.

## G1 — Dependency Direction (Zero Cycles, Ever)

```
core           → (nothing intra-monorepo)
config         → core, services
cache          → core
router         → core
client         → core
react-query    → client
adapters       → core, router, services
devtools       → core
services       → (nothing intra-monorepo)
server         → core, cache, config, devtools, services
vite-plugin    → core, router, server, config, devtools, services
cli            → core, vite-plugin, server, config, router, adapters, services
```

**Enforcement:** `boundary-check.sh` hook blocks imports that violate the DAG. `dependency-cruiser` CI validates zero cycles.

**Between packages:**
- `@theokit/http` does NOT import `@theokit/agents` (agents depends on http, not the reverse)
- `@theokit/agents` does NOT import `theokit` core framework (uses http only)
- `create-theokit` has ZERO runtime dependency on any `@theokit/*` package

## G2 — SDK is the ONLY Agent Runtime

No code in packages/ may:
1. Call LLM APIs directly (OpenRouter, OpenAI, Anthropic, Ollama) via `fetch()` or HTTP client
2. Reimplement tool calling loop (SDK already does this)
3. Reimplement session/conversation storage (SDK already does this)
4. Reimplement streaming of agent responses (SDK does this via `Run.stream()`)

**Enforcement:** `grep -rn "openrouter.ai\|api.openai.com\|api.anthropic.com" packages/ --include="*.ts"` MUST return ZERO results (excluding tests/mocks).

## G3 — Zod is the Single Source of Truth for Types

- Schema defined ONCE in Zod (`z.ZodType`, never deprecated `ZodTypeAny`)
- TypeScript types derived via `z.infer<typeof schema>`
- No manual `interface` that duplicates a Zod schema
- No `any` in production code (tests OK with moderation)
- No `@ts-ignore` or `@ts-expect-error` in production code
- No `as` type assertions unless narrowing from `unknown`

**Enforcement:** `system-design-gate.sh` hook checks on every Edit/Write.

## G4 — Tool Capability Must Be Explicit

Convention naming (Rails-style inference) applies to:
- `@Controller()` → route prefix from class name (HTTP routing, low risk)
- `@Agent()` → name + route from class name (agent routing, low risk)
- `@Toolbox()` → namespace from class name (namespace only, low risk)

Convention naming NEVER applies to:
- `@Tool()` → ALWAYS requires explicit `name`, `description`, `input` schema
- Tool capabilities are NEVER auto-inferred from method names

**Rule:** HTTP can be inferred. AI tool capability must be explicit.

## G5 — Shared Guards, Distinct Pipelines

HTTP and AI agents share ONLY `@UseGuards` at runtime. The following are metadata-only on agents and MUST emit warnings:
- `@UseInterceptors` → `THEO_AGENT_INTERCEPTOR_METADATA_ONLY`
- `@UseFilters` → `THEO_AGENT_FILTER_METADATA_ONLY`
- `@Budget` (top-level) → `THEO_AGENT_BUDGET_TOP_LEVEL_METADATA_ONLY`

Never claim "same pipeline" in docs or code comments. The correct framing: "shared guards/policies, distinct execution pipelines."

## G6 — File Size Budgets

| Scope | Limit | Action |
|---|---|---|
| Single file | 500 LoC (excl. blanks + comments) | WARN at 400, BLOCK at 500 — split |
| Single function | 50 LoC | WARN at 40, BLOCK at 50 — extract |
| Single package public API surface | 30 exports | WARN — use subpath exports |

Exceptions: generated files, test fixtures, type declaration files.

## G7 — Every Export Has a Consumer

- Every public export from a package barrel (`index.ts`) must have at least 1 production caller OR 1 test exercising it
- Dead exports are BLOCK findings in code-quality audit
- New exports require a corresponding test in the same PR

## G8 — Web Standards Over Node APIs

In `packages/http/src/` and `packages/agents/src/`:
- Use `Request`/`Response` (Web Standards) — never `req`/`res` (node:http)
- Use `fetch()` — never `axios` or `node:http`
- Use `crypto.randomUUID()` — never `Math.random()` for IDs
- Use `URL` constructor — never manual string parsing
- Node APIs only in adapters layer (`packages/theo/src/adapters/`)

## G9 — Test Quality Gates

- Every production file has a corresponding test (co-located or in `tests/`)
- Bug fixes include a regression test BEFORE the fix
- Tests use Arrange-Act-Assert pattern
- Test names describe behavior: `test_transfer_fails_when_balance_insufficient`
- No `console.log` in production paths — use structured warnings (`AgentWarningCode`)

## G10 — Honest Enforcement

If a decorator, flag, or config option doesn't actually enforce behavior:
1. Emit a warning with a stable code (`THEO_*`)
2. Document in the decorator support matrix
3. Never silently ignore — silence is the most dangerous form of tech debt

## Quality Gate Checklist (enforced pre-commit)

```bash
# All must pass before commit:
pnpm --filter @theokit/http test        # 329+ tests
pnpm --filter @theokit/agents test      # 237+ tests
npx eslint packages/ --max-warnings=0   # Zero lint errors
npx tsc --noEmit -p packages/http/tsconfig.json   # Zero type errors
npx tsc --noEmit -p packages/agents/tsconfig.json  # Zero type errors
```
