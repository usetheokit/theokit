# OC-60 browser verification

Browser control is opt-in with `THEOCLAW_BROWSER=on`; install Chromium with
`pnpm --filter theoclaw browser:install` first. Each agent receives an isolated,
headless Playwright MCP browser through the browser proxy.

Offline regression checks:

```sh
pnpm --filter theoclaw test -- tests/browser-settings.test.ts tests/browser-server.test.ts tests/browser-proxy.test.ts
```

The real-model acceptance check is `tests/live/browser.live.test.ts`. Run it with
`THEOCLAW_LIVE=1`, `THEOCLAW_MODEL` and `THEOKIT_API_KEY` (or
`OPENROUTER_API_KEY`) configured. It serves a local JavaScript-rendered token,
requires a browser navigation call, and asserts the model reports that token.
The test prints the model name, tool calls and answer for review.

The existing ledger marks OC-60 shipped on 2026-10-31 but does not name the
model. This change does not independently substantiate that historical claim:
no real-model check was run here. Attach a passing run and its exact model name
to the ledger before treating the amended acceptance condition as verified.
OC-62 is handled separately by B-676.
