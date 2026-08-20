# J10 — Deploy

The tenth of the ten benchmark journeys (`../dx-benchmark.md`). Criteria written before either
implementation exists; a journey whose criteria change after code exists is void and must be re-run
from scratch.

**Scheduling status:** blocked. `../dx-benchmark.md` § Sequencing holds J10 on issue #350 until that
issue is verified closed rather than until someone remembers it was fixed. § Current state below
records what is present in the tree and what remains unverified.

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
