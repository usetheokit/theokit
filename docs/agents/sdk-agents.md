# Vendor agent wrappers (M28)

**Status:** M28 (ADR-0041). Expose a third-party agent SDK (Claude Agent SDK, OpenAI Agents SDK,
Cursor) behind a uniform `CustomTool`, so a TheoKit agent can delegate to it — mirroring the
[ACP pattern](./acp.md). The vendor **runtime stays theirs**; TheoKit only wires.

## `createVendorAgentTool`

The vendor `client` is **injected** (the real vendor SDK client in prod, a fake in tests), so no
vendor dependency enters TheoKit core — vendor-specific client packages belong under
`@theokit/agent-*`.

```ts
import { createVendorAgentTool } from 'theokit/server'

const claude = createVendorAgentTool({
  vendor: 'claude',
  client: myClaudeAgentClient, // { query(prompt, { resumeSessionId? }) => { text, sessionId } }
  onSession: (id) => saveSession(id), // side-channel — kept out of the model's view
})
// Pass `claude` to an agent like any other tool. `theokit@0.17.0`.
```

## Resume

Each turn delegates to `client.query(prompt, { resumeSessionId? })`. The vendor's session id is
surfaced through the `onSession` side-channel so the app can resume a prior conversation without
leaking session bookkeeping into the model's view of the result.

## Boundary

`createVendorAgentTool` calls no LLM of its own and runs no loop (G2 / `sdk-runtime.md`) — it
delegates each prompt to the vendor's `query`. It is the vendor-SDK analogue of `createACPTool`
(coding agents over stdio). Fails fast if `vendor` is empty or the client lacks `query()`.

---

## Related

- [ACP](./acp.md) — coding agents (Claude Code, Amp, Codex) over stdio
- [Multi-agent](./multi-agent.md) — sub-agents, delegation, background + scoring
- [Feature backlog](./feature-backlog.md) — parity tracker (M28)
