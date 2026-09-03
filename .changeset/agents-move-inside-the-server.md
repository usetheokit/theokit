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
