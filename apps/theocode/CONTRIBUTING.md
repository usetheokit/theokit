# Contributing

The conventions this repository enforces live in the code that enforces them — `npm run lint`
chains six gates, `npm test` runs the suite, and every gate's reasoning is in its own source. This
file holds the one thing no gate can check: **how to know that what you measured is what runs.**

## Verifying a change

`npm run lint && npm run typecheck && npm test && npm run depcruise` before a commit. `npm run build`
before believing anything about the binary.

### Formatting is a separate channel, deliberately

`npm run format:check` reports every file that does not match `.prettierrc`; `npm run format`
rewrites them. Neither is in `npm run lint`, and neither should be added to it. That chain decides
whether a build is allowed to exist, and a brace style is not that — put the two in one channel and
a correctness gate fails the same way a whitespace preference does, after which the whole channel
gets read as noise. `lint` blocks; `format:check` informs.

It reports well over a hundred files on any given day — drift accumulated across the life of the
repository, not anything a new change introduced. No number is quoted here on purpose: it moves with
every commit, and this file has published an unreproducible figure before. `npm run format:check`
prints its own total on the last line — read that, and resist recounting it with a pipe. The first
attempt at this paragraph did exactly that and was off by one, because the summary line starts with
the same `[warn] ` prefix as every path above it.

Clearing that backlog is a separate mechanical commit nobody has made. The check was added ahead of
the cleanup on purpose — the drift only became visible because something finally prints it, and a
style declared in `.prettierrc` that no channel ever checked is a style nobody agreed to.

Run `format` on what your change touched, not across the tree. A formatting diff spread over
unrelated files is where a real change hides, and this repository has the receipt: reformatting
`per-session.test.ts` pushed a `describe` block past `max-lines-per-function`, which is documented in
`eslint.config.mjs` as the reason that rule is now off for test files.

**Before formatting anything, check `.prettierignore`.** It is not a tidiness list. Every entry is a
file some program PARSES, and the comments there record what happened when one was reformatted —
`prettier --write .` took three `fixed_in:` lines in `BACKLOG.md` off column 0 and turned
`tools/check-backlog-crossval.py` from 0 problems into 3. Adding a machine-read record to this
repository means adding a line there in the same change.

Green gates are necessary and not sufficient. For a change that alters what the product *does* —
a dependency bump, a new option reaching the framework, anything about what the agent can read —
exercise the built binary in a throwaway project. The suite mocks the boundary this kind of change
crosses, which is exactly why it stays green through the failure.

## What `rules/*.md` means in a comment

Comments across this repository cite rule files — `rules/error-handling.md`, `rules/testing.md`,
`rules/public-copy.md`, `rules/architecture.md`, `rules/english-only.md` — to say where a decision
came from. **Those files are not versioned here**, so a clone will not contain them. They belong to
the tooling installed at `.claude/`, which is gitignored and has its own repository.

You are not missing an explanation. Every one of those citations is an **attribution**, and the
sentence around it carries the reasoning on its own:

```ts
// Extending the SDK base keeps the error TYPED, which `rules/error-handling.md` asks for
// and a plain `Error` would give up.
```

The reader learns that the error is typed on purpose, and why, without opening anything. The path
credits the source; it is not a pointer you must follow.

Six rule files are cited this way; the sixth, `rules/git-safety.md`, is cited by
`.github/workflows/ci.yml`. Count them yourself rather than trusting a number here — the first
version of this paragraph published two figures that came from two different greps and neither was
reproducible:

```bash
git ls-files | grep -vE '^(BACKLOG|CHANGELOG)\.md$' | xargs grep -oE '(rules/[a-z-]+\.md)' | sort | uniq -c
```

Nothing detects it when one rots. `tools/check-doc-references.mjs` validates the paths cited by
`README.md` and nothing else, and widening it on its current rule — *the path resolves* — would fail
every one of these permanently, since the files genuinely do not ship.

**A citation asserts more than it credits, and that part IS checkable.** `rules/error-handling.md
§ 5` claims that section says something particular. Two such section numbers were wrong when this
paragraph was written — one of them in the argument for leaving them unguarded, and one in
production source. The sentence still stood on its own in both cases, which is why they survived:
a wrong § number costs nothing to a reader and misleads anyone who goes to check.

## Ways a careful measurement still lies

All of these happened here, and none is caught by being more careful with the measurement itself.
The fault is upstream of it.

### A compound command can skip the step that gave the rest its meaning

```bash
npm run build && rm -rf "$P/.theokit/skills" && run-the-probe   # DON'T
```

That line reads as "rebuild, then measure". A repository hook refuses the `rm -rf`, the shell
aborts, and the probe runs against the previous binary. The result was reproducible three times
and described a defect that did not exist — an upstream issue was filed and had to be retracted.

Run the destructive step and the verification as **separate commands**, and prove the build landed
rather than assuming it:

```bash
npm run build
grep -c MY_PROBE_MARKER dist/theocode.mjs      # 1, or the probe is measuring the old binary
```

### A commit message cannot say an issue is NOT closed

GitHub matches `close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved #N` anywhere in a
commit message or PR body. It does not parse the English around the keyword, so a sentence written
to deny the link performs it:

```
This does NOT close #130.       # DON'T — GitHub reads `close #130` and closes the issue
```

Measured here, on that exact line. The commit deliberately said the change did not fix the issue —
it was pinning a dependency whose new capability the intermediate layer does not forward — and
closing it reported a live, unfixed security gap as solved. The one word the author added for
precision is the one the parser cannot see.

**A code span does not protect it.** Measured here, and the first attempt to measure it was worse
than useless: the check ran against a branch the commit had not reached yet, the issue was still
open, and that read as "backticks are safe". It only became evidence once `git merge-base
--is-ancestor` proved the commit was on the trunk — and then the issue closed a second time. The
parser sees the raw text; Markdown is applied for rendering, afterwards.

So the rule has no escape hatch. Refer to an issue you are not closing with `Refs #N`, or write the
number with no keyword anywhere near it. Reserve the keywords for the commit that actually does the
work, and never spell one out in prose next to a number — not in a warning about this trap, and not
inside backticks.

**One narrowing observation, kept as a hypothesis.** A PR body upstream said *"Closes the `hooks`
half of #686"* and the issue did not close — the timeline shows no `closed` event at all. That is
consistent with the parser requiring the keyword **adjacent** to the number, which is also what
GitHub's own syntax documents. It is one observation of one case, and this repository has no
matching case of its own to check it against.

The rule stays strict anyway, and the reason is the asymmetry rather than the doubt. Being too
strict costs a slightly awkward sentence. Being too loose costs a live security issue reported as
solved — which happened twice in one day here, and each time was caught only because someone
re-checked the state instead of assuming it. Write `Refs #N` and move on.

### A negative result without a positive control is not evidence

A probe that "did not fire" has two explanations: the thing under test is broken, or the probe never
had a chance. Telling them apart costs one extra run.

Measured here: `.claude/hooks.json` did not fire in an untrusted directory, which read as the SDK
refusing to honour a declaration. The control — the *native* `.theokit/hooks.json`, same directory —
did not fire either. This product's trust gate withholds every repository hook there, so the arm
proved nothing about the SDK, and the conclusion drawn from it would have had an upstream maintainer
revert correct behaviour.

Before reporting a negative, run the arm that should succeed. If it also fails, the probe is what is
broken.

### A guard's own suite passes when the guard has been switched off

The section above is one probe. This is the same fault at the scale of a test file, and most of this
tree already follows the convention — measured 2026-09-10, 132 of 209 test files carried a case
whose prose named it. It was written down nowhere a clone could read: the normative file that states
it, `rules/testing.md`, lives under `.claude/` and does not ship.

A guard test has two halves and both carry load:

- **Lead with a fixture that MUST fail.** The first case feeds the guard input it is supposed to
  reject, and asserts the rejection. Without it, a guard that has quietly become a no-op — a
  mis-glob, an early return, a zero-length match set — passes its own suite and exits 0 in the lint
  chain. That is worse than having no guard, because a green build is read as evidence.
  `tools/check-english-only.mjs` reported clean over 144 Portuguese identifiers while its every fix
  was "verified" by running it once and reading the output.
- **Carry a floor asserting the guard does NOT fire on the clean case.** Without it, a guard that
  flags everything satisfies the first half. Only the pair pins the behaviour between *rejects
  nothing* and *rejects everything* — each half alone is satisfied by one of the two degenerate
  guards, and those are the two failure modes a checker actually has.

`tools/check-artifact-promotion.test.mjs`, `tools/check-doc-references.test.mjs` and
`tools/check-english-only.test.mjs` are written this way and say so in their headers.

**It is not only for checkers**, and the case that bought the convention was not one.
`packages/agent/tests/aggregate-cut-wiring.test.ts` asserts that an oversized rule corpus gets cut —
an assertion a build satisfies by reporting a cut *unconditionally*. The previous attempt at that
item named that exact mutant in its own plan, shipped with it alive, and the commit was green across
three new tests and the whole suite: 203 files, 1,530 passed, 0 failed. A human found it afterwards.
The arm that fails against it — *a rule corpus that fits carries no aggregate cut at all* — exists
now, and is the only one in that file that does.

**Nothing enforces this.** A grep cannot tell a floor from a comment mentioning one, and the
instrument that could — mutation testing — is a bigger decision than this paragraph. It is held by
review, which is the reason it is written here instead of assumed.

### Two legitimate artifacts can disagree, and only one is executed

`AgentBuilder.build()` returns a definition carrying the raw declaration; `compileAgentDefinition`
returns the compiled options carrying the resolved decision. Both are real, both are inspectable,
and reading the first while the runtime uses the second produced a second wrong report the same day.

`tools/check-sdk-pin.mjs` has the same shape by design: it compares declarations across three
manifests and reported "one pin, agreed" while the installed tree still held the previous version.
It is doing its job — it cannot see an install that did not happen.

So the question is not *"did I inspect an artifact?"* but **"which artifact does the system
execute?"** Answer it by following the call path, or by instrumenting the real call site and
rebuilding.

**The sharpest form of this is two trees on one machine.** Testing an upstream change means
installing it in a worktree with a dependency override — and the main checkout still holds the
pinned version. Both `.d.ts` files are real, both are on disk, and an editor or a `grep` run from the
repository root resolves the *pinned* one. Measured here: a type read from the release tree's
`@theokit/sdk@5.0.1` was compared against behaviour from a snapshot build, and the field that the
snapshot had added read as absent — twice, across two rounds, while the answer sat in the file the
worktree had installed. When an override is in play, read every signature from the worktree's
`node_modules`, by absolute path, or the reading is stale by construction.

That instruction has a hole, and it was found from the other side: it assumes you KNOW which tree
you are in. The `theokit` session reported a type as absent from `@theokit/sdk@5.0.1`, ran the
recursive search on what it believed was the right path, and got an honest zero — because its
`node_modules/@theokit/sdk` symlink still pointed at `4.52.1`, left behind when a temporary override
was removed. Not the query lying. **The object.**

So the practice is mechanical, and it costs one line:

```bash
L=$(readlink -f node_modules/@scope/pkg) && node -e "console.log(require('$L/package.json').version)"
```

Resolve the symlink and print the version BEFORE concluding anything from a search under
`node_modules`. Run here while writing this, it reports `5.0.1` in the checkout and
`5.1.0-compat-581-…` in a worktree still on disk — two trees, one package name, live on this machine
right now.

### A test double must branch on everything the real function branches on

`composition.test.ts` mocks the subagent loader so a role's declared tools are the test's input. The
double keyed on one argument — the setting sources — and ignored the directory:

```ts
const discoverSubagents = vi.fn((_cwd: string, opts: { settingSources: string[] }) => ...)
```

That was faithful while production called the loader once. When the operator's root was added, it
called it **twice** — once for the project, once for the home — and both calls pass
`settingSources: ['project']`, because that token selects the `<cwd>/.theokit/agents` *layout*, not
the root. The double could not tell the two calls apart, so it answered the home call with the
repository's roles, and a test asserting that an untrusted repository is refused would have passed
while the repository's own definition was used.

The danger is the direction it fails in. A double that keys on fewer dimensions than the real
function silently **merges two different calls into one answer**, and merged answers look like
passes. Its own docblock had already warned that a mock returning roles regardless "would make the
untrusted assertion pass for the wrong reason" — the warning was right and the code had drifted past
it.

Before trusting a double, list the inputs the real function branches on and check the double branches
on each. If it does not, it is answering a different question than the code does.

### A filter narrower than the signal reports absence, and absence reads as a negative

Four times in one day, across two repositories, a measurement was nearly reported backwards because
the output was trimmed before it was read:

| filter | what it cut | the conclusion it would have produced |
|---|---|---|
| `tail -3` | a version-floor warning printed at the top | "the snapshot does not fix #74" |
| `grep -A2` | an `env:` twelve lines below the match | "the token never reached the branch" |
| `tail -30` of a push log | the gate's own diagnostic | "the push failed, reason unknown" |
| the test runner from the repo root | a package's setup | "72 tests broke, this is a regression" |

The asymmetry is what makes this dangerous. A **wrong command** produces an error, and an error
demands attention. A **narrow filter** produces silence — and silence is exactly what a true negative
looks like, so nothing about it feels wrong. The first case above was caught only because the same
command was re-run without the pipe.

The version-floor case is the sharpest: `compatSources` had been switched off by a guard before the
test could exercise it, so the arm did not fail, it was **void**. Reporting it as a failure would
have sent someone hunting for a bug in code that was correct.

Before trusting a negative result, re-run the command with no filter at all and read the whole
output. If that is impractical, filter for the signal AND for the words a guard would use when it
disables something.

**Write the rule and you will still break it.** Both later instances above happened *after* this
section existed, by its own author. Knowing a pattern does not fire at the moment of confidence; it
fires afterwards, re-reading what you already wrote. So the practice is not "remember this" — it is
mechanical: **every empty or negative output that is about to become a claim gets a second read with
a wider window.** Two lines of cost, and it does not depend on having been suspicious.

## Filing upstream

This product is built on `@theokit/*`, and a finding often belongs to a repository that is not this
one. Before filing: reproduce against the **published** artifact, not a local checkout; search the
target tracker for a duplicate; and state the measurement, not the conclusion drawn from it.

If a maintainer cannot reproduce your report, that is data. Two upstream reports from this
repository were retracted after the owning session refused to fix a defect it could not observe —
in both cases the cause was on this side, and a "fix" there would have hidden it.

## Unblocking across repositories — snapshot, never symlink

The section above requires reproducing against the **published** artifact. That rule is only
followable if a published artifact can exist in minutes, so this is how one is obtained.

**When a fix lands upstream that a consuming repository is blocked on, publish a snapshot instead of
waiting for the release.** A snapshot is a real npm publish under its own dist-tag, with a version
string that names why it exists:

```
5.1.0-compat-581-20260905211819
```

The mechanism already exists and has been used: `#83` in this repository was measured against
exactly that version — published `2026-09-05T21:22Z`, **15 hours** before `5.1.0` reached `latest`
at `2026-09-06T12:20Z`.

That figure was first written here as *"days"*, from memory, and corrected the same day after the
`theokit` session challenged a neighbouring claim and both were measured. Fifteen hours is still
worth having; the point is that the number in a document justifying a convention has to come from
`npm view <pkg> time`, not from how long the wait felt.

### Why not a symlink

Linking a sibling checkout into `node_modules` is the obvious shortcut and it is the wrong one.
Measured on 2026-09-06, all three routes:

| route | what happened |
|---|---|
| `pnpm link ../../../theokit-sdk/packages/sdk` | did **not** link — the symlink kept pointing at the store — and wrote `"sdk": "link:…"` into `package.json`, `pnpm-workspace.yaml` and the lockfile, all versioned |
| `link:` in `overrides` | works, and breaks every other clone and CI, which have no sibling checkout |
| snapshot publish | a real artifact, a real version, every gate keeps working |

The decisive objection is not ergonomics. **Under changesets the version field does not move until
the release, so a local checkout's `package.json` lies about its own source.** Measured the same
day: `theokit-sdk` on disk said `5.1.0` while its `HEAD` carried the `effectiveToolNames` fix that
shipped in `5.2.0`. Every gate that reads a version — `npm run blockers`, `tools/check-sdk-pin.mjs`
— would have reported confidently about the wrong artifact.

That failure has a name in this repository, and § *Ways a careful measurement still lies* is the
list of times it already happened. A symlink makes it the permanent, invisible default. A snapshot
version string cannot be mistaken for anything else.

### Where it does not work, and why

**A repository in changesets pre mode cannot publish a snapshot at all.** Not a policy — the tool
refuses:

```
node_modules/@changesets/cli/dist/changesets-cli.cjs.js:1352
  logger.error("Snapshot release is not allowed in pre mode")
  logger.log("To resolve this exit the pre mode by running `changeset pre exit`")
  throw new errors.ExitError(1)
```

Measured 2026-09-06 on changesets 2.31.0: `theokit` has `.changeset/pre.json` (tag `next`) and is
refused; `theokit-sdk` has none and is not. So this convention applies to `theokit-sdk` and does not
apply to `theokit` — and the remedy the tool suggests, `changeset pre exit`, is a release decision
nobody has taken, not a step in this procedure.

Measured by the `theokit` session, which refused the convention rather than writing a procedure its
own tooling rejects. That refusal is the right one: a documented step that throws on the first run
is the fabricated mechanism both repositories spend their time hunting.

**It is the same cause as the symlink objection above.** In pre mode changesets treats version state
as a single monotonic ledger, and a snapshot would fork it — which is why the on-disk `version` does
not move until the release. One cause, two symptoms.

### For a repository that cannot snapshot

The gap a snapshot closes is not *"no channel exists"* — a prerelease tag is pinnable by exact
version. It is *not knowing a cut happened*. That costs a message, not a publish:

> when a cut lands something a consumer is blocked on, tell them the exact version

No convention, no release decision, and it works in pre mode.

### The rules that make it safe

- **A snapshot pin never reaches `develop`.** It is a measurement aid; the merged tree pins a real
  release. A snapshot can be unpublished, and a versioned file pointing at one is a build that
  breaks for everyone later, for a reason nobody will connect to this.
- **A snapshot measurement does not close an issue.** It proves the fix works. `in-develop` and the
  close still wait for `latest`, per the issue-lifecycle rule: *corrected* and *installable* are
  different claims and only the second serves whoever is blocked.
- **Raise the pin BEFORE running any check.** Otherwise the checker reads the old tree and reports
  the gap as still real — correctly, about the wrong artifact. This cost a full re-measurement once
  and is now the first line of every upstream handover message.
- **Report the result back, including a failure.** The publishing session cannot tell whether what it
  shipped serves the consumer; that is the only thing the snapshot buys, and skipping it spends the
  cost without collecting the value.

The last rule is the one that carries the value, and it is **independent of the channel**. In the
B-152 handover it was the only one that acted — no snapshot existed — and what made the report
usable was removing the fix, watching the arm fail, and restoring it, rather than accepting a green
that looked right. The first three regulate a channel; the fourth is why anyone benefits from one.

### Reading an upstream tree without pinning it

`tools/check-upstream-blockers.mjs` takes an optional path, so a sibling checkout can be inspected
without touching this repository's tree:

```bash
node tools/check-upstream-blockers.mjs ~/…/theokit-sdk/packages/sdk
```

Useful for answering *"did the fix land?"* before a snapshot exists. It is not a substitute for
measuring against the artifact: it reads a tree whose version field, as above, may not describe it.

## Changelog

`CHANGELOG.md` is written for the person consuming this product, not for the person who changed it.
Reasoning about how a change was measured belongs in the commit message and in the source; what the
entry owes the reader is what became different for them.

## Naming and placement conventions

Measured into existence by the 2026-09-10 architecture review: each rule below was either being
followed everywhere except one or two spots (which read as drift), or followed consistently but
written down nowhere (which invites the first divergence). The structural decisions behind them
are in `docs/adr/0002-feature-first-placement-and-naming.md`.

- **Modules are kebab-case, including React hooks.** `use-backtrack.ts`, not `useBacktrack.ts` —
  the wider React ecosystem writes hooks camelCase, and this repository deliberately does not:
  every module file is kebab-case, with zero exceptions in the tree. Do not introduce the first
  `useX.ts`.
- **`.tsx` files are named for their PRIMARY export.** A component file is PascalCase
  (`Banner.tsx`, `BacktrackOverlay.tsx`); a module that happens to export a component among other
  things stays kebab-case (`theme-session.tsx` exports a store, three functions and
  `ThemedSurface`). `main.tsx` is the conventional entrypoint name.
- **Test variants use the dot qualifier: `<source>.<qualifier>.test.ts`.** `user-skills.wiring.test.ts`,
  `run-composition.smoke.test.ts` — the dot preserves the pairing between test and source
  basename, which the `tests/` mirror convention and the TDD pairing gate rely on. Do not hyphenate
  the qualifier into the basename (`on-disk-wiring.test.ts` was the drift; it is
  `on-disk.wiring.test.ts` now).
- **Feature files live in feature folders; package roots hold entrypoints and genuinely
  cross-cutting files only.**
- **Session vocabulary, because three folders can plausibly claim the word:**
  `packages/agent/src/session` is engine state (ops, history, GC, artifacts);
  `packages/tui/src/persistence` is what survives a restart;
  `packages/tui/src/agent-session` is the live bridge between the running agent and the UI.
- **Package-local scripts live in `<package>/scripts/`.** The repository root owns `tools/` for
  the build gates; a second unrelated `tools/` inside a package makes every `tools/` path
  ambiguous.
