# Phase 0 — `workflows/` and auto memory, measured before costing

Two surfaces of Claude Code's `.claude/` directory were deliberately left uncosted in the parity
plan, because their on-disk format was not known. Guessing it is the failure this project already
paid for. Both are now measured against the published documentation.

Sources: `code.claude.com/docs/en/workflows`, `code.claude.com/docs/en/memory`. Measured 2026-09-07.

---

## `.claude/workflows/` — a subsystem, not a file format

**What it is.** A *dynamic workflow* is a **JavaScript file** that orchestrates many subagents. A
runtime executes it in the background, separate from the conversation, while the session stays
responsive.

**Shape.** `export const meta = { name, description }` must be the **first statement** and a plain
object literal — a variable, call or spread in it makes the command disappear from autocomplete.
The body is plain JavaScript with top-level `await`, calling a fixed set of injected primitives:

| primitive | role |
|---|---|
| `agent(prompt, opts)` | spawn one subagent; resolves `null` if stopped or on unrecoverable API error |
| `pipeline(items, ...stages)` | one item through all stages, no barrier between them |
| `parallel(thunks)` | run concurrently, await all |
| `phase(title)` | group the agents that follow in the progress view |
| `log(msg)` | narrator line |
| `args` | input passed at invocation |

**Locations.** `.claude/workflows/` (project, shared) and `~/.claude/workflows/` (user). Project
wins a name collision. In a monorepo, every `.claude/workflows/` between cwd and the repo root
loads; closest to cwd wins.

**Runtime constraints, all load-bearing:**

- No filesystem or shell access **from the script** — agents do the work, the script coordinates.
- No module loading: a script containing `import()` fails **before** the run starts.
- `Date.now()`, `Math.random()` and no-argument `new Date()` **throw**, so a relaunched run repeats
  the same `agent()` calls. Timestamps arrive through `args`.
- ≤ 16 concurrent agents, ≤ 4096 items per `parallel()`/`pipeline()` call, ≤ 1000 agents per run.
- Resumable within a session: completed agents return cached results; the first agent whose prompt
  differs re-runs, and so does everything after it.

**Cost for TheoCode: HIGH.** This is not a dialect adaptation. Implementing it means a sandboxed
JavaScript runtime with a deny-by-default capability surface, four orchestration primitives over the
existing subagent machinery, per-agent result caching for resumability, a progress view, and
concurrency caps. It is comparable in scale to `app-server` or `remote-control`, not to
`output-styles`.

**Recommendation:** out of scope for the current parity work, and named as a deliberate omission
rather than an oversight.

---

## Auto memory — a relocation, and it removes the reason ours is off

**Location.** `~/.claude/projects/<project>/memory/`. `<project>` is derived from the **git
repository**, so every worktree and subdirectory of one repo shares a directory. Overridable with
the `autoMemoryDirectory` setting (absolute or `~/`-relative), readable from any settings scope.

**Shape.**

```
~/.claude/projects/<project>/memory/
├── MEMORY.md            index, one line per memory, loaded EVERY session
├── user_role.md         one memory per topic file
└── feedback_testing.md
```

- `MEMORY.md`: first **200 lines or 25 KB**, whichever comes first, loaded at session start.
  Over the limit, the write succeeds and the excess is silently dropped on the next load — so
  Claude Code returns an error telling the model to rewrite the index.
- Topic files are **not** loaded at startup; they are read on demand.
- Frontmatter carries `type` ∈ `user | feedback | project | reference`, and a `modified` ISO-8601
  timestamp written on each save.
- Written by the model, not the user. Machine-local; never synced.
- **Excluded from the `cleanupPeriodDays` retention sweep** — transcripts expire, memories do not.
- Not inherited by subagents, except a fork. A subagent's own memory is a separate directory.

**Controls.** `autoMemoryEnabled` (default **on**), `autoMemoryDirectory`,
`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`.

### The finding

TheoCode already has memory, and its location is the difference that matters:

| | TheoCode | Claude Code |
|---|---|---|
| where | `<cwd>/.theokit/memory/sessions/` — **inside the user's repository** | `~/.claude/projects/<project>/` — machine-local, outside it |
| default | **off** | on |
| scope | the working directory | the git repository, shared across worktrees |

Ours defaults to off for a measured reason, recorded in
`packages/agent/src/config/memory-default.test.ts:12-13`:

> a summary of every session lands in `<cwd>/.theokit/memory/sessions/`. Running the agent in
> someone's repository left files there nobody asked for; 332 KB had accumulated in this checkout

**Claude Code's location does not have that problem.** Writing outside the repository is what lets
their default be *on*. So adopting the location is not only parity — it removes the objection that
forced our default off, and the index/topic-file split is a shape our memory does not have.

**Cost: MEDIUM.** The memory tools exist; what changes is where files land, a `MEMORY.md` index with
a size discipline, and per-file frontmatter. The default staying off or flipping on is a separate
decision that should follow the relocation, not accompany it.

---

## Summary

| surface | format known? | cost | recommendation |
|---|---|---|---|
| `.claude/workflows/` | yes — JS orchestration scripts | **high** (subsystem) | out of scope, named |
| auto memory | yes — `MEMORY.md` index + topic files | **medium** | worth doing; relocation first, default second |
