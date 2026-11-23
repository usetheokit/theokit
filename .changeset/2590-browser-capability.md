---
'@theokit/host': minor
---

`@theokit/host/browser` adds `browserMcpServer` (a Playwright MCP browser behind a filtering proxy: `browser_run_code_unsafe` is always denied, `deny` adds more tools, files stay in `outputDir`) and `createSharedBrowser` (one persistent Chromium shared across sessions).
