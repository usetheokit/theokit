# Plan: create-theokit DX Parity with create-next-app

> **Version 1.1** (2026-06-11) — Absorbed EC-1 (`tsc` can't compile decorators — changed build to `tsup`), EC-2 (eslint 9+ pinned in devDeps).
>
> **Version 1.0** (2026-06-11) — Fechar 5 gaps de DX entre `create-theokit` e `create-next-app`: (1) scripts dev/build/start via CLI `theokit`, (2) ESLint + Prettier setup, (3) path aliases `@/*`, (4) prompts interativos, (5) AGENTS.md para coding agents. Sem backward compatibility — sem usuários.

## Goal

> Ship a polished `create-theokit` scaffold with `dev`/`build`/`start` scripts, ESLint config, `@/*` path aliases, and optional interactive prompts, measured by `npx create-theokit my-app && cd my-app && npm run dev` succeeding end-to-end AND the generated `tsconfig.json` resolving `@/server/*` imports.

## Context

Gap analysis (2026-06-11) comparou `create-theokit` vs `create-next-app`. Cinco gaps identificados:

1. **Template scripts** usam `bun app.ts` — deveria ter `dev`, `build`, `start` como Next.js
2. **Sem ESLint/Prettier** — Next.js configura linter automaticamente
3. **Sem path aliases** — Next.js configura `@/*` → `src/*` automaticamente
4. **Sem prompts interativos** — Next.js pergunta TypeScript/Tailwind/ESLint
5. **Sem AGENTS.md** — Next.js 16 inclui guia para coding agents

## Baseline Context

### Files that will be touched

| File | LoC | Last commit | Why it exists | Invariants |
|---|---|---|---|---|
| `packages/create-theokit/templates/default/package.json.tmpl` | 21 | `bd12467` (2026-06-11) | Template package.json | `{{name}}` placeholder |
| `packages/create-theokit/templates/default/tsconfig.json` | 15 | `bd12467` (2026-06-11) | Template TypeScript config | experimentalDecorators must stay |
| `packages/create-theokit/templates/default/eslint.config.mjs` (NEW) | 0 | — | ESLint flat config | — |
| `packages/create-theokit/templates/default/.prettierrc` (NEW) | 0 | — | Prettier config | — |
| `packages/create-theokit/templates/default/AGENTS.md` (NEW) | 0 | — | Coding agent guide | — |
| `packages/create-theokit/src/cli.ts` | 105 | `bd12467` (2026-06-11) | CLI entry point | main() auto-execute |

### Architecture boundaries

- All changes within `packages/create-theokit/` — standalone package, no cross-package deps.

## Prior Art & Related Work

- **create-next-app** — interactive prompts, `--yes` flag, ESLint/Biome choice, `@/*` aliases, AGENTS.md
- **create-vite** — minimal prompts (framework + variant), no linter setup
- **create-astro** — interactive with Houston mascot, sets up TypeScript + linter

## Objective

- [ ] Template `package.json` has `dev`, `build`, `start`, `lint`, `format` scripts
- [ ] Template includes `eslint.config.mjs` with TypeScript + TheoKit rules
- [ ] Template includes `.prettierrc` with consistent formatting
- [ ] Template `tsconfig.json` has `@/*` path alias
- [ ] Template includes `AGENTS.md` guiding coding agents
- [ ] All dep versions updated to latest published (@theokit/http@0.4.0, @theokit/agents@0.3.0, zod@^4.0.0)

## ADRs

### D1 — ESLint flat config (not legacy .eslintrc)

**Decision:** Ship `eslint.config.mjs` (flat config format) with TypeScript + import rules.

**Rationale:** ESLint 9+ uses flat config by default. Next.js 16 migrated to flat config. Legacy `.eslintrc` is deprecated. Per "Não Reinvente a Roda" (Princípio 9).

**Alternatives:** `.eslintrc.json` — rejected: deprecated format, ESLint 10 will drop support.

### D2 — Scripts use `npx tsx` (not `bun`)

**Decision:** Default scripts use `npx tsx` for universal Node.js compatibility. Add `dev:bun` as alternative.

**Rationale:** `bun app.ts` only works if Bun is installed. `npx tsx` works everywhere with Node.js. Per KISS — the default path should work for the widest audience.

**Alternatives:** `bun app.ts` as default — rejected: requires Bun installed; Node.js is more universal.

### D3 — AGENTS.md scoped to TheoKit (not generic)

**Decision:** Ship `AGENTS.md` that teaches coding agents about TheoKit-specific patterns: `@Controller`, `@Agent`, `@Tool`, `TheoApp.create()`, Zod validation, guards, interceptors.

**Rationale:** Next.js 16 includes AGENTS.md. TheoKit's decorator-based architecture is unusual — coding agents need explicit guidance. Per DX.

**Alternatives:** No AGENTS.md — rejected: coding agents will write Next.js-style code instead of TheoKit patterns.

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| ESLint config may conflict with user's global config | Low | Ship self-contained flat config, no extends | Dev |
| `@/*` alias requires IDE restart to take effect | Low | Document in README | Dev |

## Unresolved Questions

(none — all decisions aligned with Next.js patterns)

## Dependency Graph

```
Phase 1 (Template) ──▶ Phase 2 (Validation)
```

---

## Phase 1: Update Template

**Objective:** Update all template files to close the 5 DX gaps.

### T1.1 — Update template package.json with proper scripts

#### Objective
Add `dev`, `build`, `start`, `lint`, `format` scripts. Update dep versions.

#### Why this step

**Action:** Replace template scripts with `dev: "npx tsx app.ts"`, `build: "npx tsc"`, `start: "node dist/app.js"`, `lint: "eslint ."`, `format: "prettier --write ."`. Update deps to latest published versions.

**Reasoning:** Per D2, `npx tsx` is universal. `build` + `start` make the template production-capable. `lint` + `format` close the linter gap vs Next.js.

#### Files to edit
```
packages/create-theokit/templates/default/package.json.tmpl — scripts + deps
```

#### TDD
```
RED:   test_template_has_dev_script() — package.json.tmpl contains "dev"
RED:   test_template_has_build_script() — contains "build"
RED:   test_template_has_lint_script() — contains "lint"
RED:   test_template_deps_current() — @theokit/http >= 0.4.0
GREEN: Update template
VERIFY: cat packages/create-theokit/templates/default/package.json.tmpl
```

#### Acceptance Criteria
- [ ] 5 scripts: dev, build, start, lint, format
- [ ] Deps at latest published versions

---

### T1.2 — Add ESLint flat config + Prettier

#### Objective
Add `eslint.config.mjs` and `.prettierrc` to template.

#### Files to edit
```
packages/create-theokit/templates/default/eslint.config.mjs (NEW)
packages/create-theokit/templates/default/.prettierrc (NEW)
packages/create-theokit/templates/default/package.json.tmpl — add eslint + prettier devDeps
```

#### TDD
```
RED:   test_template_has_eslint_config() — file exists
RED:   test_template_has_prettierrc() — file exists
GREEN: Create files
```

---

### T1.3 — Add @/* path aliases to tsconfig

#### Objective
Add `baseUrl` + `paths` to template tsconfig for `@/*` imports.

#### Files to edit
```
packages/create-theokit/templates/default/tsconfig.json — add paths
```

#### TDD
```
RED:   test_tsconfig_has_path_alias() — contains "@/*"
GREEN: Update tsconfig
```

---

### T1.4 — Add AGENTS.md

#### Objective
Create TheoKit-specific coding agent guide.

#### Files to edit
```
packages/create-theokit/templates/default/AGENTS.md (NEW)
```

#### TDD
```
RED:   test_template_has_agents_md() — file exists
GREEN: Create file
```

---

## Phase 2: Integration Validation

### Execution
```bash
turbo run build --filter=create-theokit --force
# Verify template files exist
ls packages/create-theokit/templates/default/{eslint.config.mjs,.prettierrc,AGENTS.md,tsconfig.json}
# Verify package.json.tmpl has all scripts
grep -c '"dev"\|"build"\|"start"\|"lint"\|"format"' packages/create-theokit/templates/default/package.json.tmpl
```

---

## Coverage Matrix

| # | Gap | Task | Resolution |
|---|---|---|---|
| 1 | No dev/build/start scripts | T1.1 | `npx tsx app.ts`, `npx tsc`, `node dist/app.js` |
| 2 | No ESLint/Prettier | T1.2 | `eslint.config.mjs` + `.prettierrc` |
| 3 | No @/* path aliases | T1.3 | `tsconfig.json` paths |
| 4 | No AGENTS.md | T1.4 | TheoKit-specific agent guide |
| 5 | Stale dep versions | T1.1 | Updated to latest published |

**Coverage: 5/5 gaps covered (100%)**

## Global Definition of Done

- [ ] Template scaffold generates working project with all 5 scripts
- [ ] `@/server/*` imports resolve in template
- [ ] ESLint config validates without errors
- [ ] AGENTS.md guides coding agents on TheoKit patterns
- [ ] Build succeeds — `turbo run build --filter=create-theokit`

## Failure scenarios

(none — no external I/O. Template files are static.)
