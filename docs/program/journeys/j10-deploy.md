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
