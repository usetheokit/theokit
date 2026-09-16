# Measured against Codex, 2026-08-25

What this file is: the evidence behind the parity claims in `CHANGELOG.md`, kept in the repository
so a reader can check them without re-running anything. Numbers here were measured, not estimated.
Where something is an estimate it says so.

## Method

Both agents ran the **same prompt** in **byte-identical seed directories** (a fresh `git init` each,
so `git diff` shows exactly what each one changed), on the **same provider** (ChatGPT sign-in,
`chatgpt.com/backend-api/codex`), the **same model** (`gpt-5.6-terra`) and the **same reasoning
effort** (`medium`).

    theocode run -C <dir> --skip-git-repo-check --sandbox workspace-write -a never \
      -m openai-chatgpt/gpt-5.6-terra --effort medium "<prompt>"

    codex exec --skip-git-repo-check -m gpt-5.6-terra -c model_reasoning_effort=medium \
      --dangerously-bypass-approvals-and-sandbox "<prompt>"

Verification is a command with a pass/fail count, never a reading of the agent's own summary — an
agent reporting success is not evidence of success. Where a task had a rule with more cases than the
spec illustrated, the solutions were probed **beyond** the stated examples; that is what caught the
one real divergence.

Codex CLI v0.147.0. Model output is stochastic: token counts vary between runs of the same task, so
treat a single figure as an order of magnitude and the direction as the finding.

## Re-measured on the current stack, 2026-09-02

The figures below were taken with `@theokit/agents@11.0.0`, `@theokit/tui@0.78.0` and an SDK tarball.
The stack has since moved across a MAJOR — `agents@12.1.0`, `tui@0.79.0`, `sdk@4.63.3` — which
changed real behaviour: transcript replay reads structure instead of prose, the PTY moved to its own
package, and `prompt_cache_key` is now published rather than local. So the run was repeated.

Seeds rebuilt from scratch and proved byte-identical by hash before dispatch (`t1 9b7725a8…`,
`t3 0b04ed5b…`), each side getting its own copy under `git init`. Same provider, model
(`gpt-5.6-terra`) and effort (`medium`), run side by side in tmux.

| task | TheoCode | Codex | verdict |
|---|---|---|---|
| duration parser from failing tests | 10/10, test file untouched | 10/10, test file untouched | equal |
| money-ledger spec, agent writes its own tests | 5/5 **+ probe 4/4** | 5/5 **+ probe 4/4** | equal |

**The divergence did not return, which was the question this re-run existed to answer.** The probe
is the same one that caught it the first time — it tests PAST the illustration the spec gives:

| case | before the prompt fix | now, both sides |
|---|---|---|
| `0.1 + 0.2` (the spec's example) | 0.3 ✓ | 0.3 ✓ |
| `0.001 + 0.002` | **0** ✗ | 0.003 ✓ |
| `0.005 + 0.005` | **0.02** ✗ | 0.01 ✓ |
| `0.0001 × 3` | **0** ✗ | 0.0003 ✓ |

So the `BASE_INSTRUCTIONS` change — *an example illustrates a rule and never defines it*, and *tests
you write yourself must include cases you did not already know the code handles* — survived a MAJOR
of the framework and a nine-minor jump of the SDK.

| root-cause a wrong-associativity bug across 3 files | 5/5, **one file touched** | 5/5, **three files touched** | equal result, see below |

### Cost, re-instrumented

| | gross | cached | **blended** |
|---|---|---|---|
| TheoCode | 27,682 | 13,824 | **13,858** |
| Codex | — | — | **12,410** |

Same formula as before, Codex's own: `blended = max(0, input − cached) + max(0, output)`. Roughly
**12% apart**, TheoCode above — the same order of magnitude, not a benchmark.

Two honesty notes on that pair of numbers. Ours comes from a structured field —
`{"type":"turn.completed","usage":{...}}` on `--json`, which now carries `cached_input_tokens`;
Codex's was read out of its log text (`tokens used 12.410`), so the two are not measured with equal
instrumentation. And it is one run each, against a task whose own earlier measurement showed Codex
varying 2x between identical runs.

What the gross-versus-blended gap does confirm is that the cache is working from a PUBLISHED package:
27,682 gross against 13,858 blended means half the traffic was served from cache. On the first
measurement that came from a local tarball; it now comes from `@theokit/sdk@4.63.3`.

### A divergence in scope, which the earlier run did not surface

Both fixed the bug and both reach 5/5. The fixes differ, and the difference is not stylistic:

```
seed (the bug):   return (amount + amount) * rate

TheoCode:         return amount + amount * rate      ← tax.mjs only
Codex:            return amount * (1 + rate)         ← and rewrote discount.mjs too
```

`discount.mjs` was **correct in the seed**. TheoCode left it alone; Codex rewrote it from
`amount - amount * pct` to `amount * (1 - pct)` — algebraically identical, with no defect to fix —
and added rounding to `total.mjs` that the task never asked for.

Neither is wrong by the oracle: both suites pass. But the task was to find the root cause of a
failing test, and touching a correct file widens the diff for a reviewer with nothing to show for it.
**On this axis the more restrained behaviour is ours**, which is worth recording precisely because
every other axis here measures whether we match them.

### The third task measured nothing, and the seed was mine

A third task was dispatched: a wrong-associativity bug across three files, "the tests fail, find the
root cause". **The tests did not fail.** The seed passes 5/5 untouched — `applyTax(applyDiscount(100,
0.1), 0.1)` is 99, which is what the test asserts. I wrote a broken task and only found out by
diffing the result against the seed.

Neither agent changed a byte, and both reported honestly. That is the correct behaviour in the face
of a prompt asserting something false, and it is worth recording — but it is **not** the root-cause
parity the task was meant to measure, and counting it as such would be inventing a result. The
original task 5 in the table below is the real measurement; this re-run does not replace it.

### Not re-measured

Everything the original run left out is still out: interactive TUI behaviour, long-horizon tasks,
anything needing the network or an MCP server. Three tasks, one model, one afternoon — the direction
is evidence, the ratios are not a benchmark.

## Result parity — 6 tasks

| # | Task | Verified outcome | Agreement |
|---|---|---|---|
| 1 | duration-string parser from failing tests | 10/10 both, test file untouched | equal |
| 2 | two bugs: module-level shared state + unclamped coupon | 3/3 both | **`cart.mjs` byte-identical**; `coupon.mjs` semantically identical |
| 3 | 4-requirement money-ledger spec, agent writes its own tests | 5/5 both | **initially DIVERGED — see below**; equal after the fix |
| 4 | RFC 4180 CSV parser from a 5-rule spec | 5/5 both | equal on all 9 probes, including the 5 the spec never mentions |
| 5 | root-cause a wrong-associativity bug across 3 files | 5/5 both | **identical one-line fix**, same line |
| 6 | make a test pass whose import does not exist | 1/1 both | same call: drop the phantom dependency, implement locally, say so |

### The divergence task 3 caught

The spec said *"`balance()` must not accumulate floating point error"* and illustrated it with
`0.1 + 0.2`. Both agents ended 5/5 green. Probing past the illustration:

| | TheoCode (before) | Codex |
|---|---|---|
| `0.1 + 0.2` (the spec's example) | 0.3 ✓ | 0.3 ✓ |
| `0.001 + 0.002` | **0** ✗ | 0.003 ✓ |
| `0.005 + 0.005` | **0.02** ✗ | 0.01 ✓ |
| `0.0001 × 3` | **0** ✗ | 0.0003 ✓ |

TheoCode hard-coded two decimal places (`Math.round(amount * 100)`), satisfying the one example and
violating the rule — `0.005 + 0.005` returning `0.02` is off by a factor of two in a money type. It
then wrote its own tests and chose cases its implementation already passed, so the suite was green
and the code was wrong.

Fixed in `BASE_INSTRUCTIONS` (an example illustrates a rule and never defines it; self-written tests
must include cases you did not already know the code handles). Re-measured: 4/4 correct, matching
Codex.

## Style parity — comments on non-obvious code

Counted as comment lines added by the diff, across tasks 3–5:

| | comments added |
|---|---|
| TheoCode (before) | **0** |
| Codex | 5 |

The rule existed and the model read it as a prohibition, because two restrictions and the word
"rare" arrived before the permission: *"Comment only ahead of non-obvious code, never trivial
assignments. Comments are rare and explain WHY."* Codex frames the identical rule the other way up —
*"Add succinct code comments that explain what is going on if code is not self-explanatory"*, with
"should be rare" at the end. Ours now leads with the action. Re-measured on task 5: same one-line
fix, now carrying the reason a reader would otherwise have to derive.

## Cost — at parity, once both sides are measured the same way

**The apparent gap was an artefact of comparing a gross figure against a net one.** Codex reports the
NET cost — `codex-rs/protocol/src/protocol.rs`:

```rust
pub fn non_cached_input(&self) -> i64 { (self.input_tokens - self.cached_input()).max(0) }
// blended total = non_cached_input() + output_tokens.max(0)
```

This product reported `input + output` with the cached prefix still inside it. `input_tokens`
INCLUDES the slice the provider served from cache, so that counts tokens nobody pays for.

Measured with the same formula on both sides, same task, same model, same effort:

| run | rounds | gross | cached | **blended** | tests |
|---|---|---|---|---|---|
| 1 | 4 | 25,862 | 11,264 | **14,598** | 5/5 |
| 2 | 8 | 53,971 | 39,936 | **14,035** | 5/5 |
| **mean** | | | | **14,317** | |
| Codex | | | | **13,560** (18,084 / 9,036) | 5/5 |

**A 5.6% difference, inside the run-to-run variance** — Codex's own two runs of this task differ by
2x. Run 2 is the clearest evidence the cache works: 8 rounds, 53,971 gross, only 14,035 of it new.

The gross figures before this was understood, kept because they are what the earlier sections argue
against: 50,315 → 24,914 → 24,854 on task 3 (two runs after the prompt work, a 0.2% spread), 29,774
on task 4, 29,446 on task 5, 43,261 on task 6.

Earlier prompt work halved our absolute cost independently (10 tool calls → 5, four `update_plan`
calls → 0). Real, but never the cause of the ratio.

### Why: the request, captured from both sides

Ours by instrumenting `globalThis.fetch`; Codex's by pointing it at a local capture server with
`-c model_providers.capture.base_url=http://127.0.0.1:8099/v1`.

|  | TheoCode | Codex |
|---|---|---|
| request body | 24,691 c | **76,331 c** |
| tool schemas | 14,848 c (19 tools) | **24,278 c** |
| `prompt_cache_key` | **absent** | present, stable per thread |
| `include` | absent | `["reasoning.encrypted_content"]` |
| `reasoning` | `{effort}` | `{effort, context:"all_turns"}` |
| `store` | `false` | `true` |

**We send a third of the bytes and pay ~2.8× the tokens.** Codex's prefix is cached and reused across
rounds; ours is re-charged in full every round. This is the whole remaining gap, and it is not
something a consumer can work around — the request body is built inside the SDK with no seam to add a
field.

The useful consequence: **our tool set and prompt are not the problem** and do not need trimming.
Codex carries a *larger* prompt and *more* tool schema than we do.

Filed as [usetheokit/theokit-sdk#383](https://github.com/usetheokit/theokit-sdk/issues/383).

### Shipped and verified

Both fixes are published. Verified by unpacking the tarball from the registry, **not** by reading a
green CI badge — which matters, because the first `@theokit/sdk` release reported success and
contained none of them:

| package | version | verified in the published tarball |
|---|---|---|
| `@theokit/sdk` | 4.55.0 | `prompt_cache_key` in 11 files, `input_tokens_details` in 8, `withheldBuiltinTools` in 8; SLSA provenance |
| `@theokit/tui` | 0.78.0 | first published version of the package to carry a provenance attestation |

### Still to land in the surface

The transport reads the cached count now; a consumer going through `@theokit/agents` still receives
`cacheReadTokens: 0`, so `theocode run` prints the gross figure. The blended numbers above were
measured off the wire. Noted on theokit-sdk#386.

## Upstream defects this measurement surfaced

| Issue | What |
|---|---|
| [theokit-sdk#381](https://github.com/usetheokit/theokit-sdk/issues/381) | the builtin `shell` is declared unconditionally and cannot be withheld — **the memory half of this report was wrong and was retracted**, see below |
| [theokit-sdk#382](https://github.com/usetheokit/theokit-sdk/issues/382) | `memory.enabled: false` still writes the full session transcript into `<cwd>/.theokit/memory/sessions/` |
| [theokit-sdk#383](https://github.com/usetheokit/theokit-sdk/issues/383) | `prompt_cache_key` never sent — the cost gap above |
| [theokit#474](https://github.com/usetheokit/theokit/issues/474) | `streamAgentTurnInProcess` declares no `retry`, though `AgentRunnerRunOptions` has it |
| [theokit#475](https://github.com/usetheokit/theokit/issues/475) | token usage unreachable from a tool handler, so `get_context_remaining` cannot be built honestly |
| [theokit-tui#157](https://github.com/usetheokit/theokit-tui/issues/157) | `WelcomeBanner`'s `aside` slot cannot be sized, so a consumer must hard-code the box's own padding arithmetic to fill it |
| [theokit-sdk#385](https://github.com/usetheokit/theokit-sdk/issues/385) | `run_shell` drops the PARENT process's stdout when the command spawns a child — `node --test` returns zero lines, so the agent is blind exactly when something has already failed |
| [theokit-sdk#386](https://github.com/usetheokit/theokit-sdk/issues/386) | the Responses transport never read `input_tokens_details.cached_tokens`, overstating turn cost 16x |
| [theokit-sdk#388](https://github.com/usetheokit/theokit-sdk/issues/388) | the changesets release PR could never be merged — required checks sat in `action_required`, blocking every release since 2026-08-17 |
| [theokit#482](https://github.com/usetheokit/theokit/issues/482) | the same approval requirement, scoped to `workspace` — so every ordinary contribution PR is blocked while release promotions are not |
| [theokit-tui#158](https://github.com/usetheokit/theokit-tui/issues/158) | pre-existing overflow on the undivided two-column banner below ~52 columns; `U-7c` asserts the property but only at 120 columns, where it fits |

## One report I got wrong

The first version of #381 also claimed the memory tools were declared despite
`.memory({ enabled: false })`. They are not: `LocalAgentMemory.ensureTools()` withholds them
correctly, and always did. The defect was in THIS repository — the composition read
`enabled: posture.allows.memory && memoryEnabledForSession()` with no config gate, so the flag I
believed I was setting never reached the SDK. I measured the payload, saw the tools, and blamed the
dependency without checking that my own change had landed. It had not: an edit to `chat.ts` was
overwritten by concurrent work, and `typecheck` stayed green because the older line also compiles.

Retracted on the issue, which was narrowed to the `shell` builtin. The lesson is in the method, not
the code: **verify a fix by re-taking the measurement it was supposed to move, not by re-running the
type checker.** After the gate was genuinely in force, 19 tools became 17 and 14,848 chars became
13,387 — which is the evidence the original claim never had.

#382 was re-measured under the same correction and still reproduces, so it stands.

## What was NOT measured

- **Interactive TUI behaviour** beyond the approval card and the command panels. Every task above ran
  headless, because headless is what can be verified by a script.
- **Long-horizon tasks.** The longest here is six tool calls. Context management, compaction and
  recovery over a multi-hour task are exactly where the missing `get_context_remaining` (theokit#475)
  would matter, and none of that is exercised by these six.
- **Anything needing the network or an MCP server.**
- **Whether the results generalise.** Six tasks, one model, one day. The direction is evidence; the
  ratios are not a benchmark.
