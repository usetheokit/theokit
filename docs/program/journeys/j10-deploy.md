# J10 — Deploy

The tenth of the ten benchmark journeys (`../dx-benchmark.md`). Criteria written before either
implementation exists; a journey whose criteria change after code exists is void and must be re-run
from scratch.

**Scheduling status:** measured, and lost. The hold `../dx-benchmark.md` § Sequencing placed on issue
#350 is discharged — the tracker query it demanded was performed and #350 is closed. Both sides were
then built, containerised and run; see § Measured - both sides, end to end. § Current state below is
kept as the record of what was true before that run.

## What the journey requires

Copied from `../dx-benchmark.md` § The ten journeys, unchanged. Rewording it requires an ADR,
because a movable target measures nothing.

| # | Journey | What must work |
| --- | --- | --- |
| J10 | **Deploy** | The application runs on a target that is not the developer's machine |

The whole journey is in the last clause. Producing an artifact is not deploying; a target that
serves requests to someone other than the person who built it is. Every criterion below is therefore
asserted from **outside** the build machine.

## Acceptance criteria

In the shape `ROADMAP.md` uses: observable, with an oracle, graded by `/acceptance` against the
released artifact rather than the working tree (`.claude/rules/cycle-acceptance.md` § Target kinds).

**Definition of done (all must hold):**

- [ ] a request issued from a machine that is not the build machine reaches the deployed application
      and returns the application's own response — asserted against a value the deploying developer
      randomized into the build, so a cached placeholder or a platform default page cannot pass
- [ ] the agent journey works there, not just a static route: J1's tool call succeeds against the
      deployed URL, graded by J1's own randomized-value oracle
      (`j01-tool.md` § Acceptance criteria, criterion 2)
- [ ] streaming survives the target: J3's two-chunk separation oracle
      (`j03-streaming.md` § Acceptance criteria, criterion 2) passes against the deployed URL — this
      is the criterion the buffering shim currently fails, and it is inside the journey rather than
      excused from it
- [ ] the build is reproducible enough to deploy twice: two builds of the same commit, on the same
      machine, in the same session, produce a deployable artifact both times — a weaker claim than
      byte-identical output, and chosen because it is the claim this journey depends on
- [ ] a secret the application needs is supplied by the target's own mechanism and is not present in
      the built artifact: grepping the emitted output for the secret's value finds nothing, and the
      deployed application still works
- [ ] the path from source to serving is documented and followed verbatim: the operator runs only
      what the documentation says, and any step they had to discover is recorded as a defect of this
      criterion rather than performed silently
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely
      declared
- [ ] Tauri: the desktop build is produced from the same emitted output and launches on a machine
      that is not the build machine
- [ ] TUI: the terminal client runs the core in-process against the deployed backend, or — where the
      terminal client is itself the deployment — it starts from the published package on a second
      machine. *Not applicable* is not available: a terminal binary is deployable

**What resisted an oracle.** "Deploys cleanly" hides at least three different questions — build,
upload, and serve — and no single criterion covers them without becoming untestable. They are split
above, and one is deliberately not covered: **rollback**. Whether a bad deploy can be reversed is a
real operational property, it is largely the platform's rather than the framework's, and it would
turn this journey into a platform comparison. Excluded, and stated.

Criterion 4 is also weaker than it looks and the weakening is deliberate. Byte-identical output is
`../../../ROADMAP.md` § M3's criterion, not this one. J10 needs only that the build does not fail
intermittently, because that is the failure mode blocking it.

## The Next.js side

**A direct equivalent exists, and this is the journey where the Next.js side is strongest.** Deploy
is that framework's home ground: its vendor operates a platform where a git push or a single CLI
command takes a scaffolded application from source to a public URL, and the framework's own
documentation treats that as the default path.

The reference implementation: scaffold, add the tool from J1, run the platform's deploy command,
assert against the resulting URL. Where an official example exists it must be used and cited
(`../dx-benchmark.md` § Why the protocol comes before the measurement). A self-hosted variant —
build and start behind a container — is measured as a **second** data point rather than as a
substitute, because both are real ways that framework is deployed and reporting only one would pick
the answer.

*To confirm at implementation time, because these are version-specific and this document is written
without access to that source:* the current deploy command and whether it requires an account
created interactively, whether the default runtime for a Route Handler streams without
configuration, and what the documented self-hosting path currently is.

**The asymmetry here is real, it favours the other side, and it must be reported rather than
neutralized.** One side has a first-party platform; ours has nine adapters and, as measured below,
no deploy command at all. Comparing our best target against their best target is the honest
comparison, and the report states which target each side used. Restricting them to a common
denominator — say, a container on both sides — would produce a fairer-looking number that measures
something neither side's users do.

## How the four metrics are counted here

The general counting rule is in `../dx-benchmark.md` § The four metrics. What follows is that rule
landed on this journey.

**Files touched.** Counted: every file the developer creates or edits to get from a working local
application to a serving remote one — target configuration, platform manifests, container
definitions, environment declarations, CI files if the documented path uses one. Generated
deployment output is scaffolder output and is not counted unless it was hand-edited, in which case
the edit is counted and the reason recorded.

**Glue lines.** Business logic here is the empty set — J10 changes no behaviour. Everything is glue:
manifests, config, container recipes, environment plumbing. Reported as an **absolute count**, per
the rule J8 states. Lines the developer never writes because a platform infers them count as **zero**
for that side, and the report says which side inferred what — that inference is the substance of
this journey and must not vanish into a total.

**Concepts required.** Derived mechanically from what the developer must know to follow the
documented path. Counted here in addition to imports: each target name, each configuration file
format, each platform-specific term, and each account or credential that had to be created. A
platform account is a concept: it is a name and a step the developer did not previously have.

**Time to first green run.** Wall clock from `npx create-theokit` to the first request answered from
a non-build machine. Cold cache, at least three runs, mean and standard deviation. Platform
provisioning is inside the measurement on both sides — it is what the developer waits for — and the
report separates it from local build time so a slow platform is not read as a slow framework.

## Measured - TheoKit side, metrics 1-3 (2026-08-20)

**Three of four metrics, one side, and two numbers rather than one - because the two honest targets
fail different criteria.** Metric 4 and the whole Next.js side are unmeasured, and the subsection
below says why. The hold this page records on issue #350 is unchanged: nothing here verifies it.

Obtained from a real diff, not an estimate: the scaffold template was copied verbatim, committed as
an untouched baseline, and the journey implemented on top. The counts are `git diff --numstat` over
that commit.

**Read the numbers with the failures attached to them.** A platform target costs the developer no
files and cannot serve the agent this framework exists to serve; the container path can serve it and
is not documented anywhere, which is what criterion 6 grades. Reporting either number alone would
report a deployment that does not do the journey.

| Metric | TheoKit | How it was counted |
| --- | --- | --- |
| Files touched | **2** for `node` in a container, **0** for `cloudflare` | `Dockerfile` and `.dockerignore` added for the first; for the second the adapter emits `worker.mjs` and `wrangler.toml` itself (`packages/theo/src/adapters/cloudflare.ts:198`, `:204`), which the rule above excludes as generated output |
| Glue lines | **11**, then **0** | this journey declares business logic the empty set; the diff did not contradict it |
| Concepts required | **7**, then **4** | node: the `node` target, `theokit build`, `theokit start`, the `.theokit` output directory, the `.env.local` convention that must be kept out of the image, the Dockerfile format, and a registry or host account. cloudflare: the `cloudflare` target, `wrangler.toml`, `wrangler deploy`, and a Cloudflare account |
| Time to first green run | **not measured, and on eight of the nine targets there is no green run to time** | see below |

**The 11 added lines, classified.** Published because the glue split is the metric most open to being
argued after the fact, and a table nobody can check is not evidence - least of all one published by
the side it favours.

`Dockerfile`, 8 lines, all glue: the base image, `WORKDIR`, the `package.json` copy, the install, the
source copy, `npm run build`, `EXPOSE`, and `CMD ["npm", "start"]`.

`.dockerignore`, 3 lines, all glue: `node_modules`, `.theokit`, and `.env.local`. The third is
load-bearing rather than tidy - it is what criterion 5 buys, since without it the developer's local
secret is copied into the image and the criterion's grep finds it.

**No adapter serves an agent route, and that is the finding of this measurement.** The string `agent`
does not occur in any of the fourteen files under `packages/theo/src/adapters/`. The generated
Cloudflare worker branches on `/api/` and resolves the request through `scanServerRoutes` and
`executeRoute` (`packages/theo/src/adapters/cloudflare.ts:138`, `:142`), which are the *file* routes;
agents are a separate scan (`packages/theo/src/cli/commands/start/manifest-loader.ts:58`) served by
`mountAgent`, which is exported only from the internal contract
(`packages/theo/src/server/internal-api.ts:43`, a file whose own header states it is not the public
API). So criterion 2 - J1's tool call against the deployed URL - fails on all eight adapter targets,
and it fails without a supported workaround: an application cannot mount its own agent endpoint.
`streamAgentTurnInProcess` is public (`packages/theo/src/server/agent/index.ts:29`) and is a
lower-level seam; what rebuilding the run endpoint on top of it would cost was **not measured,
because its shape is not determined** - the same "no number, because no path" this programme
recorded for J4's criterion 1.

**The one target that can pass criterion 2 passes it by not deploying an artifact.** `theokit start`
serves the project rather than a bundle: it reads the manifest and dynamically imports the scanned
source paths at request time (`packages/theo/src/cli/commands/start/manifest-loader.ts:41`,
`packages/theo/src/server/scan/module-loader.ts:11`). The container therefore ships the repository,
which is why the Dockerfile copies everything and builds inside the image.

**Four judgement calls, stated rather than buried.**

1. **Two targets were measured rather than one.** § The Next.js side says comparing each side's best
   target is the honest comparison, and on this side "best" splits: cloudflare is cheapest and cannot
   run the journey, node is dearest and can. Reporting only the first gives a **0** that means the
   developer wrote nothing for a deployment that answers no agent request; reporting only the second
   hides that the platform targets exist. Both are reported, with what each fails.
2. **The platform manifest was not counted, so 2 is a floor.** No host was chosen: a compose file, a
   `fly.toml` or a Kubernetes manifest is at least one more file, and picking one would measure that
   platform rather than this framework.
3. **The generated `wrangler.toml` was not counted**, per the rule that generated deployment output
   is not counted unless hand-edited. It would need editing for a custom domain or a secret binding;
   that edit was not made, and if it were it would be counted with the reason recorded.
4. **Criterion 6 was graded, not skipped, and it fails by construction.** The documented path is
   `README.md:466`, which lists the nine targets and `theokit build --target <name>` and stops. Every
   step after it - the base image, the install, the port, the process to run, where the secret comes
   from - was invented here rather than followed, and the criterion says in its own words that a step
   the operator had to discover is a defect of the criterion. The entire 11-line diff is that defect.

**Two fixes landed today, both real, and neither unblocks this journey.** The static adapter no
longer emits a meta refresh for every exported page - the redirect fallback now runs only for a
genuine redirect (`packages/theo/src/adapters/static.ts:192`, with the previous behaviour recorded at
`:173`) - and the Cloudflare worker no longer serves a document with no `<head>`: the shell is read
from the built `index.html` and the build refuses by name when it is missing
(`packages/theo/src/adapters/cloudflare.ts:38`, read at `:197`). Both concern what a *page* looks
like. Criterion 2 concerns whether an agent endpoint exists at all, and on the adapter targets it
does not.

**A third finding, recorded because it is deploy-shaped:** the production server never binds the
configured host. `server.listen(port, …)` passes no address
(`packages/theo/src/cli/commands/start/index.ts:179`) while the schema defaults `host` to
`localhost` (`packages/theo/src/config/schema.ts:116`). The effect is convenient in a container and
wrong as a contract - a declared bind address does nothing, in either direction.

### What is still unmeasured, and why

**Nothing was deployed.** No image was built, no worker was published, no request was issued from a
second machine. Every claim above is read from source, and criterion 1 - the whole journey, in one
line - is untouched by a measurement that never left this machine.

**Criterion 3 was not exercised and is expected to fail on six targets.** The Web shim still collects
every chunk and constructs the `Response` inside `end()`
(`packages/theo/src/adapters/web-shim.ts:194`), which is what `../../../ROADMAP.md` § M14 records.
The `node` path does not go through that shim, so the container measured here is the one target where
criterion 3 has a chance, and it was not run.

**Criterion 4 - build twice, deploy twice - was not run.** That is the criterion the #350 hold is
about, and this page still does not get to close it by reading a changelog.

**Whether `theokit start` can import the sources it scans inside a container image was not tested.**
The loader performs a plain dynamic `import()` of the manifest's path
(`packages/theo/src/server/scan/module-loader.ts:11`), and those paths are TypeScript sources.
Whether that resolves on the image's Node build - and therefore whether the container serves at all -
is exactly the class of question this journey exists to ask, and it was not asked here.

**Metric 4 (time to first green run) needs a live model call for criterion 2**, at least three times,
cold cache, plus platform provisioning inside the clock. That spends real credits and a platform
account, and the number is only meaningful measured identically on both sides.

**The Next.js side does not exist yet.** Until it does, nothing here is a comparison, and the winning
rule cannot be applied. § The Next.js side already recorded that the asymmetry favours the other
stack; a 0 and a 2 on this side do not change that and do not settle it.

**The three-target criteria cannot be exercised in this repository.** The Tauri and TUI lines need
`@theokit/tui` and `@theokit/ui`, which live outside it (`.claude/rules/three-target-parity.md`
records the same limit). The TUI line is explicit that *not applicable* is unavailable to it, so both
remain open rather than excused.

**So: J10 is not won, not tied, and not run.** It is the second journey in this programme whose cost
cannot be reduced to a number, and the reason is not that the work is large - it is that on eight of
nine targets there is no path from the artifact to the journey's own agent.

## Measured - both sides, end to end (2026-08-20, second measurement)

**The first J10 measurement never left the build machine, and this one does not either - but for a
different reason, and it got a great deal further.** Both stacks were containerised, run, and
answered a full agent turn with a tool call and a progressively streamed reply; a request issued from
a machine that is not this one reached both and returned the value randomized into the build. What
still did not happen is a deploy to a machine that is not this one, on either side, because **no
platform account was obtainable non-interactively** - not on any of our nine targets and not on
theirs. That blocker belongs to the measurement, not to either framework, and it is symmetric.

The section above is left standing as the record of what was true when it was written. Where a run
refuted it, the refutation is here rather than edited into it.

### The blocker this page was held on is discharged

`../dx-benchmark.md` § Sequencing held J10 on issue #350 "until that issue is verified closed rather
than until someone remembers it was fixed". The tracker query that section demanded was performed:
**#350 is CLOSED**, at `2026-08-20T12:45:57Z`. The criterion it guarded was then exercised rather
than inferred - see criterion 4 below. **J10 is unblocked, and this is the measurement.**

### Three claims about today's changes, verified rather than believed

| Claim | How it was checked | Result |
| --- | --- | --- |
| The deploy shim no longer buffers a whole response | `createWebShim` driven directly by a probe that writes 8 chunks 120 ms apart and times the `Response` body | **Confirmed.** Headers at **1 ms**, **9 network chunks**, first chunk at 1 ms, gaps 120-122 ms, completion 967 ms, ratio **0.001**. J3 measured the same instrument before the fix at 1 chunk and ratio 0.999 |
| `aws-lambda` is delisted for streaming, audibly | read the three declarations | **Confirmed.** The build refuses by name when `ssrStreaming` is on (`packages/theo/src/adapters/aws-lambda.ts:209`), the emitted handler warns by route when it buffers a `text/event-stream`, and the adapter answers `streamsResponses: false` (`packages/theo/src/adapters/aws-lambda.ts:243`) against a contract that makes all nine state one (`packages/theo/src/adapters/types.ts:47`) |
| #367 - no adapter serves an agent | `grep -ric agent` over `packages/theo/src/adapters/`, and over the **emitted** Cloudflare worker | **Confirmed, twice.** Zero occurrences across all 14 adapter files. Zero occurrences in the `worker.mjs` a real `theokit build --target cloudflare` produced. #367 is still open, and it is the finding that decides this journey |

The #382 mechanism is fixed and the emitted contract carries it: the generated worker returns
`toResponse(executeRoute({…}))` without awaiting the run (`packages/theo/src/adapters/cloudflare.ts:156`).
**The issue is nonetheless still open on the tracker** (`state: OPEN`, `closedAt: null`, checked the
same day). The code is repaired; the record has not caught up, and this page reports the tracker as
it found it rather than as it expected it.

### The two baselines, declared

Neither application is committed here; the evidence is the counts and the published diffs, as J3 and
J6 did.

**TheoKit.** `create-theokit` 1.23.9 with `--yes`, then J1's tool substituted for the scaffolded one
and wired onto the agent, then committed untouched. `theokit` 0.49.0 **packed from the worktree at
`6e4102775` with `pnpm pack`** and installed from the tarball - because the shim fix under
measurement is not published: npm serves 0.48.14, and measuring that would measure a framework that
no longer exists. Node 22.22.2, Docker 29.3.0.

**Next.js.** `create-next-app` 16.3.1 (TypeScript, App Router, Tailwind), then `npm install ai
@ai-sdk/react zod`, then the AI SDK App Router quickstart's route handler and page, then J1's tool -
the same baseline J1 argued for and chose, so the two measurements compose. Installed: `next@16.3.1`,
`ai@7.0.70`, `@ai-sdk/react@4.0.73`, `zod@4.4.3` - identical to J1's row.

**J10's delta is measured from there**: from a working local application to a serving remote one.
J1's tool sits in the baseline on both sides and is charged to neither.

### The instrument, and what it cost to get a run

Counted on neither side.

**The model.** A scripted local server answering `POST /v1/chat/completions` in OpenAI's SSE dialect:
one `tool_calls` frame on the first turn, then the final answer as 9 text deltas 120 ms apart. The
Next.js lane uses `MockLanguageModelV4` + `simulateReadableStream` scripted to the identical shape,
in-process, which is what J6 established. Both lanes therefore stream at the same rate from the same
script, and what the two numbers differ by is the stack.

**One thing the framework charged that J6's instrument did not.** `registerProvider` is public from
`theokit/server` and documented as the way to point at a self-hosted endpoint. Calling it from
`agents/chat.ts` had **no effect on the served run**: the announcement read
`provider=openai (declared by the model) source=OPENAI_API_KEY baseUrl=https://api.openai.com/v1` -
the built-in base URL, not the registered one - and the request went to the real api.openai.com and
401'd. The provider registry is duplicated across two bundle chunks; the copy an application mutates
is not the copy the served path reads. Already filed as usetheokit/theokit#401 by another
measurement the same day; this run corroborated it on **0.49.0 built from the worktree** (so it is
not only the published build) and on an **existing** provider name (so it is not only new entries),
and both facts were posted to that issue. The measurement proceeded behind a `--import` preload that
rewrites the origin on `globalThis.fetch` - instrument-grade, and not something an application should
have to write.

### Metrics 1-3

Four columns, because two of the four are targets that cannot do the journey and one is a target
nobody could reach. Reporting a single pair here would pick the answer.

| Metric | TheoKit, `node` container | TheoKit, the eight adapter targets | Next.js, container (official example) | Next.js, Vercel |
| --- | --- | --- | --- | --- |
| Files touched | **3** | **no path** | **3** | **0** |
| Glue lines | **12** | **no path** | **247** | **0** |
| Concepts required | **9** | **no path** | **13** | **5** |
| Time to first green run | not measured | - | not measured | not measured |
| Was it run? | **yes** - built, served, agent turn completed | build only | **yes** - built, served, agent turn completed | **no** - no account |

**"No path" is the entry J5 fixed the rule for, and it is the honest one here.** The eight adapter
targets cost the developer nothing because they emit their own manifest and handler, and a **0** in
those cells would price a deployment that answers no agent request. `theokit build --target
cloudflare` was run: it emits `worker.mjs` and `wrangler.toml`, and the word `agent` does not occur
in either. There is also no upload step in the framework at all - the CLI stops at `build`, and the
adapter contract returns void (`packages/theo/src/adapters/types.ts:48`), so nothing reports or ships
what was emitted. A cost of zero for a journey with no route to its own agent is not a win; it is a
missing row.

**Vercel's 0 is documented and unverified, and it is reported as both.** Vercel's own docs are
explicit that a Next.js deploy is zero-configuration and that `vercel.json` is an override rather
than a requirement, so the file and line counts are 0 by the platform's inference - the case
§ How the four metrics are counted here says must be visible rather than folded into a total. What
could not be done is the deploy: the CLI authenticates from `VERCEL_TOKEN` or an interactive login,
and no account exists here to mint one. The concepts are counted anyway, because a developer must
still learn them: `vercel` the CLI, `vercel link` and the `.vercel` directory it creates,
`vercel deploy --prod`, `vercel env add`, and a Vercel account.

### Both diffs, published

The reason J1 and J3 published theirs: the glue split is the metric most open to being argued after
the fact, and a table nobody can check is not evidence - least of all one published by the side it
favours. This journey declares business logic the empty set, so every line below is glue.

**TheoKit - 3 files, 12 lines.**

```diff
+++ b/Dockerfile
+FROM node:22-slim
+WORKDIR /app
+COPY .vendor ./.vendor          <- instrument, not counted (see below)
+COPY package.json package-lock.json ./
+RUN npm ci --no-audit --no-fund
+COPY . .
+RUN npm run build
+EXPOSE 3000
+CMD ["npm", "start"]

+++ b/.dockerignore
+node_modules
+.theokit
+.env.local

--- a/theo.config.ts
+++ b/theo.config.ts
-export default config().build()
+export default config().host('0.0.0.0').build()
```

`Dockerfile` 9 lines of which **8 count**; the `COPY .vendor` line exists only because the framework
under test is unpublished, and a real application installs from the registry. `.dockerignore` 3
lines, all glue, and the third is load-bearing rather than tidy - it is what criterion 5 buys.
`theo.config.ts` 1 changed line, and **that line is the whole difference between a container that
serves and a container that does not** - see the finding below.

**Next.js - 3 files, 247 lines.** `next.config.ts` gains `output: "standalone"` (1 line). `Dockerfile`
is the official `vercel/next.js` `examples/with-docker` file, copied verbatim: **112 lines** = 25
blank, 44 comment, 43 directive, three stages, BuildKit cache mounts, lockfile detection for three
package managers, a non-root user. `.dockerignore` is that example's, also verbatim: **134 lines** =
14 blank, 18 comment, **102 entries**.

### Counting judgements, stated rather than buried

Six. The first one decides the whole of metric 2, and it was settled by running both answers rather
than by arguing.

| # | The judgement | Decided as | The other way |
| --- | --- | --- | --- |
| 1 | Is the Next.js side charged for the **official 112-line Dockerfile**, or for one of the same shape as ours? | **The official example.** § Why the protocol comes before the measurement says an official example must be used where one exists, and one does | A minimal 9-line Dockerfile plus a 3-line `.dockerignore` was **written, built and run** on the Next.js side to price this: it serves the static root, the agent turn, the tool call and the stream. That count is **3 files, 13 glue lines, 9 concepts** - so glue lines go from **20.6x to 1.08x** and concepts from 1.44x to 1.0x. This is the single most consequential number in this measurement |
| 2 | Does judgement 1 overcharge the other side for ceremony? | **No, and the artifact says so.** The official image is **290 MB**; the minimal one built from the same source is **1.09 GB**. Those 112 lines buy a 3.8x smaller image, and our 8-line Dockerfile has no equivalent - ours is **612 MB** and ships the whole repository, because `theokit start` imports the scanned sources at request time | Were the size ignored, judgement 1 would look like padding rather than like work |
| 3 | Is the `theo.config.ts` host line J10's, or J1's? | **J10's.** Nothing local needs it; it exists solely so the container serves | 12 glue lines to 11, 9 concepts to 8. No effect on any verdict |
| 4 | Is the generated `wrangler.toml` counted? | **No** - generated deployment output, per this page's own rule, and not hand-edited. It was emitted by the run and left alone | It would need editing for a custom domain or a secret binding, and that edit would be counted |
| 5 | Is a container on this machine a "target that is not the developer's machine"? | **No.** Criterion 1 is graded FAIL on both sides for that reason, however far the runs got | Grading it PASS would let both sides pass the journey's central sentence on a technicality, which is the failure this protocol exists to stop |
| 6 | Is multi-stage building a concept separate from "Dockerfile format"? | **Yes** - `AS`, `COPY --from` and BuildKit cache mounts are three things a reader must know that our path never asks for | Next.js concepts 13 to 10; the verdict does not move |

### The criteria, graded against the runs

| # | Criterion | TheoKit | Next.js + AI SDK |
| --- | --- | --- | --- |
| 1 | request from a non-build machine, randomized value | **FAIL**, and the oracle passed. The container was exposed through a third-party tunnel and fetched by a machine that is not this one; it returned `{"buildMark":"J10-2568E92A7C",…}`, the value randomized into the build. The application still ran here, so the journey's own sentence is unmet | **FAIL**, identically and for the same reason. Same fetch, same marker, same tunnel. No account was obtainable to deploy either side anywhere |
| 2 | the agent journey works there - J1's tool call against the deployed URL | **PASS on the `node` container.** `POST /api/agents/chat` returned `tool-input-available` for `order_lookup`, `tool-output-available` carrying the randomized `SHIP-4F72B7`, and a final answer quoting it. **FAIL on all eight adapter targets** - #367, confirmed in the emitted worker as well as in the source | **PASS**, both container variants. `tool-input-available` for `orderLookup`, output `SHIP-4F72B7`, answer quoting it |
| 3 | streaming survives the target - J3's two-chunk-50 ms oracle | **PASS**, measured through the container: 12 network chunks, 9 text-bearing, gaps **118-121 ms**, first text at 0.20 of the run. **PASS through a real third-party proxy** too: gaps 90-201 ms. The response still carries **no** `x-accel-buffering` (#383) - this proxy did not buffer, which is not proof the next one will not | **PASS**: 16 chunks, 9 text-bearing, gaps **119-123 ms**, ratio 0.276. Through the proxy, gaps 22-256 ms. The response carries `x-accel-buffering: no`, which the SDK sets and ours does not |
| 4 | build twice, deploy twice | **PASS**, and stronger than asked. Three consecutive `theokit build` runs, all exit 0, all producing a deployable artifact; two `theokit build --target cloudflare` runs produced **byte-identical** `worker.mjs` and `wrangler.toml` (md5 equal). `.theokit/manifest.json` differs run to run, which is `../../../ROADMAP.md` § M3's criterion and deliberately not this one | **PASS**. Three consecutive `next build` runs, all exit 0, all producing `.next/standalone/server.js` |
| 5 | secret from the target's mechanism, absent from the artifact | **PASS.** A randomized key was set in `.env.local` locally and supplied to the container with `-e`; `grep` for its value across the running image returns nothing, `.env.local` is absent from the image, and the app served. The `.dockerignore` line is what buys it | **PASS.** Same test, same result; the official `.dockerignore` covers `.env*.local` among its 102 entries |
| 6 | documented path followed verbatim | **FAIL, and it is the same failure the first measurement graded.** `README.md:468` lists nine targets and `theokit build --target <name>` and stops. The base image, the install, the build, the port, the process to run, where the secret comes from **and the host binding** were all invented here. The criterion says a step the operator had to discover is a defect of the criterion; the entire 12-line diff is that defect | **PASS.** `nextjs.org/docs/app/guides/self-hosting` plus the `vercel/next.js` `examples/with-docker` directory supply the Dockerfile, the `.dockerignore`, a `compose.yml` and the one config setting. Nothing was discovered; three files were copied |
| 7-9 | Web, Tauri, TUI | **not exercisable here** - `@theokit/tui` and `@theokit/ui` live outside this repository (`../../../.claude/rules/three-target-parity.md` records the same limit). The TUI line's own text says *not applicable* is unavailable to it, so both stay open | **not applicable** - a Route Handler serves one target |

**Criteria satisfied: 4 of 6 gradeable against 5 of 6.** Ours fails 1 and 6; theirs fails 1.

### The fifth metric, and it goes our way

Per `../dx-benchmark.md` § The fifth, which is pass/fail and not a number. The break this page
specified - a missing environment variable at the target - was run on both sides, in the same shape:
a container started with no provider key, then asked for a run.

| | What reached the caller | Verdict |
| --- | --- | --- |
| TheoKit | `Model "openai/gpt-4o-mini" declares provider "openai", but OPENAI_API_KEY is not set. Set OPENAI_API_KEY, or change the model's provider prefix.` | **Names the action.** The variable, the model, the provider and both ways out. It does not name why it worked locally, which this page's exemplar asked for, and that is the gap |
| Next.js + AI SDK | `data: {"type":"error","errorText":"An error occurred."}` | **Does not name the action.** The actionable text - `Unauthenticated. Configure AI_GATEWAY_API_KEY or use a provider module`, with a URL - exists, and it exists **only in the server log**. On a platform that is precisely this page's own "does not name the action" column: a 500 on the first request with the real cause somewhere the developer has to go and find |

**The tension worth recording:** the same design that wins here lost J6's criterion 2. Ours puts the
failure text on the wire; J6 measured that as a defect because a *tool* failure arrived that way on a
run reported `done` (#388). Putting the cause where the caller can read it is right; reporting the
run as successful anyway is what was wrong. J10 sees the good half of that decision and J6 saw the
bad half, and neither reading cancels the other.

**A second break was graded in the same session and it is worse than either.** See below.

### The finding: a container that reports success and serves nobody

**The seventh instance of the family this programme has now found six times in one day, and the first
one that is a deploy.**

A container built by following the documented path starts, exits nothing, logs

```
  Theo production server
  → http://localhost:3000
```

and refuses every request from outside with `Recv failure: Connection reset by peer`. The listener is
on IPv6 loopback and nothing else: `/proc/net/tcp` inside the container is empty and `/proc/net/tcp6`
holds one row for `::1:3000`. A request issued **from inside the container** to `127.0.0.1:3000`
fails too.

The cause is one line: `resolveListenHost` maps an absent `config.host` to `'localhost'`
(`packages/theo/src/cli/commands/start/resolve-listen-host.ts:19`), and that is what `listen` is
given (`packages/theo/src/cli/commands/start/index.ts:183`) against a schema whose default is the
same (`packages/theo/src/config/schema.ts:116`).

**And it is a regression from a fix that landed today.** The first J10 measurement recorded the
opposite defect - `listen(port)` with no address, binding every interface, "convenient in a container
and wrong as a contract". That has been corrected, and the correction made every containerised
deployment unreachable by default. The new file's own docstring states the reasoning: *"Narrow is the
safe choice to make silently; binding every interface is a decision someone should have to write
down."* That is right for a laptop and wrong for a container, and nothing at runtime distinguishes
the two.

**The audible half is the worse half.** The success line substitutes the word `localhost` for
`0.0.0.0` when printing (`packages/theo/src/cli/commands/start/index.ts:187`), so two images built
from the same source - one with the host line, one without - print **byte-identical** logs. One
serves a full agent run; the other serves nobody. Verified by running both. Filed as
usetheokit/theokit#402.

**A second gap on the same two lines, folded into that issue:** `theokit start` never reads
`process.env.PORT` - `const port = options.port ?? config.port`
(`packages/theo/src/cli/commands/start/index.ts:90`), the flag or the file and nothing else. Every
platform that injects `PORT` will be served on the wrong one. The single place in the tree that
honours it is the Bun adapter's emitted entry (`packages/theo/src/adapters/bun.ts:60`). The
contrast is exact: the official Next.js image sets `PORT` and `HOSTNAME` as environment variables
because the server it starts reads both.

### What is still unmeasured, and why

**Nothing was deployed to a machine that is not this one, on either side.** No platform account could
be created non-interactively: Vercel's CLI needs a token minted on an account page, `wrangler` needs
a Cloudflare login, and the same holds for Netlify, Fly and Deno Deploy. A tunnel let a genuinely
remote machine issue the request, which grades the oracle and not the journey. **This is the honest
limit of this measurement and it is symmetric** - neither side got a platform, so neither side's
number is a claim about the other's platform.

**Metric 4 is still not measured, on either side.** It needs platform provisioning inside the clock,
which needs the account above; and a number measured against a scripted local model measures the
harness, as J6 already recorded.

**Whether the five remaining shim targets stream on their platforms is still unproven.** The shim was
measured and the emitted contract read; the adapter agent's own limit stands - `node` is exercised
end to end, and Cloudflare, Vercel, Netlify, Bun and Deno Deploy are correct in the emitted contract
and unproven on the platform, because there is no deploy in CI.

**#383 was not settled by the proxy hop.** One third-party proxy passed both streams through. nginx
with default buffering is the case the header exists for, and it was not tried.

**Criteria 7 to 9 cannot be exercised in this repository**, unchanged from the first measurement.

**Neither application is committed.** `../dx-benchmark.md` § Evidence asks for both under
`docs/program/evidence/jN-<journey>/`; that directory still does not exist, and this measurement did
not create it. Recorded as an open gap, as J1, J3 and J4 recorded it.

### The verdict, and the margin

| Metric | TheoKit (`node` container) | Next.js (Vercel, documented) | Better | Ratio | Verdict under § What counts as winning |
| --- | --- | --- | --- | --- | --- |
| Files touched | 3 | **0** | Next.js | unbounded | **Loss** |
| Glue lines | 12 | **0** | Next.js | unbounded | **Loss** |
| Concepts required | 9 | **5** | Next.js | 1.8x | **Tie** - inside the 2x bar, and TheoKit is the worse side |

| Metric | TheoKit (`node` container) | Next.js (container, official) | Better | Ratio | Verdict |
| --- | --- | --- | --- | --- | --- |
| Files touched | 3 | 3 | - | 1.0x | **Tie** |
| Glue lines | **12** | 247 | TheoKit | 20.6x | **TheoKit**, far outside the bar |
| Concepts required | **9** | 13 | TheoKit | 1.44x | **Tie** |

**J10 is lost.** The rule this journey wrote for itself is that each side is measured on its best
target and the report says which - and that restricting both to a container "would produce a
fairer-looking number that measures something neither side's users do". Their best target takes a
scaffolded application to a public URL with **zero files and zero lines**; ours has no deploy command
at all, and the one target of nine that can serve an agent gets there by shipping the repository into
a container the developer had to design. A journey is won by costing less to build the thing the
criteria describe. Here we cost more to build less.

**The container comparison is a tie, and its 20.6x is the most fragile number this programme has
produced.** It survives only judgement 1, and judgement 1 was tested by building the other answer:
charge the Next.js side a Dockerfile of the same shape as ours and the three metrics read 1.0x,
1.08x, 1.0x - level on all three. The official file earns its 112 lines (judgement 2: a 3.8x smaller
image), so charging them is right; but a margin that a defensible re-implementation of the loser
closes completely is, by § What counts as winning's own words, not a margin.

**What this journey actually establishes is not in either table.** Both stacks were run, and both
served the agent turn the criteria describe - which is more than J3 or J9 could say about the margins
they reported. Ours got there through the one target that does not deploy an artifact, after an
invented Dockerfile, past a public extension point that does nothing, and over a default that makes
the container answer no one while saying it is up.

## The deliberately broken state

Per `../dx-benchmark.md` § The fifth, which is pass/fail and not a number. The break for J10 is a
**missing environment variable at the target** — the classic: it worked locally because a dotfile
supplied it, and the target has no such file.

| | |
| --- | --- |
| Names the action | `ANTHROPIC_API_KEY is not set on target "vercel". It was read from .env.local locally; .env files are not uploaded. Set it in the target's environment.` — names the variable, the target, why it worked before, and where to put it |
| Does not name the action | A generic startup crash in a platform log the developer must go find, or a 500 on the first request with the real cause three log lines up |

A second break is graded in the same transcript, because it is the one blocking the journey:
**a build that fails intermittently.** Names the action:
`build failed reading dist/ of a workspace dependency that was being rebuilt concurrently. Run the package build with a concurrency of 1.`
Does not: a type error naming an implicit `any` in a file the developer never touched — which is the
symptom this project actually observed, and a message that sends the reader to the wrong file is
worse than one that says nothing.

## Current state and blockers

Measured against the working tree on 2026-08-20; every claim is read from source.

**The stated blocker is issue #350 and the fix is in the tree — but the hold is about verification,
not about the fix.**

What is present:

- The parallel-build race is described in the repository's own changelog, including the mechanism:
  a package's declaration pass could read a dependency's output directory while that dependency's
  clean step had emptied it, surfacing as an implicit-`any` type error in an untouched file
  (`../../../CHANGELOG.md:181`).
- The fix is applied: the workspace build runs at a concurrency of one
  (`../../../package.json:13`), and the typecheck script no longer re-invokes the parallel build
  (`../../../package.json:16`). CI adopted it across five jobs (`../../../.github/workflows/ci.yml:44`).

**So the hold stands for the reason `../dx-benchmark.md` § Sequencing gives** — the issue is open
until verified closed, not until the fix is merged. Verifying it is a tracker query plus a repeated
cold build, and neither was performed here. Stating that plainly is the point: this page does not
get to close a blocker by reading a changelog.

**A second blocker exists and is not named in the sequencing section: there is no deploy step.**
The CLI stops at `build`. There are nine registered targets
(`packages/theo/src/adapters/registry.ts:25`), dispatched from the build command
(`packages/theo/src/cli/commands/build.ts:222`, invoked at `:224`) after validation against the
declared list (`:63`). But the adapter contract returns nothing — its build method resolves to void
and everything it produces is a filesystem side effect
(`packages/theo/src/adapters/types.ts:24`) — so the CLI cannot even report what was emitted, and
nothing uploads it. One target is a validator that emits no artifacts at all
(`packages/theo/src/adapters/theo-cloud.ts:24`). Criterion 6 grades the documented path, and today
that path ends with a directory on the developer's disk.

**A third, which is why criterion 3 sits inside this journey rather than beside it:**
`../../../ROADMAP.md` § M14 records the shared web shim buffering whole responses across six
targets. Criterion 3 will fail on those targets today. It stays in the criteria because a target
that cannot stream is a target on which the agent journeys do not work, and delisting the criterion
would let the journey pass on a deployment nobody would ship.

**And a fourth that couples J10 to J7:** the web-standards handler the adapters are built on has no
rate limiting (see `j07-rate-limit.md` § Current state). So the deployed target is, today, less
protected than the developer's own machine — which is the inverse of what a deploy is supposed to
achieve, and is recorded here so the two journeys are not measured as if they were independent.

**Not measured:** whether issue #350 is closed on the tracker; whether any adapter's output actually
serves when uploaded; and whether the desktop and terminal surfaces build at all, which
`../three-target-parity.md` § Current state already records as unproven in CI.

## Cross-references

- The benchmark this journey belongs to: `../dx-benchmark.md`
- The milestone that owns the adapter contract: `../../../ROADMAP.md` § M14
- The milestone that owns build reproducibility: `../../../ROADMAP.md` § M3
- The journey whose streaming oracle criterion 3 reuses: `j03-streaming.md`
- The journey whose protection the targets lack: `j07-rate-limit.md`
- Acceptance contract that grades these criteria: `../../../.claude/rules/cycle-acceptance.md`
- Criterion shape these follow: `../../../ROADMAP.md` § Wave 1
