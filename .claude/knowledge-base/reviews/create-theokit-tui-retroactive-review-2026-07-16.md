# Retroactive review + live smoke — create-theokit TUI surface (session gap closure)

**Date:** 2026-07-16
**Scope:** three gap items surfaced after the session's cycles shipped. All three closed.

## Item 1 — #136 SSE/HTTP path had no dedicated test → FIXED

- **Was:** the #136 fix lives in the shared `consumeChunkStream`, so both the in-process (transport) and HTTP/SSE (Response) paths are covered by construction — but only the in-process path had a behavior test.
- **Now:** added `consumeUIMessageStream` tests (`tests/unit/consume-chunk-stream.test.ts`, commit `dc6e14d3`) feeding a real SSE `Response`: `test_consumeUIMessageStream_rethrows_on_sse_error_frame` (an SSE `error` frame rethrows; pre-error text still delivered) + `test_consumeUIMessageStream_happy_path_no_throw`. 5/5 green. Test-only change (no publish needed — the fix already shipped in `theokit@0.43.2`).
- Also: **GitHub issue #136 closed** with a verification comment (root cause + commits + tests + published version).

## Item 2 — create-theokit 1.19.0–1.20.1 shipped without a full `/review` → RETROACTIVELY AUDITED (clean)

Those three releases were cosmetic and predated this session's cycle discipline:
- **1.19.0** — one-file `tui/theme.ts` restyle (ACCENT, THEME override, LOGO, tips, spinner words, placeholder).
- **1.20.0** — `npm run demo:tools` (`tui/tool-variations.tsx`), a visual reference of every tool render state.
- **1.20.1** — monochrome-by-default chrome (`accent: ''` + `role.*.prefix: ''`).

**Retroactive audit (against the published `create-theokit@1.23.0` scaffold `smoke123`, which carries these exact files):**

| Check | Result |
|---|---|
| `tui/theme.ts` present + correct shape (`export const ACCENT`/`THEME` + monochrome `accent: ''`) | ✅ |
| `tui/tool-variations.tsx` present + `demo:tools = tsx tui/tool-variations.tsx` script | ✅ |
| `tsc --noEmit --noUnusedLocals` on the whole tui surface (covers theme.ts + tool-variations.tsx + App + components) | ✅ 0 errors |
| `demo:tools` runs without crashing (`tsx tui/tool-variations.tsx`, 8s, exit 124 = timeout) | ✅ |
| Monochrome default live-verified (ANSI capture this session: chrome neutral, banner coral, tool states colored) | ✅ |

**Verdict:** no defect. The changes are cosmetic, type-clean, and now transitively covered by the tui-surface tsc gate + the componentization review (1.23.0). No code change required — this record IS the retroactive review.

## Item 3 — live visual smoke of the exact 1.23.0 componentized surface → DONE (fresh published scaffold)

Earlier the smoke was partially blocked by tmux Ink-capture flakiness. Re-done cleanly against a **fresh scaffold from the published `create-theokit@1.23.0`** (`npm create theokit@latest smoke123 -- --surface tui`, `@theokit/tui@0.40.0` + `theokit@0.43.2` installed — NOT the manipulated my-app3):

| Surface | Component (post-componentization) | Live result |
|---|---|---|
| Welcome banner | `tui/components/Banner.tsx` | `✻ Welcome to smoke123` + wordmark + tips ✅ |
| `/progress` | `tui/components/Demos.tsx` → ProgressDemo (owns its own timer) | `☑ Plan / ◐ Generate / ☐…` + `✵ Working…` + `██████ 25%`, advancing; self-completes → back to chat ✅ (confirms the fresh-mount reset — the review's resolved "critical finding") |
| `/plan` | `Demos.tsx` → PlanApproval | plan markdown + Approve/Revise → Toast `● Plan approved` ✅ |
| `/ask` | `Demos.tsx` → QuestionPrompt | options + `Other…` ✅ |
| `/select` | `Demos.tsx` → SelectList (multi) | ◯ checkboxes + `0 selected` ✅ |
| App composition | `App.tsx` imports 3 components (`grep -c "from './components/"` = 3) | ✅ |

`/usage` (`UsagePanel.tsx`) needs a real turn's `lastUsage` (requires a provider key, absent in the fresh shell) — it is the same prop-driven component live-verified on 1.22.0; skipped here, not a gap.

**Verdict:** the published 1.23.0 componentized surface renders and behaves correctly end-to-end from a clean scaffold.

## Net

All three items closed: 1 real code addition (SSE test, committed), 1 retroactive audit (clean, documented), 1 clean live smoke (published bits). No open code gap remains.
