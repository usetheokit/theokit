# ADR 0027 — Extract `validate-structure` from `core/` to keep `core/` free of `node:` builtins

**Status:** Accepted
**Date:** 2026-06-19
**Deciders:** project owner

## Context

The codebase-architecture audit (`architect-output/architecture-report.md`,
84/100 "Refactor Lightly") flagged that `packages/theo/src/core/validate-structure.ts`
imported `node:fs` (`existsSync`) and `node:path` (`join`). It was the ONLY
`node:` builtin importer under `core/`.

`.claude/rules/architecture.md` (the authoritative boundary contract) states two
relevant things:

- `core/` is the foundation; it **may import npm packages** (vite, react, zod).
- Prohibition: **"Node.js APIs only in adapter layer (use Web Standards in core)."**

So `node:fs`/`node:path` inside `core/` violated the project's own prohibition.
`validate-structure` is a CLI-time project-structure validator (checks `app/`,
`theo.config.ts`, `package.json` exist) consumed by `cli/commands/{build,dev,routes}`
and re-exported from the root barrel as the public `validateProjectStructure`.

## Decision

**Move `core/validate-structure.ts` → `config/validate-structure.ts`.**

- `config/` is the "shared / project-setup" module; `config → core` is an allowed
  edge, so the file keeps importing `TheoProjectError` from `../core/errors.js`.
- The root `index.ts` re-export path changes (`./core/...` → `./config/...`); the
  public symbol `validateProjectStructure` is unchanged, so all consumer tests
  (which import from `'theokit'`) stay green with zero edits.
- A new guard test `tests/unit/core-purity.test.ts` (`test_core_has_no_node_builtin_imports`)
  makes the prohibition enforceable: it scans `core/**/*.ts` and fails on any
  `from 'node:*'` import. It was RED before the move and GREEN after.

## Alternatives considered

1. **Leave it in `core/` (rejected).** Contradicts architecture.md's own
   prohibition and leaves the audit finding open. `core/` purity has real value:
   importers can assume the foundation is I/O-free.
2. **Move to a new `cli/`-level location (rejected).** `validateProjectStructure`
   is part of the public API (`theokit` root export). `cli/` is the entrypoint
   module (`I=1.00`, maximally unstable); hosting a public symbol there is worse
   than `config/`. `config/` already owns project setup (`load-config`, `schema`).
3. **Rewrite to Web-Standards FS (rejected).** There is no portable Web FS API
   for synchronous existence checks at CLI time; the node builtins are correct
   for this concern. The fix is *layer placement*, not API replacement.

## Consequences

- `core/` is now provably free of `node:` builtins, enforced in CI by the new
  guard test.
- `config/` gains one CLI-time helper; `config → core` edge unchanged (no new
  cycle; `pnpm check:deps` green).
- `architecture.md` module map updated: `core/` row notes node-builtin-free;
  `config/` row notes it hosts `validate-structure`.
- Behavior preserved — the move is `behavior_change: none`.
