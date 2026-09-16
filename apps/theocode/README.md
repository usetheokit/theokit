# TheoCode

A terminal coding agent: one agent core, two surfaces.

```
packages/
├── agent/     the agent and everything that composes it — context, tools, delegation,
│              sessions, hooks, auth, config, pty, goal, review
├── shared/    what both surfaces need; neither one owns it
├── tui/       surface 1 — the terminal UI (Ink + React)
└── cli/       surface 2 — the headless CLI
```

The direction of dependency is the whole design: `tui` and `cli` consume `agent`, `agent` never
consumes a surface, and the two surfaces never consume each other. The layout makes that visible;
`npm run depcruise` enforces it — the `exports` map alone does not, because `tsconfig.json` maps
`@theocode/agent/*` straight onto `packages/agent/src/*` and TypeScript resolves through that
mapping without ever consulting `exports`.

## Running it

```bash
npm install
npm run dev          # the terminal UI
npm run exec "..."   # the headless CLI
npm run build        # dist/theocode.mjs (bundle) + dist/acp-entry.mjs
```

Smoke test that touches neither the network nor a credential:

```bash
node dist/theocode.mjs sessions gc
```

## The packages

| Package            | What it is                                                                                                                                          | Reached as                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `@theocode/agent`  | The composition of the SDK with this product's policy. Not a library of agents — the SDK is `@theokit/agents`; this is what decides how it behaves. | `@theocode/agent/config`, `/auth`, `/session`, `/hooks`, … |
| `@theocode/shared` | The agent seam, the diagnostic sink, and how a failed turn is reported. Shutdown is NOT here — the local copy was deleted in favour of the framework's. | `@theocode/shared/agent`, `/diagnostic-sink`, `/turn-failure-reporting`, … |
| `@theocode/tui`    | Ink + React. Owns nothing about the agent beyond driving it.                                                                                        | `npm run dev`                                              |
| `@theocode/cli`    | Headless. Seven modes: `run`, `resume`, `review`, `goal`, `sessions gc`, `doctor` (prints the RESOLVED state for a support session; exits non-zero on a failure, never prints a credential), `migrate-config` (converts a leftover `config.toml` into `settings.json`; runs before configuration is resolved, so it stays reachable when the loader refuses to start), `version` (`--version`/`-v` — prints the build and exits 0, before anything is set up, because a version that needs a working configuration is useless in the bug report that needs it most).                                                                             | `npm run exec`                                             |

## Where configuration lives

The file is **`settings.json`**, and the name is Claude Code's on purpose: paste a real one in and
this product starts. Keys it does not implement are ignored and **named** by `theocode doctor`, so
you can always tell an unsupported setting from a misspelt one.

Where it is read from, ours before theirs, per layer:

```
~/<home_dir>/settings.json          →  ~/.claude/settings.json            (your defaults)
<project>/.theokit/settings.json    →  <project>/.claude/settings.json    (the project)
<project>/.theokit/settings.local.json → <project>/.claude/settings.local.json  (personal, gitignored — wins)
```

**Tolerance depends on whose file it is.** Under `.claude/`, an unknown key is theirs and is
tolerated; under this product's own root it is a typo, and the loader refuses by name — so
`sandboxMode` never gets silently discarded in place of `sandbox_mode`.

`config.toml` **replaced.** A leftover one with no `settings.json` in the same scope refuses the
start and names `theocode migrate-config`, which converts it through the same schema the loader
parses with. Silently ignoring it would drop your whole configuration with no error.

One directory per side — `<project>/.theokit/` in a repository, `~/<home_dir>/` under your home.
It used to be two of each, and getting it wrong failed silently: a hooks block in the other one
was ignored with no error, and a hook is arbitrary command execution on every tool call (B-086).

`.theocode/` was the other one. It is still **read**, so nothing you already configured stops
working, and it is never written. When both hold a config file, the unified directory wins — the
alternative is that moving your file has no visible effect.

| Path                              | Read by            | Holds                                                                                           |
| --------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------- |
| `<project>/.theokit/settings.json` | this product **and the SDK** | `model`, `reasoning_effort`, `sandbox_mode`, `approval_policy`, `memory`, `shell_timeout_ms`, `session_gc`, `context_window`, `goal_oracle`, `home_dir`, `skills`, `output_style`, profiles — but **not `hooks`**, which this file refuses (#151). **Two readers, one file** — see the row below: adding a key here means checking what the SDK does with it |
| `~/<home_dir>/settings.json`      | this product       | the same keys, as your defaults; the project layer wins                                         |
| `~/<home_dir>/`                   | both               | transcripts, trust, hook approvals — `.theokit` by default; `home_dir` renames it, `.claude` included. A NAME, not a path, and an explicit `THEOKIT_HOME` still wins |
| `~/<home_dir>/AGENTS.md`          | this product       | instructions that belong to YOU, in every project; the project's own file is read after it. `~/.theocode/AGENTS.md` still works |
| `~/<home_dir>/rules/*.md`         | this product       | your own rules, scoped or not; the project's rules are read after them. `~/.theocode/rules/` and `~/.claude/rules/` are read too — rules are additive |
| `~/<home_dir>/agents/*.md`        | this product       | your own squad roles (`explorer`, `worker`), in every project; a role of the same name in the project wins, and yours are read even in an untrusted directory — the trust gate asks about THIS repository's code, and your home is not it |
| `<project>/THEO.md`               | this product       | project instructions — **first-wins** over `AGENTS.md`, then `CLAUDE.md`; a Claude Code repo needs no migration |
| `<project>/.theokit/`             | the SDK's filebase | `agents/<name>.md` (subagents), `skills/<name>/SKILL.md`, `rules/` — **and `settings.json` itself**, which it validates against its own schema — and whose `hooks` it EXECUTES, with no approval gate. That is why this file refuses the key outright and points at `.theocode/settings.json` (#151), and why any key added here has to be checked against what the SDK does with it |
| `<project>/.claude/`              | this product       | `rules/*.md` and `agents/<name>.md` are read from here too, so a Claude Code repository needs no migration; `skills/` already worked |
| `<project>/.mcp.json`             | the SDK            | MCP servers, spawned when the directory is trusted                                              |
| `~/<home_dir>/.mcp.json`          | this product       | YOUR MCP servers, in every project — not gated on whether a repository is trusted, because that gate is about the repository. A project cannot shadow one by reusing its name |
| `~/<home_dir>/tui-theme`          | this product       | what `/theme` last picked; `NO_COLOR` and `THEOCODE_THEME` both still override it                |
| `~/.theocode/auth.json`           | this product       | your credential — the one file deliberately left where it is; moving a live login is the one step of the unification that can log you out, so `theocode doctor` reports any copy in another state directory instead |
| `<project>/.theocode/settings.json` | this product     | the previous location — still read, never written; the row above wins when both exist           |
| `<project>/.claude/settings.json` | this product       | read when neither of the two above is there. Keys this product does not implement are ignored and named by `doctor`; its `hooks` are left to the compatibility loader that already runs them, so nothing fires twice |

The project layer is read **only for a trusted directory** — an untrusted
one falls back to your user layer, and no repository hook is wired at all. `/hooks` reports which of
those two you are in; `/status` reports the resolved model, effort, approval and sandbox.

## Environment

Every knob below is read at runtime and wins over the `settings.json` layer beneath it. The list is
not prose: `tools/check-env-knobs-documented.mjs` refuses a knob that is read in `packages/*/src` and
missing from either this table or `packages/agent/src/config/env-knobs.ts`. It was added on
2026-09-10 because two of these — `THEOKIT_SEARCH_API_URL` and `THEOCODE_DIAGNOSTICS` — changed real
behaviour while appearing in no document anyone reads. The gate sees `env.NAME` and `env['NAME']`;
a read assembled at runtime is invisible to it, so a clean run means those two shapes are covered,
not that every knob is.

| Variable | Default | What it does |
| --- | --- | --- |
| `THEOCODE_MODEL` | `openai/gpt-5.6-terra` | Switches the model. Wins over every settings layer. |
| `THEOCODE_REASONING_EFFORT` | `medium` | `minimal` … `xhigh`. A value outside the set fails loud. |
| `THEOCODE_SANDBOX_MODE` | `workspace-write` | Tool confinement. `read-only` registers no write tool; `danger-full-access` raises the write root to `/`. |
| `THEOCODE_APPROVAL_POLICY` | `on-request` | When you are consulted before a gated tool runs. |
| `THEOCODE_GOAL_ORACLE` | `judge` | Who decides the objective is met: the LLM judge (one extra call per turn) or the `update_goal` tool the model calls itself. |
| `THEOCODE_OUTPUT_STYLE` | — | The output style to apply, by name. See [Output styles](#output-styles). |
| `THEOCODE_CONTEXT_WINDOW` | — | Context window in tokens. Absent, it comes from the model catalogue. |
| `THEOCODE_SHELL_TIMEOUT_MS` | `10000` | Milliseconds before a custom command's shell expansion is killed. |
| `THEOCODE_MEMORY` | `false` | Durable memory across sessions. An unrecognised value fails loud rather than defaulting. |
| `THEOCODE_SESSION_GC` | `true` | Whether the session collector runs on its own, at most once a day. |
| `THEOCODE_PROVIDER` | — | Declares the provider explicitly. **Fail-closed**: if its key is absent, resolution aborts rather than silently falling back to another provider. |
| `THEOCODE_HOME` | `~/.theocode` | Moves the credential store (`auth.json`). |
| `THEOKIT_HOME` | `~/.theokit` | Root of runtime state, including transcripts. Moves what `sessions gc` sweeps. |
| `THEOKIT_AUTH_HOME` | derived | Points the SDK's ambient credential store at this product's. An explicit value wins. |
| `THEOCODE_TRUST_ALL_DIRS` | — | CI/headless escape: `=1` trusts EVERY directory. It switches **off** the defence against a hostile repository — set it only where you control the checkout. |
| `THEOKIT_TRUST_ALL_DIRS` | — | **Deprecated** alias of the above. Still grants, and warns once per process. |
| `THEOCODE_DIAGNOSTICS` | off | `stderr` to see the framework's diagnostics. This is the recovery path when a turn fails and the message does not say why — a rate-limit error has surfaced no other way. Unset and disabled look identical, which is the reason it is listed here. |
| `THEOCODE_THEME` | — | Forces the colour theme by name. Outranks `/theme` and `NO_COLOR`. A name outside the set is reported by `/status`, not applied. |
| `NO_COLOR` | — | The [cross-tool convention](https://no-color.org): any value disables colour. `THEOCODE_THEME` deliberately outranks it. |
| `THEOKIT_SEARCH_API_URL` | — | The web-search provider endpoint. Absent or misspelt, `web_search` is **not declared to the model at all** — the capability disappears in a way that looks exactly like a model choosing not to search. |
| `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | — | Provider keys, in that precedence order. |
| `SHELL` | `/bin/sh` | The shell used to expand a custom command in the TUI. |
| `LIVE_MODEL` | `google/gemini-2.5-flash-lite` | Used by the live test harnesses only. Does not affect the product runtime. |

## Output styles

`output_style` names a `.md` file under `~/.claude/output-styles/` or `<project>/.claude/output-styles/`
— Claude Code's feature, in Claude Code's directories, with its frontmatter (`name`, `description`,
`keep-coding-instructions`). The project wins a name collision.

A style **replaces** the built-in coding instructions. It only appends to them when its frontmatter
says `keep-coding-instructions: true` — that key defaults to `false`, and getting it backwards would
make every style a no-op with a suffix.

In a `settings.json` the key may be spelled `outputStyle`, Claude Code's name: it is the one setting
besides `model` whose name and meaning are identical in both products, so it is translated rather
than ignored. `THEOCODE_OUTPUT_STYLE` sets it from the environment.

A name that matches no file falls back to the built-in instructions rather than refusing the turn —
a typo in an optional setting should not take the product away — and `theocode doctor` names it.

Your `~/.claude/output-styles/` is read, while your `~/.claude/skills/` and `~/.claude/agents/` are
not. That asymmetry is a stated rule, not an oversight: a foreign root under your home may contribute
text that **constrains** the agent, never artifacts that **add invokable surface**.

## Keybindings

`~/.claude/keybindings.json` — Claude Code's file and format
(`{ bindings: [{ context, bindings: { "ctrl+r": "toggle-verbose" } }] }`), read at startup.

**Small on purpose, and the product says how small.** This product has no key-to-action table to
rebind: the router *computes* what a key means from what is on screen — Escape is a dismiss ladder
whose meaning is the visual stacking order, and Ctrl-C means abandon, interrupt, arm-exit or quit
depending on five state fields. Three keys in total.

So what a file can bind here is the set of gestures that mean one thing regardless of screen state:
**`toggle-verbose`, `interrupt-turn`, `quit`**, on `ctrl+<letter>`. Everything else a file asks for
is refused **by name**: a reserved keystroke, an action this product does not expose, a shape the
router cannot match (`shift+tab`, chords), or an unbind — this product's built-in keys are computed,
so there is no table entry to remove.

A built-in gesture always wins a collision, and a binding on a key the router always claims
(`ctrl+o`, `ctrl+c`) is refused by name rather than accepted and left inert. A binding cannot reach past the gate that withholds keys from an untrusted
directory or a pending approval.

`/status` names what the file asked for and did not get. The file is read once at startup, so an
edit needs a restart.

## Custom themes

`~/.claude/themes/*.json` — Claude Code's format (`{ name?, base?, overrides? }`). Select one with
`/theme custom:<slug>`, where the slug is the filename without `.json`; `/theme` with no argument
lists what is on disk.

The two vocabularies do not line up, and the product says so rather than pretending. Claude Code has
roughly forty flat colour tokens; this product's theme is structured, and **six tokens map**:
`claude` → the accent, `error`/`success`/`warning` → the status colours, `diffAdded`/`diffRemoved` →
the diff backgrounds. Colour values are read as `#rgb` and `#rrggbb`; `rgb()`, `ansi256()` and
`ansi:` are not rendered here.

Everything a theme asked for and did not get — an unmapped token, an unsupported colour notation, a
base variant with no equivalent — is **named in the toast** when the theme is selected. A theme that
silently applied a sixth of itself would teach you the rest arrived.

Base names map on the light/dark axis: `dark`/`light` exactly, and `dark-daltonized`, `dark-ansi`,
`light-daltonized`, `light-ansi` keep their axis while saying which variant was lost. Falling back to
the default instead would repaint a light terminal over an accessibility variant we cannot reproduce.

Hook events are `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`. In this product's own file an
unknown event name is a loud parse failure, not a skipped hook. In a `.claude/settings.json` — where
the vocabulary is Claude Code's and is larger — an event we do not have is dropped and named by
`doctor` instead, because refusing would stop a valid file of theirs from starting the product.

**`hooks` is written in Claude Code's nested-by-event shape** — `timeout` in **seconds**,
`matcher: "*"` meaning every tool:

```json
{ "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "./check.sh" } ] } ] } }
```

Not a flat array; the loader refuses one, naming the form above.

**Which file may declare them is not the same question as which file is read.** Every hook this
product runs is fingerprinted by sha256 and requires per-hook approval. That gate can only cover the
files this product alone reads:

| file | `hooks` |
|---|---|
| `.theocode/settings.json` (project), `~/.theocode/settings.json` | **runs here**, approval-gated |
| `.theokit/settings.json` | **refused**, naming the file above |
| `.claude/settings.json` (project) | **not run** — the framework's loader spawns them, and this product now refuses each one at that point (#130) |
| `~/.claude/settings.json` | not run by anyone; reported by `doctor` |

`.theokit/` is the SDK's own filebase and its loader reads this same file. A hook there would run
through a loader that has no approval gate, and — since v0.13.1 made the nested shape parse here —
would then run a **second** time through ours (#151).

The refusal takes the **whole file**, not just the key, and that is the point rather than a rough
edge. Dropping only `hooks` would leave the other reader running them ungated — the hole would stay
open and go quiet. Refusing the file stops the product from starting, so nothing runs them, and the
message names `.theocode/settings.json` as where to move them. Every other key in that file is
refused along with it until they do.

`SessionStart` fires once, when a session begins — at launch, at `/new`, and on a headless run that
is not a resume. It is fired by the surface that mints the session id rather than mapped onto the
framework's `on_session_start`, which fires once per *loop context*: this product builds an agent per
turn, so that mapping would run the hook on every message.

## Testing an unreleased theokit fix

The theokit repositories publish a per-commit preview to pkg.pr.new on every push to `workspace`, so
a fix there can be exercised here before it is released — an install rather than a release cycle.

```yaml
# pnpm-workspace.yaml
blockExoticSubdeps: false                      # see below — required, and temporary
overrides:
  '@theokit/agents': 'https://pkg.pr.new/usetheokit/theokit/@theokit/agents@<sha>'
```

`pnpm install`, then check the lockfile records the URL rather than a registry version — that is how
you know the build under test is the commit and not what npm happens to serve.

**`blockExoticSubdeps: false` is not optional and should not stay.** pnpm 11 defaults it to `true`,
which refuses a URL-resolved package arriving as a *sub*dependency — and a preview of
`@theokit/agents` rewrites its sibling `@theokit/presenter` to a preview URL too, so the whole
install is refused without it. It disables a supply-chain guard for the entire tree, not just for the
pinned package, so revert both lines once the answer is in. Filed upstream as
[usetheokit/theokit#632](https://github.com/usetheokit/theokit/issues/632).

Used this way it isolated [theokit#631](https://github.com/usetheokit/theokit/issues/631) to one
repository in a single install: the fix under test was in `@theokit/agents`, the symptom survived it,
and that was enough to say the remaining half lived in `@theokit/sdk`.

## Contributing

`CONTRIBUTING.md` holds the one thing the gates cannot check: how to know that what you measured is
what runs. Three ways a careful measurement still lies — a compound command that skips the build, a negative
result with no positive control, and two legitimate artifacts that disagree about which one the
runtime executes — all taken from mistakes made here, with the retracted upstream reports they
produced.

## What a failure is allowed to cost

**No availability number is claimed here, and that is deliberate.** This product has no sustained
production measurement to back one, and this project's copy rules forbid publishing an
availability figure without one — stated here rather than cited, because the rule lives in the
local toolchain that `.gitignore` keeps out of a clone, and a citation a reader cannot open is
what B-134 was. What it does have is a target for the SHAPE of a failure, which is reviewable
without a metrics pipeline and falsifiable by a test:

- **A failed turn says what failed.** Never `An error occurred.`: the provider's message, the error
  code when the framework supplies one, and a next step for the classes common enough to have one.
- **A failure that cost retries says so.** The transport retries; a turn that spent three attempts
  reports three, so a refused credential cannot read as a quota problem.
- **A failure names the way to see more**, when there is more to see and diagnostics are off.
- **A secret scrubbed from the transcript does not come back on resume, and that is the trade.** The
  live turn sees what you typed — `token: ABC123` is echoed back correctly — while the persisted
  record stores `token: ***`. Resume replays the record, so the resumed conversation only knows the
  redaction. Measured 2026-09-05: this reads exactly like a resume defect from the outside, and it is
  the credential guard doing its job. Storing the value so resume could restore it would put every
  pasted credential in a file that outlives the session, which is strictly worse than losing it.

- **Housekeeping never takes the agent down.** The session collector reports its failures instead of
  raising them, and sweeps at most once a day.
- **The delete path fails towards keeping.** What the collector cannot classify is kept, and a
  retention window below the floor is refused rather than honoured.
- **Deletion is permanent, and that is why the guards above are the whole safety net.** Collection
  calls `unlink`; there is no trash, no quarantine and no restore procedure for the transcript tree.
  A trash directory was rejected rather than overlooked — it would grow without a bound of its own,
  trading a failure mode the guards already cover for one nothing does. What the automation buys
  instead is a first run that is always a dry run, so the first thing it ever does is tell you what
  it would have removed.

Each bullet is covered by a test, and that was checked rather than asserted — writing this section is
what revealed that the retention floor, a guard on the delete path, had no test at all. The list is
the contract: if one stops holding, that is a bug rather than a change of ambition. It is written down
because the alternative — choosing by omission — is still a choice, and an unstated one cannot be
argued with.

**What was rejected, so the choice can be argued with.** The obvious alternative is a real SLO: an
availability percentage, an error budget, and burn-rate alerting. It was considered and refused,
because every input it needs is missing — there is no external commitment to breach, no on-call to
page, and no sustained measurement to compute a budget from. Declaring one anyway produces a number
nobody can act on, which is worse than the absence: it reads as a guarantee and functions as
decoration. The bullets above are the cheaper form that survives having no telemetry, and they are
what an SLO should replace once there is production measurement to build it from.

## What is deliberately not here

This repository holds **production source and its tests**. `npm test` runs them:
**130 files, 1022 cases** (measured 2026-09-03 — `npm test`'s own count, which is the only one that is right. Two naive substitutes both undercount: a glob over `*.test.ts` finds 119, because 8 suites are `.test.tsx` and 3 are `.test.mjs`; and `grep -c 'it('` across all three extensions finds 959, because `it.each` expands into one case per row). The following were left out by an explicit decision —
stated here so nobody assumes they were forgotten:

- **The process toolchain** — the engineering-cycle kit, its rules, its plans and its audit trail.
  `.gitignore` keeps all of `.claude/` local by design: that directory is the maintainer's process,
  not the product, and it is an installed plugin with a repository of its own — versioning it here
  would commit a dependency's source into its consumer. So someone who clones this gets the agent,
  not the maintenance scaffolding of the people who write it.
- **The reference documentation** written against a different layout (journey map, parity register,
  configuration reference), whose paths no longer resolve.

## Credits — OpenAI Codex

**This agent is what it is because Codex went first.**

[OpenAI Codex](https://github.com/openai/codex) (Apache-2.0) was the reference this product was
built against — not as a repository to copy from, but as an answer to questions we had not yet
asked. Reading it changed decisions we would otherwise have made worse, and in four places it
shaped what shipped:

- **The persona.** The behavioural discipline of a terminal agent — when to plan and when to just
  act, how to constrain editing, how to end a turn with a short `file:line`-referenced answer —
  is Codex's. Ours re-expresses it against our own tools; it is a derivative work, and
  `packages/agent/src/context/instructions.ts` says so on its second line.
- **The tool contract.** `run_shell`, `apply_patch`, `edit_file`, `read_file`, `update_plan`,
  `write_stdin`, `web_search`, `interactive_shell` — these names are what the model is trained on.
  Diverging from them would have cost behaviour and bought nothing.
- **The wire format.** The headless JSON protocol follows Codex's event names and `usage` shape,
  so a consumer written against Codex reads our output without a translation layer.
- **The vocabulary.** `/compact`, `/review`, `/goal`, `/fork`, `/archive`, the three approval
  modes and the three sandbox modes carry Codex's semantics.

Beyond what shipped, Codex was the **measuring stick**. The question "do we have parity?" only had
an honest answer because there was a real implementation to read: 61 slash commands, 30 CLI
subcommands, the approval and sandbox postures, the keymap. The two counts are the variants of
Codex's own `SlashCommand` and `Subcommand` enums, at the commit the parity run read (`20f109e`,
2026-09-09).

That figure is no longer maintained by hand. `npm run lint` runs `tools/check-codex-parity.mjs`,
which compares the enum against this product's builtin list and its pointer map and fails when a
user-facing Codex command is in neither. It was written because the map had drifted and nothing
looked: the first run against a current Codex found eight — `approve`, `recap`, `voice` and
`worktree` unanswered, and four pointer entries (`auto-review`, `multi-agents`, `elevate-sandbox`,
`sandbox-read-root`) naming enum VARIANTS Codex never exposes, each one shadowed by a
`#[strum(...)]` override the user actually types. The checker states the commit it compared
against on every run, because reading a month-old checkout reports a clean surface while four
commands are missing — measured, not supposed. It SKIPS loudly where the clone is absent, which is
every CI run. They are stated without a path on purpose — the study clone is gitignored, so any path
into it is one a reader who clones this repository cannot open, and pointing at an unopenable file is
the defect B-134 was. The figures that stood here before, 55 and 27, matched no source at all; no
hidden or feature-gated variant explains the gap. Two capability gaps we would not have
noticed on our own — listing and stopping background PTYs — were found by comparing against it.

**Nothing was copied.** The study clone lived outside the tree, gitignored, read-only, and every
derivation above is design re-expressed in our own code. That discipline was a rule, not a habit:
a literal copy would carry the upstream licence into this repository, which is a legal problem and
not a stylistic one.

Thank you to the Codex team. Full attribution, with the specific files, is in `NOTICE`.

Credit is also due to **[opencode](https://github.com/sst/opencode)** (MIT), whose OAuth
device-authorization flow this product adapts — see `NOTICE`.

## Licence

See `NOTICE` and `licenses/`.
