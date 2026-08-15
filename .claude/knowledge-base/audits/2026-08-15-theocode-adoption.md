# Adoption audit: does TheoCode use 100% of our system?

**Date:** 2026-08-15
**Method:** file-by-file measurement of the consumer against the layer's published surface
**Answer:** **No.** Measured first at 1140 overlapping lines with 86% publish-gated. That framing was
wrong in an important way: three of those blocks were not publish-gated at all — they were capability
gaps on our side, and reading the consumer's code found them. All are now closed. **Every remaining
line is publish-gated.**

## Coverage of what we publish

16 of the 20 subpaths `@theokit/agents` publishes are imported. The four that are not:

| Subpath | Why |
|---|---|
| `./config` | **The door 8.7.0 opened** — not on npm yet |
| `./bridge`, `./testing`, `./usage` | Internal/optional surfaces with no legitimate use here |

It declares `@theokit/sdk ^4.49.0` and never imports it directly — only mentions it in comments.
That is not a gap: it reaches the runtime through our layer, which is the intended design.

## What it still hand-rolls, and who is blocking each line

| Consumer file | LoC | Covered by | Was it really publish? |
|---|---:|---|---|
| `auth/credentials.ts` | 390 | `resolveCredential`, `PermissionStore`, `providerFromApiKeyPrefix`, `Stored*` types, **`credentialSources` (new)** | **no** — the "where did it look?" half was missing |
| `context/agents-md.ts` | 256 | `loadInstructionTree` — **`@file.md` expansion (new)** | **no** — migrating without it was a regression |
| `tools/registry.ts` | 151 | already consumed; the rest is product policy | n/a — correctly theirs |
| `config/trust-store.ts` | 145 | `TrustStore` — **canonical key + `isTrusted` (new)** | **no** — ours keyed by raw string |
| `hooks/hook-trust.ts` | 108 | `HookApprovalStore` + a one-line `map` | yes |
| `tui/SecretInput.tsx` + `secret-buffer.ts` | 90 | `FreeTextInput` `mask` | yes |
| **Total** | **1140** | | **now 100% publish-gated** |

### What "86% publish-gated" got wrong

The first pass counted a file as covered if a symbol with the right name existed. Reading both sides
line by line found three cases where the name matched and the capability did not — and in two of
them, migrating on the strength of the name would have SHIPPED A REGRESSION:

- `loadInstructionTree` walked directories and never expanded `@file.md`.
- `TrustStore` keyed decisions by raw string while its sibling `PermissionStore` canonicalised with
  `realpath` — two stores in one package, both gating execution, disagreeing about what "the same
  directory" means.
- `resolveCredential` returned `undefined` without saying where it looked.

That is the same defect class this whole cycle is about, turned on ourselves: a capability that is
*nominally* present and does not do the job costs what an absent one costs.

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

## Gaps closed while measuring (all merged)

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
billing block. Three packages are cut and waiting: `@theokit/agents` (8.7.0 tagged and released on
GitHub, plus everything above), `@theokit/tui@0.53.0`, and the SDK's pending minor.

**Nothing else is pending.** Every capability the consumer duplicates now exists, reachable, on our
side. Clearing the billing block converts the whole 1140 lines from "duplicated" to "deletable" —
`^8.6.0` already admits `8.7.0`, so most of it needs no version bump on their end either.

## Second measurement, later the same day

| Gap | Where | State |
|---|---|---|
| `providerFromApiKeyPrefix` unreachable + latent ordering defect | theokit-sdk#282 | merged |
| `StoredCredential` / `StoredOAuthCredential` not forwarded | theokit#307 | merged |
| `loadInstructionTree` had no `@file.md` expansion | theokit#308 | merged |
| `TrustStore` keyed by raw string, and had no `isTrusted` | theokit#309 | merged |
| `resolveCredential` could not say where it looked | theokit#310 | merged |
| `FreeTextInput` mask + `StatusFooter` modeLabel (G12) | theokit-tui#76 | merged |
| Dead `translateError` shim in the consumer | TheoCode#20 | filed |

Every one was found by reading the consumer's code against ours, and every one was tamper-tested —
break the production code, confirm the suite notices. Three of those tamper-tests initially did
**not** notice, and each of those was a test passing for the wrong reason:

- the store's temp-path collision (`toContain` satisfied by a longer run of mask characters),
- the import cycle guard (the depth cap terminated the cycle, so the test exercised the cap under
  the guard's name),
- the `chmod` repair (its only real trigger became unreachable once temp names were unique).
