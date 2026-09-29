# 0020 — A prebuilt function is bundled by the adapter, not by the platform

- Status: Accepted
- Date: 2026-09-26
- Deciders: the autonomous chain, under `rules/autonomy-envelope.md § A structural decision the
  contract wants recorded`

## Context

`B-263` asked for each deploy target to be exercised against a real serverless response. The Vercel
build produced a green `✓ Build complete → vercel (SSR)` and a function that cannot start. Measured
in one command, no deploy required:

```
cp -a .vercel/output/functions/api.func/. /tmp/fn/ && cd /tmp/fn
node -e "import('./index.mjs')"
→ ERR_MODULE_NOT_FOUND: Cannot find package 'theokit'
```

The emitted `api.func/` directory holds `index.mjs` and `.vc-config.json`, nothing else. The entry
opens with `import { … } from 'theokit/server/scan'`, and **Vercel's Build Output API v3 uploads a
`.func` directory as it is** — nothing installs dependencies for it and nothing bundles it.

This is a class rather than one target's bug. Measured across the adapter directory: `vercel`,
`netlify`, `aws-lambda` and `bun` each emit an entry importing `theokit/…` as a bare specifier, and
none of them bundles. Whether that breaks depends entirely on who resolves the specifier afterwards:

| target | who resolves it | outcome |
|---|---|---|
| `cloudflare` | wrangler, with esbuild, at deploy time | works — validated live on 2026-09-26 |
| `bun` | the project's own `node_modules`, present at run time | works |
| `vercel`, `aws-lambda` | **nobody** | the function cannot load |

So the question this ADR answers is not *"how do we fix Vercel"*. It is **who is responsible for
making a deployed entry self-contained**, given that three platforms answer it three different ways.

## Decision

**The adapter bundles its own entry whenever the platform will not.** The step lives in one module,
`adapters/bundle-deployed-function.ts`, and is invoked by the adapters whose platform does not bundle.

It uses **vite**, in SSR mode, with `ssr.noExternal: true`.

The emitted entry is written inside the project root first — `.theokit/<target>/entry.mjs` — and the
bundle is produced from there into the platform's output directory.

## Rationale

### Why vite, and not esbuild

The parsimony ladder's fourth rung is *"is there a dependency already installed?"*. Measured:

- `esbuild` resolves from **neither** the repository root **nor** `packages/theo`. It is a transitive
  dependency of vite and tsup, undeclared. Using it means declaring a new dependency.
- `vite` is a declared dependency of `packages/theo`, and `adapters/node.ts` **already** runs
  `viteBuild` for exactly this shape of job — an SSR build of one entry.

So vite is reuse and esbuild is an addition. The ladder stops at reuse.

### Why one module rather than a step inside each adapter

Three targets need the same step. A copy per adapter is three copies of one decision, and the
measurement that opened this ADR is what a divergence looks like: `serverDir` was threaded correctly
by `bun` and `deno-deploy` and not by `vercel`, `aws-lambda` or `cloudflare` (B-315), because the same
call was written five times.

The module is also what makes the step testable. `build()` loads a config and runs vite twice, so
nothing can ask it one question — the same reason B-312 needed an extraction before its defect could
be asserted at all.

### Why the entry is written inside the project root

Not a style choice. Measured while establishing this: an entry staged in `/tmp` makes rollup resolve
`theokit/server/scan` from `/tmp`, and the build fails with an unresolved import. The specifier is
resolved relative to the importing file, so the file has to sit where the project's `node_modules` is
reachable.

### Why `copyPublicDir` is off

Also measured. With `root` at the project, vite copied `index.html`, `logo.png`, `favicon.svg` and
`robots.txt` into the function directory — a lambda carrying the site's static assets, and an
`index.html` beside a handler.

## Alternatives rejected

**Emit a `package.json` into the `.func` directory.** Build Output API v3 does not run an install for
an uploaded function, so the manifest would be read by nobody. Verified against the platform's own
contract: the directory is uploaded as-is.

**Copy the needed `node_modules` into the `.func` directory.** pnpm's store is a symlink farm, so a
copy either follows every link and duplicates the whole graph, or preserves links that point outside
the upload. It also has no way to know which packages the entry actually reaches.

**Use `@vercel/nft` (node-file-trace).** It is the tool Vercel itself uses and it would trace the real
file set. It is a new dependency, it is Vercel-specific where this step is needed by three targets,
and it solves a problem a bundle does not have — a bundle has no file set to trace.

**Leave it to the platform and document the limitation.** This is what the code did, and the adapter's
own docblock said so honestly: *"What this does NOT prove: that a deployed page carries them. That
needs a deployment, and this repository deploys to no Vercel project from CI."* The limitation is real
and the consequence is that the target has never worked — `/api/*` could not answer on any deployment
this framework has ever produced for it. A documented non-functioning target is still a
non-functioning target.

## Consequences

**A function bundle carries the framework.** Measured on this repository's scaffold: 35 files, 2.0 MB,
with code-split chunks under `assets/` inside the function directory. Well inside Vercel's 250 MB
unzipped limit, and it removes a cold-start `node_modules` resolution.

**The build gets slower**, by one vite SSR pass over one entry. Measured at roughly 1.5 s on this
scaffold.

**Two targets are NOT changed by this ADR.** `netlify` and `aws-lambda` emit the same shape and need
the same call; they are named in `B-316` rather than changed here, because neither has been exercised
against its platform and a fix nobody can verify is a claim rather than a repair.

> **Amended 2026-09-29 — both have since been changed, and the condition above is what released
> them.** `netlify` was exercised on the Netlify emulator (B-339, B-341, B-343): `GET /api/health`
> answers 200 and `/api/agents/chat` reaches theokit's own typed errors, from output the adapter
> produced. `aws-lambda` needed no emulator — its handler is a function taking an event, so the whole
> path is exercisable locally, and `tests/integration/the-lambda-handler-answers-where-it-is-uploaded.test.ts`
> bundles it, copies it to a directory with no `node_modules`, imports it and INVOKES it: 200 with the
> trace header echoed (B-342, B-344).
>
> That is strictly more than the property this ADR accepted as sufficient for `vercel` one paragraph
> below — "the directory loads standalone under `node`" — which it changed with no Vercel deployment
> either. The deferral reason as written did not actually distinguish `aws-lambda` from `vercel`; what
> distinguished them was effort, and saying so is cheaper than leaving a reader to reconcile the two.
>
> Both targets also needed their ROUTES baked, which this ADR does not mention because bundling is
> what creates the requirement: a bundle carries no source tree, so the runtime `scanServerRoutes` that
> worked before the bundle answers 404 after it. Measured in that order on both targets.
>
> What is still NOT established for either: that the platform invokes the artifact. `B-263` holds both
> credentials as retained `access` impediments. `cloudflare` and
`bun` are deliberately left alone — wrangler and the Bun runtime each resolve the specifier already,
and bundling twice would be work with no observable effect.

**What this does not establish.** That the bundled function answers a request on Vercel. That needs a
deployment, and at the time of writing this repository has no Vercel credential — an `access`
impediment under `rules/decision-delegation.txt`, recorded in `B-263` rather than worked around. What
IS established is that the directory loads standalone under `node` with `export default: function`,
which is the property that was false before.

## Related

- `B-316` — the item, with both halves and the measurements
- `B-263` — the target-by-target deploy exercise that surfaced it
- ADR `0014` — the sibling decision for a target with no filesystem at all
- `rules/parsimony-ladder.md` — rung 4, which chose vite over esbuild
