# Release — post-V1 hardening (2026-07-06)

**Verdict:** RELEASED
**Fixes PR:** https://github.com/usetheodev/theokit/pull/82 (merge `27915d601735cb0cd0f7da547d536788b8ba9ddb`)
**Version Packages PR:** https://github.com/usetheodev/theokit/pull/83 (merge `8b61da7f1b15b98ce602651e7d52b955a498e8e8`)

## Published

| Package | From | To |
|---|---|---|
| `@theokit/agents` | 0.30.1 | **0.30.2** (#81) |
| `create-theokit` | 1.0.16 | **1.0.17** (#79, #80) |

`theokit` core unchanged (0.15.2).

## What shipped

- **#81** — `defineAgent({ tools })` type-accepts `CustomTool` (defineAgentTool + @theokit/sdk-tools).
- **#80** — default template `app/page.tsx` migrated to `@theokit/ui@1.0.0` auto-dispatch; `@types/node` + `experimentalDecorators`; jsdom render test.
- **#79** — `theokit-agents` skill doc `defineAgentTool` example corrected (`inputSchema`/`handler`).
- **#78** — `wrangler-smoke` opt-in gate (shipped as repo test; no package bump).
- Test-suite stabilization + `docs/guides/build-a-code-assistant.md`.

## Evidence — verified on the PUBLISHED registry

Fresh `npx create-theokit@1.0.17` → `npm install` (theokit 0.15.2 · @theokit/agents 0.30.2 · @theokit/ui 1.0.0) →
- `tsc --noEmit` = **0 errors** (was 7 — #80 headline)
- `theokit build` = **exit 0**
- shipped render test = **2 passed**
- generated SKILL.md teaches `inputSchema` (#79)

## Roadmap state

`theokit-ai-first` M0–M6 = 100% `[x]` (ROADMAP_COMPLETE). This is post-V1 hardening, not a milestone.
