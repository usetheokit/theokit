# Adoption audit: does TheoCode use 100% of our system?

**Date:** 2026-08-15
**Method:** file-by-file measurement of the consumer against the layer's published surface
**Answer:** **No — and 86% of the remaining distance is ours to close, not theirs.**

## Coverage of what we publish

16 of the 20 subpaths `@theokit/agents` publishes are imported. The four that are not:

| Subpath | Why |
|---|---|
| `./config` | **The door 8.7.0 opened** — not on npm yet |
| `./bridge`, `./testing`, `./usage` | Internal/optional surfaces with no legitimate use here |

It declares `@theokit/sdk ^4.49.0` and never imports it directly — only mentions it in comments.
That is not a gap: it reaches the runtime through our layer, which is the intended design.

## What it still hand-rolls, and who is blocking each line

| Consumer file | LoC | Covered by | Blocked on |
|---|---:|---|---|
| `auth/credentials.ts` | 390 | `resolveCredential`, `PermissionStore`, `providerFromApiKeyPrefix`, `Stored*` types | publish |
| `context/agents-md.ts` | 256 | `loadInstructionTree` via `@theokit/agents/config` | publish |
| `tools/registry.ts` | 151 | mostly already consumed — the rest is product policy | see below |
| `config/trust-store.ts` | 145 | `TrustStore` via `@theokit/agents/config` | publish |
| `hooks/hook-trust.ts` | 108 | `HookApprovalStore` + a one-line `map` | publish |
| `tui/SecretInput.tsx` + `secret-buffer.ts` | 90 | `FreeTextInput` `mask` | publish |
| **Total** | **1140** | | **989 (86%) publish-gated** |

## `registry.ts` — the file that looked worst and measured best

Flagged at the start of the cross-validation as "generic infrastructure the framework should
provide". Measured, it is the opposite: 151 lines that **already consume nearly all of it** — every
tool factory (`createReadFileTool`, `createShellTool`, `createEditFileTool`, …), `bindToolScope`,
`Toolset`, `CustomTool`, `withName`, and our error types.

What remains is product policy and belongs to them: *which* tools this product exposes, under
*which* names (`grep`, not `search_text`), with *which* options, and the write-root-vs-cwd
distinction that keeps a write scope from silently narrowing. A framework that decided the tool
roster would be wrong.

One dead line inside it: the `translateError` shim, whose own comment set a removal date that has
passed. Filed as [usetheoai-lab/TheoCode#20](https://github.com/usetheoai-lab/TheoCode/issues/20)
rather than changed here — the error contract is theirs.

## Gaps closed while measuring

Measuring produced work rather than only a number:

- **`providerFromApiKeyPrefix`** — the consumer infers a provider from an API-key prefix at login.
  The SDK answered exactly that from an `@internal` module no entry exported, so the consumer wrote
  its own. Now public in `@theokit/sdk/auth` ([theokit-sdk#282](https://github.com/usetheodev/theokit-sdk/pull/282), merged).
  Moving it surfaced a **latent defect**: the lookup iterated a hand-ordered table and was correct
  only because `sk-or-` and `sk-ant-` happened to precede `sk-`. Every OpenRouter and Anthropic key
  also starts with `sk-`; a shortest-match-first scan resolves them to OpenAI — invisible locally,
  surfacing as a 401 from the wrong endpoint. The consumer's hand-rolled copy sorted by length and
  ours did not. Ordering is now derived.
- **`StoredCredential` / `StoredOAuthCredential`** — the layer forwarded `writeCredential` and
  `readStoredOAuth` without the types of what they carry. A function you can call whose payload you
  must re-describe is half forwarded, and the hand-written mirror is where the two drift.
- **G12** — `FreeTextInput` `mask` and `StatusFooter` `modeLabel`
  ([theokit-tui#76](https://github.com/usetheodev/theokit-tui/pull/76), merged).

## Two claims corrected by measuring

Both had been repeated in PR bodies and release notes and were wrong:

1. **`context/instructions.ts` is not a reimplementation.** It is the product's system-prompt text —
   legitimate application content. It was about to be counted as duplication.
2. **The symlink-containment flaw is fixed on their side.** `agents-md.ts:16-36` (`B-042`) checks
   containment on the real path via `realpathSync` and denies an unresolvable one. What remains true
   is the cost: 256 lines they maintain because our door was unreachable — and a security bug they
   had to find and fix alone, which is exactly the price of a capability that exists and cannot be
   imported.

## The ceiling

Every publish in this group runs through `changesets` in CI, and CI cannot start — the account's
billing block. Three packages are cut and waiting: `@theokit/agents@8.7.0` (tagged, GitHub release
published), `@theokit/tui@0.53.0`, and the SDK's pending minor.

Clearing that block converts 989 of the 1140 overlapping lines from "duplicated" to "deletable" —
`^8.6.0` already admits `8.7.0`, so the consumer needs no version bump for most of it.
