# TheoCode ↔ TheoKit — adoption audit, method changed

Date: 2026-08-15
Framework: theokit @ `e7c4d284` (workspace) · Baseline: TheoCode @ `7bfaadc` (`feat/adopt-theokit-next`)
Question: *does TheoCode use 100% of what TheoKit can help it with, without duplication?*

---

## Why the method changed

Every prior audit matched **exported symbol names**. That is blind to the largest category:
the framework doing the same thing under a different name. This pass used three lenses instead:

1. **Subpath consumption** — 17 of 20 subpaths consumed. The three unused (`./bridge`, `./testing`, `./usage`) are correctly unused: `./bridge` is internal compilation, `./testing` is test doubles, `./usage` is a *persistence* adapter for usage records while the product renders live run usage.
2. **Published surface vs imports** — 146 published symbols, 30 imported, **116 never used**. Swept for reimplementation; two candidates surfaced (`contextPressure`, `parseHookSpecs`) and both resolved as legitimate.
3. **Modules built alone** — every module ≥ 100 LoC ranked by framework imports. Two real gaps surfaced this way, both invisible to name matching.

## Second pass — the sweep had been run on one package

The "modules built alone" lens had only ever been applied to `packages/agent`. Re-run across the
whole repository, the name-collision count goes from **8 to 13**. The five it had never seen included
`routeCommand`, and that one carried a defect: the local router ended
`EXACT_COMMANDS.get(trimmed) ?? { kind: 'send' }`, so every mistyped slash went to the model as
prose and came back answered — a plausible reply to a command that never ran.

| Collision (new) | Verdict |
|---|---|
| `routeCommand` | **migrated** — the framework classifies command/prose/error; the product maps the verb |
| `loadCustomCommands` | duplication, 122 lines — closed in the framework (frontmatter + nested dirs), migration blocked on publish |
| `loadOrCreateSessionId` / `persistSessionId` | product guarantee — they never reject and queue writes per file, so a session pointer cannot take down the TUI |
| `installDiagnosticSink` | already delegates |

### The blueprint's four `needs-evidence` items, resolved

| Item | Answer |
|---|---|
| `pty/` — duplication or discoverability? | **Neither.** 84 lines that already import `@theokit/agents/{pty,interactive,sandbox}`. Composition. |
| `archiveSession` / `renameSession` / `compactSession` | One-line facades over `Agent.archive/rename/compact`. |
| `session/gc/all-sessions.ts` multi-project sweep | Product policy. Its enumeration is injected (`opts.listProjects()`) and is six lines of `readdirSync`; the only framework knowledge in it was the `projects` path segment, now `projectsRoot()`. |
| `composer-shortcuts.ts`, `lowlight` | Keybinding policy and syntax highlighting — the product's. |

## What was found, and closed in the framework

| Gap | Why it was ours | Status |
|---|---|---|
| A rules DIRECTORY could not be walked — `fileNames.includes(entry)` matches a basename, and a rules folder holds files the caller cannot name because the user names them. External evidence: `.claude/rules/` (34 files in this repo), `.cursor/rules/*.mdc`. Cost: the consumer wrote a 112-line walk. | `loadInstructionTree` takes a predicate now | `c70eadb1` |
| A declared-but-unreadable `paths:` returned `[]` — the same value as no scope at all. A consumer rendering it turns a rule written for one subtree into a rule applying **everywhere**, silently. | `InstructionBlock.scopesUnreadable` + warning | `e7c4d284` |
| `join(root, 'projects')` had three owners. The enumeration guards with `existsSync(root) ? readdir : []`, so a wrong segment returns EMPTY — the sweep finds nothing, deletes nothing, and reports success. | `projectsRoot(root?)` | `b30fe9f1` |
| `deleteSession` reported `registryRemoved: true` for an async remover (a Promise is truthy) before the removal happened. `Agent.delete` is async and is the only agent registry in the ecosystem. | refuses before unlinking | `b023cef8` |
| The agent could not ask the framework to delegate — 23 tool factories, none for a local sub-agent. | `createDelegateTool` | `ca70a9ca` |

## What was measured and deliberately NOT changed

| Item | Verdict |
|---|---|
| `context/rules.ts` | **Migration written, then reverted.** 157 → 98 lines, but four documented contracts changed at once: assembly order (the framework orders files-before-subdirectories on purpose — in an instruction *tree* the outer file states the rule and the inner refines it; a rules *folder* wants lexicographic), truncation semantics (walk ceiling vs prompt ceiling), warning wording, and YAML strictness. The migration also made `count` report 3 while the text carried 2. Four visible contract changes at once is the owner's decision, not a tidy-up. |
| `delegation/squad.ts` | `createDelegateTool` picks **one** sub-agent from a roster; this picks none and runs the **whole team sequentially**. Different shapes. Adopting would mean contorting the API to claim adoption. |
| `hooks/hooks.ts` `parseHooks` | Stays local, by a decision already documented in `build-handlers.ts`: `.theokit/hooks.json` uses Claude Code's PascalCase event names and the framework's schema is `.strict()` snake_case. Handing it a user's existing file would throw at boot. |
| `tui/formatting/context-pressure.ts` | Already consumes `DEFAULT_CONTEXT_PRESSURE_THRESHOLDS`; what remains is the warning **text** — product presentation. |
| `config/sandbox-policy.ts` | Different signature — `(mode)` vs `(mode, cwd)`. |
| `config/env-knobs.ts` | This product's env variable names. |
| `session/session-ops.ts` `listSessions` | Different question: the framework lists transcript files on disk; this lists the agent **registry** and returns `name`/`archived`, which do not exist on disk. |
| `randomUUID`, `execFileSync` | stdlib, used correctly (parsimony rungs 2–3). |

## Closing measurement

Name-collision count does not fall when a duplication is closed — a facade **keeps** the name. The
measurement that answers the question is how many of the 13 now delegate.

**9 of 13 delegate.** The four that do not, each for a reason that was measured rather than assumed:

| Symbol | Why it stays local |
|---|---|
| `listSessions` | Different question. The framework lists transcript FILES on disk; this lists the agent REGISTRY and returns `name`/`archived`, which do not exist on disk. |
| `loadOrCreateSessionId` / `persistSessionId` | Different store, and a stronger contract. The pointer is `<project>/.theokit/tui-session` — local to the working directory — while the framework's lives under the transcript root. On top of that these never reject and queue writes per file, so a session pointer cannot take down the TUI. |
| `sandboxWritePolicy` | Different signature — `(mode)` against `(mode, cwd)`. |

Everything else that was duplicated is a facade over the framework, or was closed in the framework so
it could become one.

## State of the promise

**Not closed.** Two gates, both outside engineering:

1. **PR [#312](https://github.com/usetheodev/theokit/pull/312) has no approving review.** `develop` requires one. A `--admin` force-merge was attempted and correctly refused — approving one's own PR defeats the gate rather than passing it.
2. **npm's stored token is stale, not missing** (`E401`). `~/.npmrc` carries an `_authToken` for
   `registry.npmjs.org` dated 2026-08-05; `npm whoami` rejects it. The fix is a re-login, not a new
   secret pasted into a conversation. `verify-publish-credential.mjs` refuses before the release rather than after, so no tag or CHANGELOG claims a version the registry never received.

TheoCode consumes the published package, so it cannot reach any of the five framework changes until
they ship. `feat/adopt-theokit-next` carries the `projectsRoot` adoption, verified against the local
framework build (session suite 39/39, typecheck clean), and says in its commit message that it waits
for the publish.

### To close it

```
1. approve + merge PR #312            (workspace → develop)
2. develop → main PR + semver tag
3. npm login && pnpm release          (5 changesets pending)
4. TheoCode: bump @theokit/agents, merge feat/adopt-theokit-next
5. decide on context/rules.ts         (the four contract deltas above)
```

## Gates at the time of writing

| Gate | Result |
|---|---|
| `pnpm typecheck` | green |
| `pnpm lint` | green across 9 groups |
| `pnpm check:deps` | 0 violations, 412 modules |
| `@theokit/agents` suite | 1328 passed, 3 skipped |
| TheoCode suite (against the local framework) | 532/533 — the one failure is `interactive-shell-tool.test.ts`, untouched by this work and green on the npm package, consistent with the temporary link changing `@theokit/sdk-tools` resolution |
| `pnpm knip` | fails — pre-existing `packages/http` config debt, verified identical without these changes |
