# Changelog

All notable changes to this project are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versioning follows [Semantic Versioning](https://semver.org/).

**Work done in an upstream repository is named as such.** This product is built on `@theokit/*`, and
some entries record a fix that landed there rather than here. Those carry the repository — `theokit`,
`theokit-sdk`, `theokit-tui` — or say the change moved upstream. Measured 2026-09-03: 31 of the 131
backlog ids cited in this file belong to an upstream repo, and two entries under `[0.2.1] § Security`
describe an upstream release workflow as "the release path" with no such marker, which reads as this
product's own. Those entries are released and stay as written, per the rule against editing published
history; the convention is stated here so the next one does not repeat it. A reader who goes looking
for `release.yml` in this repository will not find it, and should not have been sent.

## [Unreleased]

### Fixed
- **Tool names are Claude Code's where the tool is the same one.** `run_shell` is `Bash`, `read_file` is `Read`, `edit_file` is `Edit`, `grep` is `Grep`, `list_dir` is `Glob`; the rest are PascalCase and keep their own names, because inventing an equivalence would make a pasted rule address the wrong capability. This is not cosmetic: `permissions` in a `.claude/settings.json` addresses tools BY NAME and `permissionRulesFromSettings` passes that name straight into the rule, so `Bash(ls:*)` could only ever match a tool named `Bash`. The system prompt, the approval gates and the UI labels moved with them — the product's own `tool_name_mismatch` guard caught every tool renamed without `withName`. (#736)
- **`doctor` no longer calls any parseable file a credential.** `{"not":"a-credential"}` is valid JSON, so it reported `credential: present` while the TUI showed `none` for the same file at the same moment. The `unreadable` state already existed and was never produced. (#823)
- **The settings row says when NO permission rule is in force.** It listed only the entries whose syntax could not be translated, so a reader concluded the rest applied. None did. (#824)
- **The test suite no longer logs you out.** `every-command.test.tsx` drives all 46 TUI commands, `/logout` among them, and `handleLogout` calls `logout(homedir())` — the harness mounts the real `<App />` in the test process, so that was the operator's own home. Every `npm test` deleted `~/.theocode/auth.json` while reporting 5 passed. Found by accident during an unrelated run, reproduced with a decoy (a generic file in the same directory survived; `auth.json` did not), and narrowed to that suite. The harness now runs against a throwaway `$HOME`, which covers the next destructive command as well as this one — fixing `/logout` alone would not have.
- **A confinement flag with no prompt is refused instead of dropped.** `theocode --sandbox read-only` on a terminal opened the UI and ignored the flag: `ExecUi` carries no options, so the `cli` layer that `security-floor.ts` designates as the operator's override reached nobody. Measured against a workspace whose file said `danger-full-access`: the operator asked for MORE confinement and got `workspace-write`, silently. It now exits 1 naming the flags it cannot honour; a bare `theocode` still opens the UI, and a prompt still honours every flag.
- **The installed binary opens the terminal UI.** `theocode` with no prompt on a terminal answered `No prompt provided` and exited 1, so the UI was reachable only through `npm run dev` in a clone — an installed copy had no way to reach the 46 slash commands, `/login` among them, which is how a credential is configured at all. No prompt plus a TTY now opens the UI; a piped prompt still answers and exits. Two bundling defects had to be fixed for the binary to start at all, and both built clean and died at runtime: Ink's optional `react-devtools-core` is resolved to an empty module (marking it external leaves an unresolvable import in the bundle), and the banner now builds a `require` so a bundled CJS dependency — `signal-exit`, via Ink — can call it at load time. Both are covered by tests that were checked against the code they protect.
- **`--continue` has a pointer to find again.** Making resume opt-in bypassed `loadOrCreateSessionId`, which used to write `.theokit/tui-session` as a side effect of reading it — so the default path stopped writing the pointer entirely and `--continue` had nothing to resume unless the user had first typed `/new`, the only other writer. Measured in a clean workspace after a full session: the file was not there. Reading the pointer is still gated by the flag; writing it never was. (#B-100)
- **The final answer may use the formatting the surface was built to render.** `## Final-answer style` opened with "Plain text; the CLI styles it" while `@theokit/tui`'s timeline passes `markdown={role === 'assistant'}` under the comment "Claude Code parity: an assistant turn is Markdown (headings, lists, fenced code → CodeBlock syntax highlight)", with 66 passing tests for that rendering in the very version this product consumes. Measured in a side-by-side run: two other agents returned cited code visually separated from their prose and this one returned it as running text. The instruction now asks for fenced code and keeps the restraint that was bundled with it. (#B-097)
- **The agent can now open a skill it was told to read.** The system prompt has been instructing the model to "call `skill_read` with its name to load the steps" while nothing ever added that tool, and the SDK is explicit that it never adds it for you. Measured beside Claude Code on the same project: it loaded a skill body and returned a token written inside; this product answered that the required tool was not available, over 75 skills sitting under `.claude/skills/`. The tool is wired from the project's own root, the repository's `.claude/skills/`, and the operator's `~/.theokit/skills/` — not `~/.claude/skills/`, which is another kit's corpus. (#B-099)
- **`doctor` and `/skills` stop answering "none" while the model carries dozens of skills.** Skills reach the agent by two paths: the declared one, which the wiring record observes, and `.claude/skills/`, which loads through the compatibility dialect and which that record never sees. Measured: `doctor` printed `skills: none` and `/skills` printed "no skills are enabled for this directory" while, in the same turn, the model reported 40 skills and named one created minutes earlier under that root. `doctor` now counts the foreign root; the panel scopes its claim to the path it can observe and names `doctor` as the surface that can answer. Neither presents the disk count as "active" — which of them reached the model is a question this product cannot answer while it passes a static system prompt. (#B-096)
- **The project-instruction header names the file the instructions came from.** It said "from AGENTS.md" unconditionally while the loader accepts `THEO.md`, `AGENTS.md` and `CLAUDE.md`, so a project holding only one of the others was told about a file it does not have. Measured: a canary appended to the only instruction file present — `CLAUDE.md` — came back attributed to `AGENTS.md`, a path nobody could open. With no known sources the header now names none, which is weaker than a precise attribution and far better than a false one. (#B-095)
- **The patch approval shows the change, not the envelope.** It printed the raw V4A body, so the prompt led with `*** Begin Patch` and closed with `*** End Patch` while the changed lines carried no per-file heading. Each file is now headed `Update <path>` (or `Add` / `Delete` / `Move to`) and every content line survives verbatim and in order — the decision is "do I want exactly this edit", and summarising would answer a different question. A body that is not V4A is shown unchanged rather than emptied. (#B-090)
- **A live test with no server now reports `skipped`, not `passed`.** Five guards were a bare `return`, which vitest counts as a pass, so a run with no model server reported five green tests that never executed. They use the test context's `skip()` now, proved both ways: dead server -> `5 skipped`, live server -> `5 passed`. The reachability probe also stopped interrogating a hardcoded host while the tests read a different one. (#B-093)
- **The `/clear` demo test no longer passes for a reason unrelated to its claim.** It drove `/help` — a panel, never conversation content — and its frame-changed assertion was satisfied by resumed history disappearing. Measured: the `/fork` line survives `/clear` in this harness both before and after that change, because `ink-testing-library` models neither scrollback nor the ANSI wipe the command performs. The limit is now stated in the test instead of hidden by a green tick. (#B-094)
- **A launch starts a fresh session; `--continue` (or `-c`) resumes the last one.** Resuming was decided by the mere presence of `.theokit/tui-session`, and nothing ever removes that file — so a directory used once resumed on every later launch, forever, with no flag to opt out. The only escape, `/new`, exists after the old context is already loaded. Measured on a restart whose purpose was to clear a session 46k tokens over its context window: it came back carrying it, announced by one parenthetical in the greeting. (#B-092)

### Added
- **One turn against a LIVE model is now exercised — the first test here that leaves the process.** Measured 2026-09-15 before writing it: of 216 test files, 45 mock the provider and exactly ONE attempted a real call, and that one skips without a paid credential nobody has set. So 1806 green tests said nothing about the half that makes this a coding agent. `packages/agent/tests/live/` asks the three questions no mock answers: does a turn complete with non-empty content, does the response arrive in MORE THAN ONE chunk (a single chunk is a whole response wearing a streaming content-type, which is exactly what a mock produces), and is a provider error surfaced rather than hung on or answered around. The third is what keeps the other two from being theatre. It runs against `ollama` on `localhost:11434/v1` — OpenAI-compatible, accepts any key — so it costs nothing and needs no secret, which is why it can run where a paid credential cannot. It SKIPS loudly, never fails, when no server answers: a machine without one is not a machine with a defect. What it does not claim is written in the file: a 1.5B model is not evidence the product is good, only that the path works.

### Changed
- **`@theokit/sdk` moves to 5.8.0, which makes the package's own public surface reachable.** The upstream release carries a gate that found 17 of 393 `@public` symbols resolving from no entry point — present in the tree, absent at the surface, across four published releases — and the two this project could have hit (`withheldSpecs`, `CompressionFailedError`) are now importable. Verified against the PUBLISHED tarball rather than the dist-tag: both symbols are present in `dist/context/index.d.ts` and `dist/errors.d.ts` inside the downloaded archive. All three declarations moved together — root manifest, `packages/agent`, and the `pnpm-workspace.yaml` override — and the installed tree was then checked PER PACKAGE, which is what caught `packages/cli` still resolving 5.7.0 through a symlink left behind by the temporary `link:` used to validate the build before publishing. Restoring the override file does not remove the links a previous install created, and an install that leaves one exits 0. 228 files and 1806 tests green, first against a local build of the release and again against the published package. (upstream `theokit-sdk#684`, `#686`)

### Added
- **The published `@theokit/*` surface is now exercised from this project, which is the only place it can be.** `packages/shared/tests/theokit-published-surface.test.ts` enumerates the export map of every installed `@theokit` package and imports each entry in a real `node` process from the directory that depends on it — 62 entry points across 5 packages. The upstream gate checks that a symbol marked `@public` resolves in the tree it just built; that cannot see an incomplete `files`, a condition that resolves nowhere, or a subpath published without its build output, because those only fail on a machine that installed the tarball. `node` is the oracle rather than a resolver call, and the reason is measured: `createRequire().resolve` asks for the `require` condition, so a first version failed all 20 `@theokit/agents` entries at once — entries this project imports successfully in 1740 other tests. A sweep where everything fails is a statement about the query. A `.json` subpath is loaded with the import attribute Node requires rather than excused, and the suite carries its own negative control, so a green run cannot be confused with a probe that is unable to fail.
- **All 43 TUI commands are driven through the real `<App />`, each on a clean screen.** `packages/tui/tests/demo/` mounts the same component `main.tsx` mounts and types character by character. Two things were measured rather than assumed. A slash command opens the command PALETTE, and the first Enter accepts the highlighted entry instead of running it — one CR leaves `/help` in the input at 21 lines, a second CR runs it and the screen goes to 51; without the second press, 22 of 43 commands reported "silent", which was this harness failing to submit and not the TUI failing to answer. And the claim the suite gates on is that every command MOVES THE SCREEN, not that it adds lines: `/clear` removes them by definition, so it is exempt there and proved in its own test with content deliberately on screen first.

### Changed
- **`@theokit/agents` moves to 14.1.0, which carries a seam for running work before a transcript is compacted.** `withPreCompaction` decorates a compaction strategy so a registered handler runs — and is awaited — before the rewrite; a failing or hanging handler is reported and compaction proceeds anyway. Verified against the PUBLISHED package from inside this repository rather than on paper: the three symbols resolve through the package entry (control: an invented export resolves `undefined`), and exercising the seam records the ordering `["handler","compact"]`, which is the entire guarantee. All four manifests moved together and the installed tree was checked per package, because a bump that moves one manifest exits 0 and leaves resolution where it was. **It does not reach this product's own `/compact`**: that command goes through `Agent.compact(sessionId, …)`, a path the seam does not touch — measured, and tracked upstream. (upstream `theokit`)

## [0.27.0] - 2026-09-13

### Changed
- **The framework dependency moved to `@theokit/sdk@5.6.0`, which is what removed the temporary clause above.** Every declaration moved together — the root `package.json`, `packages/agent`, and the `pnpm-workspace.yaml` override — because a bump that moves one of the three returns exit 0 and leaves the installed tree where it was. That is measured, not cautionary: an earlier bump in this repository reported success while `pnpm` went on resolving the pinned version from the override. The override itself is raised rather than deleted, and its recorded justification — "upstream will not raise that floor while only a prerelease exists" — is marked expired in place: `@theokit/agents@14.0.0` now declares `^5.3.0`, so the override is no longer the only route to a 5.x. Validated after the bump: typecheck clean, build clean, 226 test files and 1737 tests green.
- **A `permissions` block in `.claude/settings.json` is now parsed, and the entries this runtime cannot render are named per line.** Previously the whole key was reported as `not implemented here: permissions` and nothing else was said, so an operator could not tell a block this runtime fails to understand from one it understands and does not enforce. `doctor` now reports both. **This does not make permissions take effect.** The translated rules reach no engine — `AgentBuilder` exposes no seam that accepts them — so `permissions` deliberately REMAINS in the ignored list, and the operator is told the truth twice rather than once. Naming the per-line failures while dropping the "not implemented" line would have been the more satisfying diff and a false one: it would read, to the operator who wrote a `deny`, as confirmation that it is in force. Translation goes through `permissionRulesFromSettings` rather than the SDK's `parsePermissionRules`, which THROWS on a line it cannot read — correct for our own `.theokit/settings.json`, wrong for somebody else's file, where it would let their config crash our agent.

- **This product declares the foreign root's instructions as a surface it takes, so a coming framework release does not take them away silently.** `FOREIGN_SURFACES` gains `'context'`. The SDK gained a grant for `.claude/rules/*.md` (upstream `theokit-sdk#652`): until now those rules reached the system prompt through a door the other four surfaces were correctly refused at, and once the grant is enforced a narrowed `import` list that does not name them loses them — with no error, which is the failure the grant exists to prevent, arriving from this side. Not a widening: this product already received those rules on every run, and the name is what keeps that true. `SDK_FOREIGN_SURFACES` no longer excludes the name: `@theokit/sdk@5.6.0` published with `CompatSurface` widened to `"context" | "hooks" | "plugins" | "skills" | "subagents"`, so the temporary clause and the instruction to delete it are both gone. The exclusion existed for exactly one reason — the resolved copy could not name the surface — and it was removed by measuring the published tarball rather than by the dist-tag moving. Found by the compiler rather than by a release: passing an unknown surface to the SDK is a type error. Validated against a local build of the framework's `develop`, not the registry: typecheck clean, 225 test files and 1732 tests green. (upstream `theokit`, `theokit-sdk#652`)

### Fixed
- **A comment in `pnpm-workspace.yaml` outranked the override it was explaining, and the SDK-pin gate compared a version against a fragment of prose.** `check-sdk-pin.mjs` scanned the whole file with one regex and took the FIRST match, so a comment recording why the override exists — necessarily naming the package with a version — was read as the override. Measured in CI: with `package.json` and the override both at `5.6.0` and in agreement, the gate reported a disagreement with `^5.3.0`, trailing backtick and comma included, because that is what the sentence contained. The direction is what made it worth repairing rather than rewording the comment: the gate fails on the commit that DOCUMENTS the override and passes on the one that breaks it. Comment lines are now dropped before the scan — the defect was where it looked, not what it matched — and a control test pins that a genuine drift under the same comment still fails.

### Fixed
- **`doctor` told operators their `.claude/` hooks run without the approval gate; they do not run at all.** The message dated from when `claudeCode` was granted per SOURCE and opting hooks out needed `theokit-sdk#631`. That landed: the SDK takes a narrowed `import` list, this product adopted it in `FOREIGN_SURFACES`, and `hooks` is absent from it — so the SDK never lists `.claude/` among its hook candidates. Measured down the whole chain 2026-09-12. Telling an operator their shell runs ungated, when it runs zero times, sends them looking for a gate to tighten instead of for the reason their hook is silent — the third false statement of this shape in the same function, and the same direction as the other two: it reassured. Four tests pinned it and now refuse it. (#130, upstream `theokit-sdk#631`)

### Changed
- **The framework dependency moved off the pre-release line onto the published stable one.** `@theokit/agents` goes from `13.0.0-next.11` to `13.4.0` and `@theokit/presenter` from `^0.8.0` to `^0.9.0` — both resolved from the registry, with no local link or overlay, and the bump refused until the registry served the tarball rather than merely until a dist-tag moved. Validated against what a fresh consumer installs rather than against a working copy: typecheck clean, 225 test files and 1732 tests green, build green, the full `lint` chain — eslint, knip and the ten project gates — green, and the built CLI's own `doctor` reporting `0 failed of 12`. `13.4.0` carries eleven framework fixes for configuration surfaces that were declared and read by nothing: output styles, a dropped `.mcp.json` field, a `.claude/workflows/` directory found and deliberately refused, an operator credential helper, the settings files the declared layers pointed at but never opened, a `permissions` block translated into rules the engine evaluates, a managed `disableAllHooks`, and the operator tier exported so a diagnostic can finally distinguish `hooks: refused by operator policy` from `hooks: none` — the switch this product's diagnostic had been telling operators it lacked when it reported that hooks in `.claude/settings.json` "run WITHOUT this product's per-hook approval". (upstream `theokit`)

### Fixed
- **A hook declared in `.theokit/hooks.json` never ran, and nothing said why.** The framework's compatibility loader reads that file itself and spawns what it finds, bypassing this product's per-hook approval — so the gate refuses it, and a refused hook is treated as one that was never configured: the operation proceeds and there is no signal at all. The module had written the sentence that would explain it and nothing ever emitted it; `refusalNotice` had no production caller in any package. `theocode doctor` now names the file and the commands in it, beside the row where the equivalent `.claude/settings.json` refusal already lands. Answered from disk at diagnosis rather than at the spawn, deliberately: a spawn-time message can only arrive after the hook has already failed to fire, while "will my hook run?" is answerable before the turn starts. (#9)

### Changed
- The packages are feature-first at their roots too, and every finding of the 2026-09-10 architecture review is addressed. The loose files at both package roots moved into the feature folders that name them (`agent/src/chat/`, `memory/`, `doctor/`; `tui/src/session-ui/`, plus `backtrack-select` and `use-tui-composition` joining the folders that already named their domains); `packages/tui/tools/` is `packages/tui/scripts/`, so the repository-root `tools/` (build gates) is the only `tools/` again; the TUI's holder over the shared retry-record primitive is `retry-record-holder.ts`, so the contract and the adapter stop sharing a basename; three test files hyphenating their variant qualifier now use the dot style the rest of the suite uses; and architecture decisions have a versioned home under `docs/adr/`, which a clone actually receives — the gitignored personal records under `.claude/` never did. Naming and placement conventions are written down in `CONTRIBUTING.md § Naming and placement conventions`. Behavior is unchanged; importers of `@theocode/agent/chat` are unaffected (the subpath export moved with the file). Full remediation record: `architecture-output/final_report.md` findings PV#1–16, FO#2–9, FO#11, NV#1–3. instead of a scan through eight predicate functions that each answered whether they claimed the action. The eight groups, the precedence between them and the ~170 lines that expressed it are gone, and so is a test that parsed the dispatcher's own source with a regex to check that no command was claimed by two groups. It was safe to delete because the thing it checked was already clean and already inert — all 47 commands appeared exactly once, so the scan order was never observable — and the check now belongs to the compiler: a command with no handler does not typecheck, and a command with two handlers cannot be written. Verified rather than assumed: deleting one handler fails the build naming that command, and duplicating one fails both the compiler and the linter. No command behaves differently, and the narrow capability types that withhold the approval-mode setter from the read-only settings panels are untouched. (#40)
- The all-projects session sweep is two modules, `all-sessions.ts` (plan) and `all-sessions-apply.ts` (apply), and the collection floor both planners obey lives in `collection-window.ts` rather than inside one of them. The seam is the one the audit found rather than a tidy-up: every test file importing this module imported the PLAN phase only, and the arm that deletes registry entries was entered by nothing — which is how two data-losing defects sat inside it at 78.78% coverage with 21 sibling test files. A module boundary makes "which phase does this test drive?" answerable from the import line. The 400-line gate is what forced the question; the answer was already overdue.

### Fixed
- **The unattended daily session sweep could delete a live session's transcript, and reported removals it never performed.** `sessions gc --all-projects --apply` is spawned by the TUI at startup. Four of its guards compared a **session id** against a **transcript filename** — which the SDK derives by hashing the id — so they matched nothing, silently, on every run. Measured by driving the real planner and sweeper: the TOCTOU backstop's refusal list came back empty and the live transcript was unlinked (#49); `deleteAgent` was handed the filename, which `Agent.delete` does not recognise, so it no-opped and never touched the `.jsonl` while `removed` reported the file gone (#51); a registry entry was collected while the transcript naming it was kept (#52); and an entry with no date was aged to 1970, read as ~19 000 days old, and collected on sight (#55). `per-session.ts` was fixed for this class twice and pins it with a test; the all-projects sweep never got the fix and had no test that entered its apply phase. It has one now. (#49, #51, #52, #55)
- **`sessions gc --max-age-days 0` deleted where it should have refused.** The floor of one day was enforced by the all-projects planner and by nothing else, so the same number was refused with `--all-projects` and executed without it — planning every transcript outside the protected set. The floor is now one exported constant enforced on both paths, because the reason for it does not depend on how many projects are being swept. (#56)
- Two guards against `undefined` on fields the type system declares required are gone from the session collector; they could not fire, and a guard that cannot fire is indistinguishable from one that protects something. (#27, #28)
- **Editing `.theocode/settings.json` and then typing `/new` could kill the terminal.** `/new` re-reads the configuration, and a malformed file made `resolveEffectiveConfig` throw on a path fired with a bare `void` — an unhandled rejection, which `node >=22` turns into process death by default. The session-start seam now degrades and reports the reason on the diagnostic channel, so a typo in a config file costs a log line instead of the session. (#57)
- **`/usage` before the first turn ate the next Escape.** The panel only draws once a turn has reported usage, but the Escape ladder was told the panel was open as soon as the toggle was flipped — so the first Escape of a stream closed a panel that was never on screen and the turn kept running, on the gesture whose whole purpose is stopping it. Escape now interrupts, and `/usage` says "no usage yet" instead of doing nothing silently. (#58)
- **`/status` and `/theme` reported the environment's theme after `/theme custom:<slug>`**, and `/theme` listed the file being drawn under "also", as one still available to switch to. Both reports now name the theme actually in force. (#14)
- Nine subcommand-scoped CLI flags parsed on every mode and were silently discarded by the modes that never read them — `theocode hello --max-turns 3` and `sessions delete abc --keep 5` among them. Each is now refused by name, saying which command honours it. (#24)
- **A failed end-of-turn diff said it could not be shown and never said why.** The git seam behind it was built with an empty warning callback, discarding the reason git gives on stderr; the same call site also hard-coded a 10 s timeout where the project's own `shell_timeout_ms` applies. (#29)
- **A retry count from a contended turn was attributed to the turn that replaced it.** When a session is busy the CLI forks and opens a second stream on the same failure hooks, and the per-turn reset was never wired — so a failure that made one attempt could report "after 3 attempts". (#30)
- Two stale claims in the theme modules: the docblock stating `/theme` is "NOT PERSISTED, deliberately" (it has persisted since #72, and the paragraph was the argument a maintainer would have cited against the shipped behaviour), and the claim that a rejected `THEOCODE_THEME` value is surfaced by `App` (it is reported by `/status` and `/theme`, on demand, and never at startup). (#15, #16)

### Added

- Tests for the three-state hook trust classification (`trusted` / `untrusted` / `modified`), which decides what the consent screen shows before a hook may run and which no test imported — its only appearance in the suite was a stub returning `[]`. The `modified` branch, the one that recovers the previously approved command so an operator can tell an edit from a hook they have never seen, had never executed. Seven cases now cover all three states plus per-project scoping and the fail-closed answer when only the timeout changed. (#44)
- Tests for the six transitions of the TUI consent state model, previously at 0% with no test file naming it. The asymmetry an audit flagged — `trust()` bumps `epoch`, `distrust()` does not — is asserted with its reason rather than "fixed": `epoch` is the invalidation key of the pending-hooks memo and bumps when an on-disk input was WRITTEN, and `distrust()`'s only caller is the rollback of a trust persist that FAILED. The test that pins it also guards that premise, and goes red if a caller ever revokes already-persisted trust. (#45)
- Tests for credential provenance — the module that answers where the running credential came from and renders it in the footer — plus the refusal paths of API-key login and logout. Covering the `.env` reader closes a wrong-label failure mode: attributing a shell variable to a file sends the user to edit something that is not the source. (#46)
- A pinned, named defect in the `.env` reader found while covering it: a multiline value closed by a lone `"` on its own line swallows every declaration below it, because the quote-closing check strips a leading quote before looking for one — correct for the line that opens a value, wrong for every continuation line. The consequence is under-claiming (`(shell)` for a variable the file declares), so it is recorded with a test rather than fixed in passing. (#46)
- The English-only guard detects a fourth shape: **bare Portuguese function words used as identifiers**. `fork: (de, para) => forkSession(de, para)` shipped in `packages/tui/src/agent-session/composition-root.ts` and the guard printed `clean`, exit 0 — correctly by its own rule, since `isPortuguese` short-circuits on `EN.words.has(w)` and both words are in the English lexicons it loads (`de` in all three, `para` in `en_US.dic`). No denylist entry could reach them, and the file's own header forbids trying: forcing `para` would break the EN/PT collision handling it was rewritten to get right. So the new detector matches a SHAPE, the way the possessive detector (B-084) does — two bare Portuguese function words standing as whole identifiers on one line. The pair is what makes it safe: `para` alone is a real English identifier (the abbreviation for paragraph), and `rules/english-only.md` § "Detection is precise, not exhaustive" deliberately tolerates these words in prose, because "the first thing anyone does with a noisy gate is turn it off". That call stands; only identifiers are affected. Verified against the whole tree: one violation found, and it was the real one.
- Tests for the three `tools/` checkers that had none — `check-artifact-promotion.mjs` and `check-typed-error-assertions.mjs`, both in the `npm run lint` chain that gates every build, and `build-cli.mjs`, which produces the `dist/theocode.mjs` artifact `package.json:bin` points at. This was the project's own rule inverted: `rules/testing.md` says code without a test works by coincidence, and `packages/` honours it with 198 test files against 239 sources, while the checkers that ENFORCE the rules were exempt. The failure mode is silent — a checker that mis-globs, throws early, or matches no line still exits 0, and a green build is read as evidence. Each suite leads with the negative case (a fixture that MUST fail) and carries the anti-vacuity floors this repository's guards already use. Proven non-inert, not just green: a planted violation makes the typed-error CLI report it, and removing it returns the gate to clean. 11 of the 12 `tools/` scripts are now tested; `check-upstream-blockers.mjs` is deliberately left, because it runs only from `npm run blockers`, where it fails at a prompt rather than silently in CI.

### Changed

- `classifyHooks` no longer demands an approvals map it never read. The parameter was bound to `_approved` and ignored — deliberately, since the store is the authority and a caller-supplied copy could answer a security question with stale data — but the sole caller performed a real disk read to supply it, so the consent path read as though that read decided the classification. On this surface the signature has to state which, and it now states it by not asking. The dead read is gone with it, and with the read a failure mode: it could throw, and the catch around it turns any throw into "nothing pending", which closes the gate. (#61)
- `packages/tui/src` no longer holds two closed modules loose at its root. `clipboard.ts` + its three siblings (4 files, 123 LOC, mutually closed — `clipboard.ts` imports all three and nothing outside the set imports them individually) moved to `clipboard/`; `theme.ts`, `theme-base.ts`, `theme-store.ts`, `custom-theme.ts` and `theme-session.tsx` (5 files, 610 LOC) moved to `theme/`. The threshold is the package's own, not folklore: it had already created `composition/` for 2 files and `backtrack/` for 5. Tests moved with them per `rules/testing.md` § 5. The re-anchoring that rule warns about was paid and verified rather than assumed — two test files gained a `../` because they descended a level, and the gates were re-checked by planting a violation in the new location: eslint reports it, knip reports a dead export there, and the moved tests execute. The measurement quoted in `knip.jsonc` keeps its 2026-09-03 paths, with a note that the file has since moved: a live pointer is re-anchored, a quotation of a measurement is not.
- `chat.ts`'s 177-line `withShellAndProjectEntities` is split at the seam its own name announced. `withShellTools` wires the tools this process provides and the approvals gating them; `withProjectEntities` wires the entities read from the project's disk — MCP servers, skills, setting sources, hooks — every one trust-gated, because an untrusted repository must not steer the agent. The original name survives as the composition point and now earns its `And`. The context type is declared once as `ShellAndProjectCtx` instead of being repeated per function; the repetition was not merely untidy, it pushed the file past this repository's own `max-lines` gate. No public surface changed and no caller moved.
- `baseAgent` was measured and deliberately **not** split, with the reason recorded beside it. The review asked for the check before the cut — sequential wiring is acceptable, branching is not — and the answer is 163 lines of which 114 are comment: 49 code lines, 15 fluent chain links, 6 branch operators, cyclomatic complexity 10 by typescript-eslint's AST, which is AT this repository's gate rather than over it. Splitting a linear chain that is mostly its own documentation would buy a smaller number and a worse file. The decision is watched rather than asserted: `complexity: ['error', 10]` runs in `npm run lint`.

### Fixed

- An architecture review reported `sessionAndScreen` at cyclomatic complexity 49 — the worst hotspot of its run, double the next entry. It does not exist. `lizard` reads TypeScript with a JavaScript tokenizer that merges adjacent functions when a signature carries type annotations, and it had absorbed seven siblings; the real function is 66 lines with a 7-case switch. Nothing in this repository needed changing: `eslint.config.mjs:50` already sets `complexity: ['error', 10]` at the consensus McCabe threshold, it runs in `npm run lint`, and it reports the file clean. Verified that the rule genuinely engages rather than silently skipping the file — lowered to 3 it fires seven times. The recommendation the review made to this project was for a gate that was already here; the defect and its fix belong to the auditing plugin, which now refuses to present a merged measurement as citable.

### Added

- **A formatting channel that reports without blocking — `npm run format:check`.** `.prettierrc` declared a style and `prettier` was a devDependency, but the only invocation wrote files on demand: no channel anywhere ever asked whether the tree matched. It is deliberately kept OUT of `npm run lint`, because a chain where a brace style fails the way a correctness bug does is a chain people stop reading — so `lint` blocks and `format:check` informs. `CONTRIBUTING.md` now says which is which, and sends anyone about to run the formatter to `.prettierignore` first, since several files in this repository are read by a program rather than a person. Well over a hundred files are drifted; clearing them is a separate mechanical change nobody has made, and it is visible now only because something finally prints it. (#38)
- **`.github/CODEOWNERS`, naming a reviewer for the machinery that decides whether a build is green.** No such file existed at any of the three locations GitHub reads, so the checkers in `npm run lint`, the workflows that run them, and the configuration they read could all be relaxed or deleted with nobody asked. It is deliberately short — the product source is not listed, because a change to `packages/` is judged by the gates and a change to the gates had nothing left to judge it. `package.json` is covered alongside the checkers: dropping a `&& node tools/check-*.mjs` from the lint chain is the cheap way to disable a gate, and it leaves every checker's own tests passing. (#4)
- **A guard that fails the suite when a test makes a temporary directory and does not remove it.** Fixture lifetime was covered by no rule and no check, which is why sixteen files drifted into the same habit and two separate measurements of the cost changed nothing. It is the sibling of `no-ambient-cwd.test.ts` and copies its shape: a scan of every file under each package's `tests/` and under `tools/`, a floor on how many files were scanned so a wrong root cannot report a clean tree, and a message naming the pattern to copy. It reads the `node:fs` import rather than the call text, because one file legitimately prints `mkdtempSync(...)` as advice and a guard whose first finding is a false one gets phrased around. Its rule was tightened once already, after measurement showed the first version accepting an `afterEach` that restores an environment variable and removes nothing — the largest leaker in the tree — and that case is now pinned as a test. One limit is stated rather than left to be discovered: a file that removes some of the roots it makes still passes. (review #59)
- **The convention that a guard test must lead with a fixture that fails is now written where a clone can read it.** 132 of 209 test files already follow it and the rule stating it shipped in none of them — it lives under `.claude/`, which is gitignored. `CONTRIBUTING.md` carries both halves and why each is load-bearing: a guard that has quietly become a no-op passes its own suite, and a guard that flags everything passes the half that catches the first one. The section names the cost on the record rather than arguing in the abstract — a commit shipped with a mutant its own plan had predicted, green across 203 test files and 1,530 assertions, caught afterwards by a human. It states plainly that nothing enforces it: a grep cannot tell a floor from a comment mentioning one, and mutation testing is the instrument that could. (#60)

### Changed

- **A suppression that has stopped being needed now fails the build instead of living forever.** `eslint-disable` directives were reported as warnings, and `npm run lint` runs bare `eslint .` with no `--max-warnings`, so the run exited 0 and the set of suppressions could only grow. It is an error now. The other half of the same problem is that a suppression without a stated reason cannot be re-judged — the next reader cannot tell a considered exemption from one added to make a build go green — so the two directives that carried no `-- reason` have one, and all five in the tree now do. Verified against a planted defect rather than a clean run, since "nothing to report" and "nothing was checked" print identically. (#1, #2, #3)
- **The 25 scripts that build and gate this repository are linted; they were exempt.** `tools/` was excluded from ESLint on the grounds that its scripts need `module`/`require` in scope. Measured, that is true of exactly one file — the dependency-cruiser config — and false of every script under `tools/`, which are ESM and report zero problems once included. So `tools/build-cli.mjs`, which produces the `dist/theocode.mjs` that `package.json:bin` points at, and every checker in the `lint` job, were the one part of the tree no linter read. The genuine case is answered rather than excused: `module` is declared for `**/*.cjs` so that config is linted too. The complexity caps are deliberately NOT extended over `tools/` — they would report 20 pre-existing violations, and this configuration's stated bar is that a cap freezes a measured-clean state instead of announcing debt. (#39)
- **`npm run format` no longer rewrites `pnpm-lock.yaml`.** The lockfile is generated and parsed, and the formatter wanted 3,292 of its 3,763 lines — exploding every integrity hash onto four lines of its own, for a diff pnpm undoes on the next install while hiding whatever real dependency change shipped beside it. It joins the CHANGELOG and the BACKLOG in `.prettierignore`, which is where this repository records the files a machine reads. The header of that file also gains a correction it needed: Prettier honours the root `.gitignore` and not a nested one, measured both ways. (#38)

### Deprecated

### Removed

### Fixed

- **A lint gate that had been checking nothing for weeks now says what it checked.** The artifact-promotion guard compared two homes of a cycle artifact, and every one of the six directories it named was gone — the working area had been renamed and the published one deleted. Each missing directory was answered with an empty list, so the gate printed "no divergent duplicates" and exited 0 having opened no file. It is re-anchored on the directories in use, an unreadable directory is now an error instead of an empty answer, and every run ends with a count of what it compared — a run that compared nothing prints SKIPPED rather than a clean line. Because the working area is not versioned, that is what it prints on CI, which is stated in the file instead of being disguised as a pass. (#20, #41)
- **The typed-error-assertion guard was skipping every test in `tools/`.** It declared `tools` as a scan root while accepting only `.ts`/`.tsx` test files, and all eleven tests there are `.mjs` — so a `toThrow()` with no error type named was flagged in `packages/` and invisible in `tools/`. The pattern now covers the extensions the repository actually writes tests in (212 files scanned, up from 202), and a declared root that contributes no file says so on every run instead of passing quietly. (#21, #42)
- **The backlog cross-validation gate reported 124 items "consistent" when it had checked 24 of them against their own code.** The remaining 100 named no source path, took a branch that recorded "no source path named", and that note was never printed. Verified and unchecked are now separate lines, so the headline states what was verified rather than how many items were seen. (#22)
- **A backlog citation that stopped resolving was being dropped instead of reported.** When an item named a source file that had since moved, the cross-validation gate silently removed it from the set it checks; nine items were in that state and five lost their only citation, after which they were counted consistent having verified nothing. Paths that no longer resolve are now listed under their own heading, with what to do about them. (#23)
- **The one required CI check with no test has tests, and something runs them.** `check-backlog-crossval.py` ran entirely at import time and called `sys.exit`, so importing it ran the check and killed the interpreter — untestable by construction, which is why the two reporting defects above went unnoticed. The decision is now a function behind a `__main__` guard with 15 tests over it, run by `npm run crossval` ahead of the check itself, so a broken test fails the same gate. (#43)
- **Six tests decided their result on the host clock, on a runner this repository configures for `cpus - 4` parallel workers.** Two asserted a wall-clock delta to prove a property the test could read directly: that the session sweep is handed to a child process rather than performed inline, and that a configured `shell_timeout_ms` — not the runner giving up — killed a subprocess. The first now asserts the delegation through the `spawnSweep` double that was already injected, and that no completion was reported before the child had finished one; the clock survives only as a coarse net, moved from 500 ms to 4 s, which is still below the fastest in-process sweep ever measured here (4.9 s warm, 13 269 projects). The second now checks that the command did not live long enough to print its last word, and expresses its remaining budget as a multiple of the 120 ms bound over a command that would otherwise take 10 s, instead of a 2 s figure sitting next to a 5 s race. Stated rather than hidden: with an empty projects root injected, the sweep test's clock could never have caught an inline sweep of that root, so the delegation assertion is what carries the claim. (review #47)
- **Four render tests waited a fixed guess instead of waiting for the thing they were waiting for.** A 60 ms sleep stood in for a 34 ms coalescing window, three 20 ms sleeps for an asynchronous `/resume`, and a 50 ms `painted()` in two files for an Ink commit. Losing that bet fails in the honest direction — the frame has not painted, so the assertion reads an empty timeline — but an empty timeline is exactly what the bug under test looks like, so a scheduling delay was reportable as a product defect. They now poll a named condition with a one-second deadline, and a condition that never holds fails saying which one. Two negatives that a sleep could not decide are now decided: `/resume`'s refusal paths wait for the toast both branches end in, so "the flag never fired" means the handler finished rather than that it had not started, and the anti-thrash title case follows its unchanged rerender with a changed one, so "nothing was written in between" is read off the sequence of writes rather than off a timer. (review #48)
- **Sixteen test files created temporary directories on every run and never removed them.** Measured on one developer machine: 28 077 directories in `/tmp` under the prefixes these files use, 150 of them new from a single full run, one file accounting for 63. The remedy already existed in the tree and was copied into the files that lacked it — a list of what was made and a hook that empties it — lifted into `packages/agent/tests/helpers/temp-root.ts` for the eleven files in that package and written inline where a package or `tools/` had one caller. The review counted thirteen; sixteen is what measurement found, in both directions: one of the thirteen creates no directory at all and only prints the idiom as advice, and four more were found after the new guard's first rule was tightened. (review #59)

### Security

## [0.26.1] - 2026-09-10

### Fixed

- **`/status` no longer reports the rules as fully loaded after a second ceiling cut them (B-173).**
  Two limits act on the rule corpus in series: the loader's, which bounds what is read, and an
  aggregate one that trims the whole composed persona to fit the model. Only the first reached the
  status row, so a run whose rules had ~30,000 chars removed downstream still printed "12 loaded" —
  the agent answering normally, having never seen a third of what the repository wrote for it.
  The information was never missing; it was announced in a warning string no surface could read.
  `composeInstructions` now RETURNS what it cut and from which source, and the row reports the
  second limit as its own clause: *"12 loaded; a later ceiling cut the block from 50,000 to 20,000
  chars"*. Two clauses rather than one percentage, because the limits count different things — the
  first source characters, the second rendered ones — and a single share over two units would be a
  number no reader could check. A cut the aggregate limit takes from the surface document or the
  AGENTS.md chain is not attributed to the rules — that mis-attribution is what made an earlier
  attempt describe an intact 18-character rule block as cut from 200,000 chars to 86,346.
- Three tests no longer fail for operators who export `$THEOKIT_HOME`. They asserted about the
  operator-root seam while letting the environment decide where the loader looked, so an ordinary
  local setting produced three red tests that were about the environment rather than the code
  (B-172).

## [0.26.0] - 2026-09-09

### Added

- `buildChatAgent` accepts a `home` option naming the operator's root, defaulting to the real one.
  The operator's skills, rules and `AGENTS.md` all arrive through that root, and reaching it meant
  setting `HOME` for the whole process — which leaks across anything sharing the worker and cannot
  express one build reading one root while a sibling reads another. The three sites that composed the
  persona now share one resolved value. Other subsystems reached during a build — the trust store,
  config resolution, hook trust, MCP scopes — still read the ambient home and are NOT redirected by
  this option (B-167, with the remainder tracked as B-171).
- `clearWiring()` beside `recordWiring`, so a test that publishes a wiring record does not decide what
  the next test in its file observes. Vitest isolates per file, not per test, and one file had 13
  tests running after a publisher with the record still set (B-168).
- A suite guard that fails when any test hands `buildChatAgent` the real working directory. The
  invariant held by nobody having broken it; B-161 spent four channels establishing it and its plan
  declared this guard, which was never written (B-168).

### Changed

- The test suite no longer reads the checkout it runs in. Four tests reached ambient state — the
  process working directory, the real transcript store, and the rules corpus on disk — so the
  coverage total differed between an installed checkout and a clean clone of the same commit. Both
  now measure 2646/4488, verified twice in each environment against a real clone with its own
  install and compared per file across 239 files with no divergence. The total falls from 59.15% to
  58.95%: roughly ten lines were only ever covered by tests reading the real rules corpus off disk,
  which is coverage this repository had by accident of where the suite ran. The declared floor moves
  with it (B-161).
- Two trust tests no longer fail for operators who have a skill in `~/.theokit/skills/`. They
  compared the agent's skill list against an exact array, which cannot tell an operator's own skill
  from one contributed by an untrusted repository — so an ordinary local setup read as a gate
  failure (B-161).

### Fixed

- The coverage-floor guard's tolerance is pinned at its exact boundary again. Two fixtures were the
  old floor plus a delta; when the floor moved they stayed behind, and widening the tolerance stopped
  being caught by any test (B-161).
- `vitest.config.ts` stated a coverage floor two re-declarations out of date, in a tracked file every
  clone reads. The test meant to prevent that checked only that the prose mentioned the right things,
  never that its number was true; it now compares the two (B-161).
- The coverage-floor guard no longer reports a partial coverage run as a floor regression. Any
  `--coverage` invocation overwrites the same report path, so a single-file run left a report the
  guard compared against a whole-tree floor — it failed `pnpm lint` and proposed re-declaring a floor
  that was correct. A report showing coverage for no source file is now skipped by name; where a
  partial run did touch files it is indistinguishable from a real regression, so the guard still
  fails and the message names that third possibility instead of offering two that do not apply
  (B-165).
- The operator's rules now follow `$THEOKIT_HOME` when it points outside the home directory, as
  config, the trust store and MCP scopes already did. One build could resolve config from one
  operator root and its instructions from another: `homeStateDir` returns the configured path
  verbatim, while the rules loader dropped any root it could not express relative to the home.
  Both roots are read, and the 64,000-char prompt ceiling is applied once across them — an earlier
  attempt assembled each root separately and merged, which let two corpora that each fit produce a
  prompt of 126,012 chars reporting nothing truncated (B-171).
- The two operator roots are compared by resolved path, so a home reachable by two names does not
  have its rules read twice. `/home -> /var/home` on Fedora Silverblue, systemd-homed and any
  symlinked `$HOME` produce that shape; measured there, two rule files came back as four and a corpus
  that fit began truncating, dropping one of the operator's own files (B-171).

## [0.25.1] - 2026-09-09

### Fixed

- The coverage-floor checker skipped the one comparison it could make in a checkout without the
  kit, and said there was nothing to compare. `coverage.min_percent` is gitignored and never reaches
  a clone, but `DECLARED_FLOOR` is tracked and does — so the tracked number can always be checked
  against the coverage just measured, and the logic for that was already there and exercised. Only
  the path to it was missing: `main()` returned first, while a coverage report sat in the directory
  beside it.

  Measured in a checkout with no `.claude/`, before and after: `DECLARED_FLOOR` lowered to 40
  against a measured 59.15 used to exit 0 and now exits 1, naming the slack; lowered to 58,
  likewise. The real value still passes, and a checkout with neither the thresholds file nor a
  report still skips — and now says which of the two it lacks.

  What this still cannot see is `coverage.min_percent` itself, so the two halves *agreeing* remains
  a property of a machine that installed the kit. The checker's header says so.

  **Corrected before release.** The first version of this entry said the mutant "survived the whole
  suite in every fresh clone until now". It did not stop surviving: every new fixture was computed
  *from* `DECLARED_FLOOR`, so lowering the constant lowered the report with it and every assertion
  still held. A fixture derived from the thing under test cannot detect a change in that thing. The
  fixtures are literals now, the constant is pinned by a literal of its own, and the three mutants
  were measured dying in a genuine kit-less clone — where they had survived, including under the
  first version of this fix.

  Why no coverage step in CI is now recorded in the file that declares the floor, not only in a plan
  under `.claude/` that no clone receives: **+23 s** measured, so the obstacle is not price but that
  the step changes what every future pull request must satisfy.

## [0.25.0] - 2026-09-09

### Added

- `CONTRIBUTING.md` now says what `rules/*.md` means when a comment cites it. Measured: 29 tracked
  files carry 36 such citations, ten of them in production source, and none of those rule files is
  versioned here — they belong to tooling installed at `.claude/`, which is gitignored. A
  contributor reading `config/home-dir.ts` to learn why an error is typed was being sent to a path
  their checkout does not contain.

  The citations themselves are left exactly as they are, and that is the finding rather than
  laziness: each one is an **attribution**, and the sentence around it carries the reasoning on its
  own — *"keeps the error TYPED, which `rules/error-handling.md` asks for and a plain `Error` would
  give up"* tells you the whole thing without opening anything. Rewriting 36 sites would say once
  per site what one paragraph says once per repository, and give 36 places to drift.


### Fixed

- `packages/shared/src/turn-error.ts:23` cited `rules/error-handling.md § 3` for the generic-message
  anti-pattern. § 3 is the six-step hierarchy of handling; the anti-pattern is § 5. Production
  source, and the kind of error nothing detects: the sentence around the citation is correct and
  complete, so the wrong § misleads only the reader who goes to check it.

  Found alongside a second instance in the same review, in the argument for **not** building a
  checker for exactly this. Registered as B-164.

## [0.24.2] - 2026-09-09

### Changed

- Tests moved out of every `packages/*/src/` into a per-package `tests/` mirror, so production
  directories hold production code. 191 files relocated and 302 relative specifiers rewritten by
  codemod; `tools/` keeps its 8 tests beside its checkers, because it is not a package and has no
  `src/`. The suite reports the same 1527 tests green.

  Two things the move surfaced. `hooks-test-helpers.ts` was test scaffolding living in `src/`, and
  because it is not a `*.test.*` file the coverage config counted it as **production** — moving it
  removes 3 lines from the production denominator, so the declared floor moves with it. And six
  tests read their subject's source file **by path** rather than importing it, to assert on its text
  — that `process.cwd()` has not reappeared, that every routed subcommand is covered. Those six were
  re-pointed by hand and each was verified by mutating the source it reads and confirming it goes
  red; a wrong path still resolves to a file that exists, so a green suite would have hidden it.

  The coverage floor moves with the denominator, to **59.15%** (2655/4488), re-measured in a
  checkout with all three contamination channels checked absent one at a time rather than derived
  by subtraction.


### Fixed

- `test_every_routed_subcommand_is_covered_by_this_file` asserted nothing, and had done so since
  routing moved out of a `switch` into the `SUBCOMMANDS` table. It scraped `case '…':` labels out of
  `args.ts`, which has held none since; the regex matched an empty set, so the assertion compared
  `[]` to `[]` and passed for any input. Adding a real routed subcommand left all 46 tests in the
  file green. It now reads the table it is about, by importing it instead of scraping text, and the
  same mutant kills it.

  The trap is worth naming: mutating `args.ts` with a synthetic `case` label **does** turn the old
  test red, so a mutation aimed at the detector's regex reports a kill while the invariant behind it
  is unguarded. A mutant has to touch the invariant, not the instrument.

- Two gates had quietly narrowed when the tests moved out of `src/`, both staying green while
  covering less: `knip.jsonc` scoped every workspace to `src/`, so 191 test files dropped out of
  dead-code analysis (it reports the empty globs as hints and exits 0), and `eslint.config.mjs`
  scoped the swallowed-rejection rule to `packages/*/src/**`, losing `no-restricted-syntax` over the
  test tree. Both re-pointed. The eslint one immediately caught two orphan imports left by the fix
  above, which is the gate demonstrating it works.

## [0.24.1] - 2026-09-09

### Fixed

- The Codex parity checker released in 0.24.0 carried the bug it was written to catch. Its post-
  release review — the item shipped without one, because its validation had halted on a coverage
  gate that a different item had to fix first — found four defects, each reproduced before being
  fixed. The parser could not read a strum attribute carrying **both** forms
  (`#[strum(to_string = "pwd", serialize = "cwd")]`): the pattern needed `)]` right after the first
  quoted value, so the variant fell through to its kebab-cased name. That is the
  `auto-review → approve` rename the item was raised for, alive inside its own fix, and unnoticed
  only because the three commands Codex declares that way happen to render the same either way. The
  revision label named the **wrong repository** — `git -C codex log` walks up when `codex/` is not
  itself a checkout, so a vendored or tarball copy made the checker report the host repo's commit as
  the Codex one. A rename landed on a map key that already existed. And the two local source reads
  were unguarded, throwing the stack trace inside `npm run lint` that an edge case had hardened the
  Codex read against. Seven tests added: the suite had asserted **counts**, and a parse that finds
  most of a surface has the right count and the wrong contents — four mutants survived it, including
  reverting the fix the item exists for. All six now die.

- The coverage floor released in 0.24.0 was measured on a contaminated tree and is corrected from
  59.29% to **59.18%** — a number that itself took two attempts, because the first correction was
  measured in a worktree with the kit symlinked in and was contaminated the same way. Acceptance on the `v0.24.0` tag reported `coverage FAIL — 59.2% is below the
  59.29% floor`: `packages/agent/src/context/agents-md.ts` walks ancestor directories for
  `THEO.md`/`AGENTS.md`/`CLAUDE.md` until it finds `.git`, so from a maintainer's working tree it
  reaches a context file above it — the mechanism is demonstrated, the specific trigger in the
  maintainer's tree is not: two named causes were falsified by execution, so the honest statement is
  that this channel is real and not yet understood. It is one of **three**. The other two are a transcript store read from the home
  directory and keyed by the checkout's path, and a rules-corpus size threshold that makes the total
  depend on how large an installed kit is. Measured, one variable at a time: 2658 lines with none of
  them, 2663 in the maintainer's tree.
  The floor is therefore declared at the **minimum over that space**: a ratchet against the clean
  reading, and a floor with named slack anywhere else. Calling it a zero-slack ratchet everywhere
  would be false while the total still depends on the machine. The 0.24.0 entry below stands as
  published. The defect is B-161, and it is what would make a single number honest.

## [0.24.0] - 2026-09-09

### Added

- backlog B-159 — total line coverage is 59.29% against a floor of 80, so every plan halts at validation

- `tools/check-codex-parity.mjs`, wired into `npm run lint`: a Codex command that is in neither this
  product's builtin list nor its pointer map now fails the lint chain. The map asserts which Codex
  commands have no local equivalent and nothing verified that assertion. First run against a current
  Codex found **eight**: `approve`, `recap`, `voice` and `worktree` answered `unknown command`, and
  four entries — `auto-review`, `multi-agents`, `elevate-sandbox`, `sandbox-read-root` — named enum
  VARIANTS Codex never exposes, each shadowed by a `#[strum(...)]` override that is what a user
  types. All eight closed. The checker prints the commit it compared against on every run, because
  reading a month-old checkout reports a clean surface while four commands are missing; where the
  study clone is absent it SKIPS loudly rather than passing. (#158)

- backlog B-158 — nothing verifies the Codex parity map, and it has already drifted


### Changed

- backlog B-159 — this repository now declares its own coverage floor, at exactly the total it
  measures (59.29% of lines, `coverage.min_percent` in the code-quality thresholds). Until now no
  floor was declared and `/implement`'s validation gate fell back to a library default of 80, so
  every plan failed validation on a repo-wide number nobody here had chosen — including a plan whose
  own new file was at 100%. The declared value is a **ratchet, not a target**: it has no slack, so
  any change taken through `/implement` that lowers total coverage fails, and the only permitted
  edit is upward. Two limits, stated because the sentence above reads stronger than it is: the
  floor lives in `.claude/`, which this repository does not version, so it binds a checkout that
  installed the kit rather than every clone; and CI runs `pnpm test` without coverage, so nothing
  enforces it at merge. `vitest.config.ts`
  still sets no vitest threshold and now says where the floor actually lives; the triage it has asked
  for since 2026-08-20 — deciding which zero-coverage files are meant to stay that way — is still
  open and is what raises the number.

- `tools/check-coverage-floor.mjs`, chained into `npm run lint`: **the floor is now declared twice
  and the two must agree.** `DECLARED_FLOOR` in that file is tracked by git; `coverage.min_percent`
  in the thresholds file is gitignored and is what the kit's gate reads. The reason for the second
  copy is the reason the first version of this checker did not work: a downward edit of the
  gitignored value appeared in no diff, no review and no CI, because nothing versioned knew what
  the number used to be. Lowering the floor now means editing a tracked constant, which a reviewer
  sees. The check needs no coverage report, so it runs on every lint.

  It also fails on a value the kit would silently reject (a trailing comment makes `float()` raise
  and the floor reverts to 80), and on a floor that has drifted far enough below the measured total
  to have acquired slack — how a ratchet decays by time rather than by decision. Where the
  thresholds file is absent it skips and says so, naming the tracked number: this does **not** turn
  coverage into a merge gate.

  It parses that file the way the kit's Python gate does, which is not the obvious way. Python's
  `splitlines()` breaks on carriage return, vertical tab, form feed, the file/group/record
  separators, NEL and the two Unicode line separators; splitting on `\n` alone left a declaration
  hidden behind any of them authoritative for the gate and invisible to the checker — measured, an
  effective floor of 5 reported as agreement at 59.29, needing only a stray CR from mixed line
  endings and touching no versioned file. It also accepts exactly the numeric grammar `float()`
  accepts, and tries both the plugin and standalone layouts in the gate's own order.

## [0.23.0] - 2026-09-08

### Changed

- `@theokit/sdk` pinned at 5.5.0 (was 5.4.0). It answers this product's request (theokit-sdk#637):
  `HookApprovalRequest` now carries `timeoutMs` — the timeout the runtime **will** apply, default
  already resolved — and `sourceEvent`, the event key as the config file spelled it (`PreToolUse`,
  not `preToolUse`). Together they are exactly the identity this product's approval store hashes, so
  approving a particular foreign hook instead of refusing every one becomes possible.

  **Not built on yet, and the measurement says why.** A probe in the gate shows it is currently never
  consulted at all: since v0.21.0 the import list keeps the framework from reading `.claude/` hooks,
  so there is nothing left to ask about. Building an approval path on a seam that cannot be observed
  running would be the same defect this product has spent the week filing. The gate stays — it covers
  `.theokit/hooks.json`, which no import list reaches — and the approval path is tracked separately
  with what it would take to exercise it. (#198)

## [0.22.1] - 2026-09-08

### Changed

- `@theokit/agents` pinned at `13.0.0-next.11`. Types only: it moves the explanation of why the SDK's
  `CompatSurface` has four names and the layer's has five out of `//` comments — which do not survive
  into the emitted `.d.ts` — and into the JSDoc a consumer actually reads. Verified rather than taken
  on the release note: the four `.js` files that differ are identical once chunk hashes are
  normalised, with a positive control that fired. Taken, where the docs-only `@theokit/sdk@5.3.3` was
  declined, because the delta is not zero for a reader: it is the answer to the `TS2345` this product
  hit while converging the four call sites, and it now appears at the point of the error. (#188)

## [0.22.0] - 2026-09-08

### Changed

- `@theokit/agents` pinned at `13.0.0-next.10`, and the foreign-root declaration now **governs** the
  four call sites that reach `.claude/` instead of one. Each passes the same exported
  `FOREIGN_SURFACES` rather than its own wide `['claude-code']` literal, so tightening the list
  finally tightens the product. Proved by the arm that separates governance from coincidence —
  removing a surface and watching only the foreign half disappear:

  | site | with the surface | without it |
  |---|---|---|
  | commands | `ccprobe` + `tkprobe` | **`tkprobe` only** |
  | subagents | `nativerole` + `foreignrole` | **`nativerole` only** |

  `commands` had to be added to the list: measured upstream, a narrowed list without it reads as
  "not declared" and the directory goes dark — which is why the entry is named rather than inherited
  from the wide form. The delegated-role site takes `SDK_FOREIGN_SURFACES`, the same list minus
  `commands`, because `@theokit/sdk@5.4.0`'s vocabulary has four names where the layer's has five;
  it is derived from the one constant, never written out twice. No surface regressed: both skills
  still reach the model, both commands and both roles still load, and the three hook arms are
  unchanged. (#188)

## [0.21.2] - 2026-09-08

### Fixed

- The foreign-root divergence table names four call sites, not three. `delegation/roles.ts` builds a
  delegated role's own `local` with the same wide literal and no hook approval gate of its own, so a
  subagent could in principle have spawned what the parent refuses — the #130 fix went to the parent.
  Measured with delegation confirmed rather than assumed: the child ran its tool and reported the
  file's contents, and the foreign hook fired zero times. Not a hole, and now written down rather
  than re-derived from the same alarming line. (#188)

## [0.21.1] - 2026-09-08

### Fixed

- The foreign-root import list now says what it does not govern. Measured: removing `'subagents'`
  from it leaves `discoverRoles` returning the foreign role unchanged, because that path — and the
  TUI's custom commands — reach `.claude/` with their own direct `compatSources: ['claude-code']` and
  never through the declaration. Three call sites, one declaration, and someone tightening the list
  to stop foreign roles would get no error, no warning and no effect: the "declared and inert"
  failure, in this product's own code. The entry stays (it states what the framework may load, and
  dropping it would silently lose foreign roles the day anything routes through it); a comment and a
  test pin the divergence so it is discovered rather than believed. Converging the three is #188.

  Also measured while checking it: v0.21.0 did **not** regress `.claude/commands/`. Upstream reports
  that a narrowed list reads as undeclared in their commands loader (usetheokit/theokit#704), which
  would have been silent — our call passes the wide string form, and both a foreign and a native
  command still load. (#188)

## [0.21.0] - 2026-09-08

### Security

- `.claude/` is now imported surface by surface — skills, subagents, plugins — and its `hooks` are
  never read. Until `@theokit/agents@13.0.0-next.9` the grant was per SOURCE, so wanting the foreign
  root's skills meant taking its `hooks` too, and a `.claude/` directory usually arrives with the
  clone, written for another product. This is the second of two answers and they are not redundant:
  the `hookApproval` gate refuses at the spawn point and covers every root, including
  `.theokit/hooks.json`, which is not a compat source at all; this keeps the framework from reading
  those hooks in the first place. `plugins` deliberately stays — a
  `.claude/plugins/<bundle>/skills/<name>/SKILL.md` answers on the built binary and nothing
  establishes whether those arrive through `skills` or through `plugins`, so removing it is worth a
  measurement first. Measured with a live positive control: a native and a foreign skill both reach
  the model before and after, a foreign `.claude/agents/` role is still discovered, and the three
  hook arms are unchanged. (#183)

## [0.20.0] - 2026-09-08

### Changed

- `@theokit/agents` pinned at `13.0.0-next.9` (was `next.8`). It adds
  `settingSources.claudeCode.import`, which lets this product take the foreign root's skills and
  subagents while declining its hooks — additive to the #130 fix, since the gate refuses at the spawn
  point while this keeps the framework from reading them at all. **Not adopted yet** (#183): the
  declaration compiles and the hook arms are unchanged, but the arms that would catch a regression
  are dark in both the new build and the control, and chasing that found a skill in the *native* root
  reporting `skills: none` too. The harness cannot demonstrate the skills surface at all, so it cannot
  demonstrate that an import list preserves it — and shipping on an arm that was already dark is the
  vacuous negative this repository files issues about. The pin is taken because it measures clean and
  changes nothing observable here.

## [0.19.1] - 2026-09-08

### Fixed

- `CONTRIBUTING.md` records one narrowing observation about the closing-keyword trap: a PR body
  upstream reading *"Closes the `hooks` half of #686"* left that issue open, which is consistent with
  the parser requiring the keyword adjacent to the number. Kept as a hypothesis — one case, and this
  repository has no matching case of its own. The rule stays strict on asymmetry rather than doubt:
  too strict costs an awkward sentence, too loose costs a live security issue reported as solved.
  (#130)

## [0.19.0] - 2026-09-08

### Security

- A hook declared in a file the framework loads itself — a project `.claude/settings.json`, a
  `.theokit/hooks.json` — no longer runs. It ran shell on every tool call without passing this
  product's per-hook approval, because the framework's compatibility loader spawns those directly and
  never through `buildHookHandlers`. The gate is the framework's new `hookApproval` seam
  (`@theokit/agents@13.0.0-next.8`, upstream theokit#686), and the answer is always no: everything
  reaching it is by construction a hook this product did not translate and was never asked to
  approve. A refused hook is treated as one that was never configured — the command does not run,
  the work does not stop. Measured on the built binary, three arms:

  | arm | before | after |
  |---|---|---|
  | project `.claude/settings.json`, unapproved | fires 1 | **fires 0** |
  | own `.theocode/settings.json`, unapproved | fires 0 | fires 0 |
  | own `.theocode/settings.json`, **approved** | fires 1 | **fires 1** |

  The third arm is what separates a fix from a gate that refuses everything, and every arm ran a tool
  — so each zero is the gate answering, not a turn with nothing to gate. (#130)

## [0.18.0] - 2026-09-08

### Changed

- `@theokit/agents` pinned at `13.0.0-next.7` (was `next.5`). It exports the hook approval gate #130
  needs — `HookApprovalCapability`, `HookGateUnsupportedError`, `HookApprovalGate`,
  `HookApprovalRequest`, all four verified in the published tarball against a control name — and
  **this product cannot reach it**: `hookApproval` is a field on the `defineAgent` draft, not a method
  on the fluent `AgentBuilder` this product builds with, and `use()` composes presets rather than
  accepting a capability. The compiler answered both attempts. Re-measured on the built binary: a hook
  in a project `.claude/settings.json` still fires once, ungated, against a control arm at zero where
  the same tool runs. Taken because it is the current version and measures clean; it changes nothing
  observable here. (#130)

## [0.17.2] - 2026-09-08

### Fixed

- `CONTRIBUTING.md` corrected: a code span does **not** hide a closing keyword from GitHub's parser.
  The first measurement of that said it did, and it was vacuous — the check ran against a branch the
  commit had not reached, so the issue being open meant nothing. Once `git merge-base --is-ancestor`
  proved the commit was on the trunk, the issue closed a second time. The rule has no escape hatch.
  (#130)

## [0.17.1] - 2026-09-08

### Fixed

- `CONTRIBUTING.md` records that a commit message cannot say an issue is NOT closed. GitHub matches
  the closing keywords anywhere in the text and does not parse the English around them, so the line
  *"This does NOT close #130"* — written in v0.17.0's dependency bump precisely to deny the link —
  closed a live, unfixed security issue. The word added for precision is the one the parser cannot
  see. Filed with the other traps whose fault is upstream of the care taken. (#130)

## [0.17.0] - 2026-09-08

### Changed

- `@theokit/agents` pinned at `13.0.0-next.5` (was `next.3`). It carries a breaking rename in the
  session API — `deleteSession`'s `registryRemoved: boolean` became `registryOutcome?: RegistryOutcome`
  — and nothing here reads it: this product measures the registry half itself by re-reading the
  listing (#125), because the boolean reported that the call did not reject, which with a
  `Promise<void>` remover that never throws on a miss is indistinguishable from success. Typecheck
  clean, 1453 tests green, `sessions gc` exercised on the built binary. The upstream taxonomy now has
  a `not-attempted` value that describes this product's call exactly — it removes the registry entry
  itself and passes no remover — so the local measurement becomes redundant once that reaches a
  release; tracked for then rather than swapped now.

## [0.16.0] - 2026-09-08

### Changed

- `@theokit/sdk` pinned at 5.4.0 (was 5.3.2). It carries the two capabilities #130 needs — a per-hook
  `approve` gate and per-surface narrowing of a compat source — and **neither reaches this product
  yet**: `@theokit/agents@13.0.0-next.3` emits a hardcoded `["claude-code"]` for `compatSources` and
  never forwards `local.hooks`, so there is no way to pass either through. Measured on the product
  built against 5.4.0: a hook in a project `.claude/settings.json` still fires once, ungated, against
  a control arm at zero where the same tool still runs. Taken anyway because it is the correct current
  version — 5.3.3 was declined as a docs-only republish, and the `latest` tag has since been restored
  after a `4.x` publish moved it backwards. (#130)

## [0.15.2] - 2026-09-08

### Fixed

- A staleness issue now closes when the pins return to a state already declined, instead of being
  rewritten to describe versions somebody already ruled on. The check for a declined fingerprint ran
  inside the no-open-issue branch, so the rule was "do not RE-OPEN a declined state" where it should
  have been "a declined state is settled" — and those differ exactly when an issue is open for
  something else. Live sequence that produced it: 5.3.3 declined, upstream then moved the `latest`
  dist-tag backwards to 4.63.5 (correctly opening an issue for a different fact), and the restore
  would have left that issue open forever. Found by writing the claim in a comment and then running
  `decide` against it rather than trusting the sentence. (#163)

## [0.15.1] - 2026-09-08

### Fixed

- A staleness issue closed by a human is no longer re-opened by the next scheduled run. `findExisting`
  searched OPEN issues only, so declining a version — a legitimate answer, and the right one when the
  delta is nothing — left no trace the mechanism could read, and the issue came back every Monday.
  That is the stale-issue failure #148 warned about, inverted: an issue that will not stay closed gets
  muted exactly like one that never changes. A closed issue carrying the same fingerprint now means
  "already decided", and only that fingerprint stays quiet — declining 5.3.3 never hides 5.4.0. The
  issue body says so, so the reader knows closing it is honoured. Found by using the mechanism on the
  first real fact it produced. (#159)

## [0.15.0] - 2026-09-08

### Added

- A weekly job turns the `@theokit/*` staleness check into a mechanism: it opens ONE issue when a pin
  falls behind the tag it tracks, edits it as that set changes, and closes it when the pins catch up.
  The check itself has been accurate since it was written and nothing ran it, so it held only while
  somebody remembered to type `pnpm deps:theokit`. Not a CI gate on purpose — upstream publishing
  something is not a failure of this build, and a gate that fails for a reason its author cannot fix
  gets bypassed. A failed check is its own third state: it never opens an issue and never closes one,
  because "nobody could measure" is not "nothing is wrong". Preview it with `pnpm deps:theokit:report`.
  (#148)

### Fixed

- `doctor` now says that hooks in a project `.claude/settings.json` run **without** this product's
  per-hook approval, and names `.theocode/settings.json` as where to move them to have them gated.
  It already named the loader that runs them, which a reader finishes reassured — the fact that
  matters is that nothing gates them. Measured on the v0.14.0 binary: such a hook still fires once,
  ungated. Closing that half needs per-surface control over the foreign root (theokit-sdk#631);
  `claudeCode` is granted per source today, so opting hooks out would also drop the subagents,
  skills and rules adopters come here for. (#130)

- CHANGELOG correction to `[0.14.0] § Security`, which said *"Everything else in
  `.theokit/settings.json` still loads"*. It does not: the refusal takes the whole file, so a `model`
  beside the `hooks` is refused too. Measured from the v0.14.0 tag in a clean clone — `model` alone
  loads, `model` + `hooks` refuses both. The behaviour is correct and unchanged; dropping only
  `hooks` would leave the SDK's loader running them ungated, which is the hole the release closed.
  Only the entry was wrong, and released entries are not edited. (#151)

## [0.14.0] - 2026-09-08

### Fixed

- `hooks` in a `.claude/settings.json` are no longer translated and re-run here — the SDK's loader
  already runs them, and running them again fired each one twice. In `~/.claude/settings.json` they
  are inert (the SDK reads hooks from the project directory only) and `doctor` says so, rather than
  the file looking active. (#151)

### Security

- `hooks` declared in `.theokit/settings.json` are refused instead of run. That file is the SDK's own
  filebase: its compatibility loader reads it and executes the hooks in it **without this product's
  per-hook approval**, so a command there ran ungated. Since v0.13.1 taught our loader the same
  nested-by-event shape, an approved hook then ran a **second** time. Measured against a real session
  before the fix: unapproved fired once, approved fired twice; after, the file is refused with a
  message naming `.theocode/settings.json` as where hooks go. Everything else in
  `.theokit/settings.json` still loads. (#151)

## [0.13.2] - 2026-09-08

### Changed

- `@theokit/sdk` pinned to `5.3.2`. No runtime change reaches this product: it carries the
  session-hook cadence on the published `.d.ts` (`fire once per RUN, not once per agent lifetime` —
  the fact #132 turned on) and a better refusal for a malformed `hooks` block, which an operator
  here never sees because our own refusal fires first. Tracked because this repository pins theokit
  exactly and by policy exercises it: a pin that only moves when someone remembers accumulates
  divergence, which is what #148 records
- **Documentation:** `README.md` gave `.theokit/` two owners in two rows of one table — one said
  `settings.json` was this product's, the other called the directory the SDK's filebase and listed
  `agents/`, `skills/` and `rules/` but not `settings.json`. So a reader checking who else reads the
  file before adding a key concluded the SDK does not — which is the reading that produced #144, a
  released BLOCKER where a documented `hooks` array refused every turn. Both rows now say two
  readers, one file. The information was not absent; it was distributed such that reading carefully
  returned the wrong answer (#144)

## [0.13.1] - 2026-09-07

### Fixed

- **A `hooks` array in `.theokit/settings.json` refused every turn.** `.theokit/` is the SDK's own
  filebase, so its settings loader reads that same file and validates `hooks` against Claude Code's
  nested-by-event shape; our flat array failed it, fatally, on every turn. Released in v0.11.0 —
  it did not exist while the file was `config.toml`, because the SDK does not read TOML, and
  renaming the file put it inside a filename another loader already owns. The loader now refuses the
  flat array first, naming the nested form; `hooks` in a `settings.json` is the nested shape in every
  root (#144)
- `SessionStart` hooks run. They are fired by the surface that mints the session id — at launch, at
  `/new`, and on a headless run that is not a resume — rather than mapped onto the framework's
  `on_session_start`. Measured: registration was never the problem, the framework fires what is
  registered; what differs is meaning. `on_session_start` is once per *loop context*, and this
  product builds an agent per turn, so the mapping would have run a `SessionStart` hook on every
  user message — worse than not running it, because that is exactly the hook an author writes
  assuming it happens once. `inert-events.ts` and its `DECLARED BUT NEVER RUNS` marker are deleted,
  as its own docblock instructed (#132)

## [0.13.0] - 2026-09-07

### Added

- A failed turn that reports `does not support image content in tool results` now says what it
  means: **a tool** returned the image, not the attachment, and `ctrl+o` shows which tool ran. The
  guard behind that error is reachable only from a `tool_result` part — an attachment is an `image`
  part of a user message and takes a different branch — so the claim is safe to make. It cost two
  sessions hours: the message read as "your attachment is unsupported", and the transcript collapses
  tool activity to `Used 1 tool` unless `ctrl+o` is pressed, so the run that failed looked identical
  to the five that passed (#133)


### Changed

- `@theokit/sdk` pinned to `5.3.1`, which carries the fix for `Agent.delete` never hydrating the
  registry from disk (theokit-sdk#612). **What that changes here:** `sessions delete` re-reads the
  listing to classify the registry half, and the state that re-read observes moves from
  `still-present` to `removed` — the verification is unchanged, what it verifies now happens.
  The SDK half was measured by the publisher against the installed npm package in a clean project;
  it is **not** re-verified end-to-end here, because a registered session needs a real turn (#125)

## [0.12.0] - 2026-09-07

### Added

- `theocode --version` / `-v` prints the build and exits 0. It used to be rejected as an unknown
  option with a usage dump and exit 1 — the first thing anyone types against an unfamiliar binary,
  answered as though they had used the tool wrong. It runs before anything is set up, because a
  version that needs a working configuration is useless in the bug report that needs it most, and
  `doctor` now carries the same line (#128)


### Fixed

- `/compact` reported a real measurement of the wrong quantity: it said
  `Context compacted (~348→~188 tokens)` while the footer read the same `40.3k/121.6k context`
  before and after — two numbers for one word in one frame, leaving only two readings available and
  neither of them what happened. Those numbers count the TEXT of user/assistant/system messages;
  `tool_use` and `tool_result` blocks are not counted, and on a real session they were ~83% of the
  transcript. The compaction itself works — 28.7k → 5.5k measured, tool output genuinely removed.
  The numbers stay and are now labelled for what they count, which is the M94 shape from the footer
  one line above the meter this contradicted (#126)
- `sessions delete` reported success about the half nothing had checked: it removed the transcript,
  left the registry entry, and printed `deleted <id>` with exit 0 — leaving a registered session
  whose transcript no longer exists. The registry half is now MEASURED by re-reading the listing
  before and after, in three states: `removed`, `still-present` (named, and exit 1) and
  `unverified` (an archived session is excluded from that listing, so absence proves nothing there).
  The SDK's own `registryRemoved` is deliberately not used — measured 2026-09-07 it is `true` even
  when the removal removes nothing, because it reports that the call did not reject (#125)
- `sessions list` could not list a single session created by the headless CLI. It kept only ids
  beginning with `tui-`, and three surfaces mint ids — the TUI, the headless CLI (`exec-`) and the
  review runner (`review-`) — so every headless session was invisible to the only command that
  reveals an id, while `archive`, `rename`, `delete` and `fork` all take one. Worse, it reported
  that as `no sessions for this directory`: an assertion of absence, while `resume --last` resumed
  the session and `sessions gc` counted it as kept. The filter is removed rather than widened —
  the deletion-protection set is already built from this same listing with no filter, and two
  answers to "what is a session" is how the two come to disagree (#124)

## [0.11.0] - 2026-09-07

### Fixed

- A keybinding on a key this router always claims was counted as honoured while it could never fire:
  `ctrl+o` is not on Claude Code's reserved list, has the right shape and names a real action, so it
  passed every check — and the binding is consulted only where nothing built-in claimed the key. It
  is now refused by name, through a set kept SEPARATE from the reserved one: their list is copied
  verbatim, and folding one of ours into it would stop it being a faithful copy (#135)

### Added

- **Keybindings** from `~/.claude/keybindings.json`, in Claude Code's format, read at startup.
  Deliberately small, and the product says how small: this router computes a key's meaning from
  screen state rather than looking it up, so what a file can bind is the set of gestures that mean
  one thing regardless — `toggle-verbose`, `interrupt-turn`, `quit`, on `ctrl+<letter>`. A reserved
  keystroke, an action this product does not expose, a shape the router cannot match, and an unbind
  are each refused by name and reported in `/status`. A built-in gesture wins a collision, and a
  binding cannot reach past the gate that withholds keys from an untrusted directory (#127)
- **Custom themes** from `~/.claude/themes/*.json`, in Claude Code's format, selected with
  `/theme custom:<slug>`; `/theme` with no argument lists what is on disk. Six of their ~40 colour
  tokens map onto this product's structured theme (`claude`, `error`, `success`, `warning`,
  `diffAdded`, `diffRemoved`) and everything else — an unmapped token, a colour notation this
  product does not render, a base variant with no equivalent — is named in the toast rather than
  dropped. Base names keep their light/dark axis, so an accessibility variant we cannot reproduce
  does not repaint a light terminal to the default (#127)
- **Output styles.** `output_style` names a `.md` file under `~/.claude/output-styles/` or
  `<project>/.claude/output-styles/` — Claude Code's feature, in its directories, with its
  frontmatter (`name`, `description`, `keep-coding-instructions`). A style **replaces** the built-in
  coding instructions and only appends when `keep-coding-instructions: true`; that key defaults to
  false, and getting it backwards would make every style a no-op with a suffix. The project wins a
  name collision, `THEOCODE_OUTPUT_STYLE` sets it from the environment, and a name that matches no
  file falls back to the built-in instructions rather than refusing the turn — `theocode doctor`
  names it instead (#127)
- In a `settings.json` the style may be spelled `outputStyle`, Claude Code's name: it is the one
  setting besides `model` whose name and meaning are identical in both products, so it is translated
  rather than ignored. Every other apparent overlap between the two vocabularies is a name collision
  with a different meaning behind it and is deliberately NOT translated (#127)
- `.claude/settings.local.json` and `.theokit/settings.local.json` are read as their own layer,
  above the committed project file and below profiles — Claude Code's precedence, and its own layer
  so hooks accumulate across the two rather than one replacing the set (#127)
- `theocode migrate-config` converts every leftover `config.toml` — in the project and in the user
  directory — into `settings.json`, through the same schema the loader parses with. It runs before
  configuration is resolved, so it stays reachable when the loader refuses to start (#127)
- `hooks` may be written in Claude Code's nested-by-event dialect in this product's own
  `settings.json`: `timeout` is converted from seconds to `timeout_ms`, `matcher: "*"` becomes
  match-all rather than an invalid regex that would fail at boot, and an event this product does not
  have is dropped and named instead of throwing (#127)


### Changed

- **BREAKING: `config.toml` is replaced by `settings.json`.** The configuration file is now JSON and
  carries Claude Code's filename, so a real `settings.json` can be pasted in and the product starts.
  A leftover `config.toml` with no `settings.json` in the same scope refuses the start and names
  `theocode migrate-config`; ignoring it would drop the whole configuration with no error (#127)
- Configuration is read from this product's own root before the foreign one, per layer:
  `~/<home_dir>/settings.json` then `~/.claude/settings.json`; `<project>/.theokit/settings.json`
  then `<project>/.claude/settings.json` (#127)
- Keys a `settings.json` carries that this product does not implement are ignored and **named** by
  `theocode doctor`, split into "not implemented here" and "unrecognised" — a key that is dropped
  without being nameable teaches an operator that a setting is read when it is not (#127)
- Tolerance for unknown keys depends on whose file it is, not on a list of key names. Under
  `.claude/` an unknown key is theirs and is tolerated; under this product's own root it is a typo
  and the loader refuses by name, so `sandboxMode` is never silently discarded in place of
  `sandbox_mode`. An earlier inventory of 141 Claude Code keys was measured against a real
  `~/.claude/settings.json` and missed five of them (#127)


- `@theokit/agents` 13.0.0-next.2 → 13.0.0-next.3.


- **Correction to the 0.10.1 entry below.** It said `sessions gc` "no longer deletes a transcript it
  could not read". The guard is real and tested, and it is **inert in this product**: it fires on an
  `idSource: "unavailable"` field that only `@theokit/sdk`'s `listSessions` supplies, and this
  product's own transcript reader does not. Measured on the production path — a registered session
  whose transcript is corrupt is kept regardless, because protection is derived from the registry
  and never from reading the file. So the case the entry described was never at risk here.

  The guard stays, for a caller that does supply the field. The published entry is left as written,
  per the rule against editing released history.


### Fixed

- `/hooks` reported a `SessionStart` hook as active while it can never fire. It now lists it marked
  — `DECLARED BUT NEVER RUNS` — rather than as wired, and marked rather than hidden: a row that
  disappeared would answer "was my file read?" with silence, a second false answer in place of the
  first. Root cause is upstream (theokit-sdk#613): the SDK has two hook subsystems, and
  `on_session_start` exists only in the one that hook handlers never reach. The three events that do
  fire are exactly the three with a member in the other (#132)
- `pnpm lint` now runs `depcruise`, which CI already ran and the local gate did not. A circular
  import between the config schema and its disk loader passed every local check and failed on the
  PR — the same shape as a CI suite that is green on a broken build, in reverse (#127)
- Corrected a false claim in the source: a comment stated that hooks translated from a
  `settings.json` "go through the same fingerprint approval gate as every other hook". Measured in
  the TUI with a real TTY — three hooks declared in this product's own file fired three times with
  zero approval prompts and no approvals file written. Directory trust is what stood between them
  and the operator, not the fingerprint. The comment now carries the measurement; whether project
  scope is covered by directory trust deliberately is asked in #130 (#127)
- `resolveEffectiveConfig` resolved the trust posture from the ambient environment while resolving
  the configuration from the one the caller injected — B-033's split, one layer lower. Already
  wrong, and expensive now: the posture decides whether a project's whole `settings.json` is read
  (#127)
- Two docblock citations that pointed at nothing: `env-knobs.ts` named `docs/CONFIGURATION.md`,
  which has never existed here, and `hooks/hooks.ts` called itself the parser for
  `.theokit/hooks.json`, which no caller has ever handed it. The `reader`-path gate only checks the
  `reader` field, so a citation in the prose beside it was invisible — the same shape as B-134, one
  field over (#127)

- The pin guard now checks the tree, not only the files. An install can report success and leave the
  previous version in place; every declaration then agrees while the build runs against something
  else (#120).


- `sessions gc` and `theocode sessions delete` keep protecting a live session after the upstream
  rename of `protectedTranscripts`. The map is keyed by transcript path now, not by session id, and
  this product was still mapping each key forward as though it were an id — which produced an empty
  guard. Caught before the upstream release, over a link into their candidate build (#107).

## [0.10.2] - 2026-09-07

### Changed

- `@theokit/agents` 13.0.0-next.1 → 13.0.0-next.2, which narrows the agent-module parameter from
  `unknown` to a real type. The shape that shipped unable to start a turn in 0.7.0 and 0.7.1 is now
  a compile error rather than a runtime one (upstream theokit#663, reported from here).

## [0.10.1] - 2026-09-07

### Fixed

- `sessions gc` no longer deletes a transcript it could not read. "I could not read this" and
  "this belongs to nobody" are opposite claims, and only the second justifies deletion (#106).

### Changed

- `@theokit/sdk` 5.2.1 → 5.3.0, which publishes `listSessions` — a listing that reads each session
  id from inside its transcript and reports `unavailable` rather than guessing from the filename.

## [0.10.0] - 2026-09-06

### Fixed

- A rules corpus too large for the prompt is now cut **between** rules instead of mid-sentence, and
  the model is told what was left out. It was receiving a rule that stopped in the middle of a word
  and reading it as complete (B-157).

### Changed

- Your own `~/.claude/` contributes rules and not skills, subagents or commands — one stated rule
  instead of four separate decisions: a foreign root may bring text that constrains the agent, never
  artifacts that add invokable surface (B-156).

## [0.9.1] - 2026-09-06

### Changed

- `/status` answers about your rules before the first turn, reading the disk and saying so, instead
  of `<not loaded yet>` — matching the `agents.md` row beside it and Codex, which answers at
  startup (#61 item C).

## [0.9.0] - 2026-09-06

### Added

- A turn ends by showing what it changed, from git — scoped to the files that turn wrote, so a
  repository that was already dirty does not mix your uncommitted work in with the agent's. Silent
  when nothing changed (#105).

## [0.8.0] - 2026-09-06

### Fixed

- `theocode review` works when you signed in with OAuth, which is the default. It failed on every
  invocation with `API key for provider "openai" expected to start with "sk-"`, on both the CLI and
  the TUI, while the same credential worked for an ordinary turn (#101).
- `sessions gc` no longer deletes a registered session in another project, no longer leaves a
  registry entry behind after reporting it removed, and protects transcripts written by 4.x as well
  as 5.x. All three were found by the repaired `review` running against this morning's own gc
  commit (#101).

### Changed

- `@theokit/sdk` 5.2.0 → 5.2.1, which refuses a created subagent where it previously answered a
  plausible wrong tool list about it.

## [0.7.2] - 2026-09-06

### Fixed

- **The agent could not start a turn at all in 0.7.0 and 0.7.1.** Both the CLI and the TUI failed on
  every invocation with `an agents/ file must default-export a defineAgent(...) value`. Upgrade
  from either version (#96).

### Changed

- `@theokit/sdk` 5.1.0 → 5.2.0, which publishes `effectiveToolNames` — the instrument that answers
  what the runtime will actually put in front of the model, without a credential and before the
  agent runs. The `analyst`'s read-only boundary is now asserted against that catalog rather than
  against its declared tool list (#80, upstream #583).

## [0.7.1] - 2026-09-06

### Fixed

- `/status` now reports how much of the rules block reached the prompt. A project whose rules exceed
  the ceiling was running on a fraction of them with the only notice going to `stderr`, which the TUI
  does not surface — measured in this repository's own checkout, 8 of 34 rule files and 74% of the
  text were being dropped in silence (#91).

## [0.7.0] - 2026-09-06

### Added

- A skill in your own `~/.theokit/skills/` is loaded and offered to the agent, so something that
  encodes how *you* work no longer has to be copied into every checkout (#65).
- A subagent defined in `.claude/agents/` is discovered, like one in `.theokit/agents/` already was
  (#83). Your own `~/.claude/agents/` is deliberately not read: on a machine that also runs Claude
  Code that directory holds another kit's roles.
- A custom command in `.claude/commands/` appears in the popup alongside `.theokit/commands/` ones
  (B-152). Both roots are read only when the directory is trusted, as before.

### Fixed

- The `analyst` subagent no longer offers a shell. It is declared read-only in its tool list and
  says so in its own instructions, and until now it could run commands anyway (#80).

### Changed

- `@theokit/sdk` 5.0.1 → 5.1.0 and `@theokit/agents` 13.0.0-next.0 → 13.0.0-next.1. These carry the
  three doors the items above needed; none of the work was possible against the previous pins.

## [0.6.0] - 2026-09-06

### Added

- **`npm run blockers` asks the installed tree whether the upstream gaps are still real**, instead of trusting the sentence that says so. Four issues carry a `blocked` label and a comment naming what unblocks each; that naming is prose, true when written, and nothing re-checks it — so the day upstream publishes, the label keeps saying blocked until somebody happens to look. The check resolves the symlink first (two trees with one package name is how a type was once reported absent from a version nobody was reading), reads the type rather than grepping the file, and stays advisory: a blocker that is still real is the expected state, not a build failure. Proven to report both states before being trusted — against the installed `5.0.1` all three read `blocked`, and against a candidate build carrying the fixes all three read `LANDED`.

- **Three surfaces of the `.claude/` dialect are registered as work rather than left as a footnote** (B-152, B-153, B-154). This product documents that it reads the foreign root, and three surfaces measured on 2026-09-06 reach nothing: `commands/` (the framework's loader takes two roots and no third), hooks declared in `settings.json` (the parser's own first line scopes it to `.theokit/hooks.json`, while a sibling module exists purely to make a *borrowed* hook script run), and `plugins/` (no occurrence anywhere in the tree). A partial dialect is worse than none — someone who saw rules, skills and subagents work there has no reason to suspect these, and each failure is silent. All three route upstream so the fix is the default for every consumer instead of a workaround in one.

- **`CONTRIBUTING.md` records a fifth way a careful measurement lies**: a filter narrower than the signal reports absence, and absence reads exactly like a negative. Four instances in one day across two repositories, each of which would have produced a confident wrong conclusion — the sharpest being a version-floor guard that had switched a feature off before the test could reach it, so the arm did not fail, it was void. A wrong command produces an error and demands attention; a narrow filter produces silence, which is what a true negative looks like.

- **A delegated role keeping its roots can no longer cost it its sandbox.** `local` is assembled from several conditional pieces, and adding the inherited roots as a second spread would overwrite it rather than merge — dropping `sandboxOptions` and trading a capability bug for a default-OPEN security one. It is correct here by construction, and nothing said so: no test in this repository asserted a child's `sandboxOptions` at all, so a refactor extracting a helper between those fields would have broken it in silence. Proven non-vacuous by introducing the exact trap — the naive spread makes only the new test fail while the other three stay green, which is the shape that would have shipped. Named by the `theokit-sdk` session while implementing the same inheritance upstream.

- **`npm run lint` refuses a test that asserts something throws without saying what.** `rules/error-handling.md` requires errors to be explicit and typed, and nothing checked that the tests honoured it — a principle written down with no mechanism reads exactly like an enforced one. A bare `expect(fn).toThrow()` is satisfied by any throw, including a `TypeError` from an unrelated null deref, so a test guarding a typed refusal keeps reporting green after that refusal has decayed into a crash. Two such assertions existed and both guarded fail-loud contracts: a non-boolean `memory` key must be rejected rather than coerced, and an unknown tool name must fail at declaration. Both were tightened against **measured** values — `ConfigError` with the field named, and the message `unknown tool "gerp"` — never against what the source looks like it should raise. The gate was proven to fire by planting a violation, because a gate that has never failed has demonstrated nothing.

### Changed

- **knip 6.32.2 → 6.34.0**, and the gap it was pinned against is re-measured rather than assumed. `includeEntryExports` is still not honoured on the newer release: a dead export planted in an entry file goes unreported, while the identical export in a non-entry file is caught — the positive control that proves the instrument speaks. So `#71` stays open on `webpro-nl/knip#2012`, now with the measurement citing the latest published version instead of the one the report was written against.

### Fixed

- **`sessions gc` protected nothing it claimed to protect, and deletion here is permanent** (#84). A transcript's filename is derived from its session id and is not equal to it — `exec-522dc0ef-…` names a file called `7dc7d4ef-….jsonl`. The protected set was filled from three vocabularies (registry agent ids, the live-session pointer, filename stems for the quota) and consulted with a filename stem, so two of the three could never match: **a registered session and the session a running TUI was writing to were both collectable**, and the same mismatch made `inRegistry` permanently false, which is why every session read as an `orphan` — a report that looked like an explanation and was an artefact of the comparison. Only `keepLast` and most-recent ever worked, because those are filename-derived on both sides, and they hid the rest by covering the live session whenever it was also the newest. Both plan paths now key on one vocabulary, using the SDK's own forward mapping; the inverse cannot exist over a hash and is not needed, since every id is already in hand. Verified on the built binary in both directions: the pointer's transcript and a registered session are kept, and an unregistered 60-day-old one is still collected.

- **`theocode doctor` stopped calling a working bundled skill a missing file** (B-155). A skill inside a `.claude/plugins/<bundle>/skills/` bundle loads and answers — measured on the built binary with the bundle removed as the control — and the row reported `declared with no SKILL.md` regardless. Third instance of one defect in this check: it knew the project roots, then learned the operator's root, and never learned that a root can nest bundles. Each time it named a cause that is false about a file that is there, which is how a diagnostic teaches people to stop reading it.

- **A delegated role no longer carries a shell its definition never granted** (#80). The framework registers a `shell` tool for every local agent whether or not the caller asks — *"including when you pass `tools: []`"*, per the SDK's own `LocalOptions` docblock — so a role declared with three read tools enumerated `shell` first in its catalog, while the test asserting its declared list went on passing. The list was right; the catalog was not. Roles now withhold the builtin. Safe for the roles that legitimately execute: this product's shell is the custom `run_shell` under a different name, verified on the built binary — an executing role still returns `WORKER-OK-42`. The mechanism is **observed**, not inferred: with the option set, a child's catalog goes from `shell, read_file, list_dir, grep, parallel` to `read_file, list_dir, grep, parallel` — the first direct sighting of the withhold doing what its docblock promises. That observation was taken on the sibling `SubAgent` path (which accepts the field only in an unreleased upstream build), so what remains inferred is narrow: that the same option, on the same SDK call, behaves the same for a role. The role's own catalog stays unobservable because the squad path summarises its member's reply instead of relaying it. The `analyst` is unfixed and stays so — it is a `SubAgent`, whose spec carries no such field, and upstream measured that a withholding parent produces a child that recovers the tool anyway (`usetheokit/theokit-sdk#580`).

## [0.5.0] - 2026-09-05

### Added
- **A squad role can live in your own `~/.theokit/agents/`, not only in the repository you happen to be in** (#65). Measured with a positive control: the identical file delegated from the project and left the model reporting *"no such subagent/delegation tool is available"* from the operator's root. The gap was ours rather than upstream — `@theokit/sdk` has no user-configuration layer for any surface, so the user-level rules and `AGENTS.md` that already loaded are read by this product's own code, and two surfaces simply never got the same treatment. The project still wins a name collision, and an untrusted directory still contributes nothing: the trust gate asks whether the code in *this* directory is trusted, and nobody's home is the repository. Reuses the framework's own reader by handing it the home directory, rather than listing a directory here — a second reader of one convention is the defect that reader was published to end.

- **`theocode doctor` stops blaming a missing file for a skill that is on disk** (#65). A `SKILL.md` under `~/.theokit/skills/`, declared in configuration, was reported as `declared with no SKILL.md` — the file was there, so the row named a cause that is false and sent the reader to write what they had already written. Measured with the same file copied into the project as a positive control: the project copy answers, the operator's copy leaves the model with no skill tool at all, because `@theokit/sdk@5.0.1` builds every skill root from the working directory. The row now distinguishes the two — a skill that is genuinely absent, and one that exists where nothing reads it — and names the remedy for each. Counting the operator's root as present was the alternative, and it is the worse one: a green tick over a capability that does not load is the exact shape this check was added to end.

- **The dependency watcher compares against the channel this repository actually tracks** (#73). It read `latest` and nothing else, so `@theokit/sdk` pinned to `5.0.0-next.1` reported as behind `4.63.4` — a version deliberately declined — while `5.0.0-next.3` was invisible. Measured twice in one day: `readSessionMessages` and the `.claude/` forward both published on `next`, and both were found by hand while asking "is anything pending?", which is the question this tool exists to answer. The channel is now derived from the INSTALLED version, so a repository that pins a prerelease has said which channel it tracks without saying it twice, and the tag is printed **beside** the number — a version with no channel next to it is the ambiguity that produced the issue.

- **`theocode doctor` stops ticking green for a skill that is not there** (#67). The skills row was the DECLARED list, so both directions were wrong and neither said so: a configuration naming a skill with no `SKILL.md` reported `✓ skills: exists, ghost`, and a real skill created the documented way — file written, config line forgotten — was invisible while the panel showed a phantom. The two are now held against the disk and reported apart, because their remedies differ: a name to delete against a line to add. **The default `skills` list is empty**, where it named `daily-briefing` — a skill that resolves to no `SKILL.md` anywhere, so every fresh install declared a capability it did not have.

- **A delegated squad member reads the workspace the way the agent that spawned it does** (#74). The main agent declared `project` and `claudeCode`; the child, built through a different entry, declared neither — so it ran with a narrower view of the directory than its parent, and said so once per delegation as soon as `@theokit/sdk@5.0.1` moved that notice off a channel that is off by default. The child now inherits both roots, gated identically: the foreign one travels with the native one and never past it. Verified on the built binary — a delegation in a project holding `.claude/` went from one spurious notice to none.

- **`@theokit/sdk` 5.0.0 → 5.0.1**, which carries the fix for a finding this repository's measurement produced (usetheokit/theokit-sdk#563). 5.0.0 stopped reading `<cwd>/.claude/` unless declared and announced the loss through a diagnostics channel that is off by default — so an upgrading consumer lost hooks, skills and subagents in silence, and the environment variable the release notes named does nothing here, because this product renames the key. The notice now reaches stderr with no configuration. Verified after the bump: an undeclared `.claude/` says so on a plain run; a trusted directory, where this product does declare it, stays quiet.
- **`@theokit/sdk` 5.0.0-next.4 → 5.0.0** — the line we were already on reaching stable, and it carries the fix for a leak this repository reported hours earlier (usetheokit/theokit-sdk#554): `memory.directory` moved the facts and left the SQLite index in the project, where it sat carrying the fact text and the absolute path of the store. Verified end to end after the bump — the index now lives beside the facts and the project gets nothing. Its own **BREAKING** change is that `<cwd>/.claude/` is unread unless declared; this product declares it, verified on the new major with a subagent delegated and a skill body reaching the prompt from `.claude/`. A consumer who has not declared it loses those surfaces silently on upgrade.

- **`@theokit/agents` 12.1.0 → 13.0.0-next.0**, which carries the `claudeCode` setting source (usetheokit/theokit#634) — the forward that unblocks the skills and subagents halves of #65. The major number carries no breaking change we could find, and that was measured rather than assumed: its changelog lists Minor Changes only, and a diff of the exported surface is **0 symbols removed, 1 added** (`resolveCompatSources`), with `SettingSourcesSelection` gaining one optional field beside the `user` and `project` it already had. Verified on the built binary rather than on the suite alone: a real turn, a skill, a subagent, an MCP tool and a resumed transcript all still work. **`.claude/skills/` and `.claude/agents/` now work**: the `claudeCode` setting source is declared, gated on the SAME evidence `project` takes, because `.claude/` is repository-controlled — it usually arrived with the clone — and holds a `hooks.json` that executes shell. Verified end to end on the built binary in one project holding both: `.theokit/agents/native.md` and `.claude/agents/foreign.md` both delegated, and a skill whose only copy sat under `.claude/skills/` reached the prompt.

- **A resumed session shows the conversation it restored** (#70). `/resume` used to leave the welcome banner over an empty transcript — indistinguishable from a command that did nothing, while the model demonstrably held the earlier turns. The turns are now read from the session and drawn ahead of the live thread, tool calls included. Unblocked by `readSessionMessages` in `@theokit/sdk@5.0.0-next.4` (usetheokit/theokit-sdk#546). The greeting still says the session was resumed: the transcript shows what was said, that sentence says the model still has it, and a short history would otherwise leave the second fact unstated. `/new` and `/clear` now clear it — the state was documented as "`/resume` sets it, `/new` clears it" and only the first half was implemented, so a fresh conversation kept announcing a continuation.
- **`@theokit/tui` 0.79.0 → 0.80.0** — the published latest, taken while checking whether its new `initialMessages` seam (usetheokit/theokit-tui#179) was what #70 needed. It was not: this product's agent comes from `@theokit/agents`' `useAgent` and `useTimeline` owns the composition, so the history goes in there. Recorded because the two look interchangeable from the issue thread.
- **`home_dir` renames the directory this product keeps its state in** — `.theokit` by default, `.theocode` or `.claude` if you prefer. One key moves the transcripts, the projects root, the collector and the trust store together, because a root that is written and a root that is swept must never be two different answers. The trust store joined them late and the omission is worth naming: `TRUST_STORE` was a module-level constant that called `homedir()` at import time and pinned `.theokit`, so the first version of this key moved everything except the record of which directories may run code — the one piece of state where being asked again about a settled question teaches an operator to approve without reading. Decisions made under the previous root are still honoured, read-only, so moving the root never re-asks. A root holding another product's transcripts is refused rather than collected (#72)
- The dead-export gate now records **why** four files escape it, the cause is filed upstream as webpro-nl/knip#2011, and the fix proposed there (webpro-nl/knip#2012) has been built and measured against this tree (#71). The previous note measured the symptom honestly and could not explain it. Narrowed: `includeEntryExports` is not broken and knip 6.x did not regress — it reports a dead entry export in a single package, with an auto-discovered entry, and in a workspace. The trigger is a **root `package.json` script naming a file inside a workspace**, which is exactly `dev`, `exec` and the bundler's entry point here. Two arms differing by one line reproduce it from scratch. No behaviour change: the setting stays, because it costs nothing and becomes correct the day the interaction is fixed. What that day looks like is now recorded too: with knip#2012 applied this tree goes from clean to one finding — a compile-time assertion helper in a test file, a deliberate survivor whose own docblock predicted the listing — and the four entry files stay exempt regardless, because none of them is a declared entry. The config change that would cover them is deliberately not made yet: a gate written against unreleased behaviour is one nobody can verify today.

- **MCP servers that are yours, not the repository's** (#72). `~/<home_dir>/.mcp.json` is read in every project, so a server you use everywhere is declared once instead of copied into each repository — and can be used in a repository you do not own. It is **not** gated on project trust: that gate asks whether THIS repository's code is trusted, and your home is not the repository — the same reasoning the user instruction layer already rests on. Gating it would also remove the case it exists for, since a repository you have not vouched for yet is exactly where you still want your own tools. The project's `.mcp.json` stays gated, unchanged. On a name collision **yours wins**, and the attempt is reported: letting a repository shadow a server you trust by reusing its name with a different command is a hijack whose only symptom would be the right tool doing the wrong thing. A malformed file in one scope no longer silences the other. `theocode doctor` gained the fact it could not previously state — servers a repository declared and trust withheld are now NAMED (read, never started), where before the row said `mcp: none` while three servers sat declared in the directory and nothing said why.

- **`/theme` is remembered** (#72). It switched for the session and told you to set `THEOCODE_THEME` if you wanted it to last, which is a real answer and an invisible one: you had to learn a variable exists and then edit a shell profile to keep a choice you already made. The pick is now written to `~/<home_dir>/tui-theme` and read at the next launch. Precedence is unchanged where it was already decided — `NO_COLOR` outranks everything as an accessibility signal, and `THEOCODE_THEME` outranks the stored value, because someone exporting a variable for this invocation is addressing this invocation and a stored preference that silently won would make the variable inert. A typo in `THEOCODE_THEME` is still named rather than swallowed, and the toast says which of the two happened: remembered, or session-only because the file could not be written. Telling you it persisted when it did not is the one outcome worse than not persisting. It is not a `config.toml` key, for the reason already recorded there: the theme is a rendering concern and the agent's configuration contract is not where a surface preference belongs.

- **`theocode doctor` reports a credential file left in a directory the product does not read** (#72). The two-directory split produced one defect that reaches past tidiness: measured 2026-09-04, `~/.theokit/auth.json` held a nine-day-old refresh token, written by the SDK before this product pointed it at its own store, and since then read by nothing and rotated by nothing. A token no code path touches does not stop being a token — it stops being one anybody notices. The credential store itself is **deliberately not moved**, and that is the one exception to the unification above: moving a live login is the single step that can log you out, or resolve to the stale copy instead of the fresh one, and its only benefit is a tidier directory listing. So the store stays where the product writes it, the leftover becomes visible, and removing it stays your decision. The check reads no file content — existence and location are the whole answer, which is also why it can be reported with no risk of a secret reaching a log. The row appears only when there is something to report; a row that permanently reads "none" is noise, and noise is what makes a diagnostic stop being read.

- **Your own `AGENTS.md` and `rules/` moved with the configuration** (#72). Both are read from `~/<home_dir>/` now, so every file this product reads under your home is in one place. `~/.theocode/` keeps working: for `AGENTS.md` the unified location wins when both exist, and for rules BOTH are read — a rules directory is a set, and dropping one because another directory also has rules would silently disable a rule you wrote, where `AGENTS.md` is one document under several names and is therefore first-wins. `~/.claude/rules/` is read too. An import inside your instruction file resolves against the directory that file actually came from, so a legacy `@shared.md` stays readable from the directory it sits in. `/status` now asks the loader for the path instead of computing its own, since a row that reports what is in the prompt must not be able to be wrong about it. Verified against the built binary: an instruction in the unified directory, an instruction in the old one, and rules in both, each observed in the model's reply.

- **One configuration directory instead of two** (#72). `config.toml` is now read from `<project>/.theokit/` and `~/<home_dir>/` — the same directories that already hold the rules, the subagents, the transcripts and the trust store. The old `.theocode/` location is still read and never written, so nothing you configured stops working; when both hold a config file, the unified one wins, because the alternative is that moving your file has no visible effect. This reverses a decision recorded under #65 — "what this product owns in the operator's home is `.theocode/`" — which was sound while nothing could name a single root, and stopped being sound when `home_dir` could: a key that renames the state directory while a second, unreachable state directory persists is a key that tells half the truth. The split had already been measured costing users twice: a valid `[[hooks]]` block written into `.theokit/config.toml` produced `hooks: []` from a trusted directory with no error at all (B-086), and `~/.theokit/auth.json` sat nine days stale beside the live `~/.theocode/auth.json`, read by nothing and rotated by nothing. The trust gate is unchanged — an untrusted repository is withheld from BOTH project locations, since widening where we look must never widen what an untrusted directory may say.

- **`.claude/rules/*.md` and `.claude/agents/*.md` are read alongside our own** (#72). A repository set up for Claude Code carries its rules and its subagents there, and this product looked only under `.theokit/` — so a project that had both was steered by half of what it declared, with nothing saying the other half was ignored. Rules from both roots are loaded (additive, not first-wins: a rule file is a rule, and dropping one because a same-named file exists elsewhere would silently disable it), and `paths:` scoping is unchanged. Subagents are merged and de-duplicated by name, ours first, so a repository that keeps the same file in both places has one subagent rather than two. The router that decides whether a custom command can delegate resolves through the SAME function the `/subagents` listing uses — widening the listing alone would have produced the exact drift that shared function exists to prevent: a listing promising an agent the router then fails to find. Skills needed no change: the SDK's own file discovery already covers `.claude/skills/`, verified end to end against a skill declared only there.
- **`THEO.md`, `AGENTS.md` and `CLAUDE.md` are all read, first-wins in that order.** A repository written for Claude Code now steers this agent with no migration; before, only `AGENTS.md` was read and everything else was invisible. A directory contributes exactly one instruction file, and `.local.md` runs its own chain so adding a `THEO.md` cannot orphan an `AGENTS.local.md` (#72)
- `theocode doctor` is now documented — a user-facing diagnostic that has shipped since B-081 and that the README's own list of CLI modes omitted, and the discoverability gate now covers CLI modes as well as config keys
- `context_window` and `goal_oracle` are now listed among the documented config keys, and a lint gate keeps the README's list complete — a knob an operator cannot discover is a knob that does not exist for them

- **`~/.theocode/AGENTS.md` — instructions that belong to you rather than to a repository** (#65). Configuration and credentials have had a user layer since the beginning; instructions never did, so a preference of the operator's — "answer in Portuguese", "run the suite before telling me it works" — could only be written into a project `AGENTS.md`, which commits it into a shared repository and steers a teammate's agent too. The project chain is read AFTER it, so the closer instruction still wins, matching the precedence the README already documents for `config.toml`. Imports inside it resolve against `~/.theocode`, not against the repository — otherwise an operator's own `@shared.md` would be unreadable from inside a repo, and would mean a different file in each one; the confinement itself is not relaxed, since an import lands in the model's prompt and that directory is one other tools write into too. **It is deliberately outside the trust gate**, which is the half worth stating: that gate is the defence against a repository hijacking the agent through instructions, and it asks "do I trust the code in this directory?" — a question with no meaning for the operator's own home. Verified against a hostile `AGENTS.md` in an untrusted directory: the repository's instruction was blocked and the user's was applied, in the same run. `~/.theocode/rules/*.md` follows the same design — read outside the gate, project rules after them, and `paths:` scoping preserved so a rule the operator scoped does not silently widen to everything. It is `.theocode/` rather than `.theokit/` on purpose: `.theokit/` inside a project is the framework's directory, but what this product owns in the operator's home is `.theocode/`, where `config.toml` and `auth.json` already are. The loader is the existing one with its root as a parameter, not a second traversal. `/status` names the layer, because a user file that silently failed to load is indistinguishable from one being followed — the row reads `agents.md:   user: ~/.theocode/AGENTS.md`. That row also had to stop lying: `NOT LOADED — directory untrusted` was true while the project chain was all there was, and became a lie by omission the moment a layer outside the gate existed, since something IS in the prompt. It now says the project chain was ignored AND names what was applied. This closes the instructions and rules halves of #65; skills and subagents wait on usetheokit/theokit#633, since that option cannot reach the SDK through `@theokit/agents` yet.

- **The transcript collapses by default, and ctrl+o expands it** — the resting state Claude Code shows. A run of adjacent tool calls renders as one dim count line (`Used 1 tool`, `Ran 2 shell commands`) instead of a stack of cards, so a long turn no longer pushes the answer off the screen; ctrl+o flips to the full cards and puts `Showing detailed transcript · ctrl+o to toggle` under them. Built on `AgentTimeline`'s `verbose` and `footer` (usetheokit/theokit-tui#61), so the collapsing is the toolkit's and only the key binding is ours — which is the split the toolkit asks for: it exposes the flag and names ctrl+o in its own docblock, the app decides which key flips it. A reading gesture gets a key rather than a slash command because it is reached mid-answer, with the eye on the output. The router puts it after the ctrl+c branch and the surface guards, so it cannot shadow the interrupt or steal a key from a prompt that is waiting for an answer — both pinned by tests, since a shortcut that swallows ctrl+c is worse than no shortcut. It is listed in `?` too: a shortcut absent from the help panel is a shortcut nobody finds.

- **Every Codex command name is answered instead of refused.** Measured against Codex's own `SlashCommand` enum, which declares 58: `unknown command` was the reply to about thirty of them — accurate and useless, since more than half have an equivalent here under a different name. Five became real commands (`/theme`, `/agents`, `/permissions`, `/exit`, `/pwd`); the remaining 24 answer with the equivalent (`/permissions` → "split in two here: /approval … /sandbox …") or say plainly that there is none. The ones pointing at a real feature are in the `/` menu, because that is where a person discovers `/approval` exists; the ones that only report an absence answer when typed but stay out of it — a menu where a third of the entries say "we don't have that" is worse than a shorter menu. Three upstream debug hooks (`debug-m-drop`, `debug-m-update`, `test-approval`) are deliberately not mirrored. Own verbs are matched first, so implementing one of these for real takes over from its pointer automatically.

- **`/title` sets the terminal window title, and chooses what it carries** — product, working directory, model, session; `app dir` by default. It updates when the underlying fact changes rather than once at startup, so `/model` and `/fork` repaint the tab, and it restores the terminal's own title on exit using xterm's title stack rather than blanking it (an empty tab is not what the user had). Nothing animates during a stream: a tab bar repainting mid-turn is what makes people switch the feature off. Sanitisation is load-bearing, not decorative — the toolkit THROWS on a control byte and `/model` accepts any word.

- **`/statusline` chooses which facts the footer carries** — model, effort, approval, sandbox, goal, auth, context; all of them by default, because nobody asked for fewer facts, they asked to be able to choose. `/statusline default` restores. The separator is not a `join`: `model` and `effort` stay one phrase (`gpt-5.6-terra medium`), so turning the feature on changes WHICH items appear without redesigning how the rest look.

- **`/raw` prints the last reply — or `/raw all`, the whole conversation — into the terminal's own scrollback**, so it can be selected with the mouse without box borders or hard-wrapped lines. It is deliberately NOT a mode, and is named accordingly everywhere it appears. Two measurements say a mode is unreachable: `AgentTimeline` takes no render-mode prop, and Ink's `textWrap` admits only `wrap | hard | truncate-*` — there is no "leave the line alone", so any text inside Ink's layout is hard-wrapped with real newlines. Copy-friendliness is a property of text that never entered the layout, which is what printing to scrollback gives.

- **`/exit` and `/pwd`, the two names Codex answers to and this build did not.** Codex routes both `/quit` and `/exit` to the same verb; here `/exit` was an unknown-command error, raised on the way OUT of a session — the least forgiving moment to be pedantic about a synonym. `/pwd` answers "which directory is this session in" without opening the status panel to read one row of it.

- **`pnpm dev:banner [columns]` prints the welcome banner at a chosen width (#61).** Every layout change to it previously had to be verified by launching the TUI, authenticating, and trusting a directory — so it usually was not verified at all, which is how a wordmark that truncated the working directory shipped. `pnpm dev:banner 80` renders the narrow branch in under a second. (#61)

- **`pnpm deps:theokit` reports what is out of date in the `@theokit/*` dependencies.** `pnpm outdated` cannot answer this: measured on pnpm 11.22.0, it reports only root `devDependencies`, so `--prod` comes back empty and every `@theokit/*` package — all of them `dependencies` of the four workspace packages — is invisible. `@theokit/agents` sat at 10.1.0 with 11.0.0 published and the command reported the tree as current. The new check enumerates every manifest, delegates the registry lookup to `pnpm view`, flags majors, and exits non-zero when something is behind. (#59)

- **`/status` reports the `AGENTS.md` chain (#61).** It was the one trust-gated INSTRUCTION source with no listing anywhere: `/skills`, `/mcp` and `/hooks` each report what survived the gate, and the file that most directly steers the model reported nothing. The case that matters is the silent one — an untrusted directory drops it, so the agent runs without the rules the repository wrote for it and no screen says so. The row distinguishes three states that are not interchangeable: no agent built yet, a chain REFUSED by trust (with the count of files ignored), and a repository that genuinely has none. Codex reports the same fact on its own status panel (`Agents.md: <none>`). The listing and the loader share one traversal, so they cannot name different files.

- **`npm ci` could not install this repository, and `npm install` installed the wrong `@theokit/agents`.** Two failures with one cause: the lockfile was never regenerated after the manifests moved. `npm ci` refused outright — `lock file's eslint@9.39.5 does not satisfy eslint@10.9.1` — which is every CI job, since all five run it. And `npm install` succeeded while pinning `@theokit/agents@10.1.0` against a `^11.0.0` manifest, marking its own output `invalid` and carrying on; the tree then failed `typecheck` on `onError`, a field only 11.0.0 has. Both were invisible in development because the working tree is installed by **pnpm**, which reads `pnpm-lock.yaml` and resolves correctly. `npm install --package-lock-only` does NOT fix it — it reconciles a lockfile, it never reconsiders a resolution already pinned there, so it corrected the eslint range and left `agents` at 10.1.0 through repeated runs. Regenerating from scratch does (`rm package-lock.json && npm install`), which is how the current lockfile was produced: `eslint@10.9.1`, `@theokit/agents@11.0.0`, and `npm ci` clean. The underlying condition — two lockfiles for one repository — is unchanged and will do this again the next time a manifest moves without one of them being regenerated.

- **Dependencies brought to their published latest.** `@theokit/agents` 10.1.0 → 11.0.0, `@theokit/presenter` 0.7.0 → 0.8.0 (11.0.0 requires exactly 0.8.0, so the root override moved with it), ESLint 9.39.5 → 10.9.0, Vitest 3.2.7 → 4.1.11, `dependency-cruiser` 18.1.1 → 18.2.0, `typescript-eslint` 8.67.0 → 8.68.0, esbuild 0.28.1 → 0.28.2, TypeScript 5.9.3 → 6.0.3. All five CI gates green afterwards. (#59)

- **TypeScript stays on 6.0.3 rather than the published 7.0.2, and the reason is a gate that went quiet.** Under TS 7 the lint job dies outright (`typescript-eslint does not support TS 7.0`), which is loud and fine. `depcruise` is the problem: it reported **`✔ no dependency violations found (0 modules, 0 dependencies cruised)`** and exited 0. The gate that enforces the direction of dependency — `tui`/`cli` consume `agent`, `agent` consumes neither, which `README.md` calls "the whole design" — passed green having read nothing, because `dependency-cruiser` declares `typescript: >=2.0.0 <7.0.0` and degrades to a warning instead of a failure. On 6.0.3 it cruises 215 modules and 545 dependencies. Revisit when both tools publish TS 7 support. (#59)

- **`@types/node` stays on the 22 line.** 26.2.0 is published, `engines` declares `node >=22` and the runtime here is 22.22.2. Typing the code against APIs the runtime does not have trades a real guarantee for a version number. 22.20.1 is the newest 22.x. (#59)

- **`pnpm` installs this repository again.** `pnpm-workspace.yaml` held only the `allowBuilds` prompt pnpm writes when it needs a decision — no `packages:` key, so pnpm saw no workspaces at all. It now declares the roots, sets `linkWorkspacePackages` so pnpm reads the internal `"*"` ranges the way npm workspaces already does (the CI runs `npm ci` in all five jobs and had to keep working), and approves the two builds that are load-bearing: esbuild, which the bundler needs, and `node-pty`, the native addon behind `interactive_shell` and `write_stdin`. (#59)

### Changed
- README now states that transcript collection is irreversible — `unlink`, no trash, no restore — and why a trash directory was rejected, so the guards that protect the delete path are readable as the whole safety net rather than one layer of several (rubric criterion 5)
- README's reliability target now records the alternative it rejected — a real SLO with an error budget — and why, so the decision is reviewable rather than merely stated (SRE-01.1)

- **What a failure is allowed to cost is written down, and the citation that resolved to nothing is gone** (`B-133`, `B-134`). Nothing in the repository stated a reliability target, and that was the one absence the system-design sweep did not excuse by the product being a local tool: an agent that fails one turn in twenty is a different product from one that fails one in a thousand, and without a statement the retry question had no criterion, only a preference. The new README section states **no availability number** — there is no sustained production measurement to back one, and publishing a figure without it is what `rules/public-copy.md` § 5 forbids — and targets the SHAPE of a failure instead: five properties reviewable without a metrics pipeline and falsifiable by a test. It claims each bullet is covered, and that claim was CHECKED rather than asserted; checking it is what found that the retention floor, the guard that refuses a collection window below one day rather than normalising it, had no test at all on the only path in this product that deletes user data. A comment in `liveness-seam.test.ts` mentioned it, which is documentation rather than a gate. Four tests now cover it, including that the floor value itself is still accepted, so refusing everything would not satisfy them. One bullet was reworded rather than kept, because its second half was a wiring property no test backed — a target whose bullets are half-true is worse than none. Separately, `README.md:99` deferred to `docs/adr/0002-cycle-artifacts-are-promoted-to-docs.md` for the decision behind what is deliberately absent, and that file does not exist, is not tracked, and is not gitignored: a reader who cloned and asked why the toolchain was missing was sent to a document they could not open. The reasoning is inline now — the directory is the maintainer's process rather than the product, and an installed plugin with its own repository, so versioning it here would commit a dependency's source into its consumer. Two stale claims in the same file were corrected while there, both invalidated by this work rather than found separately: the measured test count and a config table that listed none of `memory`, `shell_timeout_ms` or `session_gc`. 837 tests green.

- **The session collector runs on its own, so the retention policy the repository declares is the one it applies** (`B-131`, `B-132`). Everything the collection needed already existed and was careful: a 30-day window with a 1-day floor and a refusal below it, a 200 000-operation sweep budget sized from a measured ~2.54 operations per project over a measured 13 269-project tree, a plan/apply split with a dry run, and an UNDETERMINED-is-KEPT fail-safe on the only path in this product that deletes a user's data. The one missing part was that nothing ever called it — `sessions gc` was an explicit CLI action, so between two manual runs the tree only grew, and a human was the scheduler for a procedure whose steps never change. `session_gc` is a config key, ON by default, and the default is the decision rather than an oversight: the policy already declared 30-day transcripts collectable and nothing applied it, so the declaration and the behaviour disagreed. Nothing about WHAT is collected changed — the new module is the trigger and nothing else, with the window, the floor, the budget and the fail-safe injected, and its tests assert delegation rather than reproducing behaviour that would then exist twice on the delete path. Two orderings are load-bearing and both are pinned: it NEVER throws, because housekeeping that can take the agent down beside a user's session is worse than housekeeping that does not happen; and it stamps the attempt BEFORE sweeping, so a sweep that fails every time does not re-run at every launch. The trigger differs per surface for a stated reason — the TUI fires it unawaited after `render` so it can never delay a start, while the CLI awaits it after the answer is delivered and before the process leaves, because a one-shot process that backgrounds a sweep either delays its own exit or has it killed halfway. `apply: true` is passed explicitly and has its own test, since `runAllProjectsOnDisk` is a dry run by default and omitting it would have produced a collector that reports removals every day and removes nothing. Every outcome is reported and the outcome type separates `disabled`, `too-soon`, `ran` with counts, and `failed`: in a silent system "it ran and removed nothing" and "it never ran" look identical, and only one of them means the policy is being applied. `THEOCODE_SESSION_GC=0` keeps collection manual. 833 tests green, depcruise 0 violations across 236 modules.

- **The config-reachability detector was reporting green about a key it never read** (`B-135`). `env-knobs.test.ts` asserts that every config key is either settable by environment or explicitly exempt, and B-041's docblock argues that a detector nobody runs is not a detector. Its input, however, was a hand-retyped copy of the schema, and `memory` had been added to the schema without being added to the list — so the key was settable in `config.toml`, exempt nowhere, reachable by no variable, and the suite was green because the gate was never shown it. That is the same failure the detector exists to prevent, one level up, and it fails in the reassuring direction. The list is derived from `CONFIG_SCHEMA_KEYS` now, with an assertion that the derivation still covers every key, since a derivation can be undone by a later edit. Deriving it turned the suite red on `memory` immediately, which is the proof it was not ceremony; `THEOCODE_MEMORY` closes it, accepting `1/true/yes/on` and their negatives and returning anything else verbatim so a typo is rejected by name rather than read as `false` — the direction that matters, because memory-off is what a determinism-sensitive benchmark asks for and a silent "off" would tell the operator they got what they wanted.

- **A failed turn now says how many attempts it cost, and how to see more** (`B-129`, `B-130`). The retry policy on the critical path is the transport's — three attempts with a growing delay, measured 2026-08-25 as `retry 1/3 in 20ms` then `retry 2/3 in 403ms` — and nothing in this product declared it, configured it, or SAW it. That last part had a price already recorded in the source: after those retries an auth failure reached the user as `rate_limit (HTTP 429)`, "which reads as a quota problem and sends the user off to check a usage page". The count is not invented and not counted here: `RunRateLimitEvent` carries a 1-based `attempt` on the same `onRunEvent` stream the MCP sink already consumed, and `@theocode/shared/retry-record` remembers the highest one seen — counting events instead would inflate the figure the moment one were re-delivered, and a wrong number shown to a user is worse than no number, so a non-integer crossing the package boundary is ignored rather than rendered as `after NaN attempts`. Zero and one report nothing, because a single attempt IS the turn. The count resets at the turn boundary beside `startMcpFailureTurn`, since a count carried over from the previous turn is a number that is wrong rather than missing. This does not claim a retry policy — the policy is still the transport's and still not configurable here; it makes it visible, which is what was missing. Alongside it, the failure text names `THEOCODE_DIAGNOSTICS` — the variable `turn-error.ts:13` had recorded, about itself, as "an environment variable the failure message does not mention" — but only when diagnostics are OFF, because telling an operator to enable what they already enabled is exactly the noise that gets a message skipped. `installDiagnosticSink` had always computed that answer (`result.kind !== 'off'`) and all three entry points discarded it; it is readable now. Absent context means UNKNOWN rather than `false`, so a surface nobody wired keeps the old text instead of advertising a state nobody checked. The CLI had no `onRunEvent` subscription before this and now has one. Extracted `resolveRunTarget` on the way, because adding the wiring pushed `runCommand` past the function-length gate and the credential-routing reason it carries is not about running a turn — raising the limit would have been the bypass. 813 tests green, lint and typecheck clean, depcruise 0 violations across 234 modules.

- **The shell command an operator writes is now theirs to bound, and the git seam exists once** (`B-128`). Three call sites hard-coded `timeout: 10_000`, and one of them — `config-commands.ts:118` — governed an ARBITRARY user command (`process.env.SHELL -c cmd`). A custom command that legitimately took longer was killed with no knob to raise, while the hook engine directly beside it had accepted a per-hook `timeout_ms` since it shipped. The number was never the finding; two sibling features executing operator-written commands, one configurable and one not, was. `shell_timeout_ms` is a config key whose default is the constant it replaces — deliberately unchanged, because moving the default while adding the knob would have changed behaviour for everyone under cover of a fix — reachable as `THEOCODE_SHELL_TIMEOUT_MS` and validated as a positive integer, since `execFile` reads 0 as "no timeout" and a typo would therefore have removed the bound rather than shortened it. It resolves per invocation, like `/review` already does, so an edit to `config.toml` applies without a restart. The other two sites were the same eight lines of git seam pasted twice, including a `catch {}` that discarded the reason — and because `buildReviewTarget` branches on `ok` to decide what it is reviewing, a swallowed failure did not surface as an error, it silently changed the SCOPE of the review. That seam is now `@theocode/shared/git-runner`, with `timeoutMs` as a parameter (a shared constant would have moved the literal, not removed it) and `onWarn` REQUIRED, so a later caller cannot rebuild the silence by leaving an optional argument off; git's stderr is captured rather than inherited, which both stops `fatal: Needed a single revision` painting over the TUI and makes it the text of the warning. Found on the way and fixed rather than suppressed: adding the eleventh key tripped the complexity gate on `pickScalars`, which was ten `if (raw.x !== undefined) out.x = raw.x` lines — a shape whose silent failure mode is that a new key parses, validates, and is then dropped on the floor, configurable in a file and inert at runtime. It is driven by `CONFIG_SCHEMA_KEYS` now, with a test pinning that every schema key survives the copy and that the sample set covers the whole schema. 792 tests green, lint and typecheck clean.

- **`knip.jsonc` now records what the dead-export gate actually covers, and ten inert entry patterns are gone** (#71). The header claimed `includeEntryExports` was "the setting that carries this file" — without it "an export declared IN an entry file is exempt". Measured against knip 6.32.2 by appending a plainly dead `export const X = 1` to one file at a time: an entry file is exempt **anyway**, four times out of four (`tui/src/main.tsx`, `cli/src/main.ts`, `agent/src/chat-acp.ts`, `tui/tools/render-banner.tsx`), while non-entry files are reported normally. Setting the key at the config root, setting it inside a workspace block, and passing `--include-entry-exports` all give the same result. The claim was also wrong in a second way that is why it survived: it said "every `index.ts` here is an entry", and no `index.ts` is in any entry list — the barrels are covered precisely because they are NOT entries. Impact is small and stated rather than dressed up: those four files declare one export between them, and the surface that matters is covered. What was not small is a comment promising a guarantee the tool does not deliver, which is how a reader stops checking. The setting stays; the comment now carries the measurement. Separately, the ten entry patterns knip itself reported as `Remove redundant entry pattern` were deleted — knip reaches all of them without being told, through the `package.json` scripts that run them and through its own default patterns — verified by deleting and re-running: still 0 issues, still 0 configuration hints, and all four files still resolve as entries rather than becoming unused files. Gate behaviour is unchanged in both halves: `lint`, `typecheck`, `depcruise` (231 modules, 0 violations) and 776 tests green before and after.

- **CI installs with pnpm, and `package-lock.json` is gone** (#69). The repository carried two lockfiles and two package managers: developers ran pnpm, all five CI jobs ran `npm ci`. That is only safe while both produce the same tree, and they did not. Measured with an exact pin and a full `npm install` — not `--package-lock-only` — npm resolved `@theokit/sdk@4.55.0` against a `^4.63.3` override, printed `invalid: "^4.63.3"` in its own `npm ls` output, and exited 0; pnpm resolved the same manifests correctly. So CI was green about a dependency graph nobody developed against, and the only signal was a word in output nobody reads. This repository had already paid for that shape once — `56ea1a1` records `npm install` pinning `@theokit/agents@10.1.0` against a `^11.0.0` manifest, marking its own output invalid, and failing `typecheck` on a field only the newer version had. One manager, one lockfile, one tree. Verified as CI verifies it: `pnpm install --frozen-lockfile` in a clean tree, then all five jobs against it — typecheck clean, 776 tests, lint 0, depcruise 0, crossval 0 (crossval needs real git history, which `fetch-depth: 0` already provides and a scratch export does not).

- **`@theokit/sdk` moves to the `5.0.0-next.1` prerelease.** Prereleases are the default for this repository, not the exception: TheoCode is the consumer that exercises theokit, so staying on `latest` means validating code the team has already fixed. Both `theokit-sdk#523` (a resumed turn replayed history through the lossy projection, which is what taught the model to emit `[tool call]` markers) and `#524` (the `.claude/` opt-in) are reachable only from the prerelease, with `latest` still at `4.63.3`. Pinned exactly because no stable range accepts a prerelease — `^5.0.0` and `>=5.0.0` both reject `5.0.0-next.1` — and applied as an override because nothing here imports the SDK directly: it arrives under `@theokit/agents@12.1.0`, which declares `^4.52.1` and will not raise that floor while only a prerelease exists (usetheokit/theokit#634). Verified in the installed tree rather than on paper: agents resolves to `@theokit+sdk@5.0.0-next.1`, `compatSources` present in 21 files, typecheck clean, 776 tests green. The local `[tool call]` fix stays — the upstream half is only reachable here now, and removing ours before measuring would be trading a working guard for an assumption.

- **The headless surface renders a patch as a patch, and says when it truncates.** Every tool call printed through one generic line — `exec <name> <JSON.stringify(input).slice(0, 200)>` — which is right for a read (`exec read_file {"path":"tax.mjs"}`) and collapses for `apply_patch`: the whole diff became escaped JSON on a single line, with literal `\n` where the newlines were, for the one tool call a reader most wants to read. Measured against Codex on the same task, where its `exec` path prints the diff body. This is not a capability the product lacked — the TUI has rendered `Edited <files> (+N -M)` all along through `formatToolHeader`; the headless surface was built without it and stayed behind, the same shape of asymmetry as the config layers elsewhere in this release. The `.slice(0, 200)` was the quieter half: it cuts a real multi-hunk patch mid-line and **says nothing**, so the log shows half an edit with no mark on the missing half. Both limits now name what they dropped (`… truncated — N more lines`). Only `apply_patch` changed — the generic line stays for every other tool, with a test pinning that, because widening the change is the same scope creep this release criticised elsewhere. Input is treated as hostile throughout: a `patch` that is not a string falls back to the generic line rather than throwing, since a renderer that dies on an unexpected shape takes down a turn that was merely going wrong.

- **The explored collapse is preserved, and the `defaultToolHeader` fallback that cost it was reverted.** A previous entry in this release claimed four tools "stopped rendering as their raw snake_case names" by composing the toolkit's default table in as a fallback. That was measured afterwards and removed: `ToolHeaderFormatter`'s own docblock says explored grouping matches on the possibly-overridden `name`, so returning a name for a tool in `exploreTools` opts it OUT of the collapse — and `git_diff`, `grep`, `list_dir` and `read_file` are all in `DEFAULT_EXPLORE_TOOLS`. Measured on three consecutive `read_file` calls: `explored` (one block) became `Read | Read | Read` (three cards). Every tool the fallback could have helped is in the explore set, so the trade was a pure loss — a verb on a card, paid for with the grouping that is the Claude Code shape this product is chasing. An explored tool with no entry of ours still renders its raw name when it appears alone; that is the honest cost, and the fix is an entry in our own table, where a verb can carry the target and the tense. Pinned by an integration test through the real formatter, because the unit test could not tell a correct `undefined` from a pipeline that never called it — which is exactly how this got in on a green suite.

- ~~**Four tools stopped rendering as their raw snake_case names.**~~ `git_diff`, `grep`, `list_dir` and `read_file` are in this product's registry and were never in its header table, so they reached the timeline as `git_diff` rather than `Diffed`. `defaultToolHeader` (usetheokit/theokit-tui#53) answers all four, and is now composed *after* our own table rather than replacing it. The order is the point: the toolkit's default is deliberately tool-agnostic — it answers `run_shell` with a bare `Ran`, no target and no tense, because "guessing which input key holds the file is exactly the app-specific knowledge the seam exists to keep out". Swapping our seven entries for it would trade `Running echo hi` for `Ran` and call it an upgrade. `view_image` gets an entry of its own, since neither table had one.

- **Dependencies taken to their published latest, across a MAJOR.** `@theokit/agents` 11.0.0 → 12.1.0, `@theokit/tui` 0.78.0 → 0.79.0, and the transitive `@theokit/sdk` to 4.63.3. Two migrations were required and both are behaviour, not types — the type checker was green before and after each one.

  **`@theokit/agents/pty` moved to `@theokit/agents-pty`** (the 12.0.0 break). Installing `@theokit/agents` no longer compiles a terminal: `@theokit/sdk-pty` carries a native postinstall that every consumer paid for, measured upstream at 6.7 s against 1.4 s without it. Two imports here move and `@theokit/agents-pty@^0.2.1` is declared where the backend is actually used, in `packages/agent`. The old subpath still resolves and throws a sentence naming its replacement, so this was never going to fail as a missing module.

  **Transcript filenames became UUIDs**, and that one had to be found by running the suite. Eight tests across two files failed as *empty results* — `expected [] to have a length of 2` — because both fixtures composed `<base>/projects/<encoded-cwd>/<id>.jsonl` by hand and the reader now looks for `<uuid>.jsonl`. The SDK documents this exact failure beside `projectsRoot`: a consumer's enumeration is guarded with `existsSync(root) ? readdir(root) : []`, so a path that no longer matches *returns nothing instead of throwing* — "a wrong path that throws is a bug report; a wrong path that returns nothing is a collector that quietly stopped collecting". Both fixtures now ask `transcriptPath(base, cwd, id)` for the path, and the assertions compare against the path they were given rather than against a filename they expected the layout to produce. Production code never built these paths by hand; only the fixtures did, which is why nothing but the tests moved.

- **`@theokit/sdk` is pinned in `pnpm-workspace.yaml`, because three sources disagreed about which version was installed.** `pnpm-lock.yaml` said 4.53.1, `node_modules/@theokit/sdk/package.json` said 4.54.0, and the bytes on disk contained `prompt_cache_key` — which only exists from 4.55.0. The tree was a stale lock entry overlaid with a local tarball installed during the Codex cost measurement, plus a flat `node_modules/@theokit/` directory left by an `npm install` in a pnpm workspace, which won resolution over pnpm's own links. An `overrides` floor of `^4.63.3` makes the resolution answer to something a reader can check, and the transitive SDK now genuinely carries the cache fixes (`prompt_cache_key` in 11 files, `input_tokens_details` in 8, against 4 before).

- **The agent reaches the same result in half the rounds — and, on one task, a materially BETTER one (#63).** Measured against Codex on identical tasks, same model (`gpt-5.6-terra`) and effort: on a four-requirement spec task we spent 50,315 tokens over 10 tool calls where Codex spent 18,084, and we produced a WRONG answer that passed its own tests. The spec said "`balance()` must not accumulate floating point error" and illustrated it with `0.1 + 0.2`; the agent hard-coded two decimal places, satisfied the one example, and violated the rule — `0.005 + 0.005` returned `0.02`, double, in a money type. It then wrote its own tests choosing cases its implementation already passed. `BASE_INSTRUCTIONS` now carries a section saying an example ILLUSTRATES a rule and never defines it, and that self-written tests must include cases you did not already know the code handles. Alongside it, a round-economy section: do not explore for files the task already named, do not re-read a file `apply_patch` just wrote (it is atomic and reports what it wrote), and run the exact command the task names. Two instructions that CAUSED the waste were removed — the coding loop opened with "plan first, then loop" on exactly the linear tasks rule 1 forbids a plan for, and told the agent to spend a call ticking the last box when green. Re-measured on the same task: 5 tool calls instead of 10, 24,914 tokens instead of 50,315, zero `update_plan` calls, and all four precision cases correct — byte-comparable with Codex. On an RFC 4180 CSV task both agents now agree on all nine probes, including the five the spec never mentions.

- **`/theme dark|light|no-color` switches the colour theme live.** It could only REPORT: the theme was a module constant handed to the provider as a fixed prop, so the resolved value could be described and never changed, and a user on a light terminal had to set `THEOCODE_THEME` and relaunch. The provider now subscribes to a one-slot session override through `useSyncExternalStore`, so a pick repaints the mounted frame. The environment stays the DEFAULT and the override is deliberately not persisted, for the reason `/memory off` is not either — a durable preference belongs in config where it can be reviewed, not in a switch someone flipped once and forgot. It outranks `NO_COLOR` on purpose: an ambient accessibility signal loses to one typed just now by the person watching the screen. `/status` says which of the two is in force, because "light, because you asked" and "light, because the environment says so" are different facts.

- **`/cd` stays unimplemented, and the reason is now recorded in the code.** Codex has it; making it work here is not a matter of relaxing the second-write refusal in `working-directory.ts`. Only the agent would follow the move — the composition root reads the directory once and memoises, so the session pointer, the PTY owner, and the custom commands loaded at the FIRST directory's trust level all stay behind, and `reloadConfig()` re-reads the directory the session has left. The security shape is the decisive one: consent state is seeded once, so moving into an untrusted directory would not raise the trust gate, and approving a gate raised for the old directory persists trust for the new one. A `/cd` that moves the path and leaves the posture is worse than no `/cd`. The finding travels as a docblock in `working-directory.ts` rather than only in a report.

- **The agent comments non-obvious code again, as the reference does.** Measured across three benchmark tasks: Codex added 5 explanatory comments, we added 0. The rule existed — "Comment only ahead of non-obvious code, never trivial assignments. Comments are rare and explain WHY" — and the model read the prohibition, because two restrictions and the word "rare" arrived before the permission did. Codex frames the same rule the other way up: "Add succinct code comments that explain what is going on if code is not self-explanatory", with "should be rare" at the end. Ours now leads with the action too. Re-measured on the parser task: same one-line fix as before, now carrying `// Equal-precedence operators group from the left.` — the reason a reader would otherwise have to derive.

- **The Apache-2.0 persona attribution left the prompt and became a docblock.** It was the second line of `BASE_INSTRUCTIONS`, so it was sent to the model on every round of every turn — and the model is not the party a licence notice is for. It reads the same in the source and in `NOTICE`, where a person actually looks, and stops costing 48 characters a round.

- **`web_search` is only declared when a search provider is configured.** `createGenericHttpSearchAdapter` degrades gracefully — unconfigured, it returns `[]` and never throws. Graceful for the run and wrong for the prompt: with no `THEOKIT_SEARCH_API_URL`, which is the default, the tool was still declared on every round and still approval-gated, so the user could be shown a consent card for a search that had nothing to search. Its approval entry is conditional with it, because the framework refuses an approval map naming a tool the agent does not have.

- **`view_image` reaches the model.** It was built by the registry and handed to no agent, so the capability the item exists for did not exist — and the test guarding it asserted only that the registry could resolve the name, which stayed green the whole time. Ungated, matching `read_file`: same root, same containment rule, and `read_file` can already return any workspace file's bytes, so a card there would gate the rendering rather than the access.

- **Durable memory is OFF by default and is now a config key (`memory`).** It was on for every trusted directory, with no key in `config.toml` — the only way off was a session switch that reset on the next launch. Codex ships the same capability as a feature with `default_enabled: false` (Codex's own feature registry: `key: "memories"`, `Stage::Stable`), so this is not a matter of taste: the agent we are measured against does not turn it on either. Measured 2026-08-25, it costs three things. It WRITES — a summary of every session lands in `<cwd>/.theokit/memory/sessions/`, so running the agent in someone's repository leaves files there nobody asked for (35 transcripts, 332 KB, accumulated in this checkout alone; a fresh benchmark directory grew one on its first turn). It READS BACK — recall from earlier sessions enters later turns, so two identical runs of the same task can diverge because the second one saw the first, which is the one property a benchmark against another agent must not have. And it declares `memory_search` + `memory_get`, 1,462 chars of tool schema re-sent on every round of every turn (17 tools in a directory with no store, 19 with one). Set `memory = true` to have it back. The three gates are ANDed — trust decides whether it is possible, config whether it was asked for, `/memory off` can only restrict further.

- **The default model is `gpt-5.6-terra`, up from `gpt-5.4`.** The comparison this product is measured against runs the 5.6 family, and a harness comparing two different models cannot isolate harness behaviour — which is the whole reason the default is pinned rather than left to the provider. `terra` is the middle tier of the three (`sol` > `terra` > `luna`); `-m/--model` and `model` in config override it as before.

- **The welcome banner reads like the reference it is measured against (#61).** Four differences from Claude Code, all visible side by side in a terminal: the wordmark is centred rather than left-aligned; the identity lines (model, cwd) are centred under it; a rule now separates the two columns, running the full height of the box, and another separates "Tips for getting started" from "What's new", spanning the panel at every width. The wordmark itself is unchanged — what changed is the column it sits in: the left column is sized deliberately (`LOGO_COLUMNS`) instead of by whatever the art happened to measure, because the art DEFINED that column and a 34-wide wordmark was what truncated the working directory.

- **The banner says which build it is (#61).** It said nowhere. Both references print it — Codex in its header (`>_ OpenAI Codex (v0.147.0)`), Claude Code in the top border (`╭─── Claude Code v2.1.236 ───`) — and the only way to answer the question here was to leave the TUI. `AGENT.version` is a literal with a test that reads the root manifest and fails when the two disagree, so a release that bumps one and forgets the other goes red.

- **The working directory is shortened from the LEFT (#61).** `truncate-end` dropped the tail, which is the half that answers the question: on this repository the banner read `cwd: ~/Projetos/theo/theokit-fram…` — four levels of ancestry and no way to tell which of five sibling checkouts you were in. It now reads `cwd: …/theokit-framework/usetheo-labs/TheoCode`.

### Removed

- **The local `view_image` tool (53 lines) and its path resolver, replaced by the built-in.** `@theokit/agents@12.1.0` started forwarding `createViewImageTool`, and the reason to take it is not that it is one dependency less — it is that the built-in is better at the part that matters. It returns typed failures (`path_traversal`, `not_found`, `unsupported_image_type`, `image_too_large`) where the local version threw and relied on the SDK to convert; it defaults to a 5 MB ceiling with the reason written beside it (base64 inflates by 4/3 and lands straight in the model's context, so a 20 MB screenshot is not a slow request, it is a failed and expensive turn) where the local version had no ceiling at all; and its factory applies the SE17 handler/`toModelOutput` split, which the local version did by hand. The upstream note is the argument for deleting rather than keeping a copy: *"an image reader that honours any path is a file exfiltration primitive with a friendly name"* — `/etc/passwd` renamed to `.png` is one prompt away, and that is not code any product should maintain its own version of. `readImageAttachment` stays: it still serves `/image`, which is the user-initiated path.

### Fixed
- **The skills diagnostic stopped asking you to adopt another tool's inventory.** Dogfooded on this repository: `.claude/skills/` held forty entries installed by a Claude Code kit and `.theokit/skills/` was empty, so `theocode doctor` listed thirty-nine names under "on disk but declared nowhere". Every entry was true and the row was useless — and a diagnostic nobody reads is worth what an absent one is worth. The undeclared direction now covers this product's own project root only, because that is where the remedy fits: "add a config line" is the fix for a skill someone wrote here and forgot to declare, and the same sentence said about a foreign root is an instruction to adopt it. The other direction is unchanged — `.claude/skills/` is read since #72, so a *declared* skill living only there is still not reported as missing.

- **The file that defines the state roots said nothing writes to `.theocode/`, and a sign-in writes there.** `home-dir.ts` described that root as "READ, never written" without qualification. It is true of config and instructions and false of the credential: `oauth-config.ts` names the directory as the store, and `installAuthHome` points the SDK at it, so `~/.theocode/auth.json` is written on every sign-in. The behaviour is deliberate — the SDK's own store is `~/.theokit/auth.json` and two writers on one file is the collision the separate name avoids — so what was corrected is the claim, not the code, in the one place a reader would most reasonably trust it and go tidy up a live credential. A characterization test now pins the store's directory: renaming it to the current root fails there instead of silently moving everyone's sign-in.

- `/resume` now says the session was resumed. The transcript is cleared and the earlier turns are not re-rendered, so the screen looked exactly like a command that did nothing — while the model demonstrably had the context. Rendering the history itself needs two APIs the framework does not expose publicly, filed upstream (#70)
- The npm-style `overrides` block is gone from `package.json`, and a lint gate refuses a new one: pnpm never read it, so its `@theokit/sdk` pin sat at `^4.63.3` while the tree resolved `5.0.0-next.1` — a control that looked like it worked (#69)
- Session collection now refuses a transcript root it did not create, instead of sweeping it and reporting a clean run — pointing `THEOKIT_HOME` at any other directory used to produce `0 would remove; 0 kept` and exit 0, and the same path would have deleted another product's transcripts once the home directory becomes configurable (#72)
- A failed turn now answers the framework's TYPED error codes, not only the provider's message text — a refused credential reported `auth_failed` with no next step at all, while the same failure with a raw `401` in its text got one; ten of the SDK's eleven codes produced no hint (B-149)
- The backlog cross-validation gate skipped closed items it was able to check — a second commit written after a space was dropped, and any `fixed_in` mentioning an upstream package was skipped whole even when it also named a local commit; coverage went from 107 verified / 42 skipped to 108 / 41
- Four test suites created a temporary directory per case and never removed it — measured at 2,773 leaked `theocode-*` directories in `/tmp`, paid once per test on every machine that runs the suite
- The dangling-reference guard had two holes of its own: it ignored citations into foreign languages (`.rs`, `.go`, `.py`, …) and it EXEMPTED gitignored paths — the one case guaranteed unopenable for everyone who clones, and the exact defect it was built to catch
- README's Codex parity figures were wrong at the source — 55 slash commands and 27 CLI subcommands, against 58 and 30 in the pinned study clone the parity run actually read; both now name the file they are counted from
- Session collection now names WHICH read failed when it skips a project — an unreadable pointer file was being reported as `registry unavailable`, sending the operator to the wrong file (B-143 follow-up)

- **`B-134`'s guarantee had no gate, and the next dangling citation was already there** (`B-151`). Found by sweeping the class `B-150` named: a guarantee that lives only in a Definition of Done is not a gate. B-134's second bullet — "no reference in `README.md` points at a path that is neither tracked nor ignored" — had nothing behind it. It was verified by hand, once. The next dangling citation was **already present, and it was mine**: the reliability-target section written for `B-133` cites `rules/public-copy.md`, which lives at `.claude/rules/public-copy.md` and is excluded by `.gitignore`, so a reader who clones cannot open it — the same defect as B-134, reintroduced within the hour, in the section written to fix a sibling finding. `tools/check-doc-references.mjs` runs in `lint` now: every backticked repository path in the README must exist on disk or be deliberately gitignored. Ignored passes, deliberately — `.claude/` is local by design, and citing it is a choice about what the reader can see, different in kind from a citation that resolves to nothing. My own citation was fixed the way B-134's was, by inlining the reasoning and dropping the path. One exemption exists and carries its reason in the source: `AGENTS.md` is described in the configuration table, as the file an operator may put in their own project, rather than cited as a record here — and a test asserts the allowlist cannot grow to swallow anything else. Eight tests, including two anti-vacuity floors, because a matcher that returns everything and a guard that flags nothing would otherwise both pass.

- **Moving the sweep to a child process silently regressed two shipped Definitions of Done** (`B-150`). Found by auditing whether the items closed in this release actually met the criteria written on them. Two bullets — "what the automation did is visible, so 'it ran and removed nothing' is distinguishable from 'it never ran'" and "the first automatic sweep says what it WOULD have removed" — were met by the in-process collector and lost when the sweep moved into a child spawned with `stdio: 'ignore'`. The parent reported "background sweep finished" and nothing else; the child's entire output went to `/dev/null`. The instrument was wrong for the concern: `'ignore'` was chosen because the TUI owns the screen, which is an argument against INHERITING the child's streams, and piping captures them without displaying anything — ignoring was the only one of the three that also threw the information away. stdout is piped and collected now, stderr stays ignored, and the parent appends the child's verdict line so the counts reach the operator through the diagnostics channel. A silent child still produces a report, deliberately: reporting only when there is output would make a broken child indistinguishable from a collector that never ran. Nothing detected the regression because no test covered the counts — the guarantee lived in a DoD, and a DoD is not a gate. Three tests carry it now.

- **`B-130` was marked shipped with half its Definition of Done undelivered, and nothing said so** (`B-149`). Found by checking whether the items closed in this release had actually met the DoD written on them. B-130's second bullet — "the final error class survives to the user rather than being reported as whatever the last attempt returned" — is not delivered: a 401 retried by the transport still reaches the user as `rate_limit (HTTP 429)`, now with `after 3 attempts` beside it, which is a hint rather than the class. It is also not deliverable from this repository, and the reason was already written down in a file nobody had connected to the item: `docs/parity/2026-08-25-codex-parity.md` records that `streamAgentTurnInProcess` declares no `retry` though `AgentRunnerRunOptions` has it, filed upstream as usetheokit/theokit#474. So the product cannot see, configure or intercept the policy that rewrites the class. The remainder is tracked as its own open item with the upstream dependency named, per the rule that an item blocked on a third party stays open rather than being closed as "not ours" — and B-130 was NOT re-marked, because amending a DoD to match what was delivered is moving the goalposts, which is the defect the audit that produced it exists to catch. An item marked shipped whose DoD is half-met is the rot the registry exists to prevent: the next reader takes `shipped` to mean the problem is gone, and the 401-as-429 misdiagnosis is not gone.

- **Three findings shipped without a block in the registry that is supposed to hold them** (`B-140`, `B-141`, `B-143`). Found by sweeping the fifth pattern this session repeated — a change reaching consumers without the record the rules require. They had CHANGELOG entries, commit messages and `B-NNN` references in code comments, and no block in `BACKLOG.md`: so a reader who followed one of those references into the registry found nothing, and the file `cycle-backlog.md` calls "the single place that answers what is pending" could not answer what had happened to them. The ids were referenced-but-unallocated, which is the state the registry's own unbreakable rule exists to prevent — ids are the audit trail, and a reference that resolves to nothing makes every other reference worth less. All three are registered now with their evidence, their measurement and the commit that carries them, and each carries a footnote saying it was registered late. The blocks were re-sorted afterwards and the multiset hashed before and after: 148 blocks, content identical, 148 unique ids.

- **A hand-maintained count in the README went stale twice in one session** (`B-148`). The suite figure was invalidated by this release's work, updated, and invalidated again by the tests added after the update — it read 107 files / 837 cases while `npm test` reported 115 / 879, both times by the same hand that was fixing staleness elsewhere. It is corrected, and now names the two ways of counting that are WRONG so the next reader does not reach for either. **A derived gate was considered and rejected on measurement**: a glob over `*.test.ts` finds 114 because one suite is a `.test.mjs` under `tools/`, and counting `it(` finds 823 because `it.each` expands at runtime. A gate built on either would assert a wrong number, which is worse than an old one — a stale figure carries its date and says so, while a wrong gate is green and confident. The honest instrument here is the date the claim already carries, and the rejected alternative is recorded so nobody re-litigates it from scratch. **It then decayed a third time before that entry was an hour old**: corrected to 879, and the next fix added three tests — so the very item whose criterion is "the count matches what `npm test` reports" was violated by the work that followed it. That is not inattention; it is what a hand-maintained number in a document does while work continues, demonstrated three times in one session. The rule that would have held, and the one now recorded: update the count as the LAST step before finishing, never in the middle.

- **The third repeated pattern, swept: runtime claims written as fact** (`B-147`). Two classes had already been swept after appearing three times each — unbounded subprocesses and tests that cannot fail. A third had appeared twice, both in the same file and one written while fixing the other: a claim about runtime behaviour stated in a comment that nobody had measured. So every behavioural claim written in this release was enumerated and the deducible ones measured. Three were deductions rather than observations, and one was false: "node with no script starts an idle REPL that never exits, one leaked process per launch" — it does not, because with `stdio: 'ignore'` the child's stdin is `/dev/null`, so node reads EOF and exits 0 immediately. The guard is still right for a smaller and more precise reason, which is now what the comment says: that child would exit 0 having swept nothing, and the reporting would announce a finished sweep, so the collector would claim success daily while collecting nothing. The two claims that survived measurement — a `spawnSync` timeout leaving `status` null with `SIGTERM` and `ETIMEDOUT`, and `rmdir` failing `ENOTEMPTY` on a non-empty directory — now carry the measurement, so the next reader does not re-derive them from POSIX.

- **A second false claim about process behaviour, written while fixing the first** (`B-146`). The collector's child process was documented as "NOT detached. The child is bound to this process's lifetime". Measured by spawning one, exiting the parent immediately and checking whether it finished: **the child outlived the parent**. A child spawned without `detached` is orphaned and reparented, not killed; what `detached` changes is the process group, so closing the terminal window sends SIGHUP to both. The claim was load-bearing — the CLI's decision not to collect rested on "a one-shot process exits before the child finishes and would kill it halfway", and that premise was wrong. The comment states the measurement now, and the CLI's decision was re-derived rather than kept: it does not collect because `onReport` fires on the child's `close` event and a one-shot CLI is gone by then, so the sweep would run completely unobserved — the "it ran and removed nothing" versus "it never ran" ambiguity the reporting exists to remove. This is the second false runtime claim in the same file: `B-142` fixed one asserting the sweep could not block the operator, which an independent review falsified by measuring, and this one was written while fixing it, by the same reasoning-instead-of-measuring.

- **Two more unbounded subprocesses, both synchronous, both freezing the TUI** (`B-145`). This release fixed the same defect three times — a timeout the operator could not reach (`B-128`), a `git` call with none at all on the CLI's first line (`B-137`), and a child process spawned with no bound by the fix for the second (`B-144`). Three instances is a pattern, so every subprocess in production source was enumerated and checked instead of waiting to trip over a fourth. Two more had none: the clipboard write, and both `git diff` calls behind `/diff`. Both are `spawnSync`, which does not merely take time — it blocks the event loop, and in the TUI that is the Ink render loop, so a frozen frame with no cursor is what the user sees and it is indistinguishable from a crash. The clipboard is the sharper of the two: its candidates are `wl-copy`, `xclip`, `xsel` and `pbcopy`, exactly the programs that hang when a display variable is set and the compositor is not answering. The diff bound is 10 s because `/review` already bounds its git calls at 10 s — two different answers to "how long may git take" in one product is the inconsistency the first of these findings was about. The clipboard needed no error-handling change: `spawnSync` reports a kill through `result.error` and the existing loop already turns any non-ENOENT error into a write failure, so a timeout surfaces as a real failure of an installed clipboard rather than skipping to the next candidate or returning as though the text had been copied; a test drives exactly that. The sweep was then re-run — 9 call sites, 7 real, all bounded, and the two it still reported were prose inside comments, checked by opening them rather than reported as findings. **And then the other repeated pattern of this release was swept the same way** — a test that cannot fail, which had already appeared three times. Mutation-checking every test added here found two more blind in exactly the way the collector's `apply: true` had been: they asserted the timeout CONSTANT existed and never that it was passed, so deleting `timeout:` from either `spawnSync` call left the suite green. The options are values now — `clipboardSpawnOptions` and `diffSpawnOptions` — so a test reads what the call receives rather than what a constant says, and removing either bound fails tests. Two things about the checking itself are worth recording, because both would have produced a false clean: the mutation harness reported a verdict when the mutation had not applied, and one reported blindness was a badly-formed mutation that moved code inside the same `try` instead of out of it.

- **The fix for an unbounded subprocess introduced an unbounded subprocess** (`B-144`). This release fixed a timeout the operator could not reach (`B-128`) and a `git` call on the CLI's first line with no timeout at all (`B-137`) — and then, moving the session sweep into a child process to stop it blocking the event loop, spawned that child with no `timeout` and no `killSignal`. Third instance of one defect in one release, and the third was introduced by the fix for the second: a change that moves work somewhere else inherits none of the bounds the old place had, and nothing in the review of that change asked about them. The failure mode accumulates, which is what makes it worse than the two it followed — a sweep blocked on a dead network mount lives as long as the TUI does, and the next day the stamp is due again and another is spawned beside it, with nothing reaping them. The bound is ten minutes and generous on purpose: 37.1 s was measured for one sweep on a 13 269-project tree, so a limit near that would kill legitimate work on a large disk, and a collector that always dies is worse than the hang it prevents because it stops working silently. `SIGTERM` rather than the default, so a sweep caught mid-`unlink` can finish the syscall it is in; `stdio: 'ignore'` because the TUI owns the screen and the stderr guard protects this process, not a child. All three moved into the command builder so they are asserted by tests rather than left as call-site arguments nobody reads.

- **`keepLast` was spent on entries that could never be collected, so the ones it protects were deleted** (`B-140`). Found by an independent adversarial review and reproduced with its own test before being believed. The quota protects the N most recent transcripts of a DEAD project, and the sort feeding it reads an unknown mtime as `Infinity` — so an entry the collector could not `stat` sorts as the newest thing in the project and takes a slot. Those entries are already safe, because `collectableAge` returns undefined without an mtime and the planner skips them, so the quota was spent on files that were never at risk while the stale transcripts it exists to protect fell through to deletion. Measured: 10 unstattable entries beside 5 stale ones planned all 5 for removal at the default quota of 10. This is the mirror of the bug B-020 fixed one line above — `mtimeMs` used to be `0`, which sorted LAST and dated the file to 1970, and that fix reasons about sort position and concludes `keepLast` "could not protect it either"; moving the entry to the front protected it twice and unprotected its neighbours. The most-recent guard for ALIVE projects had the same hole and is fixed with it. Reachability changed in this release: until `session_gc` defaulted to true, this needed someone to type `sessions gc --apply`.

- **One unreadable pointer stopped collection for the whole tree** (`B-143`). `readPointerId` fails fast on any errno but ENOENT, and its reason is sound — what it returns is a deletion decision, so swallowing an EACCES would drop a live session from the protected set. That argument is about *that project*. The call sat outside every `try` in `resolveGuards`, between the catch wrapping `listProject` and the one wrapping `listRegistry`, so the throw unwound out of `planSessionGCAllProjects` itself: measured, the whole plan rejects. One project with a permissions problem meant nothing anywhere was collected — and under the automatic trigger the stamp is already written, so it would not retry for a day, every day. It is inside the same guard as the registry read now, which the caller already handles by skipping the project and reporting it; the safe direction stays where it belongs and stops being contagious.

- **The credential-routing order, which the source calls "the fix", had no test** (`B-141`). `run.ts` states it plainly: route the model id for the credential that will serve it, then resolve a credential for the routed id, then build on that id. Getting it wrong is not theoretical — it shipped, and was measured on 2026-08-25: with a ChatGPT sign-in the configured id selects the API-key provider, `api.openai.com` refuses an OAuth token with a 401, and after the transport's retries that reached the user as `rate_limit (HTTP 429)`, sending them to check a quota page for an auth problem. Nothing tested it; the order survived as a comment over dynamic imports no test could reach, on a path where a previous version cost a user their turn and their diagnosis. The seams are injectable now and four tests pin the sequence, including that the second resolution uses the ROUTED id — which is the bug itself, stated as an assertion.

- **The automatic sweep blocked the event loop for up to 37 seconds, and the comment beside it said it could not** (`B-142`). Found by an independent adversarial review of this release — the check the originating audit declared missing four times and never performed. It built the tree this repository itself cites as measured (13 269 projects) and ran the exact shape of the TUI's call with an event-loop lag monitor: **37.1 s cold, 4.9–13.2 s warm**. `planAllProjectsOnDisk` is declared `async`, but its body runs synchronously until the first `await` and `classifyProjects` is invoked eagerly while the argument object is built, so `void collectSessionsAutomatically(...)` deferred the tail of a function whose tail was empty. That falsified a claim written into the source in this same release — "housekeeping must never be something the operator waits for … the `void` is the point rather than an oversight" — and the CLI was worse-shaped than its own comment admitted, awaiting the sweep so `theocode run` printed its answer and then sat for 5–37 s, invisible in a script except as a stall. There is no in-process fix: the work is synchronous JavaScript inside a dependency, and no scheduling makes a synchronous block yield. The sweep runs in a child process now, executing `sessions gc --all-projects` — the command that already exists — so the path that deletes user data still has exactly one implementation, with the parent keeping the decision (enabled, due, first-sweep-must-not-apply) in a `sweepDecision` the two callers shared so they could not drift. It is deliberately not detached and the CLI no longer triggers at all: a one-shot process exits before the child finishes and would kill it halfway, so collection belongs to the long-lived surface. Two more findings from the same review, both introduced by this release: `resolveEffectiveConfig` was evaluated while the argument object was built, so a typo in `~/.theocode/config.toml` threw **outside** the `.catch` the comment called "the belt to its braces" and killed the TUI after `render()` had claimed the terminal; and a recorded guard — "a brand-new session is the most-recent, which is protected regardless" — was false, because the most-recent guard returns early on DEAD projects. One review finding was **refuted** and is recorded as refuted: the collector's report does not paint over the Ink frame, because `installStderrGuard` redirects `process.stderr.write` to a log file for exactly that reason and is installed first. The change forced two deletions, taken rather than suppressed: with the CLI trigger gone and the TUI spawning, `maybeCollectSessions` and `collectSessionsAutomatically` had no caller and knip said so.

- **The first automatic sweep looks before it deletes** (`B-139`). Found by asking whether the automatic path matches the manual one it automates, rather than only whether it works. It matches on the window, the floor, `keepLast` and the operation budget — all inherited and verified. It did not match on the safety step: `sessions gc` is **dry-run by default** (`args.ts:120`) and prints "re-run with --apply to delete", because deletion is significant enough that the author made the operator ask for it. Turning collection on by default removed that property for everyone, and removed it at the worst moment — the first run, when the backlog of old transcripts is largest and nobody has yet seen what a 30-day policy would take. Someone with two years of sessions would have met the change as a large silent deletion. The first sweep now plans, reports what it WOULD remove, and removes nothing; the next applies. The stamp is still written on that first run, so the collector cannot dry-run forever — the failure it must not trade itself into. The report names the choice rather than burying it: "first automatic sweep — DRY RUN, nothing was removed. The next one will apply; set `session_gc = false` to keep collection manual." Both guarantees are mutation-checked and independently protected: forcing the first sweep to apply fails 2 tests, forcing every sweep to dry-run fails 6, and dropping the `apply` argument on the way to the SDK fails 6.

- **The test guarding the collector's central promise could not fail** (`B-138`). Found by mutation-checking the fixes in this release rather than trusting a green suite: revert each change, confirm the test that claims to protect it turns red. Nine of ten mutations were caught. The tenth was not — dropping `apply: true` turns the automatic collector into a PERMANENT DRY RUN that plans removals every day, removes nothing and reports success, and the suite stayed green at 6 passed. The assertion checked that the report string did not contain `DRY-RUN`, and the string never contained that word in either case, so it was true whatever the code did. It guarded the one promise that makes deleting an operator's transcripts by default acceptable — that the collector actually collects — and it was written by the same person as the fix, in the same change, and passed review by being green. The outcome now carries `dryRun`, read from the flag the SDK sets on its own result, and the assertion reads that; the report says `(DRY-RUN — nothing was removed)` when it applies, because "0 removed because there was nothing" and "0 removed because I did not remove" are different facts. Verified the only way that means anything: the same mutation now fails 2 of 7 tests, and reverting it returns 7 of 7 green.

- **The first thing the CLI does was an unbounded subprocess that misreported its own failure** (`B-137`). `gitGate` runs `git rev-parse --is-inside-work-tree` before anything else, and it ran it with no timeout at all — so a git that hangs, on a network-backed working tree, a stale `index.lock`, or a credential helper waiting on a prompt, hung the CLI forever, before it had printed anything a user could act on. Every failure also took one branch and printed `Not inside a git repository`, so a hang, a missing binary and a genuinely non-git directory were reported identically and only one of them was true — the same shape as a transport turning a 401 into a 429. The gate still refuses; what changed is that it is bounded and that the reason git gave reaches the user beside the verdict. The bound is `DEFAULT_SHELL_TIMEOUT_MS` and deliberately NOT `shell_timeout_ms` from config: this runs before any config is resolved, and reading a file here would add a failure mode to the earliest path in the process, the one place a failure has no friendlier path to fall back to. **It was found by re-measuring rather than by trusting a fix**: the sweep that produced the timeout finding counted call sites hard-coding a constant, and this one was invisible to it precisely because it had no constant to count. A search for "the constant is wrong" cannot find "there is no constant". Four tests cover it, including that skipping the gate runs no subprocess and that the timeout actually reaches the call — a bound a test cannot see is a bound nobody asserts.

- **The backlog registry was `INVALID` with 31 blockers, and every one of them is closed** (`B-043`, `B-079`, `B-100`). This was reported as pre-existing while fixing the audit findings, and then fixed rather than left as a footnote. The bulk was routing: 30 items name `theokit`, `theokit-sdk` or `theokit-tui`, all three of which exist on disk beside this repository, and none of which was in the routing table — so every one was `BLOCKER/unroutable_repo`, routing to nobody. Running the router directly rather than trusting the structure check found a worse one it does not look for: `TheoCode` itself was a **BROKEN ROUTE**, because the table named `agents/theocode.md` and no such file existed, so all 106 items filed against this repo resolved to nobody either. Gate G1 asks whether a repo is IN the table, not whether the table's answer exists. Both specialist files are written now, with commands verified in the checkout on the day rather than copied from a table, and `route_domain.py` exits 0 for all four repos — **on the machine that ran it, and nowhere else**. `.gitignore` excludes all of `.claude/`, which is where the routing table and both specialists live, so this entry credits a repair no clone receives. It is recorded here anyway because the CHANGELOG is where a reader would look for it and silence would be worse, but the honest reading is that the registry's health is per-checkout until the kit that owns those files ships the fix itself. The remaining three findings were content: `B-100` said `raw` while carrying a measurement taken 2026-08-10, which misreports an examined item as unexamined; `B-079` was missing `why_now`, reconstructed from the premise its own evidence and kill_reason both quote; and `B-043`'s third DoD bullet had nothing falsifiable in it — following that one found that the guarantee it described was implemented in `squad.ts`, explained in a comment, and covered by no test at all, so `disposeMembers` is extracted and five tests now hold the line that a member whose disposal rejects cannot replace the delegation result the user waited a full turn for. The item blocks are also sorted by id, which the `renumbered` blocker was about; the multiset of blocks was hashed before and after to prove only the order changed. `check_backlog_structure.py` reports **SHIPPABLE, 0 blockers, 0 majors, 0 minors**, and `crossval` 93 of 93 consistent.

- **`npm run build` was broken, and no CI job ran it** (`B-136`). `tools/build-cli.mjs` copies `provider-catalog.json` out of `@theokit/sdk` — without it, auto-compaction is silently disabled in every model mode — and the root package never declared that dependency, relying on the SDK being hoisted into the root `node_modules` as a transitive of `@theokit/agents`. pnpm does not hoist it, and pnpm is right: you may not resolve what you did not declare. So `dist/theocode.mjs` could not be produced, and the smoke test the README offers as the check that "touches neither the network nor a credential" was unrunnable by anyone who cloned. The fix is a declaration, not a resolution trick: `@theokit/sdk` is a root devDependency pinned to `5.0.0-next.1`, the same exact version `pnpm-workspace.yaml` already overrides to, so the installed tree is unchanged and only the build's real use becomes written down. Nothing in `packages/*/src` imports the SDK, so the test asserting the product does not claim an SDK it never imports is untouched. **The gate is the actual fix**: this went unnoticed because CI ran typecheck, test, lint, depcruise and crossval and no build at all. A `build` job now runs it, asserts the three artifacts exist and are non-empty — esbuild exits 0 while writing nothing if its entry resolves to an empty module, and the catalog is a copy step whose failure is silent — and then runs the README's smoke test verbatim rather than a proxy for it. knip reports the dependency as unused because the reference is a runtime-computed specifier its own config warns about; that is recorded in `knip.jsonc` with the reason, as that file prescribes, rather than left as a standing warning, because a gate that always prints something is a gate people stop reading. Verified end to end: three artifacts produced, `node dist/theocode.mjs sessions gc` exits 0, lint fully clean.

- **Three Codex verbs whose feature we ship reported `unknown command`** (#61). The pointer map exists so someone arriving from Codex finds the capability we DO have under a different verb, and `multi-agents` fell straight through it while `/agents` and `/subagents` were both registered — the user is told the product lacks something that is one word away, which is worse than a missing feature because it ends the search. `elevate-sandbox` and `sandbox-read-root` failed the same way: the map already answered two sandbox verbs and these two were simply not among the keys, so the answer existed and the door to it did not. All three now point at the real command. The regression test asserts the class rather than the three names — a Codex name whose feature exists here is never a `commandError` — because the next verb to fall through this gap will not be one of these. The four copies of the sandbox answer collapsed into one constant while the tests were green: one sentence about how sandboxing works here, edited in one place.

- **Every turn was denied in any repository that also uses Claude Code.** Not degraded — denied: `✗ preRun hook denied execution: bash: /.claude/hooks/userpromptsubmit-inject.sh: No such file or directory`. Note the leading slash. `@theokit/sdk` reads hook definitions from `.claude/settings.json` as well as `.theokit/`, which is a deliberate and useful compatibility, but the commands in that file are written for Claude Code's runtime and reach project files through `$CLAUDE_PROJECT_DIR` — the documented way, since an absolute path would break for everyone else on the team. Nothing outside Claude Code defines it, so the shell expanded it to the empty string and the hook runner read the missing file as a refusal. Both surfaces now set the variable at boot when it is unset, beside the existing `installAuthHome` and for the same reason: if this product executes a file written against another runtime's contract, it should supply the part of that contract it can. An already-set value always wins, so running inside Claude Code is unaffected — its real value points at the true project root and clobbering it would break the very hooks this fixes. Filed upstream as usetheokit/theokit-sdk#522; the failure there is doubly quiet, because it fails closed and names the script (which is present) rather than the variable (which is not).

- **`/memory` claimed `Memory ON` while nothing could be written.** Real memory is the AND of three facts — directory trust, the `memory` config key, and the session switch — and the panel read only two of them. With the shipped default `memory: false`, it therefore named a `MEMORY.md` path and reported ON; dictating a fact with "Remember: …" wrote nothing, and no such file was ever created. Introduced in this same release, when `memory` became a config key and this panel was not told. Each `false` now keeps its own sentence, because the remedy differs: trust the directory, set the config key, or flip the session switch — telling someone `/memory on to resume` when the switch is not what is off sends them to a command that cannot help them. Found by driving `/memory` in the running TUI during the validation sweep; the unit tests were green throughout, since nothing had ever asserted the panel against the memory that actually runs.

- **Stdout carried every message the turn emitted, joined without a separator (#62).** `--help` states the contract it broke: "Stdout carries ONLY the final message". A turn emits text more than once — a preamble before each burst of tool calls, a recap after the last one — and the processors concatenated all of it, so on a two-step task stdout read ``I'll read `duration.mjs` and report its contents briefly.`duration.mjs:2` defines …`` with nothing between the two messages, because nothing was ever meant to join them. `-o/--output-last-message` wrote that same run-on string to a file a script then reads. The boundary is the tool call: text buffered when one starts was a preamble by definition, since the answer cannot precede the tool that establishes it. Preambles now go to stderr, in order, before the call they announce; stdout carries the closing message alone, as Codex's does.

- **A ChatGPT sign-in worked in the TUI and failed in the CLI — the same credential, the same second (#62).** `theocode run` reported `rate_limit (HTTP 429)`, which reads as a quota problem and is not one. Two defects stacked, both measured on 2026-08-25 by posting the stored token to each endpoint. First, headless built on the CONFIGURED model id: a ChatGPT sign-in stores an OAuth token, `openai/…` selects the API-key provider, and `api.openai.com` refuses that token outright (`401 Missing scopes: api.responses.write`). The TUI re-points the id at `openai-chatgpt/…` before resolving anything; the CLI did not. Second, even routed, the SDK's `openai-chatgpt` provider reads `<home>/.theokit/auth.json` while this product writes `<home>/.theocode/auth.json`, and the only bridge is `THEOKIT_AUTH_HOME`. The TUI set it with a hand-rolled `??=`; the CLI called `ensureAuthHome` and **discarded the return** — B-034 had correctly stopped that function mutating its argument, and the one call site whose entire purpose was the mutation was never updated. Both surfaces now call `installAuthHome`, which is named for the half that writes, and headless routes the id before it resolves a credential for it. `theocode run` completes a tool-calling turn again.

- **Consent cards say what the answer DOES, not which key to press (#61).** `PermissionPrompt` defaults to a bare `Yes` / `No`. Both references name the consequence — Codex: `1. Yes, continue` / `2. No, quit`; Claude Code: `1. Yes, I trust this folder` / `2. No, exit`. Each gate now supplies its own refusal label, because the three refuse into different outcomes: a tool call is rejected, a hook is left inert, and the trust gate QUITS the session — which the button never said. The deny choice stays LAST by contract, not by style: `PermissionPrompt` yields the last choice's value on Esc, so reordering them would make Esc approve a shell command. (#61)

- **The approval card says which keys settle it (#61).** It showed `❯ 1. Yes / 2. No` and nothing else, leaving the user to guess between typing the digit, pressing Enter, and pressing Esc — on a card that is blocking a shell command, which is the worst moment to guess. Both references print it: Claude Code ends with `Enter to confirm · Esc to cancel`, Codex with `Press enter to continue`. Ours reads `Enter to confirm · Esc to reject`, and says *reject* rather than *cancel* because that is what Esc does — the tool call is refused, the question does not go away. Applied to the trust gate and the hook-review gate as well as tool approvals. (#61)

- **Every failed turn rendered as "An error occurred." on both surfaces (#62).** The framework masks by default — `presentUIMessageStream` uses `opts.onError ?? MASK_ERROR` — and neither surface passed `onError`, so every failure in this product printed three words and nothing else. Measured 2026-08-25: a rate-limited account produced `ERROR: An error occurred.`, and the cause (`RateLimitError`, already retried twice) was reachable only through `THEOCODE_DIAGNOSTICS=stderr`, an environment variable the message does not mention. The default is right for the transport it was written for — a public HTTP endpoint must not leak server internals to a caller who is not the operator — and wrong here, where the caller IS the operator, on their own machine, against their own credential. One policy in `@theocode/shared/turn-error` now serves both surfaces, so they cannot describe the same failure differently. It reports the message and code, and adds a next step for four common failures. The same run now reads: `ERROR: openai API error: rate_limit (HTTP 429) [AGENT_ERROR] — the provider is rate-limiting this account — wait and retry, or switch model with /model`. (#62)

- **`/status` answered `<unknown>` about `AGENTS.md` at the only moment anyone asks (#61).** The row reported what the last build wired, and `/status` is what a person runs BEFORE the first turn — so the line that says which rules the agent is about to follow read `<unknown — no agent has been built yet>` precisely when it was needed. The walk behind it is a pure read of the disk, so the question always had an answer. It now names the files it finds, labelled `(on disk — not loaded yet)` because the trust gate has not run at that point: reporting them as loaded would be the overstatement `<unknown>` was avoiding.

- **`/status` reported the sandbox twice and aligned its values raggedly (#61).** The panel rendered `sandbox:    sandbox:workspace-write` — it filled a column already labelled `sandbox:` with `sandboxLabel`, which carries that prefix for the FOOTER, where it sits in a `·`-joined run of bare values and has to say which knob it is. The getter is now split (`sandboxLabel` / `sandboxDetail`), so neither consumer has to strip a prefix back off. The column padding was typed into eight template literals by hand and was already wrong on arrival — `model:` sat one column left of the other seven. It is computed from the widest label now, which makes that class of defect unrepresentable rather than merely fixed.

- **`theocode doctor` reported a green tick for an expired credential (#61).** `credentialState` checked that the file existed and parsed, never that it was still valid, so an OAuth token ten days past its expiry produced `✓ credential: present` — a diagnostic whose whole job is to answer "is this ready to run?" saying yes about the first thing that would fail. `expired` is now a state of its own and reports as a WARNING, not a failure: a refresh token may still renew it, so "you will probably be asked to log in" is the honest strength of the claim. A credential with no `expires` at all (an API key) is unaffected — a missing field is not an expiry. `collectChecks`'s docstring had claimed since it was written that the tests could "drive an expired credential"; they could not, because the state did not exist. (#61)

- **The Codex study clone can no longer be committed.** `codex/` — 99 MB of Apache-2.0 source — was present in the working tree, untracked and **not** gitignored, in a repository that is public. `README.md` states the rule it violated: the clone "lived outside the tree, gitignored, read-only", because "a literal copy would carry the upstream licence into this repository, which is a legal problem and not a stylistic one." A single `git add -A` would have done it, and nothing warned: `git status` showed one untracked directory line like any other. It is now gitignored, and ESLint ignores it too — from v10 ESLint descends into it and tries to load `codex/sdk/typescript/eslint.config.js`, which aborted the entire lint run before one file of ours was checked. (#60)

- **Three defects ESLint 10's new `recommended` rules surfaced.** A live-session pointer that could not be read threw a symptom error with no `cause`, discarding the errno and the stack for a failure whose whole job is to say which syscall on which path refused (`session/gc/pointer.ts`). Two dead initialisers (`config/trust-store.ts`, `tui/src/backtrack/backtrack.ts`) read as fallbacks that no path can ever reach. (#59)

- **Test runs no longer claim every core on the host.** `vitest.config.ts` capped nothing, so the default applied — `os.availableParallelism()`, one fork per core, each booting a full test environment. On a 12-thread machine a single `vitest run` therefore took the whole box, and anything else running alongside it (a second suite, a typecheck, the desktop) competed for what was left. The cap now leaves 4 cores free (`Math.max(2, cpus().length - 4)`), scaling with the runner instead of hard-coding one machine's core count. It costs no wall-clock — measured in `theokit-ui`, the full suite ran 73.96s at 4 workers against 74.36s at 12. (usetheokit/theokit-ui#51)

## [0.4.7] - 2026-08-20

### Changed

- **`InputSlot`'s approval surface no longer casts what its own predicate already proved (B-107).**

  `@theokit/tui` moved from `^0.67.0` to `^0.76.1`. Under 0.x the caret pins the MINOR, so
  `^0.67.0` was `>=0.67.0 <0.68.0` — this package could not reach anything published after 0.67,
  and `@theokit/tui` was not in `node_modules` at all.

  The version that mattered is 0.76.0, which added `narrowingLayer`: a `SurfaceLayer` whose `when`
  is a type predicate, so the narrowing survives into `render`. It was extracted **because of the
  cast in this file** — `approval={p.pendingApproval as PendingApproval}`, three lines below the
  `when` that had already proved it. That cast is gone.

  Nine minors were crossed with no breakage: 42 distinct symbols across 21 files, all present in
  both published artifacts, and typecheck / 555 tests / lint / depcruise identical to the
  pre-bump baseline.

## [0.4.6] - 2026-08-19

### Changed

- **CI's five checks are documented as NOT required, with the measurement that proves it (B-062).**
  The workflow header said the five jobs were "every one of them blocking". That is true in a
  narrow sense — no job reports a failure as a pass — and it reads as the broad one: that GitHub
  refuses the merge. It does not, and cannot at this tier.

  Measured with a token holding `permissions.admin: true`: branch protection is a 403 on `develop`
  AND on `main`, repository rulesets are a 403, and organisation rulesets are a 403 naming GitHub
  Team. Rulesets were checked rather than assumed — they are the newer mechanism and the obvious
  escape hatch, and there is no free-tier route to a required check on a private repository. It is
  a billing wall.

  What holds the line today is a person waiting for five green ticks — usually. 25 merged PRs
  surveyed (#25 through #49), none merged with a red rollup, the six most recent merged 20-49
  seconds after the last check completed. But PR #33 merged **one second after its checks started,
  with zero completed**; it went green afterwards, so it is not a red merge, and nothing gated it.
  That is B-070 in the umbrella backlog (not this file's own B-070), and it is why "correct
  practice" is not the same as a control.

  **No decision was made, and this entry is not an approval of the gap.** Three ways out, each with
  its consequence and none recommended: buying GitHub Team costs money this measurement did not
  price; making the repository public removes the wall for free and discloses the full history
  irreversibly; leaving it as it is keeps merges ungated by anything but attention. The choice
  belongs to the account owner. The record states where the decision stands and embeds a one-line falsifier
  (`gh api .../branches --jq '.[] | {name, protected}'`) that goes false the moment protection is
  configured. It does NOT prove the billing wall on its own: a paid tier where nobody configured
  protection prints the same result, so the four API calls are what establish that, and the record
  says so.

  No job, step, trigger or product file changed. This buys traceability, not enforcement.



## [0.4.5] - 2026-08-19

### Changed

- **The clear-screen sequence comes from `@theokit/tui/terminal` (B-014).** `terminal-io/clear-screen.ts`
  — a single-line constant — is deleted, and both call sites import `CLEAR_SCREEN_AND_SCROLLBACK`.

  **The bytes are unchanged**, and saying so matters: the two declarations were identical, so this
  ships no behaviour change. What it buys is the name and the tests. `CLEAR_SCREEN` did not say it
  clears the scrollback, so shortening it would have silently left the history on screen — and the
  local constant had no test at all, while the library's pins all three parts of the sequence.

## [0.4.4] - 2026-08-19

### Changed

- **The context warning's rise detection comes from `@theokit/tui` (B-012).** `useContextWarning`
  now calls `useRisingEdge`; the eight hand-written lines it replaces had two failure modes the
  library's docstring enumerates, both of which show up as *the warning does not appear*.

  Three owners, one fact each: `@theokit/agents/config` classifies the pressure,
  `@theokit/tui` detects the rise, and `contextWarning` — which names `/compact` and says what
  compaction costs — stays here, because a framework that wrote it would be putting words in this
  product's mouth.

  **An absent usage reading now explicitly HOLDS the last level.** The tempting adoption maps it
  to `ok`, and `ok` is a fall, which re-arms the detector — so the next reading would warn a second
  time for a level the user had already been told about. The existing test drove an absent reading
  only at the start and would have stayed green through exactly that. The new one drives it
  mid-stream, and it is the only test that fails against the wrong version.

## [0.4.3] - 2026-08-19

### Changed

- **The frame budget comes from `@theokit/tui` (B-010).** `rendering/coalesced-memo.ts` (79 lines)
  and its test (60 lines) are deleted; `use-timeline.ts` consumes `useCoalesced`, whose suite
  covers every assertion the local test pinned plus four the local suite never had — a backward
  clock jump, a zero window, screen-reader passthrough, and the trailing update.

  The deleted `test_the_clock_is_monotonic_non_decreasing`, whose detection power was
  mutation-verified under B-030, is replaced by
  `src/renderer/frame-budget.test.ts` `test_the_default_clock_is_performance_now_and_not_Date_now`
  upstream. It is named here so the question "what happened to that assertion?" has an answer.

  **`frame-budget.ts` survives, and that is the point of the change.** The library's default window
  is 34ms, which equals `ceil(1000 / 30)` — but only while `TUI_MAX_FPS` is 30. Taking the default
  would convert one derived pair into two constants that agree by coincidence, and `TUI_MAX_FPS` is
  also what ink receives as `maxFps`. The window is now computed by `coalesceWindowMs(TUI_MAX_FPS)`
  and passed explicitly, with three tests pinning the derivation — including one that fails for a
  hardcoded 34.

## [0.4.2] - 2026-08-19

### Changed

- **The input row's precedence is a declared list, and it is asserted for the first time (B-008).**
  Two nested ternaries decided which of seven surfaces owns the row — four branches in `InputSlot`,
  four more in `ConversationSlot` — and neither file had a test. They are now two layer lists
  consumed by `@theokit/tui`'s `selectSurface`, read top to bottom, with nine tests: eight ask a
  plain state object which surface wins, one mounts to prove the names are wired to real surfaces.

  Precedence is unchanged. The overlapping cases were found by measuring which conditions can hold
  at once — the pair the work item's own wording suggested turned out to be the one pair that
  cannot overlap, so a test written from that phrasing would have asserted an unreachable state.

## [0.4.1] - 2026-08-19

### Changed

- **Both advertising channels are derived by `@theokit/tui` from one declaration (B-006).**
  `components/composer-shortcuts.ts` (72 lines) is deleted; `composerShortcutsFor` and
  `footerHintFor` — the derivation the library extracted in B-005 — replace it, reading a single
  `THIS_BUILD` declaration in `components/composer-capabilities.ts`.

  **The adoption was not a pure deletion, and that is the finding.** The library gates four keys
  where the local filter gated one, so a minimal declaration would have silently dropped the `?`,
  `/` and `@` rows. Each was measured at the app's `<ChatComposer/>` instead of assumed.

  **`mentions` is declared `true` although this app passes no `fileSearch`.** `ChatComposer`
  declares `fileSearch = defaultFileSearch`, so omitting the prop installs a `.gitignore`-aware cwd
  walk rather than disabling mentions — the `@` menu works. The library's own field docstring says
  "a mention provider is passed", which is the predicate the code does not use; following it
  literally would hide a working affordance, the inverse of the defect this model exists to
  prevent. The upstream correction is tracked separately.

  `!` stays unadvertised (ADR 0001) and `← for agents` stays unadvertised (B-067). The three B-028
  tests changed only their CALL, never an assertion, and the `SessionFooter` tests were not touched
  at all — they assert the rendered frame, which is what makes them the migration's proof.


### Fixed

- **CI could hang indefinitely on one network step, and now cannot (B-073).** The word-list
  install had no time ceiling anywhere in the workflow; measured on run `32269423670` it sat
  in-progress for 21 minutes with zero output and did not respond to a cancel, while the other
  four jobs finished green in under two. Every job now declares a ceiling, and the install
  retries three bounded attempts with backoff — the stall is silent, so a whole-step timeout
  could only report the death, never recover from it. If all three attempts fail the job is RED:
  the language gate fails closed by design and is never silently skipped.

## [0.4.0] - 2026-08-19

### Changed

- **The backtrack overlay windows through `@theokit/tui`'s `WindowedList` (B-004).**
  `windowAroundSelection` — 25 lines of hand-rolled centred windowing — is deleted, and
  `BacktrackOverlay` goes from 91 lines to 45.

  The fork was deliberate and its own test recorded the two conditions under which it would end:
  the library's `windowFor` was a trailing window, and it reported overflow as booleans where the
  overlay needs counts. Both now hold, so the record's expiry arrived.

  **The hidden-row markers now read `▲ 8` / `▼ 7` instead of `… 8 older` / `… 7 newer`** — a
  deliberate, user-visible change, not a side effect: the arrows are the compact conventional form
  and this overlay already carries a wordy header. What the overlay needed and the library does not
  draw is kept rather than lost: the rounded border (the consumer's own `Box`), the per-row numbers
  the header's "message 11/20" refers to (formatted into the rows), and the header's own gesture
  words (the `header` slot, which exists so the library never puts them in its mouth).

- **The usage panel comes from `@theokit/tui` instead of a local copy (B-002).** The 31-line
  `components/UsagePanel.tsx` composed three primitives it already imported from the library — which
  is exactly the composition the library extracted and published. It is deleted, and
  `ConversationRegion` imports the published component.

  `@theokit/tui` moves `^0.53.0` → `^0.67.0`. That bump is the substance rather than a detail:
  under npm's semver `^0.x` is pinned to the same minor, so `^0.53.0` could never reach the version
  that ships the component.

  The render was proven identical before the deletion — both components drawn with a turn carrying
  input, output, cached, reasoning and cost, and the full frames compared — rather than assumed from
  the two files composing the same primitives.

## [0.3.1] - 2026-08-19

### Fixed

- **The session GC's refusal to delete a live session is now covered by a test that can fail
  (B-017).** Neutralising the guard used to leave all 534 tests green, while
  `theocode sessions --apply` reaches it and deleting a user's live pointer is unrecoverable. The
  tests assert the delete seam is never CALLED for a protected id — asserting only that an error is
  reported passes against a version that deletes the session and complains about it.
- **The veto that keeps the agent off the unsandboxed builtin shell is now covered (B-017).** It is
  wired at `chat.ts:245` and no test imported it; a regression would have surfaced as a write that
  ignored `--sandbox read-only`, in the field. The pass-through case asserts the previous handler's
  return VALUE, so a wrapper that calls the chain and discards its decision is caught.

  Both suites were verified by mutation rather than by existing: 11 mutants, 11 detected.

## [0.3.0] - 2026-08-19

### Added

- **The five declared gates now run on every pull request (B-015).** `typecheck`, `test`, `lint`,
  `depcruise` and `crossval` each run as their own job, so a failure names which gate broke instead
  of stopping at the first one. None of them is allowed to report a failure as a pass. Before this,
  `.github` had never existed across 383 commits and every gate passed only when a human remembered.

### Fixed

- **The 31 closed items that recorded no commit now say who closed them (B-016).** `crossval` was
  reporting `31 problems` to nobody. Each value was read off the commit that recorded the closure,
  not chosen to satisfy the check — 30 of the 31 name another repository's release
  (`@theokit/sdk`, `@theokit/tui`, `@theokit/presenter`, `@theokit/agents`) and one names two local
  commits. That distribution is the explanation for the lapse: the registry had become a tracker for
  framework work, and a `fixed_in` field that assumes a local commit has nothing true to say about it.

## [0.2.1] - 2026-08-17

### Added

- **A dead-export gate runs in `npm run lint`, and `knip.jsonc` is committed with it (B-049).** The
  configuration is the point, not the tool: under knip's defaults every `exports` subpath counts as
  an entry, so every barrel is reachable by definition — measured on this tree, the default config
  reported **1** issue and this one reported **28**. `includeEntryExports` is on for the same
  reason, since every `index.ts` here is an entry and that is precisely where dead surface collects.
  The gate was verified by injecting a dead export in an entry file and in a non-entry file and
  confirming a non-zero exit for both; a gate nobody has seen fail is not known to work.

### Removed

- **Three functions nobody called, with their re-exports (B-033, B-049).** `mutateConsentStore`
  (`config/trust-store.ts`), `measuredPrecedenceChain` (`config/layers.ts`) and
  `effectiveConfigUnderPosture` (`config/effective-config.ts`). Each appeared exactly twice in the
  repository — its definition and its barrel line — and in no test. `effectiveConfigUnderPosture` is
  not a new find: B-033 shipped with the DoD bullet "has a caller or is deleted" and its own
  `dod_verified` says "NOT addressed — belongs to B-049"; B-049 then shipped without addressing it.
  Deleting `mutateConsentStore` cascaded into `ensurePrivateDir` and four now-unused imports, which
  is the usual shape: dead code hides more of itself behind itself.
- **Twelve barrel re-exports with no consumer, and four `export` keywords that widened nothing
  (B-049).** The implementations stay — they are used inside their own packages — so this narrows
  the declared surface without touching behaviour. `CONFIG_SCHEMA_KEYS`, `MissingCredentialError`
  and `BackendComPosse` lost the `export` keyword itself, and the `Check` / `CheckStatus` /
  `Diagnosis` type surface left the entrypoints; `doctor.ts`'s `CheckStatus` turned out to be unused
  even in-module, contradicting the comment that claimed it was "retained because this module's own
  checks are written in terms of it".
- **`figlet` from `packages/tui`, closing a B-010 DoD bullet that shipped unmet (B-010).** That
  bullet read "`figlet` is used (via `renderFigletArt`) or removed". `renderFigletArt` belongs to
  `@theokit/tui`, and it is never called: it appears in that package only at its definition and in
  its export list, `WelcomeBanner` does not produce art, and `Banner.tsx` passes a literal `LOGO`.
  So the "or removed" branch is the true one. `lowlight`, the other half of the same bullet, STAYS —
  see Fixed below.
- **The `./chat-acp` subpath and the whole `exports` map of `packages/tui` (B-049).** Both are
  reached by file path instead: `scripts.build:acp` runs esbuild against
  `packages/agent/src/chat-acp.ts`, and `scripts.dev` starts the TUI with `tsx`. B-049 kept
  `./chat-acp` deliberately, calling it "the external ACP integration surface"; the rationale does
  not survive re-examination, because every package here is `private: true` and the external ACP
  client consumes the `dist/acp-entry.mjs` bundle, never the subpath.
- **`packages/agent/tests/`, an empty directory outside the test-discovery patterns.** It matched
  neither `packages/*/src/**/*.test.{ts,tsx}` nor `tools/**/*.test.mjs`, so a test placed there
  would have silently never run — a trap rather than clutter.
- **`hooks/hook-runner.ts` and its test — 140 lines that no production code reached.** The wrapper
  around the framework's `runHookCommand` lost its last caller when the whole builder moved upstream:
  `build-handlers.ts` bridges to `buildHookHandlers`, which owns the result transform, so nothing
  regresses. Its only importer was its own test, which is why neither the dead-export gate nor the
  reference graph reported it — **a test is a consumer**. Found by asking a different question:
  which production symbols have consumers, but only test ones. The stale citation of
  `hook-runner.ts:39` in `hook-trust.test.ts` was repointed at the real path.
- **The `REVIEWER_TOOLS` re-export in `review/create-agent.ts` (B-084).** Its own comment set the
  sunset — "delete once nothing outside this file reads it" — and the one reader was
  `composition.test.ts`. That test now imports the name from `composition/agent-spec.ts`, where it
  is declared and where `reviewerShape` reads it. A re-export whose only consumer is the test that
  consumes it is surface the product does not have.

### Fixed

- **`lowlight` was almost deleted as dead, and is not (B-010).** No file in this repository imports
  it, which is why a repo-wide search calls it unused. It is reached at runtime through
  `AgentTimeline` → `ChatMessage` → `MarkdownText` → `CodeBlock` → `import("lowlight")`, so every
  assistant reply containing a fenced code block goes through it; without the declaration the
  framework warns `code renders unhighlighted` and the TUI loses syntax highlighting silently.
  Caught by reading `@theokit/tui`'s own loaders after the removal, not by any tool: `knip` and
  `depcheck` both reported the dependencies clean, and on this one they were right. Recorded here
  because "no import site" and "no consumer" are different claims, and the gate added above cannot
  tell them apart.
- **`vitest.config.ts` is inside the type program.** `tsconfig.json` included
  `packages/*/src/**/*` and `tools/**/*`, which matched 258 of the repository's 259 TypeScript
  files. The one exception was the test configuration itself, so a type error there survived
  `npm run typecheck`. Now covered by a `*.config.ts` entry.
- **The `check-english-only` allowlist citation, again.** The entry moved 76 → 156 when the `ask`
  module was migrated, and 156 → 166 when this cleanup added an import above it. The comment now
  records both moves and why the entry stays line-numbered: keying it by file alone would exempt the
  whole file.
- **A test that pinned a public export was invisible to static analysis (B-004).**
  `ask-bridge.test.ts` asserted the entrypoint exports `ConcurrentQuestionError` by importing the
  namespace and indexing it with a string, so the dead-export analysis read that export as
  unconsumed and the cleanup removed it — only the assertion failing caught the mistake. The export
  is restored, now re-exported straight from `@theokit/agents/ask` rather than through
  `ask-bridge.ts` (that middle hop had no consumer of its own), and the test reaches it by a static
  named import. Its two siblings, `ConcurrentListenerError` and `QuestionAbandonedError`, stay
  removed: nothing imports them and nothing tests them.

### Fixed

- **A fase CODE-QUALITY, rodada pela primeira vez nesta sequencia, achou quatro coisas — todas
  minhas, todas desta sessao.**
  - Tres imports orfaos em `session/session-ops.ts`, sobra da migracao de `protectedTranscripts`.
  - `buildChatAgent` passou de 10 para 11 de complexidade ciclomatica. Os dois gates de CONFIANCA
    que estavam em ternarios inline — quais raizes de config ler, e se os servidores MCP sobem —
    viraram `settingSourcesFor` e `mcpServersFor`. Um gate de confianca enterrado numa expressao
    dentro de uma funcao de 60 linhas e onde ninguem o procura.
  - 63 comentarios em portugues em `packages/`, que e English-only.
  - Uma entrada do allowlist do `check-english-only` apontando para `ask-bridge.test.ts:76` — a linha
    tinha ido para 156 quando o modulo `ask` foi migrado. Um allowlist por NUMERO DE LINHA e uma
    citacao que apodrece a qualquer edicao acima dela, e esta parou de cobrir o que devia sem dizer
    nada.

  Os tres gates (`lint`, `typecheck`, suite) ficam verdes ao mesmo tempo.

### Fixed

- **`tsc` fica limpo: 6 erros -> 0.** Os seis nao eram ruido herdado — eram seis chamadas de
  `processor.finish('ok')` num teste, contra uma assinatura que aceita `'finished' | 'error'`. `'ok'`
  e o vocabulario INTERNO (`outcome.status`), nao o da API.

  Passavam porque a implementacao so pergunta `status === 'error'`, entao `'ok'` caia no mesmo ramo
  de `'finished'`: comportamento acidentalmente correto sobre uma chamada invalida.

- **Oito `as never` removidos do mesmo arquivo.** Nao eram necessarios: `ChunkLike` e estrutural e
  frouxa, e cada literal ja a satisfazia.

  A relacao entre os dois defeitos e o que vale registrar. Os casts **anestesiavam o arquivo**: com
  `as never` espalhado, ninguem olha os erros que sobram. Foi por isso que esses seis atravessaram
  uma sessao inteira sendo chamados de "linha de base pre-existente" sem que ninguem lesse o que
  diziam.

### Changed

- O registry de tools passa a LIGAR o escopo uma vez, via `bindToolScope` de
  `@theokit/agents/tool-scope`, em vez de repetir `projectRoot: scope.cwd` em sete entradas e
  `sandbox` em uma.

  Cada repeticao era um lugar onde se pode esquecer — e esquecer o `sandbox` no `createShellTool`
  produz um shell NAO CONFINADO sem erro e sem aviso, que e o defeito que o B-006 documentou aqui.

  As duas tools de ESCRITA passam `projectRoot: scope.writeRoot` explicitamente, com override. Nao e
  detalhe: para elas a raiz do projeto E a raiz de escrita, e deixar o bind aplicar o `cwd`
  ESTREITARIA o escopo de escrita em silencio quando os dois divergem — o caso de
  `danger-full-access`. Ha teste sobre exatamente essa divergencia.

### Removed

- **331 linhas mortas em `hooks/hooks.ts`** — `preToolUseVeto`, `transformResult`,
  `fireObservational`, `appendOneHookFeedback`, `policyBlock`, `chainBudgetBlock`, `decideBudget` e o
  resto do motor antigo. Estavam inalcancaveis desde que o `buildHookHandlers` local foi deletado: o
  unico chamador delas era ele.

  O arquivo caiu de **423 para 78 linhas** e agora e o que o nome sempre deveria ter dito: o PARSER
  de `.theokit/hooks.json`, e so ele. O motor e do framework.

  Deletar so o ponto de entrada e deixar o corpo para tras e como duplicacao sobrevive a uma
  migracao: nada quebra, nada aponta para la, e o proximo leitor encontra dois motores. Foi
  exatamente o que eu tinha feito.

- `hooks/continuation-budget.ts` — ficou orfao quando o motor saiu. O framework tem o orcamento de
  continuacao desde o `@theokit/agents@8.5.x`, e ele e o que de fato roda.

### Changed

- O motor de hooks passa a ser o do framework. `buildHookHandlers` local (486 LOC) deletado; ficou um
  adaptador que faz as duas coisas que o framework nao pode saber: traduz os NOMES DE EVENTO deste
  produto (`PreToolUse`/`PostToolUse`/`Stop`/`SessionStart`, que os usuarios escrevem em
  `.theokit/hooks.json`) e injeta o NOSSO fingerprint, para que nenhuma aprovacao ja em disco perca a
  validade.
- `hook-runner.ts`: 164 -> 83 linhas. O spawn, o grupo de processo, o teto de saida e o drain budget
  sairam para `@theokit/agents/hooks`.


### Added
- **theokit-sdk 4.51.0: the session, approval and credential rules the framework now owns (B-096, B-098, B-099).** Refusing to destroy a session another process is writing — with "could not determine" kept apart from "nothing is open", because the second is the input that would disable the guard. A veto as a typed decision rather than a tool result the model retries around. And a credential reported by presence and a hashed fingerprint, never by value.
- **theokit-tui:** backlog B-126 — SonarCloud's *analysis* has failed on every PR in that repo (not its quality gate), so the check has been red for at least three PRs and reads as noise.
- **theokit-tui:** backlog B-125 — a rendering test fails about one run in four; the rate and the limits of the evidence are recorded, including that it was not established whether the flake pre-existed.
- **The slash-command router's dispatch is covered, and the test says what it actually pins (B-116, second slice).** The obvious property to assert was precedence — the chain of responsibility over seven capability groups, first-to-claim wins. Measured, precedence is NOT observable: the 38 actions partition cleanly across the seven switches, so reordering `GROUPS` changes nothing. Three mutations proved it — reordering the chain, removing the early return, making `noop` stop claiming — and none turned a case red. The first version of this test claimed to pin precedence and was therefore vacuous for its own stated purpose. What replaced it pins the invariant the chain actually rests on: no action is claimed by two groups, read from the source rather than from a hand-kept list, because a list would need updating by the same person who broke the invariant at the same moment. Duplicating one action across groups turns it red. The behavioural cases stay, asserting that each group's actions reach it and that an unclaimed action is inert — where a registry entry added without a handler lands.
- **`rules.ts` is characterized — 157 LoC that had no test at all (B-103, B-116).** It is consumed by `config/trust-posture.ts`, which decides whether a project's `[[hooks]]` are honoured, and a hook is arbitrary command execution on every tool call (B-086) — so migrating it onto `@theokit/sdk/context` without a safety net would be a security change wearing a refactor's clothes. The 22 cases pin what the module DOES today rather than what it should do, concentrating on the product policy the SDK's `runDiscovery` may not carry: the traversal budget and its two typed refusals, the 64 000-char truncation and its warning, the injected `readFile`/`warn` seams, the frontmatter `paths:` scoping that decides whether a rule applies everywhere or to a subset, and the inode-keyed cycle guard. Six mutations turn the covering cases red (join separator 3, budget guard 3, character ceiling 1, cycle guard 1, unclosed frontmatter 2, scope prefix 2). A seventh is recorded as NOT detected and the test says so in place: deleting the explicit `.sort()` leaves every case green, because `readdirSync` on this filesystem already returns sorted entries at 3 and at 40 entries — the assertion pins the output contract, not the sort call.
- **`routeKey` now has a test per surface state (B-116, first of two slices).** The 115-LoC modal state machine that decides what Ctrl-C, Esc and Enter mean across seven surface states — open question, demo, consent gate, login, backtrack ladder, streaming turn, composer — had no direct test. Its failures are the silent kind: the key appears to do nothing, or it does the other thing, and B-029 is the record of exactly that shipping (Esc-rewind was dead because a flag was raised before the data it announced). 26 cases assert the ACTIONS returned rather than the effect of applying them, which is possible because the function is pure and returns its actions instead of performing them — asserting effects would test `applyKeyAction` instead, and would pass on a router returning the wrong action whenever two actions converge on the same effect. Escape's six-way priority gets its own block, each case setting every lower-priority trigger as well, because the real defect here is usually not a broken branch but a right branch that never runs. Shown to detect rather than assumed to: six mutations — reordering the goal/streaming precedence, dropping the composer-text guard, widening `Ctrl-C` to any `ctrl` key, not stacking `reset-backtrack`, making a demo `Ctrl-C` quit on the first press, and dropping `interrupt-turn` from question abandonment — each turn the covering cases red. The slash-command router's dispatch, the item's second bullet, is not covered yet.
- **The goal refusal in `sendMessage` now has a test (B-116).** Two refusals protect a running turn from being disturbed; the `streaming` one in `resume-command.ts` was already covered, and this one was not. It is the more dangerous of the two to lose, because losing it neither throws nor looks broken — the message simply reaches the agent while a goal is driving it, interleaving a human turn with the goal's own, and the operator sees their message accepted. Three cases assert the refusal, the wording that tells the operator both ways out, and (anti-vacuity) that an ordinary message still goes through. `lastSentMessage` is asserted alongside, because a refusal that still recorded the message would make the next `/retry` replay something the agent never received — a worse failure than the one being refused. Deleting the guard turns two of the three red.
- **A `theokit` routing domain, so a gap that belongs upstream can be filed against the repo that owns it.** Items for the framework previously routed nowhere — correct while this install governed one product, and increasingly untrue once three consumer-measured gaps in one day turned out to be framework bugs. Ships with `agents/theokit.md` so the routing resolves to a named owner rather than to nobody.
- **Seven backlog items scoping what would make a second agent product nearly free to build (B-096..B-102),** derived from measuring which subsystems this repo had to write itself.
- **theokit-sdk:** backlog B-103 — context assembly exists in the SDK and no consumer can reach it.
- **theokit-tui:** backlog B-104 — terminal-surface primitives are rebuilt by every agent CLI.
- **theokit:** backlog B-105 — `@theokit/presenter` is pinned, imported nowhere, and its job is done by hand.
- **theokit-sdk:** backlog B-106 — the framework creates session artifacts and leaves the reaping to the consumer.
- **theokit-sdk:** backlog B-107 — the two invariants that keep a trust posture honest live only in the consumer.
- **theokit:** backlog B-108 — what an agent actually wired is not observable from the framework.
- **theokit-sdk:** backlog B-109 — every release leaves `develop` behind `main`, and the next release PR would re-publish shipped work.
- **theocode:** backlog B-110 — the README tells every reader this repository has no test suite (it has 67 files, 427 cases).
- **theokit-sdk:** backlog B-111 — the tarball guard covers one publishing repo, and today's release came from the other.
- **theokit-sdk:** backlog B-112 — the release workflow disables provenance citing a repository privacy that no longer holds.
- **theokit-sdk:** backlog B-113 — the pre-push gate re-runs the full validate for a push that introduces no commits.
- **theokit-sdk:** backlog B-114 — a tag push reported success and transferred nothing.
- **theokit-sdk:** backlog B-115 — nothing tests what the SDK does with a file the repository controls.
- **theocode:** backlog B-116 — the most stateful surface subsystems are the least tested.
- **theokit-sdk:** backlog B-117 — two containment guards judge a path by its name, so a symlink out of the root is judged by where it sits rather than where it points.
- **theokit-sdk:** backlog B-118 — the repo `.npmrc` makes every local publish fail as a 404, sending the diagnosis to token permissions.
- **theokit-sdk:** backlog B-119 — `globbed` discovery cannot see a nested rule, and a pattern written to say so matches nothing at all.
- **theokit-sdk:** backlog B-120 — the re-release guard answers "all clear" for a ref it cannot read.
- **theokit-sdk:** backlog B-121 — six publishable packages cannot publish with provenance because `repository.url` is empty.
- **theokit-tui:** backlog B-122 — CI has been red on `develop` for at least 8 runs, and the cause is step order.
- **theokit:** backlog B-123 — `@theokit/presenter` has no lifecycle surface, so a Codex-shaped consumer cannot use it.
- **theokit:** backlog B-124 — `create-theokit`'s TUI template loads a project `.env` with no guard, so every scaffolded product starts exposed.

### Changed
- **The JSONL emitter projects the framework lifecycle fold (B-123).** `createJsonlProcessor` composes `foldTurnLifecycle` from `@theokit/presenter@0.6.0`. The LoC delta is **+13, not a shrink** — recorded as measured. What the migration exposed matters more: three mutations survived the entire CLI suite because nothing covered the emitter, which is the contract every consumer of `--json` reads.
- **B-106 closes: the framework decides what may be reaped, and deletes nothing (B-106).** `planReaping` ships in `@theokit/sdk@4.50.0`. The severity that deferred it — this is the path that deletes user data — is answered by the design rather than waived: planning is separated from deleting, so the dry run is structural and the dangerous case ("could not determine whether this session is live") is asserted rather than simulated.
- **B-103 is killed on evidence, and its one surviving finding registered as B-127.** Measured against `@theokit/sdk@4.49.0` in a clean project: a consumer both reaches context assembly and registers its own discovery source. What survives is that a spec's `priority` is a raw position in a list the consumer does not own — placing a source between two defaults means picking 25 by reading them.
- **B-104 closes: all three terminal primitives ship (B-104).** The keypress router joins the stderr guard and the serialised writes at `@theokit/tui@0.52.0`. The deferral is answered rather than waived — what is published is the ordering rule, not one product's key vocabulary.
- **The keypress router declares its layers instead of nesting ifs (B-104).** The ordering rule is `@theokit/tui@0.52.0`'s `./keys`; the layers — `open-question`, `demo`, `gated`, `composer` — and every word in them stay here. Precedence is now readable in one place and enforced: moving `gated` ahead of `open-question` turns tests red. The file grew by four lines of code, which is the honest number — the value is that the contract is declared rather than implied by nesting.
- **B-107 closes, in a narrower form than it asked (B-107).** The bullet expected config-key reachability to be checkable *in* the framework; measured after B-097 shipped, the framework has no config-key registry and by design will not have one — the keys are the consumer's vocabulary. So `auditEnvReachability` (`@theokit/sdk@4.49.0`) owns the rule and TheoCode ranges over its own keys with it. The failure still surfaces in this repo's suite; what this repo no longer writes is the detector, including the half everyone forgets — an opt-out that no longer exempts anything.
- **B-116 closes: the two most stateful surface subsystems now have tests that detect (B-116).** `routeKey` has a case per surface state and the slash-command router a case per capability group — all seven, after a first pass with four read as done. The router's precedence turns out not to be observable at all (the actions partition cleanly across the switches), so the tests pin the disjointness the chain actually rests on, which nothing enforced. One refusal is asserted through dispatch; the other is recorded as a known gap rather than proven with a test that would await disk to make a routing claim.
- **B-108 closes: the framework reports what it wired (B-108).** All three bullets hold — the record is derived from the values handed to the builder rather than from a second read of configuration, "withheld because untrusted" is distinguishable from "none configured", and TheoCode's `wired-capabilities.ts` is now a projection. Measured on the projection: one of eight wiring mutations found a real hole and closed it — `projectSources` pinned to `true` passed the whole suite, and it gates whether an untrusted repository may redirect a squad member's model.
- **`wiredCapabilities` becomes a projection of the framework's record (B-108).** The derivation moved to `@theokit/sdk@4.48.0`'s `recordWiring`, which takes the trust posture as its gate; what stays here is this product's shape — which three capabilities are lists of names, plus the two fields that are not entities at all. Behaviour is unchanged and the framework version adds a guard this one never had: recording a capability the posture does not gate now throws instead of quietly reporting it as suppressed.
- **B-097 closes: the config layer's rules are the framework's, its words are its own.** All three DoD bullets hold — the framework provides layered resolution with declared precedence, the floor rule and a trust posture; a consumer adds a layer without reimplementing precedence; and TheoCode's `config/` shrank to its keys plus composition (212 -> 172 lines of code). Measured, not asserted: 14 wiring mutations on the migrated code are all detected, including trust granted by the store — the normal path, which had no test before this.
- **TheoCode's config layer now consumes the framework's rules instead of restating them (B-097).** `security-floor`, `layers` and `trust-posture` keep this product's vocabulary — the sandbox and approval orderings, the six-layer chain with its precedences, the eight capabilities and what withholding each one costs — and delegate the rules that every layered-config product rebuilds identically to `@theokit/sdk@4.47.0`. Code shrinks 212 → 172 lines, and the rules now live where they are tested for: the framework's suite pins the ceiling that only descends, hooks accumulating across layers, and untrusted denying every declared capability.
- **`terminal-io/` now consumes `@theokit/tui/terminal` instead of owning it (B-104, third DoD bullet).** 387 → 308 production LoC, delta −79, measured rather than estimated: `log-rotation.ts` deleted outright (33 → 0), `stderr-guard.ts` reduced to binding this product's `[theocode]` label (66 → 17). `write-queue.ts` GREW by three lines (21 → 24) and that is the correct trade — the framework ships a factory rather than module state, because two library consumers in one process must not serialise against each other, so the application has to own the single instance explicitly. That single instance is the whole reason the file still exists: two queues over one file would interleave writes and nothing would fail loudly. The input router stays, as B-104's measurement said it would — its mechanism generalises, its vocabulary does not. 71 files / 487 cases green, typecheck clean, 216 modules cruised with no dependency violation.
- **B-107's second invariant is blocked on B-097, measured (B-107).** The mechanism checks that every config key is either env-reachable or carries a documented opt-out — and it needs a set of config keys to range over. The framework has none: no `config` subpath, no `configSchema` / `layeredConfig` / `loadConfig` anywhere in the source, and the only enumerable key list in the package is the `SOVEREIGN_ENV_KEYS` that bullet (a) just added. Implementing it would mean inventing the config-key registry first, which is B-097 — and inventing it inside a lint would fix the shape of the framework's config surface as a side effect. B-097 is now the keystone for three items: this bullet, B-108, and the harder half of B-106.
- **B-108 measured: blocked on B-097, structurally (B-108).** The evidence holds exactly — zero occurrences of `onWired` / `wiredCapabilities` / `suppressedBy` across both framework trees, against 72 LoC in the consumer. But the second DoD bullet requires the framework to KNOW about directory trust, and it does not: B-097, which moves the trust gate upstream, is still `raw`, and the SDK's 23 hits for "posture" are all SANDBOX posture, a different concept sharing a word. A framework cannot report a decision it does not make. Implementing the first bullet alone would be worse than waiting: a listing without the trust dimension cannot distinguish suppression from absence, which is exactly the defect B-071 was REOPENED for — and shipping it upstream would hand that defect to every consumer. Moved to `triaged` with the three properties the implementation must preserve recorded on the item.
- **B-106 measured: the SDK ships no collector for the artifacts it creates, and the item's own grep claim needed correcting (B-106).** Every pointer in the evidence resolves — file, line, and the symbol on that line. The item said `grep -rlniE "garbage|retention|prune|reap"` finds nothing; it finds five files, none of which reap session artifacts (compaction prunes message history, `session-scope` documents state *a consumer* prunes, `task.ts` has `retentionMs` for the task registry, two are false positives). The definitive measurement is different and stronger: the SDK unlinks only what is in flight in the operation doing it — a lock it just released, a `.tmp` from a failed atomic write — and the built barrel exposes ZERO symbols matching gc / collect / reap / prune / retention / sweep. Moved to `triaged` and deliberately NOT implemented in this pass: this is the path that deletes user data, the consumer's version is 1 402 LoC, and a half-correct data-deleting API is worse than the duplication it removes. The three constraints the consumer paid to learn — B-020's `mtimeMs = 0` aging to 20 000 days, the sweep-wide rather than per-directory budget, the TOCTOU re-check of the writer lease — are recorded on the item so the implementation starts from them.
- **The `@theokit/presenter` override is justified, and the justification is written down (B-105).** It is not an orphan pin: it forces a TRANSITIVE dependency (`@theokit/agents` → `@theokit/presenter`), and it entered to carry the fix where `readMessageStream` dropped the whole `finish` chunk — and with it the `messageMetadata` that makes the real token readout possible (B-090, B-080). Measured now, it changes nothing: `@theokit/agents@7.5.0` declares presenter as exactly `0.5.1`, and removing the override resolves to 0.5.1 anyway, verified by regenerating the lock and reading it. KEPT anyway, because agents pins exactly rather than by range — a future agents declaring 0.4.0 would silently reintroduce the dropped-token bug, and this is the floor that prevents it. The justification lives here because package.json admits no comments.
- **B-104 is measured and split in two, and the split is the finding (B-104).** The intake evidence — "0 of 8 files import `@theokit/*`" — reads as *all of it is transferable*; per-file measurement says coupling is not uniform. `write-queue.ts` (21 LoC), `log-rotation.ts` (33) and `stderr-guard.ts` (66) are generic and extractable now. `input-router.ts` (115) is the trap: zero references to this product, so it looks portable, while its entire contract is this surface's vocabulary — `KeyboardState` declares `hasOpenQuestion`, `inDemoInput`, `emLogin`, `backtrackArmed` and `KeyAction` returns `prime-backtrack`, `pause-goal`, `close-demo`. A second agent CLI has none of those. A public API is semver-bound, so a keypress router with the wrong state vocabulary is worse than none — the second consumer routes around it instead of around nothing. Item moved to `triaged` with the design pass named as its own slice.
- **B-103's consumer migration is decided against, on evidence (B-103).** With `@theokit/sdk@4.43.0` reachable and the recursion blocker gone, the question became answerable per capability rather than per file: the SDK covers 2 of 9 — the recursive rules walk and `@import` expansion — and does not carry the traversal budget and its typed refusal, the inode cycle guard, the character-ceiling truncation and its warning, the injected `readFile`/`warn` seams, `AGENTS.local.md`, or the tail-truncation that keeps the nearest instructions. The one equivalent piece would be a downgrade: TheoCode's containment guard refuses a path it cannot resolve, while the SDK's falls back to the lexical path. The item's "~430 LoC could be returned" came from file sizes, and file size is not capability. What survives is the gap restated — not "no consumer can reach context assembly" but "what it reaches is the easy half", one upstream item per missing capability, which is what B-119 already was.
- **`ehRotaChatGPT` is now `isRouteChatGPT`.** The last Portuguese identifier in the auth routing path; the project's convention is that code is English and only the conversation is not. Private to `model-route.ts`, so no caller changed and no public surface moved.
- **The README's test count was re-measured (B-110, B-116).** B-110 replaced a false claim ("this repository holds no test suite") with a measured one; the same day's work made the measured one stale, as 67 files / 427 cases became 69 / 456 once `routeKey` and the `sendMessage` refusal got their tests. A number that ages silently is B-110's defect one step removed — a reader cannot tell a stale measurement from a current one, and both read as authoritative. Re-measured with `npm test`, not incremented by arithmetic.
- **`@theokit/sdk/context` exists upstream (B-103).** Discovery, rule activation and `@path` import resolution are now a semver-covered public surface of the SDK instead of code every consumer re-derives. TheoCode has not migrated yet — its `packages/agent/src/context/` still carries all 602 LoC, and the ~430 that could be returned is consumer-side work the upstream plan deliberately left out of scope.
- **`theokit-tui` joins the `theokit` routing domain.** A measured item (B-104) belongs to that repo and to no other, which is the trigger `cycle-backlog.md § Domain routing` names for extending the table. It routes to the existing `agents/theokit.md` specialist rather than to a new one, so the resolution names an owner.

### Fixed
- **theokit-tui 0.52.1: the suite stops failing about one run in twenty (B-125).** Two timing assumptions replaced by waits on the actual signal — a fixed 50ms sleep per keystroke, and "two ticks are enough for useInput to subscribe". Twenty consecutive full-suite runs: 20 green.
- **theokit-sdk 4.51.1: a user-visible failure is never the message nobody receives (B-102).** `diagFailure` falls back to stderr when no sink is installed, while ordinary chatter stays silent. A corrupted frame is visible and recoverable; a dropped failure is neither.
- **The README no longer tells readers this repository has no test suite (B-110).** It stated "`npm test` does not exist here. Any claim about this code's behaviour is currently unverified in this repository" — false on all three counts: `npm test` runs 67 files and 427 cases. The sentence did not merely age, it instructed: a contributor arriving at a repo whose README says the tests are absent does not run them. Sibling of B-062, which found the same disease in the domain specialist file.

### Security
- **theokit-sdk:** a tool now declares the scope it reaches and whether its action is reversible, and the approval layer gates on those rather than on the tool name (B-101, and B-100's structural bullet). A sandbox answers which files a process may touch; it cannot answer what an action reaches. Refusal outranks approval, an empty grant refuses, and an undeclared scope refuses.
- **theokit-sdk:** the last two lexical containment guards now resolve symlinks (B-117), and the re-release guard refuses an unreadable ref instead of reporting a clean release (B-120). Both were failures whose symptom was a green tick.
- **theokit:** scaffolded products no longer load a project `.env` unguarded (B-124). The framework was handing every new product the unguarded loader as its starting point — a cloned repository could redirect the credential store through `THEOKIT_AUTH_HOME` before any trust prompt. The guard walks every template file, not the one path the defect was found in.
- **`resolveTrustPosture` shipped in `@theokit/sdk@4.47.0`, and B-108 is no longer blocked (B-097, B-108).** A framework cannot report a decision it does not make; now it makes one. Verified against the registry: untrusted denies every declared capability, the gate covers every capability declared, a trusted store grants and says `store`, and a blanket environment switch is reported as `env` rather than hidden behind the same word. The invariant is the point — `allows` is built FROM the declared list, so a product adding a ninth capability cannot forget to gate it, and that failure is invisible when it happens. What remains in B-097 is the consumer migration and the wiring from posture to withheld loaders.
- **B-097's two slices are live in `@theokit/sdk@4.46.0`, verified against the registry.** Installed into a clean project and exercised: a project layer cannot loosen the operator's sandbox, the operator's explicit flag still wins, `hooks` accumulate across layers instead of being displaced, and a chain that is not strictly ascending is refused. The release also validated the B-114 correction in production — the ref verifier ran at its new position, after the action pushes tags, and reported `✓ all 1 release tag(s) at HEAD are on origin` instead of the false negative it produced when wired inside the publish.
- **`foldLayers` moved upstream — B-097's second slice (B-097).** Later layers win, `undefined` never overwrites, and named keys ACCUMULATE. That last rule is the security-relevant one: with plain last-wins a project file DISPLACES the user's entries for a list-valued key rather than adding to them, and for `hooks` — arbitrary command execution on every tool call — that is the difference between a repository adding a hook and a repository removing yours. Layer names are the caller's data, so `profile` never reaches the framework. 15 cases; five mutations, four detected, and the fifth recorded as unobservable in both the source and the test rather than left to look covered. The TRUST POSTURE is still not extracted, which is what B-107(b) and B-108 actually wait on.
- **The release-ref verifier moved to run AFTER the tags are pushed (B-114, correction).** It caught a failure on its first CI release and the failure was the wiring: `changeset publish` creates the tags, the changesets action pushes them in a later step, so checking inside `pnpm release` asked before the pusher ran. 4.45.0 published successfully, the check reported its tag missing, and `git ls-remote` showed it there moments later. A gate that fails every release is worse than no gate — it is how a red check stops being read, which B-122 measured happening for eight consecutive runs on the sibling repo. Now its own workflow step, guarded on `published == 'true'`, with `pnpm verify:refs` for the local path where it can legitimately fail.
- **`applySecurityFloor` moved upstream — the first slice of B-097, chosen by measurement (B-097).** Layered config resolves last-wins, and for the keys that decide confinement that is a hole: a project layer outranks the user's own file, so a cloned repository can hand itself the most permissive sandbox and the operator's global choice loses silently, at the moment the directory is opened. Which slice to extract was decided by measuring, not by file size: across the consumer's 12 config files coupling count does NOT predict genericity — `env-knobs.ts` has zero framework references and is entirely this product's key names, the same trap as B-104's keypress router. The floor rule was extractable because its vocabulary is DATA (a permissiveness ordering, the restricted layer names, the override name), so a second product supplies its own. 16 cases; four mutations detected, one of which found a real coverage gap first — `ceiling = level` versus `Math.max` differs only when a restricted layer HARDENS and a later one offers a value in between. The precedence chain, the trust posture and the consumer migration are NOT done, so B-097 is still the keystone for B-107(b), B-108 and the harder half of B-106.
- **The release path now verifies its tags reached the remote (B-114, closed).** `changeset publish` reports success on its own exit code, and an exit code is not evidence a ref transferred: git contacts the remote BEFORE `pre-push` runs, the hook takes ~11 minutes, and the idle connection is dropped before the transfer — git dies of SIGPIPE (141) with no message and output ending in a green gate line. Both hypotheses filed at intake are refuted (it reproduces on a plain branch name, and the process dies before any transfer). A second defect compounded it: `git push … | tail -N` reports the pipeline's last status, hiding the 141 behind `tail`'s 0. `scripts/verify-release-refs.mjs` is wired into `pnpm release` after the publish, with three distinct exit codes — verified, a tag never arrived, could not check — because collapsing the third into the first is the defect. Its own first draft had exactly that flaw and was caught before shipping.
- **The trust invariant moved upstream: `@theokit/sdk` now guards a project `.env` (B-107).** `process.loadEnvFile()` reads the PROJECT's `.env` into `process.env` — right for a provider key, a hole for the variables that decide where credentials live and what is trusted. Without a guard, a cloned repository shipping `THEOKIT_AUTH_HOME=/tmp/attacker-store` redirects the credential store at startup, before any trust prompt, because locating the store is what happens first. The new `loadProjectEnv` captures a NAMED set of sovereign keys before the load and restores them after, including restoring "was not set" by deleting the key. The measurement was worse than B-107 claimed: the framework's own scaffolder ships the unguarded version, so every product generated from `create-theokit` starts exposed — filed as B-124. TheoCode's own 38-line version stays until the published release lands.
- **`@theokit/tui@0.51.0` ships the terminal loop primitives, and fixes a CI gate that had been red for 8 runs (B-104 slice 1, B-122).** The new `./terminal` subpath carries `installStderrGuard`, `createWriteQueue` and `rotateLog` — verified against the REGISTRY: installed into a clean project, the queue serialises per key, the guard redirects stderr to its log, and rotation refuses a nonsense argument with a typed RangeError. The keypress router stays out, deliberately. Along the way, `gates` on that repo turned out to have been failing on `develop` for at least 8 consecutive runs — `publint --strict` resolves `exports` against a `dist/` that `build` had not yet produced, so it reported every entry as missing including the two that predate all recent work. Reproduced on a worktree of the earlier commit, so it was not caused by the change it blocked, and now green on both Node versions.
- **B-119 and B-121 shipped in `@theokit/sdk@4.43.0` and the 3.0.2 line, both verified against the registry.** `globbed` discovery understands `**`: installing 4.43.0 into a clean project and running `runDiscovery` with `.theokit/rules/**/*.md` surfaces a nested rule, while `.theokit/rules/*.md` still surfaces only the top level — the capability is new, the shipped default is unchanged. And the six packages that could not publish with provenance at all now do: `@theokit/acp`, `@theokit/cli`, the three memory adapters and `@theokit/sdk-pty` each carry a SLSA attestation, which is B-121's third bullet met by a release rather than by reading manifests.
- **B-112 is closed, and the last third was proven on the registry (provenance).** `NPM_CONFIG_PROVENANCE` is back in `release.yml` and the obsolete header is gone; the third bullet asked for an attestation verified on the REGISTRY rather than asserted from a green job, and `@theokit/sdk@4.43.0` — cut through the workflow — answers with a SLSA provenance predicate. The distinction the bullet drew earned itself: the run that produced it reported FAILURE, because a different package was refused with E422 for an empty `repository.url` (B-121). A green job would have been the wrong thing to trust in both directions.
- **B-109, B-111, B-113 and B-115 are shipped and released upstream.** `@theokit/sdk@4.42.1` carries the containment fix; the release-hygiene guards (workspace-protocol publish guard, the re-release refusal, the automatic back-merge, the pre-push skip) are on `main`. The back-merge workflow proved itself on the release that carried it — it fired on the push to `main`, saw `develop` one commit behind, and opened the PR without anyone remembering to. B-114 stays open: two of its three DoD bullets are met (cause established, remedy in the rule) and the third, a release path that verifies a pushed ref rather than trusting an exit code, is not built.
- **`@theokit/sdk@4.42.1` is published, and the context-manager containment fix is live (B-115).** The guard was `absolute.startsWith(resolvePath(cwd))` — no separator boundary and lexical, so it admitted a sibling directory whose name extends the project's (`<cwd>-evil`) and any symlink resolving outside the root. Verified against the REGISTRY rather than the source tree: installed 4.42.1 into a clean project, a sibling-directory escape is refused and a legitimate in-root import is still inlined.
- **Upgraded to `@theokit/sdk@4.41.1`,** which confines `@path` context imports to the repository that declares them. Before it, a repository this agent was pointed at could inline any file readable by the process — an SSH key, a `.env` — into the system prompt via a `CLAUDE.md` line that was exactly `@~/.ssh/id_rsa`. Found and fixed upstream from here; TheoCode's own `AGENTS.md` loader was already contained (B-042), but the SDK's discovery path runs whenever the `project` setting source is enabled for a trusted directory.

## [0.2.0] - 2026-08-10

### Added
- **`/mcp` reports a server that was started and did not answer (#188).** Its tools silently vanish from the session, and the panel previously could only say whether each server answered was "not reported here" — true while no layer below knew. `@theokit/sdk@4.41.0` now emits that failure per server with its reason, and the panel names it, distinct from a server withheld by trust. Absence of a failure is still not reported as health: the turn may not have run yet, and a server that recovers stops being reported as failed on the next turn. Requires `@theokit/agents` 7.5.0, which forwards the run-event sink through the in-process turn. Verified live against a real MCP server: a configured server that never completes its handshake is named in the panel with its reason.

### Fixed
- **An MCP server that fails to start is no longer silent (#188).** Its failure was caught per server and written only to the SDK's stderr, which this product never reads — so `/mcp` could list a configured server while every tool it provides had vanished. Fixed at the source in `@theokit/sdk` as an additive typed event; the panel reports it once the release reaches here through CI.

### Added

- The interface now knows when the conversation is filling up and says so before it runs out, naming `/compact` and what compacting costs, once per level rather than every turn. KNOWN GAP: it cannot fire yet — the token reading it depends on is not reaching the status bar, which also means the "live token usage" the welcome screen advertises is not appearing at all (B-080, B-090)

- `/resume <id>` opens a session from the terminal interface. It listed your sessions and gave you no way to open one, while the command line could resume all along. It refuses while a turn is still running, names the session you are leaving — which stays listed — and tells you an unsent draft was discarded rather than letting you find out (B-087)

- `/sandbox` changes what the agent is allowed to do to your disk without restarting. Only the approval mode could be changed mid-session; the sandbox was a label in the status bar, so realising the posture was wrong meant quitting. Tightening applies immediately; loosening asks you to confirm, because granting the agent more of your disk should be something you meant to do. The status bar follows it from the next turn, reading the mode the agent was actually built with rather than resolving the configuration a second time (B-076)

- `theocode doctor` reports what your installation will actually do: whether you are logged in, which directory it trusts, the model, sandbox and approval it resolved, and which MCP servers, skills and hooks an agent built here would really get. It reports the RESOLVED state rather than re-printing your config, because the gap between the two is the thing that goes wrong. It exits non-zero when something is broken so it can be used in a script, and it never prints a credential — presence only, since a diagnostic is what people paste into an issue (B-081)

- `/memory` now shows what it remembers and lets you change it. It reported that a store existed, where it was and how many facts it held — and nothing else, so watching the count climb left you editing files outside the product to do anything about it. It now lists the facts by number, `/memory forget <n>` removes one from disk, and `/memory off` stops it generating more for this session. The switch says when it applies and that it is not saved, because a preference you flipped once and forgot is worse than one you have to set deliberately (B-077)

- `/hooks` now reports the hooks the agent is actually running, with the command each one executes — not what the configuration file asks for. Those two can disagree, and the disagreement is the thing worth catching: an untrusted directory wires none of them, and the panel says so before listing anything, so a list of hooks can never read as protection you do not have (B-071)

- `/mcp` shows which external tool servers the agent started. They are spawned as real processes when the directory is trusted, and until now nothing told you which ones had loaded — or that an untrusted directory had refused to start them at all. The untrusted case names the servers and says why they are gated: they run before any per-tool approval (B-069)

- `/skills` shows which skills the agent actually loaded. They are read from disk and can be removed entirely when the directory is untrusted, and both states were invisible: a skill that was not taking effect gave you no way to tell whether you had misnamed the directory, never listed it, or had it dropped on purpose. When trust removed them the list names them and says they were not loaded, because "no skills" and "your skills were dropped" send you to opposite places (B-070)

- The agent now records what it actually wired — which MCP servers, skills and hooks reached it, and which ones the directory's trust posture removed. It is built from the same values the agent was constructed with, at the moment it was constructed, so a surface reporting it can no longer disagree with what is running. Nothing user-visible yet; it is the foundation the `/mcp`, `/skills` and `/hooks` listings need, and building it once is what stops four commands from each growing their own version (B-069, B-070, B-071)

- The command line can now list, archive, rename, delete and fork sessions. It could only collect garbage and resume one, while the terminal interface could do everything else — so scripting anything about sessions meant driving the interactive app. Every operation calls the same code the interface calls, rather than a second copy, which is how the two halves drifted apart in the first place. Actions that name a session require the id: headless there is no "current session", and guessing would let `delete` remove whichever transcript happened to be newest (B-074)

### Changed

- Twenty identifiers written in Portuguese are now English, and the guard that is supposed to catch them can finally see that shape. It could not before: names like `pluginDeHooks` are built from words that are each valid English — `do` the verb, `de` a prefix — so every part was checked, cleared, and the Portuguese construction passed whole. The check now recognises the construction itself, was scored against real English names before it landed, and was proven by planting a violation and watching the build fail (B-084)

### Added

- The agent can look at an image in your repository. Attaching one with `/image` still works, but that requires you to anticipate that a picture matters — a design mock, an architecture diagram or a screenshot of a failing test was invisible to it otherwise. It reads only inside the workspace: a path pointing outside is refused and said so, never quietly redirected somewhere allowed (B-082)

- The README now says where configuration actually lives. There are two directories — `.theocode/` for the product's own settings and `.theokit/` for subagents, skills and rules — and putting a setting in the wrong one is ignored with no error at all. That matters most for hooks, which run a command of your choosing on every tool call: a block in the wrong file protects nothing and says nothing. The valid hook event names are written down for the same reason (B-086)

### Removed

- A planned "ask something without keeping the conversation" feature was dropped before it was built. It existed because a side question forced you to fork a session that could never be removed; now that sessions can be deleted, the cost is one command rather than a permanent entry, and building a second kind of session to avoid it would have added more than it saved (B-079)

### Added

- `/hooks` shows which lifecycle hooks are registered for the directory you are in, with the event each is bound to and whether it has been approved. Hooks can block a tool call, and until now the only way to learn one existed was to have it stop you. When the directory is untrusted the list says so first and in full — those hooks are declared and are not running, and a reader who skimmed the list could otherwise believe they were protected (B-071)

- `/subagents` lists the specialised agents a project defines. Until now the only way to find out which ones existed was to name one that did not and read the error — the set was discoverable exclusively through failure. When a project defines none, it says where it looked, because someone who put them elsewhere needs the path rather than the word "none" (B-072)

- A reply can finally leave the terminal. `/copy` puts the last answer on the clipboard as markdown and `/export [path]` writes the whole conversation to a file — until now the only way out was selecting text with the mouse from a bordered box that wraps every line, which mangles exactly the code and commands people want to paste. Both read the conversation data rather than the drawn screen, so a long line inside a code block survives at its original width. Where there is no clipboard at all — over ssh, in a container, in CI — it says so and points at `/export`, instead of quietly doing nothing (B-075)

### Changed

- The screen's wiring was split into three files instead of one. Everything that assembles the terminal interface lived together, and it had grown to the point where adding a single new piece of information for a command to read broke two size limits at once — a feature was written, tested, and thrown away because of it. The parts that build the session and the parts that hand dependencies to the input box now live on their own, the behaviour is identical, and the whole test suite passes untouched, which is what makes that claim checkable (B-085)

### Added

- A session can now be deleted, not just archived. Archiving only hid a conversation behind an `(archived)` label — the transcript stayed on disk and stayed listed — so a session that captured a pasted credential could not be removed through the product at all. `/delete <id>` removes both the entry and the file. It always requires the id: archiving defaults to the current session because it can be undone, and this cannot. It also refuses to delete a session something is still writing to (B-078)

- The colour scheme is no longer fixed to dark. `THEOCODE_THEME=light` switches it, and a terminal that cannot render colour at all — piped output, a log, a screen reader — is served by `no-color`, which was previously unreachable from outside the source. `NO_COLOR` is honoured too, so anyone who already sets that convention for other tools gets it here for free, and it wins over the product's own setting because it is an accessibility signal rather than a preference. A value that is not one of the three falls back to dark and SAYS so in `/status`, which also now answers the only question anyone asks about a theme: why is it this colour (B-073)

### Fixed

- Asking for the current model no longer answers half in Portuguese. `/model` with no argument said `(use /model <name> para trocar)`, and the guard that is supposed to catch exactly this reported the file clean — every word in that sentence is also an English word, including `para` and `trocar`, so it was declined one word at a time and passed as a whole. The text is now English, a test pins it, and the guard's blind spot is written down where the next person editing it will see it (B-083)

- The status bar no longer offers you an agents panel that does not exist. Opening the command menu replaced the `? for shortcuts` hint with `? for shortcuts · ← for agents`, and pressing the left arrow did nothing, because asking the toolkit to show no hint is what made it show its own — which lists everything the toolkit can do rather than what this build wires. The hint is now assembled from the capabilities that are actually present, so an unbuilt feature cannot be advertised by omission (B-067)

### Added

- **TheoCode:** backlog B-080..B-082 — three further items from widening that comparison past the command menu, to the CLI subcommands and the tools the model itself can call. Summarizing a long conversation is entirely manual and nothing warns you before the context runs out, so the failure lands mid-task; nothing diagnoses an installation, so when a setting does not take effect the only recourse is reading source; and the agent cannot open an image in the repository, which makes a diagram or a screenshot invisible to it unless you attach one by hand (B-080)

- **TheoCode:** backlog B-067..B-079 — thirteen maintenance items from the first side-by-side run of this product against the terminal agent it was adapted from. Two are defects you can reproduce today: the footer names an agents panel that was never built, and the composer ignores Home and End, so correcting a long prompt is one arrow key at a time. The rest are capabilities that exist in the engine and have no surface — MCP servers are spawned and a failed one is silent, skills can be removed by trust-gating with no way to tell, hooks can block a tool call and cannot be listed — plus three absences a user meets directly: a reply cannot be copied or exported out of the terminal, the sandbox posture is displayed but not changeable, and a session can be archived but never deleted. Five further differences were deliberately NOT filed, because the only argument for them was that the other product ships them (B-067)

- What the agent is allowed to do is now checked automatically. The set of tools it can reach, which of them stop and ask you first, and which files a cloned repository is permitted to influence were all decided in code that no test read — so a change that quietly removed an approval prompt, or let an untrusted project's configuration through, would have shipped with every test still passing. Fourteen tests now assert those decisions for all three agents the product builds, and each one was verified by breaking the product on purpose and confirming the test caught it (B-061)
- **TheoCode:** backlog B-059..B-063 — five maintenance items from a cross-validation of `packages/{agent,shared}` against the framework it consumes. The repository now holds three agent-construction routines that do not call each other, so building a fourth agent means writing a fourth one; the primitive all three share is not exported from the package; nothing in the suite asserts what an agent is composed of; the domain specialist still tells every cycle the repo has zero tests, against 48 on disk; and ten of the framework's thirteen error classes sit outside the typed hierarchy the product catches on (#B-059)
- `npm run crossval` checks that every closed backlog item names a commit which actually touches the code the item is about. It exists because the 2026-08-08 review found an item closed against a commit that never touched the file its own evidence cited — and on its first run it found two more items closed with no commit recorded at all (B-018..B-057)
- **TheoCode:** backlog B-019..B-051 — 33 maintenance items covering all 78 actionable findings of the 2026-08-08 `packages/` review; 11 of them reopen an item closed on 2026-08-07 whose Definition-of-done bullet the code never satisfied, including the review's single `critical` finding (B-019)
- The welcome banner has a test suite locking what it renders — the ASCII wordmark, the product name, the model, and both right-hand panels (B-011)
- `BACKLOG.md` — the single maintenance registry for TheoCode, seeded with 17 items derived from the TheoCode ↔ theokit cross-validation of 2026-08-07 (`docs/reviews/2026-08-07-theokit-crossval-review.md`)
- `CHANGELOG.md` — this file, required by Unbreakable Rule 6 and recorded as finding CI-010 in that same review
- The manual test runbook for the Telegram example reads in English, and the bot handle it tells you to talk to is now marked as illustrative — it belonged to one developer and exists nowhere in the example code, so anyone following the steps literally was messaging nothing (B-066)
- Every repository in the framework this product is built on now checks its own English-only rule as part of its test suite. Only one of the ten did before, and it was the only one that had needed no cleanup — the other nine relied on someone remembering to look. Installing the check found the last Portuguese identifiers and one error message a user could see, and each repository's exemptions are written down with the reason: a prompt whose Portuguese is the behaviour being taught, a Unicode test corpus, and release notes that are a record of what shipped rather than prose to rewrite (B-065)
- Portuguese was removed from the framework this product is built on, not just reported. Four of the ten framework repositories carried it in source — comments, error messages the user could see, and identifiers including one on the published interface; 129 occurrences are now English and four repositories are clean. What remains is verified false positives: OpenTelemetry field names, a Unicode test corpus, and the word list belonging to another repository's own Portuguese guard (B-058)
- The Portuguese names still on the framework's public interface were measured precisely, and the answer is much smaller than assumed: four type names, none of them reachable at runtime, one of which this project mentions once in a comment. The change that had been treated as needing a major version needs four deprecation aliases in a minor — and the specific function the concern named turns out never to have been published at all (B-058)

### Changed
- The project's written record now has one home. Plans and reviews were being kept in two places at once — one of them not part of the repository, so it never reached anyone who cloned it — and the two copies of the same plan had already drifted apart, with the stale one being the copy a working session picked up. Durable documents live in `docs/`, the reasoning is written down in an architecture decision record, and a check now fails the build if the same document ever exists in two versions again (B-064)
- Building a new kind of agent no longer means writing a new routine to build it. The product ships three agents — the one you chat with, the code reviewer, and the members of a delegated team — and each was assembled by its own separate piece of code, so a fourth would have been a fourth. What an agent is allowed to do is now declared as a list in one place, and all three read from it; a new agent that needs *less* than the coding one is three lines, which the old assembly could not express at all (B-059)
- The agent can no longer resolve its own project directory. Whoever builds it must say which directory it is for, so the trust decision, the configuration, the tools' write scope and the project instructions cannot end up describing two different folders — a disagreement that was previously one forgotten argument away, and silent when it happened (B-059)
- The TheoCode domain specialist describes the repository as it is now. Nine of its calibration facts had gone false in three days — it told every cycle the repo had zero tests and no way to run them (there are 268, all passing), that the history was three commits long (131), that the layering was enforced by nobody (dependency-cruiser now checks five named rules over 190 modules), and it named a framework version the workspaces had already moved past. It now carries the date on every measured figure, and a note that the tree wins when the two disagree (B-062)
- `.gitignore` and `.prettierignore` are written in English; their comments carried the reasoning behind a dozen ignore rules and were the last Portuguese prose in a versioned file (#B-058)
- The English-only guard now covers `tools/` as well as `packages/`, and reads comment prose — a seven-line Portuguese comment in the build script was invisible to every previous detector (#B-058)
- English-only guard rebuilt on dictionary lookup instead of a word denylist: it now flags a word a Portuguese dictionary knows and an English one does not, so an unforeseen Portuguese term is caught rather than silently passed (#B-058)
- Portuguese identifiers renamed to English across the agent package, including a Portuguese source filename (#B-058)

- Running a shell command straight from the composer with `!` is deliberately not implemented, and the reasoning is written down in `docs/adr/0001-shell-shortcut-confinement.md`. The terminal toolkit offers the shortcut, so anyone reading its documentation will expect it here: every command this product runs passes an approval prompt, a sandbox scope and any policy hook, and a composer shortcut has no turn for the approval to attach to — wiring it would mean a second, separate path to running commands on your machine. Ask the agent to run the command instead, or use `/ps` and `/stop` for background shells (B-056)
- Every message the product shows is in English. Ninety-two strings were in Portuguese, among them the login and goal toasts, the background-shell summary, the config and delegation errors, and the deprecation warning for a trust environment variable (B-052)
- The tool-registry error bridge now states that it is temporary and what removes it: the upstream defect it works around is fixed and awaiting release (B-016)
- The credential module states up front that it reads credentials and contains none, so the repository's secret gate flagging it by filename is answered in place instead of re-investigated each time (B-007)
- The OAuth credential type documents why it is narrower than the SDK's, so a surface review stops reading the two shapes as the same fact written twice (B-007)
- The approval ledger is documented and covered by tests as deliberate, not duplicated: it suppresses an approval the user already answered during the window before the agent's thread reflects it, which a stateless lookup cannot do (B-011)
- The backtrack overlay's windowing is now documented and pinned by tests as a deliberate divergence from the toolkit's own: it centres the selection (a history scrubber) rather than trailing it (a menu), and reports how many entries are hidden rather than merely that some are (B-011)
- The welcome banner is now the terminal-UI toolkit's own component instead of a hand-rebuilt copy of it. Same layout, one place to maintain — and the three upstream defects that blocked the switch are fixed at the source (B-011)
- The agent is now built against one working directory, supplied by whoever composes it. It used to read the process directory at six independent points while two of the four call sites had already resolved a directory and passed only part of it — so a run could be configured for one directory and have its trust, tools and project instructions resolved for another (B-015)
- The approval prompt, the slash-command list and the tree-diff panel now use the terminal-UI toolkit's own types instead of local copies of the same shapes. No behaviour changes; a field added upstream now reaches these call sites instead of silently missing them (B-011)
- The hook module declares all its imports in its header. Four of them sat past line 220, so the module's dependency surface was invisible from the top of the file. No behaviour changes (B-015)

### Removed

- `@theocode/cli` no longer offers an importable entry point. Importing it ran the command-line interface as a side effect, because the package exported the file that starts it (B-049)
- An echo-disabled secret reader and a team-member options builder, both of which had no caller and no test. They belong to features that were never built (B-049)
- The `Blocked <command>` marker in the tool header. It could never appear: it keyed on an exit code this product does not emit, so it read as protection while providing none. A hook veto is still invisible in the terminal, which is now tracked openly rather than disguised by dead code (B-027)
- The forked copy of the interactive-shell tool: 48 lines that existed only to recover the session-limit details the SDK used to discard. Fixed upstream and released, so the tool is now the SDK's own (B-009)
- Two package entry points nobody imported, and the two broken `bin` declarations (B-010)
- Dead surface: an unused drain helper, an orphan temp-file sweeper that hard-coded a private SDK naming convention, a statically unreachable assertion, and four exported readers with no callers — 174 lines (B-016)
- The unused `apiKey()` accessor and the transport dependency it fed: it was threaded through two modules and never read (B-007)

### Fixed
- A goal run no longer dies when the agent SDK emits an event type this build does not recognise; the unknown event renders as nothing and the loop keeps going (#B-058)
- Error messages, toasts and CLI output that were still in Portuguese are now English — the sandbox-mode error, the session-GC summary line, the goal toasts, the log-rotation and approval-ledger range errors, and the collapsed-continuation row in the timeline (#B-058)
- Three Portuguese identifiers no dictionary contains — `THREAD_PADRAO`, `semEspaco`, `indice` — were still in the agent package after it was declared clean; the guard now carries a measured list of the eight such words found by reading every entry of `--list-unknown` (#B-058)

- Command descriptions no longer carry milestone identifiers. Ten of them cited milestones this repository has no roadmap for, and the deprecation warning for a trust variable promised removal at one that does not exist (B-046)
- The configuration error for an untrusted project role points at the environment-knob registry instead of `docs/CONFIGURATION.md`, which was never written (B-046)
- The footer offers `? for shortcuts` only when pressing it does something (B-046)
- A hook approval that fails to persist leaves the consent gate open and shows a toast. It used to close the gate as if the approval had succeeded, so the hook was never approved, the user was never asked again that session, and the only report went to a log file (B-040)
- Diagnostics that could not be written to the terminal UI's log are counted and reported when the session ends. On a non-writable path the interface ran with every diagnostic dead and nothing said so (B-039)
- The terminal UI's log is rotated during a long session, not only at startup, so it no longer grows past its cap unbounded (B-039)
- A malformed `hooks` block is now reported. It disabled the hook consent gate silently, so no hook ran and nothing said why (B-039)
- A clean shutdown exits 0. Ctrl-C, a cleanup that failed, and a cleanup that timed out all returned the same failure code, so nothing wrapping the process could tell them apart (B-045)
- Attaching an image that cannot be read now fails with the same typed error as every other image failure, instead of an untyped one a caller written against the contract would let through (B-051)
- The keyboard help no longer advertises `!` for running a shell command. The shortcut was never wired, so `!npm test` was sent to the model as prose (B-028)
- Esc-rewind works. Arming the ladder read the turn count and previews before they were set, so the overlay drew nothing and a second Esc cancelled instead of stepping back — the feature was unreachable (B-029)
- The backtrack overlay speaks one language. Its header was in Portuguese while the toast for the same keypress was in English (B-029)
- A failure after the backtrack fork is now reported instead of becoming an unhandled rejection. The session had already moved, and the terminal said nothing (B-029)
- A custom `THEOCODE_HOME` is now honoured when resolving an `openai-chatgpt/*` credential. That route looked in the default home while every other route looked in the overridden one, so the same credential was found by one and missed by the other (B-034)
- `ensureAuthHome` no longer writes into the environment it was given. Asking where the auth home is had the side effect of changing the caller's environment (B-034)
- A caller that resolves configuration from an explicit environment now gets its trust decision from that same environment. The seam existed but was unreachable, so a single run could take the posture from the ambient environment and the configuration from an injected one (B-033)
- A session pointer that cannot be written degrades with a diagnostic instead of terminating the terminal UI. Three of the five paths that write it — `/new`, `/clear`, `/fork`, the Esc interrupt and the backtrack confirm — were still unprotected (B-031)
- A pasted API key is no longer submitted with its trailing newline. The credential was stored as-is and authentication failed later with a provider message that said nothing about whitespace (B-047)
- Setting a second listener on the ask bridge now fails with a typed error instead of silently replacing the first. A surface could stop receiving questions with no error and no warning (B-035)
- `-C/--cd` now selects the directory whose `.env` is loaded. The project environment was read before the working directory changed, so it came from the directory the user was leaving (B-026)
- `theocode --help` prints the usage text and exits successfully. It used to be reachable only by triggering an error, so asking for help returned a failure and a complaint about a mistake the user had not made (B-023)
- `theocode review --uncommitted` now reviews the uncommitted changes. The flag was parsed and checked for conflicts with `--base`/`--commit`, then never read, so it selected nothing (B-023)
- `--last`, `-m/--model` and `-o/--output-last-message` are now rejected on the commands that cannot honour them, instead of being accepted and ignored (B-023)
- The CLI usage text no longer teaches an `exec` subcommand that does not exist. Every documented invocation (`sessions gc`, `review`, `goal`, `resume`) was written with a prefix the parser does not route, so following the help text sent the whole command to the model as a prompt — starting a billable turn instead of running the command (B-022)
- A hook scoped with a `matcher` no longer runs against a tool result that carries no tool name. The matcher is a tool-name scope, and a hook written for `run_shell` was running with an empty one (B-021)
- The session collector no longer treats "I could not check" as "it is gone". A directory it cannot read, a working directory it cannot stat, and a transcript whose timestamp it cannot read now each leave the project untouched instead of clearing every retention guard (B-020)
- `--keep-last` now applies to projects whose working directory no longer exists — the only projects the collector actually deletes from. It previously had no effect there (B-020)
- A collector run that could not list any project reports the failure instead of "nothing to collect" (B-020)
- Custom commands now appear in the `/` menu as you type. They were routable and listed in the `?` help panel, but were never handed to the composer — so the only way to discover one was to open the help (B-011)
- The agent now introduces itself as TheoCode, on the SDK it actually runs on. It was calling itself "Theokit Builder" in the system prompt, the greeting, the banner, the composer placeholder and the directory-trust dialog — the last of which asked for filesystem and command-execution permission in the name of a product that does not exist (B-002)
- Pressing ESC on a pending question now unblocks the turn immediately. The question was removed from the screen but never withdrawn from the agent, so the model kept waiting on it for five minutes while the interface showed it as gone (B-004)
- The "a question is already pending" error now reads in English and can be caught by type from the package entrypoint, instead of being reachable only by matching its message (B-004)
- `/diff` now renders as a real diff — coloured, with a line-number gutter and unchanged runs folded — instead of one undifferentiated block of text that the terminal cut off (B-011)
- Trusting a repository's subagents no longer silently trusts its hooks. The setting source that enables one enables both, and repository hooks loaded that way skipped the per-hook fingerprint check that exists to catch a command changed after approval (B-008)
- `theocode` now points at the built artifact, so it runs. Both declared entry points pointed at raw TypeScript with no shebang and failed on first invocation — one of them by handing the file to ImageMagick's `import` (B-010)
- The dependency direction the README promised was enforceable now actually is, via `npm run depcruise`. The `exports` map alone never enforced it, because TypeScript resolves through a `tsconfig` wildcard that reaches past the declared entries (B-010)
- A corrupt transcript now reports which line is broken instead of just "transcript unreadable", and the reader is the SDK's own — the truncated-last-line tolerance is now a declared option rather than a re-derived index check (B-012)
- Tightening the sandbox mode now ends shell sessions already running under the looser one. A `bash -i` started with full access survived a switch to read-only, still interactive under the permissive wrap (B-014)
- A failed background write of the session pointer or goal state no longer terminates the terminal UI; it degrades and reports the reason instead (B-013)
- Local runtime state under `.theocode/` is ignored by git again. Two rules cancelled each other out, so sessions and the resolved config were committable despite being declared local (B-017)
- The file that records which directories you trust and which hook commands you pre-approved is now refused when other local users can write it, and its directory is repaired to be private if something else created it first (B-005)
- A delegated sub-agent can no longer be handed tools with the sandbox silently omitted. The scope treated a missing sandbox as "run without one" rather than as an error, so the shell it built was unconfined with no warning (B-006)
- A project's config file can no longer widen the sandbox or switch approvals off over the user's own setting. Both keys ranked below `project` and `env` in precedence, so a cloned repository could grant itself full access; tightening is still allowed, and an explicit command-line flag still wins (B-006)
- The terminal UI no longer auto-approves commands when no sandbox is actually enforcing anything. It approved every command under `full-auto` while the same screen warned that confinement was absent — the headless surface had refused this combination all along (B-006)
- Forking a session now also protects the most recent transcript, not just the one the pointer names — the session most likely still being appended to was absent from the guard (B-003)
- A transcript that is being written to right now is no longer eligible for deletion. Cleanup consulted the cross-process writer lease in neither phase, so only the file's age stood between a live session and removal (B-003)
- Session cleanup now refuses to run when it cannot read which session is live, instead of treating an unreadable pointer as "no session is live" and proceeding to delete (B-003)
- The ACP surface no longer registers `request_user_input`, a tool it could not answer — every such call used to stall for five minutes waiting on a bridge only the terminal UI listens to (B-001)
- An authentication failure now surfaces as an authentication failure instead of being passed downstream as an empty key, which made the real cause resurface later as an unrelated provider error (B-007)

### Security

- A delegated team is confined to the working directory its parent was built for. It resolved its own from the process instead, so a worker could be given write authority over a different tree than the one the caller chose (B-032)
- An `AGENTS.md` import can no longer reach outside the project. Outside a git repository the boundary was the filesystem root, so any file on the machine could be pulled into the agent's instructions; and a symlink inside the project was followed out of it, because containment was checked on the path text rather than on where it actually points (B-042)
- The set of pre-approved hook commands is now read through the same permission check as directory trust. It had its own reader, so a consent store any other local user could write was refused for the cheaper decision and accepted for the one that authorises command execution (B-019)
