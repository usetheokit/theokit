---
'create-theokit': major
---

**Agents move inside the backend, and the scaffold's folders name their domains.**

A generated project put `app/`, `server/` and `agents/` side by side at the root, which said that
agents are a third thing next to the frontend and the backend. They are not: an agent reads secrets,
calls tools, holds the model key and runs where the server runs. Every rule that applies to
`server/` already applied to `agents/`, and the flat layout is what kept anyone from noticing.

A new project is now generated as:

```
src/
├── app/            # interface — the only half that ships to a browser
├── server/         # backend — everything that never leaves the machine
│   ├── agents/     # agent composition: prompts, tools, skills
│   └── routes/     # file-based HTTP
└── shared/         # the contracts both sides import
```

`theo.config.ts` declares all three paths (`.appDir('src/app')`, `.serverDir('src/server')`,
`.agentsDir('src/server/agents')`), so the layout is a value the project owns rather than a
convention the framework assumes.

**Existing projects are unaffected and need no migration.** The framework's defaults are unchanged —
a project that declares nothing still resolves `app/`, `server/` and `agents/` at the root. This is
major for `create-theokit` because a *newly generated* project has a different shape, not because
anything stopped working; the CLI already read every path from the config (`build`, `dev` and
`routes` pass `config.appDir` to the structure validator), which is what let the scaffold move
without a framework release.

Two things the move made visible, both of which argue it was overdue: the three cross-imports in the
bot preset got *shorter* (`../../server/delivery.js` → `../../delivery.js`), and the `tsconfig`
include lost an entry, because `src/server/**` now covers the agents that needed their own line.

Two options the move exposed as broken, both now fixed:

- **`--import-alias` pointed at directories that no longer exist.** A custom alias expanded to
  `./server/*` and `./app/*`, so a project generated with `--import-alias '~/*'` carried a tsconfig
  whose aliases resolve to nothing. The mapping moved to `alias-paths.ts` where it is tested against
  the directories the template actually ships, rather than living as three untested literals inside
  a function that writes to disk.
- **`--src-dir` is gone, and its prompt with it.** The generated project is always under `src/`, so
  the question changed nothing whichever way it was answered — and answering *yes* actively broke
  the project: it moved `theo.config.ts` into `src/`, where the CLI does not look for it, and
  overwrote `include` with `src/**` alone, dropping the two ambient `.d.ts` globs the template needs.

And two the generated app itself exposed, both of which made a fresh project fail its own
`format:check` on files the user never typed:

- **`README.md.tmpl` was never formatted.** The check that exists reads the template's `**/*.md`,
  and `.tmpl` does not match — but it becomes `README.md` in the user's project, where it *is*
  checked. Its tables had been unaligned since before this refactor.
- **The `--tailwind` stylesheet import used double quotes** against a template whose `.prettierrc`
  sets `singleQuote: true`, plus a stray blank line.

Both are now covered by tests over the OUTPUT rather than the template: one scaffolds a project and
runs Prettier against it with the config that project ships, the other hands the injected CSS line
straight to Prettier — it is written after `scaffold()` returns, so the first test cannot see it.
