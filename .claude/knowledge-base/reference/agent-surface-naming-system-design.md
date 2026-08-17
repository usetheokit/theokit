# Agent-surface naming & directory taxonomy — System Design decision

> Deep research (references + System Design literature + web) that settles the M2 naming question, so we don't repeat the near-miss of renaming `server/`. Cited from the M2 discovery/plan + ADR.

## The decision (LOCKED for M2)

1. **Agents live in a top-level `agents/*.ts`** — one file = one agent → generated endpoint + typed client hook. AI-first, gives agents their own home (no `server`).
2. **The backend directory stays `server/`** (and the public subpath exports stay `theokit/server/*`). Do NOT rename it.

```
meu-app/
  app/            # frontend (pages, file-based routing)
  agents/         # <- agents (M2): 1 file = 1 agent
  server/         # backend (routes, actions, ws, jobs, …) — unchanged
  theo.config.ts
```

## Why (evidence-backed)

- **Screaming Architecture caveat.** "Top level screams the domain, not the framework" targets **product apps**, not **horizontal frameworks**. TheoKit is a framework → its top-level compartments (frontend/backend/CLI) are legitimately technical roles. For a framework, **POLA (match known conventions) > by-domain purity.** (Clean Architecture ch.21; cleancoder.com)
- **The field converged; `server/` is the correct name for a *separated* backend.** Nuxt/Nitro use `server/` — and Nitro is TheoKit's closest analog (universal fetch-handler + Node/Bun/Deno/Workers adapters). `api/` means the **`/api` URL segment** (child of `server/`/`app/`), not the whole backend — promoting it to top-level **collides** with that meaning (POLA violation). `routes/` = the URL tree only. `backend/` is absent from first-tier TS frameworks (reads as a monorepo deployable split). (Nuxt v4 server dir; Nitro routing; SvelteKit routing; Next.js route handlers)
- **Renaming public subpath exports is BREAKING → major**, with real cost: 16 `theokit/server/*` exports + 144 files + 62 templates/docs + a codemod + a dual-alias window — for **negative** convention gain. The only safe path (if ever done) is dual-export alias → `@deprecated` → jscodeshift codemod (skip aliased imports) → remove in the next major, exactly like Next.js `middleware → proxy`. (semver.org; npm `exports`; Next.js codemods; types-react-codemod)
- **AI frameworks reserve `server/` for the HTTP layer and give agents their own dir.** Mastra = `src/mastra/{agents,tools,workflows}/` with a first-class **`agents/`**; the server is *config*, not a folder. That is the only convergent AI-framework directory convention — and it favors top-level `agents/`. (Mastra project structure)

## Consequence for the roadmap

- M2 = the `agents/*.ts` convention (Eixo B). Non-breaking, cohesive, AI-first.
- A `server/` → other-name rename is explicitly **rejected** (not deferred) — it would trade a convention-aligned name for a colliding one at breaking-major cost. Reopening requires a fresh ADR with evidence that overturns the POLA + cost analysis above.
