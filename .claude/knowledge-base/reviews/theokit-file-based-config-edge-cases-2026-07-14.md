# Edge Case Review — theokit-file-based-config

Date: 2026-07-14
Tasks analyzed: 6 (T1.1, T1.2, T2.1, T2.2, T3.1, T4.1)
Cases found: 7 (EDGE: 3, NEGATIVE: 4 | MUST FIX: 2, SHOULD TEST: 3, DOCUMENT: 2)

The plan touches ONE real external boundary the plan under-specifies: **filesystem discovery keyed on `cwd`** — and it introduces TWO subprocess-spawning file types in the showcase demo (MCP servers, shell hooks) that can break the dogfood if treated as inert examples. Those are the load-bearing edges.

## MUST FIX

### EC-1: `cwd` defaulted to `process.cwd()` may not be the app root → silent "discovers nothing"
- **Affected task:** T2.2
- **Kind:** NEGATIVE (wrong-but-not-throwing input → silent empty discovery)
- **Family:** State / Boundary
- **Scenario:** T2.2 defaults `local.cwd` to `process.cwd()`. But `theokit dev`/`start` is not guaranteed to run with `process.cwd()` === the app root (a user can `cd packages/x && theokit dev ../..`, a monorepo task runner, an IDE launcher). If `process.cwd()` is not where `.theokit/` lives, discovery finds nothing and **fails silently** — the exact failure D2 exists to prevent.
- **Impact:** The feature appears wired (no error) but discovers zero config — the worst UX (looks done, isn't). Directly undermines the Goal's observable metric.
- **Suggested fix:** Default `cwd` to theokit's **resolved config/project root** (the dir containing `theo.config.*` / the vite `root`, which the framework already computes at the dev/start boundary), NOT blind `process.cwd()`. Add `test_settingSources_cwd_is_config_root_not_process_cwd`. Update ADR D2 + T2.2 to say "app/config root the framework resolves", with `process.cwd()` only as the last-resort fallback.

### EC-2: Showcase `mcp.json` / `hooks.json` spawn real subprocesses → can break the agent on create
- **Affected task:** T3.1
- **Kind:** NEGATIVE (external dependency failure on discovery)
- **Family:** Resource / I/O
- **Scenario:** The doc's `mcp.json` example (`npx -y @modelcontextprotocol/server-filesystem /data`) SPAWNS an MCP subprocess on `Agent.create`; `hooks.json` runs a shell command (`node .theokit/policy.js`). In the showcase demo these are not inert — a missing `/data`, an un-fetchable npx package (offline), or a missing `policy.js` makes the agent-create hang or throw, breaking the browser dogfood that is the plan's proof.
- **Impact:** The dogfood (T3.1/T4.1 DoD) fails or hangs for a reason unrelated to the wiring under test.
- **Suggested fix:** In the showcase, make MCP + hooks **safe-by-construction**: (a) `hooks.json` runs a trivial always-exit-0 command that exists in-repo (e.g. `node .theokit/hooks/log.js` committed alongside, or `node -e "process.exit(0)"`); (b) `mcp.json` either omitted from the auto-loaded demo OR points at a server that starts reliably in the env (and the dogfood asserts discovery of the READ-ONLY types — skill/subagent/context — for the "it works" proof, treating mcp/hooks as documented-but-optional). Add a note in T3.1: the proof rides on skill/subagent/context discovery, not on a live MCP subprocess.

## SHOULD TEST

### EC-3: Empty `settingSources: []` — undefined semantics
- **Affected task:** T2.1
- **Kind:** EDGE (empty-but-valid array)
- **Suggested test:** `test_empty_settingSources_is_treated_as_unset` — `agent().settingSources([]).build()` compiled → `assembleM8CreateOptions` MUST NOT inject `local: { settingSources: [] }` (an empty array to the SDK is ambiguous). Assert `local.settingSources` is absent (empty ⇒ same as never opting in), preserving the skills-gated back-compat default.

### EC-4: Malformed `.theokit/` file → typed `ConfigurationError` must propagate, not crash the dev server
- **Affected task:** T2.1 / T3.1 (Failure scenarios)
- **Kind:** NEGATIVE (invalid file content)
- **Suggested test:** `test_malformed_theokit_file_surfaces_configuration_error` — with `settingSources:['project']` and a malformed `SKILL.md` under the cwd, the SDK raises `ConfigurationError`; assert the framework lets it PROPAGATE as a typed error to the caller (the mountAgent request path), and does NOT swallow it (Error-Handling rule) — and does NOT hard-crash the whole `theokit dev` process (one bad agent request ≠ server down). Assert the specific error type + a message, not just "throws".

### EC-5: `settingSources` set AND inline `.skills()` set — interaction
- **Affected task:** T2.1
- **Kind:** EDGE (two valid sources of the same knob)
- **Suggested test:** `test_settingSources_wins_over_skills_default_no_double_inject` — an agent with BOTH `.settingSources(['project','user'])` and inline `.skills([...])` ⇒ `local.settingSources === ['project','user']` (the explicit value wins; the skills-gated `['project']` default is NOT additionally merged/duplicated). Proves D1/D3 precedence.

## DOCUMENT

### EC-6: Project hooks execute shell (informed-consent risk)
- **Kind:** NEGATIVE (trust boundary)
- **Accepted risk:** Already ADR D5 — `.theokit/hooks.json` runs shell; ships as explicit opt-in (`.settingSources(['project'])`) with a DEEP DIVE security note, no second theokit gate (the app owns its own `.theokit/`). Ensure the note is actually written in T3.1's docs (not just the ADR).

### EC-7: Showcase `cron/jobs.json` fires while the host is alive
- **Kind:** EDGE (background timer)
- **Accepted risk:** A demo cron job could fire during the dogfood. Keep the showcase `cron/jobs.json` benign (a job that just logs, long interval) OR present-but-not-auto-started; document that cron is included as a discoverable-config example, not an active scheduled job for the demo.

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 | 0 |
| T1.2 | 0 | 0 | 0 | 0 | 0 |
| T2.1 | 1 (EC-5) | 1 (EC-4) | 0 | 3 (EC-3/4/5) | 0 |
| T2.2 | 0 | 1 (EC-1) | 1 (EC-1) | 0 | 0 |
| T3.1 | 1 (EC-7) | 1 (EC-2) | 1 (EC-2) | 0 | 2 (EC-6/7) |
| T4.1 | 0 | 0 | 0 | 0 | 0 |

**Coverage check:** the input-boundary tasks (T2.1 discovery projection, T2.2 cwd, T3.1 files) each have both an EDGE and a NEGATIVE case considered. T1.1/T1.2 are pure in-memory builder/compile (the `SettingSource[]` type is compile-checked; a runtime-garbage JS caller is out of scope — the SDK validates sources downstream) — noted, no lens forced.

**Verdict:** PLAN NEEDS ADJUSTMENT — absorb EC-1 (config-root cwd, not process.cwd()) and EC-2 (safe showcase mcp/hooks; proof rides on read-only types) into the plan as v1.1; add the three SHOULD-TEST cases to T2.1's TDD.
