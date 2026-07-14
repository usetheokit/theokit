# Review: theokit-file-based-config

**Date:** 2026-07-14
**Reviewers:** 4 dimensions audited directly (architecture/boundaries, cross-validation, tests/wiring, security) against the diff `91ba77d1..develop`
**Diff scope:** 10 production files + 6 test files, ~268 insertions (packages/agents + packages/theo)
**Findings:** BLOCKER 0 · HIGH 0 · MEDIUM 1 (fixed in review) · LOW 1 · INFO 4
**Verdict:** READY_TO_MERGE

## MEDIUM findings

### F1: EC-4 test promised by the plan was not written — FIXED during review
- **Severity:** MEDIUM (plan-vs-impl divergence; low actual risk)
- **Found by:** cross-validation + tests
- **Plan ref:** T2.1 RED / `## Failure scenarios` / coverage matrix G13 — `test_malformed_theokit_file_surfaces_configuration_error`
- **Detail:** The plan promised an integration test proving theokit surfaces (never swallows) the SDK's `ConfigurationError` from a malformed `.theokit/` file. It was missing (only an unrelated `channel-transport` malformed-jsonl test existed). The underlying contract IS met by existing code (`sdk-adapter.ts:601-607` — `catch → yield { type:'error', code:'SDK_ERROR', message }`), so the risk was low, but the promised coverage was absent.
- **Action taken:** Added `packages/agents/tests/integration/setting-sources-malformed-config.test.ts` (commit `ea5935e2`) — a mocked SDK rejecting on create with a `ConfigurationError` proves the stream yields an error event carrying the message (fail-loud, not a silent clean end). Green.

## LOW findings

### F2: `resolveDiscoveryCwd` uses a loose structural param type
- **Severity:** LOW (advisory)
- **File:** `packages/theo/src/server/agent/mount-agent.ts:151`
- **Detail:** `resolveDiscoveryCwd(compiled: { settingSources?: readonly unknown[] }, …)` uses a minimal structural type instead of the SDK's `CompiledAgentOptions`. It only reads `.length`, so it is NOT `any` and is type-safe (G3-compliant). Using the real type would be marginally stronger but couples `mount-agent.ts` to the agents type; the structural minimum is a defensible KISS choice. No action required.

## Cross-validation summary

| Task | Status | Evidence |
|---|---|---|
| T1.1 `.settingSources()` builder | ✅ fully implemented | `agent-builder.ts` interface + makeBuilder; `test_builder_settingSources_carries_to_config` |
| T1.2 compile → CompiledAgentOptions | ✅ fully implemented | `define-agent.ts` + `agent-compiler.ts`; `test_compile_carries_settingSources` |
| T2.1 project into local, decoupled, EC-3/EC-5, back-compat | ✅ fully implemented | `resolveSettingSources`; 5 tests incl empty=unset + explicit-wins + skills back-compat |
| T2.2 cwd = projectRoot not process.cwd (EC-1) | ✅ fully implemented | `mountAgent` projectRoot + `streamAgentUIMessages` cwd mapping + 2 callers; `test_settingSources_cwd_is_config_root_not_process_cwd` (fakeRoot ≠ process.cwd) |
| T3.1 showcase demo + browser proof | ✅ fully implemented | `.theokit/` 6 file types + `.settingSources(['project'])`; dogfood evidence outcome=pass (file-based `release-notes` discovered) |
| T4.1 validation + changeset + CHANGELOG | ✅ fully implemented | changeset (minor ×2), CHANGELOG entry, all gates green |
| EC-4 malformed → typed error | ✅ fixed in review | `setting-sources-malformed-config.test.ts` |

**Tasks: 6 · fully: 6 · partial: 0 · missing: 0 · diverged: 0** (after the EC-4 fix).

## Boundary / guardrail audit

- **G2 / sdk-runtime / ADR-0040:** ✅ PURE wiring. No file loader, hook executor, or MCP launcher added; theokit only sets `local.settingSources` + `cwd` and hands to `Agent.create`. The SDK owns discovery + hook shell execution + MCP launch. The grep guard (`openrouter.ai|api.openai.com|api.anthropic.com`) hits are pre-existing provider-config comments, not new fetches.
- **G3 type-safety:** ✅ `SettingSource` re-used from `@theokit/sdk` (single source of truth, no duplicate). `readonly SettingSource[]` throughout. No `any`, no non-narrowing `as`, no `@ts-ignore`.
- **G1 dep direction:** ✅ agents→sdk (types only), theo→agents — no new cycle.
- **G6 file budgets:** ✅ `sdk-adapter.ts` (already 695 LoC, over budget) was NOT grown — the cwd default lives in `mount-agent.ts` by design; `mountAgent` refactored to `MountAgentOptions` to stay ≤5 params; `resolveSettingSources`/`resolveDiscoveryCwd` are small SRP helpers.
- **Back-compat:** ✅ skills-only agents byte-unchanged — `resolveSettingSources` returns `['project']` when `compiled.skills` is set and no explicit sources; `test_adapter_passes_skills_to_create` still asserts `local.settingSources` contains `'project'`.
- **Security (D5):** ✅ hooks-shell posture is opt-in via `.settingSources(['project'])`, documented in the builder + config JSDoc; the showcase `hooks.json` is safe-by-construction (`node -e "process.exit(0)"`). No second theokit gate (per ADR D5 — informed consent, honest enforcement G10).

## Quality gates summary

- `@theokit/agents` test: **719 passed / 3 skip / 0 fail** (98 files)
- root suite (theo): **4104 passed / 0 fail** (pre-EC-4; EC-4 is agents-scoped)
- typecheck: clean (agents + agents-test-config + theo)
- eslint: 0 warnings on touched files (`max-params` + `complexity` resolved via `MountAgentOptions` + `resolveDiscoveryCwd`)
- G2 grep guard: zero real violations
- Dogfood: real-browser PASS (file-based `release-notes` skill discovered)

## Handoff decision

**READY_TO_MERGE.** The single MEDIUM (missing EC-4 test) was fixed within the review; only a LOW advisory (loose structural type) remains, which is a defensible KISS choice needing no change. Proceed to `/release` (develop→main PR, human-approved merge).
