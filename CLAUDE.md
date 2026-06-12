# CLAUDE.md — TheoKit

Contract between Claude and the **TheoKit** sub-project. Read before touching anything under `theokit/`.

This file complements the [Theo monorepo CLAUDE.md](../CLAUDE.md). Cross-project rules still apply — this file adds TheoKit-specific layers and **does not** propagate to other sub-projects in the monorepo.

---

## How TheoKit connects to TheoCloud (read this BEFORE editing any seam code)

TheoKit (this repo) emits `.theokit/services.json` v2 — the **only** contract surface with the **TheoCloud commercial PaaS** (`theo-cloud/theo`). The two systems are deliberately decoupled per the `TheoCloud-first re-lock (2026-05-27)` invariant — neither imports the other; the artifact on disk is the seam.

**Canonical integration doc:** [`docs/architecture/theokit-theocloud-integration.md`](docs/architecture/theokit-theocloud-integration.md). It contains the end-to-end flow diagram, the wire-protocol contract, the typed-error cause chain, the services.json schema-version table, and the hardening invariants from Plan v1.2 (the 22 findings closed on the integration seam).

Claude MUST consult that doc BEFORE editing:

- `packages/theo/src/services/adapters-bridge/manifest.ts` (the v2 emit producer)
- `packages/theo/src/services/schema/schema.ts` (the Zod schema mirrored from TheoCloud's JSON Schema 7)
- `packages/theo/src/cli/commands/build.ts` (the `--target theo-cloud` adapter)
- `packages/theo/src/cli/commands/migrate/services-json.ts` (the v1 → v2 codemod)
- `packages/theo/src/config/schema.ts` `name` field (DNS-1123 validated, used as project identifier)
- any new code that touches `services.json`, the `--target theo-cloud` emit path, or the cross-product schema-version drift guard (`tests/unit/services-manifest-v2.test.ts` EC-7)

The doc is mirrored at `theo-cloud/theo/docs/architecture/theokit-theocloud-integration.md` — keep both copies in sync (edit one, copy the diff to the other in the same commit).

---

## What TheoKit is — and how we talk about it

TheoKit is the **app the agent lives in**. Technically, it is a Next.js-based framework for building full-stack AI agents in TypeScript. But that technical description is the answer to "what is it?" — not to "what do I get?". This `CLAUDE.md` enforces the gap between the two.

**Positioning, internal:**

- TheoKit treats the agent as a first-class citizen of the app, not as a plugin or add-on. Routes, auth, sessions, WebSockets, server actions, deploy targets — every primitive is shaped to make an agent shippable on a real domain, talking to real users.
- The narrative reference is the kind of personal-agent storytelling that drives projects like OpenCode (one developer, multiple agents, each with its own purpose, all running in production). TheoKit is the *framework* that turns that vision into a shippable app.
- The "Build the app your agent lives in" line is the HERO and the load-bearing piece of TheoKit copy. Everything in the README, future TheoKit docs, and TheoKit-specific launch material radiates outward from that promise.

**Positioning, public:**

- Use the Voice and Tone section below. Aspirational HERO, benefit-first BODY, technical DEEP DIVE.
- Mention sibling products (TheoCode, TheoCreate, the `theo` Go platform) only as context for the *family*, never as the lede. The TheoKit reader landed here because they want to build something. Give them that first. **Honesty rule:** do not list a sibling as a *capability* of TheoKit unless the code wiring exists in this repo. The Ecosystem section below states the literal wiring; copy that contradicts it is invalid.

---

## Voice and Tone

How we communicate publicly **about TheoKit**. The stack stays technical — the copy doesn't.

**Locked 2026-05-15.** Reference posture: aspirational, first-person, outcome-oriented public copy — the same posture that lets OpenCode-style projects reach a developer who is *imagining what they will build*, not yet evaluating a feature list. We adopt this posture for **TheoKit's public surfaces**. Internal docs, ADRs, this `CLAUDE.md`, and the "How it works" / "Architecture" sections of the README stay precise and technical. The stack, narrative, and product hierarchy do not change — only the words we use to introduce TheoKit.

### Communication layers

TheoKit public copy lives in three layers. Each layer has different permission for technical depth.

| Layer | Where it lives | Permission | Voice |
|---|---|---|---|
| **HERO** | TheoKit README h1+sub-h1, site sections about TheoKit, social posts naming TheoKit, demo intros, launch threads | **No jargon.** Promise an outcome the reader can picture. Speak to the reader's want, not to the feature. | Aspirational, first-person allowed ("I built…", "You ship…"), present tense. |
| **BODY** | README "What you get" / "Why TheoKit", short blog intros, comparison tables involving TheoKit | **Benefit-first, with one technical anchor per item.** Lead with what the developer accomplishes; close with the underlying capability. | Direct, second-person, short sentences. |
| **DEEP DIVE** | README "How it works" / "Architecture" / "Server Routes" / "Typed Client" / "Auth" / "WebSocket" / "CLI" sections, this `CLAUDE.md`, ADRs, internal docs, blog deep dives | **Full technical precision.** This is where `defineRoute`, `AES-256-GCM`, `defineWebSocket`, `theoFetch`, Vite, Zod, tsup and similar terms belong. | Editorial-technical, precise, no marketing varnish. |

If a piece of TheoKit copy is at the wrong layer, it is broken — even if every word is true.

### Vocabulary — public copy translation

Lead with the outcome. Anchor the technical term once in DEEP DIVE, then drop it everywhere else.

| Don't say (in HERO or BODY) | Say instead | Where the technical term goes |
|---|---|---|
| "Next.js framework for Full-Stack AI Agents" | "Build the app your agent lives in" | DEEP DIVE: "Built on Next.js with file-based routing and typed server actions" |
| "The opinionated TypeScript surface for building the app around your agent" | (Drop the framing. The HERO already says it.) | DEEP DIVE: TypeScript-first, batteries included, no plugin maze |
| "File-based routing, typed routes, encrypted sessions, WebSockets, server actions" | "Routing, auth, real-time, deploy — wired" | DEEP DIVE: full feature list belongs here, with API names |
| "`defineRoute` with Zod validation, automatic type inference" | "APIs that validate themselves" | DEEP DIVE: keep the `defineRoute` + Zod call-site example |
| "`defineAction` with CSRF protection" | "Server actions without plumbing" | DEEP DIVE: explain CSRF + the call-site example |
| "Encrypted sessions (AES-256-GCM), `requireAuth()` with type narrowing" | "Sessions that just work" | DEEP DIVE: AES-256-GCM and `requireAuth()` belong here |
| "`renderToPipeableStream` + `hydrateRoot`" | (Forbidden in HERO/BODY.) | DEEP DIVE only |
| "Built with Vite 6 / React 19 / Zod / tsup / Vitest" | (Drop from HERO/BODY. List in DEEP DIVE only.) | DEEP DIVE: keep the "Built With" table |
| "Multi-language framework with Python, Node, Go, .NET support" | "Your backend, your language. Ship the Python or Node service next to the app." | DEEP DIVE: `services: {}` in `theo.config.ts` orchestrates external processes via OpenAPI + proxy, Wave 1 supports Python (FastAPI) and Node (Hono/Fastify) |
| "Polyglot framework" / "Run any backend stack" | (Banned in HERO. Allowed in BODY only as "polyglot services" feature name.) | DEEP DIVE: explain the Like-Vercel runtime contract — fetch handler universal, file-system routing build-time, env runtime, structured logs, healthcheck convention |
| "Replaces TheoCreate" / "TheoKit + TheoCreate" | (TheoCreate is absorbed — say "scaffolding is in `create-theokit`".) | DEEP DIVE: `create-theokit my-app --backend python` generates TheoKit app + FastAPI service in one command |

### Storytelling rules (HERO and top of BODY)

HERO and the opening of BODY may use first-person storytelling about what the developer is building with TheoKit.

- **Show real usage of an agent app, not features of a framework.** "I have an agent that drafts my newsletter and a dashboard where I edit its drafts before it sends them" beats "supports multi-agent workflows." The TheoKit reader is imagining a product, not evaluating an SDK.
- **Use "I" and "you" freely.** "I shipped my agent's dashboard on Friday" or "You ship your agent's dashboard on Friday" — both land. Pick whichever reads better in context. Mixing across a page is fine; switching mid-sentence is not.
- **Present tense, active voice.** "TheoKit gives your agent a home." Not "TheoKit will give" or "TheoKit can give."
- **Outcomes are concrete.** "Live URL", "production traffic", "a real form that submits to a real handler", "a WebSocket that lasts past the demo" — not "blazing fast", "seamless", "robust", "opinionated".
- **Lead with the want, not the product.** Open with what the reader wants to do. "Ship an agent your friends can actually use" → TheoKit name comes second.

### Public-copy rules (apply on every TheoKit public surface)

1. **The HERO answers one question: "what do I get?"** Not "what is it?". Not "what features?". Just the outcome the reader is buying into.
2. **One technical anchor per benefit, max.** A BODY bullet says what the dev *does*, then optionally how. "WebSocket as a file (`server/ws/chat.ts`)" — outcome + anchor. Not "WebSocket endpoints via `defineWebSocket` with file-based routing under `server/ws/`".
3. **Banned in HERO and BODY:** `defineRoute`, `defineAction`, `defineWebSocket`, `theoFetch`, `requireAuth`, `createSessionManager`, `defineMiddleware`, `defineConfig`, `hydrateRoot`, `renderToPipeableStream`, AES-256-GCM, Drizzle ORM, Vite, Vitest, tsup, opinionated, monorepo. Each has a benefit-shaped equivalent — find it. (Vite, Drizzle, Vitest etc. are allowed in DEEP DIVE.) **Exception 2026-05-27:** `polyglot` is allowed in BODY/DEEP DIVE *only* in the phrase "polyglot services" (the formal feature name from Wave 2 mission). It remains banned in HERO and in any other framing.
4. **Banned everywhere (HERO, BODY, DEEP DIVE):** "blazing fast", "robust", "powerful", "seamless", "enterprise-grade", "next-generation", "industry-leading", "battle-tested" (unless followed by an actual battle), and "production-ready" without a Status section to back it.
5. **Numbers beat adjectives.** "4 templates" beats "multiple templates". "1 file = 1 WebSocket endpoint" beats "easy real-time setup". If you can't put a number on it, question whether the claim is real.
6. **Verify before publishing.** Every named feature must exist in the TheoKit README or CHANGELOG. The voice gets aspirational; the facts stay honest.
7. **HERO never names internals.** A reader on TheoKit's landing surface must not learn the word `defineRoute` before they learn what they will accomplish.

### Before / After — TheoKit examples

The conversions Phase 1 will apply across the TheoKit README and TheoKit's site section.

**README hero (h1 + sub-h1) — already applied**
- Before: *"Next.js framework for Full-Stack AI Agents. The opinionated TypeScript surface for building the app around your agent."*
- After: *"Build the app your agent lives in. Routing, auth, real-time, deploy — wired."*

**README "What You Get"**
- Before (sample): *"File-based routing — `app/page.tsx` → route. Layouts, loading, error, not-found."*
- After: *"Routes are just files — `app/page.tsx` → `/`. Layouts, errors, loading, not-found — no config file."*
- The pattern: outcome first, one concrete technical anchor, then a short qualifier. Each bullet should make the reader picture themselves *using* the thing.

**README "Project Structure" through "Imports"**
- Before: these sections sit immediately after "What You Get" without a layer break, so they read as features.
- After: insert a clear `## How it works` delimiter before "Project Structure". Everything from there down is DEEP DIVE and may use the full technical vocabulary, including `defineRoute`, `defineWebSocket`, `theoFetch`, etc.

**README "Built With" table**
- Stays as-is in DEEP DIVE. Vite, React 19, Zod, tsup, Vitest, Playwright are allowed here.

### How this section evolves

The **vocabulary table** and **before/after examples** are living — add new entries as new TheoKit copy lands or new patterns are discovered. The **communication layers**, **banned terms list**, and **storytelling rules** require an explicit strategic review (same gate as the monorepo Locked Narrative table). Do not weaken these to make a piece of marketing copy fit.

---

## Native bindings discipline

Some dependencies ship native binaries (currently: `better-sqlite3`). Each is compiled against a specific Node.js ABI (`NODE_MODULE_VERSION`). When the installed Node version differs from the ABI the binary was built against, every `require()` of that module throws `Module did not self-register` or `NODE_MODULE_VERSION X required, got Y`.

**How we prevent this:**

1. `engines.node = ">=22.12.0"` in every package.json — pnpm warns on mismatch (does NOT block).
2. `.nvmrc` (when present) pins the canonical Node version — `nvm use` switches.
3. `scripts/preflight-native-bindings.mjs` runs as vitest `globalSetup` (`tests/setup-native-bindings.ts`) — detects ABI mismatch + auto-rebuilds (one-shot, sentinel-cached at `node_modules/.cache/preflight-native-{abi}.ok`).
4. CI workflows ship an explicit `pnpm rebuild better-sqlite3 --workspace-root` step before tests (defense in depth).

**If you hit the error locally:**
- First: `nvm use` (or `nvm install` if you don't have the pinned version). 95% of cases.
- If you can't switch Node: `pnpm rebuild better-sqlite3` (or `--filter <pkg>`). The preflight does this automatically on first test run.
- If both fail: `node-gyp` prerequisites missing (python3, make, C++ compiler). Install build-essential / Xcode CLI tools.

**If you hit it in CI:**
- Check the workflow ran the rebuild step. If yes and it failed, the runner image lacks build prerequisites.
- `CI=true` is auto-set by GitHub Actions — preflight then fails fast (no auto-rebuild) so the explicit CI step's failure is what users see.

**Do not:**
- Pin a specific binary version — pnpm store deduplicates; use `pnpm rebuild`.
- Add fresh `try/catch` around `require('better-sqlite3')` to "handle" the failure — that masks the bug. Fix the root cause.

**Convention notes:**
- The preflight covers both theokit's own `node_modules/.pnpm/better-sqlite3@*/...` AND any binding loaded via a workspace-link symlink to a sibling repo (EC-1 — `findRebuildCwd` walks the realpath to route rebuild correctly). The `@theokit/sdk` workspace link in particular causes the SDK's better-sqlite3 to hardlink across both repos via pnpm store.
- `NATIVE_DEPS` in the preflight is hardcoded (`['better-sqlite3']`). When shipping a new native dep, add it to that array AND its `exerciseDep()` case so the probe actually triggers dlopen.

Plan: [`../.claude/knowledge-base/plans/dogfood-regressions-fix-plan.md`](../.claude/knowledge-base/plans/dogfood-regressions-fix-plan.md) v1.1.

---

## How this file relates to the monorepo

- Monorepo cross-project rules (Cross-Project Rules 1–10 in [`../CLAUDE.md`](../CLAUDE.md)) still apply inside `theokit/`. This file does not override them.
- The voice and tone defined here is **scoped to the TheoKit project tree**. Do not export these rules to other sub-projects without an explicit strategic review at the monorepo level.
- The Locked Narrative table in the monorepo `CLAUDE.md` is authoritative for cross-product positioning (headline, sub-headline, comparison stack). TheoKit copy must not contradict it; TheoKit copy may be more aspirational *within* the TheoKit-shaped slice of that narrative.

---

## Ecosystem — the five siblings, literally (one being absorbed)

TheoKit lives next to five sibling projects under `/home/paulo/Projetos/usetheo/`. This table is the **source of truth** for what TheoKit actually integrates with. Any README claim, comparison table, or pitch deck that contradicts this is wrong and must be corrected to match the code.

Three siblings flow **into** TheoKit (it consumes them). One sibling flows **out** of TheoKit (it consumes TheoKit's plugin SDK). One sibling is **being absorbed into** TheoKit (its scaffolding capabilities become part of `create-theokit`). The direction matters — see the "Direction" column.

| Sibling | Sibling repo | Kind | Direction | TheoKit consumes via / is consumed via | Code wiring | Status |
|---------|--------------|------|-----------|----------------------------------------|-------------|:------:|
| **`@theokit/sdk`** + `@theokit/gateway` + `@theokit/gateway-telegram` | `../theokit-sdk/` (TypeScript) | Agent runtime: `Agent.create/send/getOrCreate`, `Run.stream`, providers (OpenAI/Anthropic/Ollama/OpenRouter), conversation persistence (`.theokit/agents/<id>/messages.jsonl`), custom-tool runtime | **TheoKit ← sibling** (TheoKit consumes it) | **Workspace protocol (permanent link, assimetria intencional vs UI)** — `pnpm-workspace.yaml` includes `../theokit-sdk/packages/{sdk,gateway,gateway-telegram}`. Local edits in the sibling reflect immediately. Status quo justificado em ADR [0001 (theokit-sdk)](../../theokit-sdk/docs/adr/0001-workspace-link-default-status-quo.md): SDK é runtime de produção, perfil de acoplamento alto, iteração rápida é crítica. Contrasta com `@theokit/ui` (opt-in link via ADR [0020](docs/adr/0020-cross-repo-workspace-link-opt-in.md)). | 6 framework files: `server/agent/{create-conversation-history,stream-agent-run,agent-types}.ts`, `server/define/define-agent-tool.ts`, examples + templates `from '@theokit/sdk'`. | ✅ Wired |
| **`@theokit/ui`** | `../theo-ui/` (TypeScript) | React component library: chat surface (`ChatMessage`, `ChatThread`, `ChatComposer`, `ToolCallCard`), theme system (`ThemeProvider`, `ThemeScript`, `TheoUIProvider`), design tokens, 50+ generic components | **TheoKit ← sibling** (TheoKit consumes it) | **npm dep + optional peerDep** — published `@theokit/ui` (currently `^0.11.0-next.0`) consumed via the npm registry; declared como **optional `peerDependency`** em `packages/theo/package.json` (ADR [0018](docs/adr/0018-usetheo-ui-vite-plugin-contract-versionado.md)). `pnpm-workspace.yaml` does **NOT** include `../theo-ui/` por default — local edits no sibling NÃO refletem sem publish. **Opt-in** via `pnpm theo-ui:link` (ADR [0020](docs/adr/0020-cross-repo-workspace-link-opt-in.md)) — copia `pnpm-workspace.linked-ui.yaml` sobre o canonical e linka o sibling para HMR cross-repo. Pre-commit hook GATE 0 bloqueia commit-com-link (force `--no-verify` proibido). CI sempre usa canonical (preserva publish-and-bump path). | Framework auto-injects `<TheoUIProvider>` in SSR + client entries when the package is detected. **Contract test cross-repo** em `tests/integration/contract-usetheo-ui-vite-plugin.test.ts` (consumer) + `theo-ui/tests/contract/theokit-consumer.test.ts` (producer, gated por `prepublishOnly`). 13 files reference it: `vite-plugin/{inject-stylesheets,integrate-ui,theoui-detect,config-resolve,auto-detect,auto-detect-types,index}.ts`, `router/entry{,-server}.ts`, `config/schema.ts`, `cli/commands/{dev,upgrade-readiness}.ts`, `server/cost/track-agent-run.ts`. | ✅ Wired (npm + optional peer + opt-in link) |
| **`theo` → TheoCloud** (formerly "Theo PaaS") | `../theo/` (Go) | **The principal deploy target** — hosted product where TheoKit apps run in production. K8s operators (Crossplane-style), Helm charts, multi-tenant control plane, managed Postgres + Redis, secret rotation, audit log persistence, distributed rate-limiter store. Separate Go CLI named `theo`. | **TheoKit → sibling** (TheoKit deploys to it) | **Adapter shipped Wave 3 v2.0 (thin validator)** — `packages/theo/src/adapters/theo-cloud.ts` exists and `theokit build --target theo-cloud` exits 0. The OSS adapter is intentionally thin: it validates `.theokit/services.json` (existing zod gate), logs the services that will be deployed, and returns. **K8s manifest emission lives ENTIRELY inside TheoCloud (proprietary Go code)** upon receiving the upload — TheoKit OSS never emits K8s YAML. Rationale (architectural decision 2026-06-05): OSS framework MUST emit formats consumed by public/open systems OR neutral exchange formats; NÃO formats consumed by proprietary closed systems. Exposing K8s shape in OSS would leak TheoCloud-internal infrastructure choices. Architectural hooks still in place: `JobBackend` interface (ADR-0002), `UsageStorageAdapter` interface (R0.5.11 design), `RateLimitStorageAdapter` (security-hardening plan), structured logging to stdout. | TheoCloud-side issues #58, #59, #60 interlock with TheoKit's security primitives. Next: TheoCloud Go-side cutover plan (Phase B) consumes the uploaded services.json bundle and emits K8s internally. | ✅ **Primary target — thin OSS adapter shipped, K8s emission TheoCloud-internal** |
| **`theokit-plugins`** — first-party plugin registry | `../theokit-plugins/` (TypeScript) | Container repo for official Fastify-style plugins that consume TheoKit's `TheoPlugin` SDK (ADR-0008). Today: **1 package shipping** — `@theokit/plugin-cors` v0.1.0 (CORS middleware, peerDep `theokit >= 0.1.0-alpha.5`); **2 proposed** — `@theokit/plugin-sentry` (ADR-0012 there, ≤ 2 weeks after cors release) and `@theokit/plugin-i18n` (ADR-0013 there, ≤ 6 weeks after cors release). "Moderate roadmap" strategy per ADR-0011 D4 (in this repo). | **TheoKit → sibling** (sibling consumes TheoKit — direction INVERTED) | **Zero code wiring in framework core.** TheoKit does not import, dynamic-resolve, or auto-load anything from `theokit-plugins`. The sibling consumes TheoKit via npm `peerDependencies` + the `TheoPlugin { name, register(app) }` interface re-exported from `theokit/server`. Apps install plugins explicitly (`pnpm add @theokit/plugin-cors`) and pass them to `defineConfig({ plugins: [...] })`. | **Anchors live here, not there:** [ADR-0011](docs/adr/0011-moderate-plugin-roadmap-strategy.md) (strategy + temporal gates); [`docs/concepts/plugins.md`](docs/concepts/plugins.md) §7 (authoring guide); [`docs/adr/0008-theoplugin-is-the-canonical-sdk.md`](docs/adr/0008-theoplugin-is-the-canonical-sdk.md) (the SDK they consume). | 🌱 **Sibling — first plugin (`plugin-cors` v0.1.0) shipping 2026-Q3** |
| **`theo-stacks` → `create-theo`** (being absorbed into `create-theokit`) | `../theo-stacks/` (TypeScript) | Standalone polyglot scaffolder published as `create-theo` on npm. Today ships **19 templates in 7 languages** (Node · Go · Python · Rust · Java · Ruby · PHP — `node-express`, `node-fastify`, `node-nestjs`, `go-api`, `python-fastapi`, `rust-axum`, `java-spring`, `ruby-sinatra`, `php-slim`, `node-nextjs`, `fullstack-nextjs`, 7 monorepo-* variants, `node-worker`) with health probes, graceful shutdown, Dockerfile, CI per template. | **TheoKit ← (absorbing) sibling** | **Decision 2026-05-27 (ADR-0013 in this repo, to be drafted):** TheoCreate's scaffolding role is folded into `create-theokit`. Wave 1: TS templates already in `packages/create-theo/templates/`. Wave 2: import `python-fastapi` + `node-fastify` (or `node-hono`) templates, adapt to live next to TheoKit as `services/*/`. Other 5 languages deferred to future ADRs with demand evidence. Standalone `theo-stacks` repo + `create-theo` npm package go into deprecation. | Templates to absorb: `python-fastapi` (priority), `node-hono` (to be added — new, replaces `node-fastify`/`node-express` for fetch-handler shape). Existing TheoKit templates (default/dashboard/api-only/postgres/saas) gain a `--backend` flag that wires `services: {}` in `theo.config.ts`. | 🟡 **Being absorbed — Wave 2 milestone; standalone repo enters deprecation when absorption completes** |

### Rules that derive from this table

1. **TheoCloud (formerly Theo PaaS) IS the principal strategic target** — comparison tables, pitch decks, and roadmap items should reflect that. As of Wave 3 v2.0 (2026-06-05), the `theo-cloud` *deploy adapter* IS shipped as a **thin validator** — it bundles + uploads but does NOT emit K8s YAML. Honest framing: "TheoCloud is the principal deploy target; the OSS adapter validates and uploads; TheoCloud emits K8s manifests internally upon deploy." This split preserves TheoCloud's proprietary moat — OSS code never leaks K8s infrastructure shape (lesson learned: "OSS framework deve emitir formats consumidos por public/open systems OR neutral exchange formats; NÃO formats consumidos by proprietary closed systems"). A prior v1.x attempt to ship a K8s generator inside `packages/theo/src/services/generators/k8s-generator.ts` was deleted on 2026-06-05; this file MUST NOT resurrect.
2. **TheoCloud-shaped surfaces in framework code use neutral interfaces, not direct TheoCloud calls.** `JobBackend`, `UsageStorageAdapter`, `RateLimitStorageAdapter`, structured-logging-to-stdout — all designed so TheoCloud "slots in as a third backend" (per ADR-0002) without coupling the framework to a single platform. Same interface lets Postgres/Redis/SQS/Cloudflare Queues plug in.
3. **`@theokit/sdk` is the agent runtime — always.** The locked premise (`[[project-stack-deps]]` memory) stands: defaults, docs, examples wire `@theokit/sdk`. New agent primitives are *sugar over the SDK*, not parallel implementations.
4. **`@theokit/ui` is a published npm dep by default; workspace-link is OPT-IN** (ADR [0020](docs/adr/0020-cross-repo-workspace-link-opt-in.md)). Cross-repo PR flow para evoluir junto: **(a)** `pnpm theo-ui:link` no `theokit/` para iterar com HMR (auto-checks `../theo-ui/dist/vite-plugin.js`), **(b)** ship a mudança em `../theo-ui/` + roda contract test local (`pnpm test:contract`), **(c)** `pnpm theo-ui:unlink`, **(d)** publish `theo-ui` em `^0.X.Y-next.Z` (gated por `prepublishOnly`), **(e)** bump TheoKit consumer (`packages/theo/package.json:peerDependencies['@theokit/ui']`), **(f)** `pnpm install` + `pnpm sync:templates` para propagar aos templates. **NÃO** ativar o link cross-repo em CI/release (preserva publish-and-bump validation path). Tampouco adicionar `theo-ui/` ao `pnpm-workspace.yaml` canonical — isso destruiria o ciclo de release validado. Contract test cross-repo (consumer + producer) é o gate runtime; peerDep range é o gate install-time.
5. **TheoCloud is the only deploy target the team validates end-to-end.** A user cloning this repo and running `pnpm install && pnpm dev` does not need to clone the `theo` Go sibling — local dev works standalone. The 6 non-TheoCloud adapters (Vercel, Cloudflare Workers, AWS Lambda, Bun, Deno Deploy, Netlify, Static) and the Node adapter are kept **in-tree as opt-in compatibility surfaces** (per Wave 2 design: they reject `services: {}` non-empty and accept empty config for SPA-only deploys). Apps may use them at their own risk; the team does NOT validate them against real production environments. Marketing copy must not claim "8 adapters production-ready" — the honest framing is "TheoCloud is the principal deploy target; non-TheoCloud adapters are opt-in compatibility surfaces without team validation." Re-introducing team validation for any non-TheoCloud target requires a fresh ADR with demand evidence (3+ production apps explicitly blocked). See TheoCloud-first re-lock 2026-05-27 in the Roadmap section.
6. **Renaming "Theo PaaS" → "TheoCloud" in user-facing copy** — README, marketing surfaces, comparison tables, status banners. Internal ADRs and historical plans retain "Theo PaaS" with `(formerly)` annotation when re-edited — do not rewrite history that says "Theo PaaS" inside completed plans.
7. **`theokit-plugins` is a DOWNSTREAM sibling, not an upstream dependency.** The framework core ships zero coupling to it — no auto-load, no preset, no convention. Apps install individual plugins (`@theokit/plugin-cors` etc.) and wire them via `defineConfig({ plugins: [...] })`. The strategy that governs which plugins ship lives in TheoKit's ADR-0011, not in the sibling — because the gate (community demand) is observed from TheoKit core, where the `TheoPlugin` SDK lives. **Do not** add `theokit-plugins` to `pnpm-workspace.yaml` — the per-plugin `devDependency: "theokit": "link:../../../theokit/packages/theo"` is the local-dev link, by design.
8. **Plugin-shaped features ship in this repo (core) only if they pass ADR-0011 gates.** Otherwise they belong in `theokit-plugins` (first-party) or as community packages (`@<scope>/theokit-plugin-<name>`). A plugin proposal lands as a TheoKit-core ADR first (defining whether the surface deserves core OR plugin status), then the plugin author creates the package in `theokit-plugins/packages/`.
9. **`theo-stacks` / `create-theo` is being absorbed, not deleted in fragments.** All polyglot scaffolding becomes a flag on `create-theokit` (e.g., `create-theokit my-app --backend python`). The standalone `create-theo` npm package enters formal deprecation only after Wave 2 ships and the equivalent flags work end-to-end. **Do not** publish patches to `create-theo` in parallel — that creates two scaffold sources of truth. Bug fixes go straight into the absorbed templates inside `theokit/packages/create-theo/templates/`.
10. **Wave 2 backends are Python + Node ONLY.** The `theo-stacks` repo shipped 7 languages; absorbtion intentionally narrows to 2. Go/Rust/Java/Ruby/PHP scaffolding is **archived**, not migrated. Reopening any of those requires a fresh ADR with demand evidence (matches ADR-0011 gates: 1+ app in production using a community/draft template, 3+ requests, doesn't duplicate a core primitive, maintainable, tests + fixture).

### Future evolution of these relationships

Changes to the table above (e.g., upgrading `theo-ui` to a workspace link, shipping the `theo-cloud` adapter, deprecating `gateway-telegram`, adding a new sibling, promoting a `theokit-plugins` package into core) are **architectural decisions** — they require:
1. An ADR in `docs/adr/`
2. A migration plan in `docs/plans/`
3. An explicit update to this Ecosystem table

Inserting a new sibling in copy without doing the wiring is not allowed. **For TheoCloud specifically:** copy *may* state "TheoCloud is the principal deploy target" (truthful — it is the strategic target with pluggable-interface preparation already in place AND the Wave 3 v2.0 thin adapter shipped 2026-06-05) AND copy *may* state "deploys to TheoCloud" because `packages/theo/src/adapters/theo-cloud.ts` now exists, `theokit build --target theo-cloud` exits 0, and unit + integration invariant tests cover the thin-adapter contract. What copy *must not* claim is that TheoKit emits K8s manifests — that lives entirely inside TheoCloud (proprietary Go code) per the 2026-06-05 architectural split. **For `theokit-plugins` specifically:** copy *may* state "first-party plugin registry, 1 package shipping (`plugin-cors`)" and link the repo; copy *must not* claim TheoKit "auto-loads" plugins or "ships with built-in CORS/Sentry/i18n" — apps install and wire each plugin explicitly.

---

## Roadmap

> **Consolidated 2026-06-01.** Roadmap version-by-version + Macro Roadmap + 1.0 stability lock para o framework theokit moveram pro single source of truth em [`../CLAUDE.md`](../CLAUDE.md) (meta-repo). Sub-repo só mantém Voice/Tone + Native bindings + Ecosystem + Architectural decisions on record + Out of scope (tudo abaixo). Pra ver o que está em cada versão (0.2.0 ✅, 0.3.0 ⏸, 0.4.0 ⏳, 0.5.0 ⏳, 0.6.0 ⏳, 1.0) ou pra ver o Macro Roadmap "agent products on Like-Vercel runtime", consulte o meta CLAUDE.md.

Cross-product invariants (não-negociáveis para TheoKit também):

1. **Multi-runtime NUNCA embedded em TheoKit core** (absoluto). Polyglot services rodam como external processes, wired via proxy/manifest/typed client.
2. **`@theokit/sdk` é a agent runtime — sempre.** Defaults, docs, examples wiram `@theokit/sdk`. Sugar over the SDK, não parallel implementations.
3. **Wave 2 polyglot backends são Python + Node ONLY** (priority). Outros deferidos com ADR + demand evidence.
4. **TheoCloud é o único deploy target validado end-to-end.** Outros adapters = opt-in compatibility surfaces, NÃO promovidos.
5. **`server/` cobre end-to-end com TS-only.** Polyglot via `services: {}` é OPT-IN, não pré-requisito (documentação MUST NOT imply o contrário).

### Architectural decisions on record

Decisions that are not "out of scope" (we might still adopt) but are **explicitly DEFERRED with named re-evaluation triggers**, or are **IMPLEMENTED with a named approach that future PRs should not re-litigate without reading the prior research**. Every entry links to the artifact that supports the decision.

- **Devtools surface — IMPLEMENTED 2026-05-19 (commit `e369f4a`).** After full prior-art audit of TanStack Router devtools, Next.js `next-devtools/dev-overlay`, and Astro `dev-toolbar` (other frameworks — Remix, SvelteKit, Nitro, Hono, tRPC — verified to ship no devtools surface of their own).
  - **Decisions locked in:** (a) **React portal into Shadow DOM** — NOT pure custom elements (Astro pattern) and NOT non-shadow (TanStack default). (b) **Auto-inject via Vite plugin in dev** — NOT user-imported component (TanStack pattern leaks `NODE_ENV` assumption into user code). (c) **Vite HMR `import.meta.hot.send/.on`** as bridge — NOT custom WebSocket (free from Vite, dies cleanly in prod). (d) **localStorage persistence with schema-version key** — server-endpoint persistence (Next.js pattern) is overkill for v0. (e) **goober** (~1KB) for shadow-DOM-scoped CSS — Tailwind doesn't pierce shadow roots. (f) **Tree-shake via TanStack-style dual export** — `Devtools` (noop in prod) + `DevtoolsInProd` (always real); bundler-agnostic, no Vite magic required. (g) **CSS custom properties scoped to `:host`** for theme switching — NOT scoped to a descendant selector, because `createPortal(children, shadowRoot)` mounts components as siblings of the React root div, not descendants (subtle Shadow DOM detail — see `Overlay.tsx` `ThemeVars` comment).
  - **Do NOT re-implement as web components, even if extensibility pressure arrives.** Astro's plugin-app architecture is mature only because Astro has community apps consuming it. TheoKit has zero community asks. v1 plugin extension via `definePlugin`-style hooks is on the runway; rewriting to web components is a regression for our React-first surface.
  - **Artifact:** [`.claude/knowledge-base/reference/devtools.md`](.claude/knowledge-base/reference/devtools.md) — 1163-line deep dive (TanStack/Next.js/Astro file:line citations, 29 edge cases, 7 convergent patterns, 7 divergent patterns with TheoKit choices). [`docs/plans/devtools-plan.md`](docs/plans/devtools-plan.md) — 1860-line execution plan, 10 ADRs, 13 tasks, edge-case-plan reviewed. Anyone wanting to re-open these decisions reads both docs first.

- **Server Components (RSC) — DEFERRED past 1.0.** Decision recorded 2026-05-19 after a full prior-art audit of Next.js (canonical), Astro (server islands), TanStack Start (RSC opt-in via `@vitejs/plugin-rsc`), and SvelteKit (no equivalent).
  - **Decision:** TheoKit stays **client-by-default**, aligned with TanStack Start's posture. Not Next.js's server-by-default posture.
  - **Why now:** TheoKit's current bundle (193.90 KB gzipped, 45% under the 350 KB target) does not benefit from RSC's primary value proposition. Streaming SSR (Phase 3, `renderToPipeableStream` + `onShellReady`) already covers the Suspense-streaming use case. `defineRoute` + `theoFetch` already cover server-only data fetching with type safety. The RSC cost (1263 LOC just for the boundary plugin in Next.js, tight coupling to a moving `react-server-dom-webpack` target, TS can't structurally check directives so falls back to name heuristics) does not pay back for an agent-shaped app.
  - **Re-evaluation triggers (all three required to revisit):**
    1. `@vitejs/plugin-rsc` reaches v1 with public maintenance plan
    2. Remix / React Router 7's RSC integration ships and is observable in production
    3. Concrete user demand from shipped TheoKit apps with measured pain — bundle size or server-only data fetching as a binding constraint
  - **If we do adopt later:** via `@vitejs/plugin-rsc` as an opt-in flag (TanStack pattern), NOT by re-implementing webpack-style flight plugins.
  - **Artifact:** [`.claude/knowledge-base/reference/server-components-rsc.md`](.claude/knowledge-base/reference/server-components-rsc.md) — 704-line deep dive, 12 sections, file:line citations for every assertion. Anyone wanting to re-open this decision reads that doc first.

- **AUTH-DELEGATION — LOCKED 2026-05-19 (security-hardening release).** After a prior-art audit of 8 frameworks (Next.js, SvelteKit, Remix, Astro, TanStack Start, Nuxt, Nitro, Hono).
  - **Decision:** TheoKit ships **5 RFC-stable protocol primitives** (`generatePkceChallenge` / `generateOAuthState` + `verifyOAuthState` / `discoverOidcProvider` / `generateTotp` + `verifyTotp` / `generateBackupCodes` + `verifyBackupCode`) PLUS session primitives (`createSessionManager`, `requireAuth`, `rotateSession`) PLUS a recommendation page (`docs/concepts/auth-providers.md`). TheoKit does **NOT** ship concrete provider implementations (Google, GitHub, Facebook, etc.) — those are delegated to specialist libraries (Auth.js, Better Auth, Lucia, Iron Session, hosted IdPs like Clerk/Auth0/WorkOS).
  - **Why:** OAuth providers have constant deltas (scope changes, endpoint moves, breaking flow updates). Specialist libs maintain them; TheoKit's single-maintainer constraint cannot keep up. Standards-level primitives (RFC 6749 / 7636 / 6238 / OIDC Discovery 1.0) don't churn. 6 of 8 surveyed frameworks delegate; only Remix 3 outliers by bundling 9 providers — explicitly contraindicated for single-maintainer scope (§4.1 / §4.4 / §5.1 of the reference doc).
  - **Re-evaluation triggers (all three required to reopen):**
    1. TheoKit reaches a team of 3+ engineers committed to long-term framework maintenance
    2. Concrete user demand from shipped TheoKit apps with measured pain — "I tried Auth.js and couldn't make it work" reports >5 per month
    3. A specialist auth lib (Auth.js / Better Auth) breaks compatibility with TheoKit's session primitives without an actively maintained fix
  - **If we do adopt later:** ship providers as separate optional packages under `@theokit/auth-*`, NEVER in the framework core. Each package owns its provider's deltas and ships independently.
  - **Artifact:** [`.claude/knowledge-base/reference/oauth-oidc-delegation.md`](.claude/knowledge-base/reference/oauth-oidc-delegation.md) — 793-line deep dive, 8-framework audit, 5 protocol primitives with sample code, delegation strategy. Anyone wanting to re-open this decision reads that doc first. Recommended libs (in priority order): **Auth.js** (NextAuth, multi-provider workhorse), **Better Auth** (modern TypeScript-first DX), Lucia, Iron Session.

### Out of scope — intentionally

Items considered and rejected. **Do not move these into a milestone without a strategic review.**

- **Replacing Next.js for everyone.** TheoKit is a vertical framework for agent-shaped apps. The framing in the monorepo Locked Narrative ("the app the agent lives in") is the wedge. Trying to be a horizontal Next replacement dilutes the wedge.
- **A11y / i18n primitives baked into the framework.** Both are real, both are hard, both are well-served by external libraries. TheoUI handles a11y for its components; i18n is the consumer's choice.
- **CSS-in-JS runtime.** TheoUI uses Tailwind; the consumer can adopt any CSS strategy on top. No runtime CSS in the framework core.
- **Built-in agent orchestration.** TheoKit ships the *home* for an agent, not the agent itself. `examples/agent-saas` and the default template show how to wire an agent — they're patterns, not framework primitives. Agent orchestration belongs upstream in TheoKit-SDK / Mastra / Vercel AI SDK.
- **Re-implementing RSC in-house.** Even if we adopt RSC eventually (see "Architectural decisions on record" above), we will integrate `@vitejs/plugin-rsc` rather than maintain a webpack-style flight plugin. The Next.js implementation is 1263 LOC for boundary detection alone — that's framework lock-in to Vercel's bundler choices, not an asset.

### How this roadmap stays honest

- **Every item references a verifiable artifact** — a plan file, a fixture, a CHANGELOG entry, an issue, or a number. Aspirational items without an artifact go in 0.5.0+ "no commitment" tier.
- **Moving an item upward requires evidence.** "Validate Vercel adapter" stays in 0.4.0 until somebody runs `theokit deploy --target vercel` against a real Vercel project and the result is committed (smoke log or e2e spec). Until then it's a promise, not a feature.
- **Marketing copy must trail the roadmap, not lead it.** The Voice and Tone section forbids "production-ready" without a Status section to back it. The Status section in the README points at this roadmap.

---

## Pipeline de ciclos (plan ecosystem)

Configurado em `.claude/` via `bash scripts/install.sh` do template [`plan`](file:///home/paulo/Projetos/plan), em modo **adição-only**: o framework custom do TheoKit (58 skills, 4 rules, 4 hooks, agents/, worktrees/) permanece **intacto**; o plan ecosystem foi sobreposto adicionando componentes novos sem destruir nada. Backups locais (gitignored via `*.bak`):

- `CLAUDE.md.bak` — versão 266 linhas pré-merge
- `.claude/settings.json.bak` — versão pré-extensão (3 hooks, agora 6)

**O que foi adicionado** (sem sobrescrever o existente):

- **21 skills do plan**: `ast-grep`, `auto-plan`, `code-quality`, `deck`, `deps-audit`, `discover-{plan,plan-confidence,edge-cases,execute,confidence,improve}` (6), `generated`, `grill-me`, `implement`, `marp-slide`, `plan-confidence`, `plan-improve`, `release`, `skill-{register,validator,writer}`. As 58 skills SDK (`server-actions-architect`, `vite-integration-engineer`, `runtime-adapter-strategist`, `dx-error-message-specialist`, etc.) coexistem.
- **28 rules do plan**: `cycle-*.md` (8), `*-golden-rule.md`, `*-thresholds.txt`, `*-allowlist.txt`, `audit-trail-rotation.md`, `loop-engine-convention.md`, `public-copy.md`, `review-model-routing.txt`. As 5 rules SDK (`architecture.md`, `backend.md`, `frontend.md`, `testing.md`, `type-safety.md`) coexistem.
- **4 hooks do plan**: `sessionstart-context.sh`, `userpromptsubmit-inject.sh`, `public-copy-lint.sh`, `precompact-preserve.sh`. Os 4 hooks SDK (`validate-command.sh`, `boundary-check.sh`, `post-edit-check.sh`, `stop-validation.sh`) **permanecem na versão custom do TheoKit** (não foram sobrescritos pelos do plan, que têm conteúdo diferente).
- **`scripts/`** (install.sh, check_xrefs.py, test_e2e_smoke.py, session-catchup.py, attest-plan.sh, statusline.sh), **`commands/`** (plan-attest, plan-goal, plan-loop), **`plugin.json`**, **`HOW-TO-USE.md`**, **`.active_plan.example`**.
- **knowledge-base/** estendido com subdirs estruturais faltantes (plans, implementations, audits, adrs, grills, dogfood/evidence, judge-codex, discoveries/{plans,blueprints,snapshots}, progress, tools, references). Os existentes `reference/` e `reviews/` permanecem.

**`.claude/settings.json` estendido** (não substituído):

- Adicionado `statusLine` apontando para `scripts/statusline.sh`.
- Adicionados eventos `SessionStart` (injeta git state + active plan) e `UserPromptSubmit` (injeta active plan excerpt).
- Adicionado `PreCompact` (snapshot do plano antes de compactar contexto).
- Adicionado `public-copy-lint.sh` ao `PostToolUse` existente.
- Adicionadas deny entries para `.claude/knowledge-base/{references,tools}/**` (read-only zones).
- **Preservados**: permissões SDK (npm/pnpm/vitest/playwright/tsc/eslint/prettier), todos os hooks SDK no wireup original.

**Comandos disponíveis (TheoKit custom + plan):**

- **TheoKit custom** (preserva): `/server-actions-architect`, `/vite-integration-engineer`, `/runtime-adapter-strategist`, `/dx-error-message-specialist`, `/zod-contract-specialist`, `/framework-api-reviewer`, `/dogfood`, `/dogfood-npm`, `/edge-case-plan`, `/to-plan`, `/to-reference`, `/to-research`, `/review`, `/changelog`, `/build`, `/dev`, `/test`, `/meeting`, ... (58 skills)
- **Plan (adicionado)**: `/grill-me`, `/auto-plan`, `/deps-audit`, `/code-quality`, `/plan-confidence`, `/plan-improve`, `/implement`, `/release`, `/discover-{plan,plan-confidence,edge-cases,execute,confidence,improve}`, `/skill-{register,validator,writer}`, `/ast-grep`, `/deck`, `/marp-slide`

**Conflitos de nomenclatura preservados na versão TheoKit** (skill SDK vence):

- `dogfood` (TheoKit 548 linhas vs plan 98) — TheoKit version permanece. Plan version disponível ao consultar `.claude.bak` se houver futuro merge.
- `to-plan` (TheoKit 267 vs plan 153), `edge-case-plan` (TheoKit vs plan), `review`, `to-reference`, `excalidraw` — TheoKit versions permanecem.

**Hooks SDK preservados (conteúdo diferente do plan):**

- `boundary-check.sh` (TheoKit 48 vs plan 32 linhas)
- `post-edit-check.sh` (TheoKit 36 vs plan 88 linhas)
- `stop-validation.sh` (TheoKit 175 vs plan 199 linhas)
- `validate-command.sh` (TheoKit 45 vs plan 90 linhas)

Os hooks do TheoKit têm regras custom do projeto; os hooks do plan não foram instalados para evitar regressão.

**Contratos**: `.claude/rules/cycle-*.md` (plan) + `.claude/rules/{architecture,backend,frontend,testing,type-safety}.md` (TheoKit). Não há sobreposição.

---

## When this file is wrong

The TheoKit code and README are authoritative. If this file says one thing and the code/README say another, the code/README win. Update this file via PR with a one-line rationale. The voice and tone rules require an explicit strategic review before being weakened or repealed.
