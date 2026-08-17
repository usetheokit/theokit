---
scenario: agent-chat-new-surface
date: 2026-07-08
operator: usetheodev
outcome: pass
summary: theo-code-v2 migrated 100% to the builder-only API streams a real model + runs a tool end-to-end
---

# Dogfood — M31 builder-only migration, anchor scenario

The anchor scenario (`agent-chat-new-surface`) run against **theo-code-v2 fully migrated to the
TheoKit builder-only authoring API** (12 tools via `tool()`, 6 route files via `route()`, agent via
`agent()...approval()...build()`), consuming the **published** `theokit@0.20.0` +
`@theokit/agents@0.33.1` (npm-strict, not the monorepo).

## Environment

- App: `/home/paulo/Projetos/usetheo/theokit-tools/theo-code-v2` (commit `7bc6d0b`)
- Deps: published `theokit@0.20.0`, `@theokit/agents@0.33.1` (installed via npm)
- Provider: real OpenRouter model (`openrouter/openai/gpt-4o-mini`) via `.env`
- Server: `node bin/theo-code.mjs serve --port 3860` (tmux, real dev server)

## Evidence (live HTTP against the running dev server)

| Surface | Authoring builder | Result |
|---|---|---|
| Web `/` | `apps/web` (appDir) | HTTP 200, `id="root"` |
| `/api/health` | `route().handler().build()` | HTTP 200 `{"status":"ok","framework":"TheoKit"}` |
| `POST /api/sessions` | `route().handler().build()` | HTTP 200, session `id` created |
| `POST /api/agents/code` (stream) | `agent().model().context().tool()…build()` | Real model stream: `start → text-delta "OK" → finish` |
| Tool exec | `tool('read').input().execute().build()` | `toolName:"read"` → returned `0.1.0` (the correct package.json version) |

## Gates (pre-smoke)

- `npm run typecheck` → exit 0
- `npm test` → 25 files / 98 tests passed (includes the HITL `write/edit/bash` approval boundary test —
  the `.approval()` builder method preserves the human-gate on mutating tools)
- `npm run lint` → clean

## Conclusion

The builder-only authoring path works end-to-end on the real anchor app against published bits — the
agent streams a real model and executes a `tool()`-built tool, with the HITL boundary preserved. This
is direct evidence for M31 DoD bullet "npm-strict dev smoke still functional (web + /api/health +
agent stream + TUI)". (TUI live-run was validated on the same app in a prior session; the migrated
tools are the same `read` path the TUI drives over HTTP.)
