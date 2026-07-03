---
generated_by: roadmap-init
generated_on: 2026-07-03
slug: theokit-ai-first
peer_count_cloned: 7
peer_count_skipped: 0
catalog_location_note: >
  The roadmap-init template places this at knowledge-base/references/_catalog.md.
  In TheoKit, knowledge-base/references/ is a read-only zone enforced by
  hooks/boundary-check.sh (peers are study-only, never edited). This catalog —
  which is OUR curated metadata, not peer source — therefore lives one level up
  at knowledge-base/references-catalog.md. The cloned peer folders themselves
  are intact under knowledge-base/references/.
---

# References catalog

State-of-the-art peer projects gathered at project inception by `/roadmap-init`.
This file is the contract `/discover-plan` reads when investigating a peer.

> **Lifecycle:** every peer below has lifecycle `cloned` (folder present under `knowledge-base/references/`) or `skipped` (rejected at license gate, kept here for the record).

---

## ai-sdk (Vercel AI SDK) — PRINCIPAL PEER

- **Folder:** `knowledge-base/references/ai-sdk/`
- **Lifecycle:** cloned
- **Repo:** https://github.com/vercel/ai
- **License:** `Apache-2.0`
- **License-gate decision:** auto-approved-permissive (GitHub returned `NOASSERTION`; LICENSE header confirmed Apache-2.0)
- **Last release / last commit:** 2026-07-03
- **Stars / forks at clone time:** 25326 / 4704

### Why this peer is here

The peer this entire initiative aligns to. Defines the `UIMessageStream` / `message.parts` wire protocol (Eixo A), the route-handler + `useChat` zero-config wiring pattern (Eixo B), and ships `@ai-sdk/tui` for the terminal harness (Eixo D). The grill locked "adopt the ai-sdk protocol instead of maintaining a proprietary one" (constraint #5, team size).

### What to study in it

- `packages/ai/` — `streamText`, `toUIMessageStream`, `createUIMessageStreamResponse`, the UIMessageStream part types (text / tool-call / tool-result / reasoning / error / finish).
- `packages/react/` (`@ai-sdk/react`) — `useChat` and how it consumes the POST route by convention (zero-config).
- `@ai-sdk/tui` — the terminal rendering harness for Eixo D.

### Supports ROADMAP milestone(s)

- M0 — *because:* the walking skeleton emits UIMessageStream consumed by `useChat`.
- M1 — *because:* the canonical protocol we translate SDKMessage into.
- M2 — *because:* the route+useChat zero-config wiring pattern to mirror.
- M5 — *because:* `@ai-sdk/tui` is the terminal-harness reference.

### Clone command used

```bash
git clone --depth 1 --filter=blob:none https://github.com/vercel/ai knowledge-base/references/ai-sdk/
```

---

## assistant-ui

- **Folder:** `knowledge-base/references/assistant-ui/`
- **Lifecycle:** cloned
- **Repo:** https://github.com/assistant-ui/assistant-ui
- **License:** `MIT`
- **License-gate decision:** auto-approved-permissive
- **Last release / last commit:** 2026-07-03
- **Stars / forks at clone time:** 10920 / 1077

### Why this peer is here

The consumer side of the protocol we will emit — proves that a real React UI can render our stream. Shows `useChatRuntime` (AI SDK runtime), `useDataStreamRuntime`, message-parts rendering, generative UI, and inline human-in-the-loop approvals.

### What to study in it

- `useChatRuntime` / `useDataStreamRuntime` — how the runtime binds to an AI SDK stream.
- Composable primitives (`Thread`, `Message`, `Composer`, `ToolUI`) — the message-parts rendering contract.
- Inline HITL approval + generative-UI (render tool calls as React components).

### Supports ROADMAP milestone(s)

- M1 — *because:* validates the UIMessageStream we emit against a real consumer.
- M4 — *because:* informs the harness tool-card + HITL surface.

### Clone command used

```bash
git clone --depth 1 --filter=blob:none https://github.com/assistant-ui/assistant-ui knowledge-base/references/assistant-ui/
```

---

## opencode (sst/opencode)

- **Folder:** `knowledge-base/references/opencode/`
- **Lifecycle:** cloned
- **Repo:** https://github.com/sst/opencode
- **License:** `MIT`
- **License-gate decision:** auto-approved-permissive
- **Last release / last commit:** 2026-07-03
- **Stars / forks at clone time:** 181814 / 22465

### Why this peer is here

The canonical real-world terminal harness in TypeScript (Bun, event-based event system, runs over the Vercel AI SDK with 75+ providers). The reference for Eixo D and for how tool calls / reasoning are rendered in a terminal.

### What to study in it

- The event-based stream system and how tool-call / reasoning parts are rendered in the TUI.
- Tool execution loop + approval handling in a terminal context.
- How it consumes the AI SDK as the model/streaming layer without a parallel runtime — the exact posture our harness must keep.

### Supports ROADMAP milestone(s)

- M5 — *because:* canonical terminal-harness reference.
- M1 — *because:* event/stream + tool-call rendering informs the protocol translation.

### Clone command used

```bash
git clone --depth 1 --filter=blob:none https://github.com/sst/opencode knowledge-base/references/opencode/
```

---

## mastra (mastra-ai/mastra)

- **Folder:** `knowledge-base/references/mastra/`
- **Lifecycle:** cloned
- **Repo:** https://github.com/mastra-ai/mastra
- **License:** `Apache-2.0` (core) — `ee/` directories are enterprise-licensed
- **License-gate decision:** auto-approved-permissive for the core; **DO NOT copy from any `ee/` directory** (auth enterprise, separate license)
- **Last release / last commit:** 2026-07-03
- **Stars / forks at clone time:** 25755 / 2344

### Why this peer is here

Shows how a batteries-included TS framework structures the agent surface + standalone server and loop/memory over the AI SDK — informs the unified surface (Eixo B) and the harness (Eixo C). Frequently paired with the ai-sdk (SDK = model/streaming layer; Mastra = agent/workflow layer).

### What to study in it

- Agent definition + server exposure surface (how an agent becomes an endpoint).
- Memory / workflow loop patterns as an adapter over the AI SDK (not a parallel runtime).
- **Study the core only — skip `packages/*/src/**/ee/` (enterprise-licensed).**

### Supports ROADMAP milestone(s)

- M2 — *because:* agent-surface + server structuring.
- M4 — *because:* loop/memory harness patterns over the SDK.

### Clone command used

```bash
git clone --depth 1 --filter=blob:none https://github.com/mastra-ai/mastra knowledge-base/references/mastra/
```

---

## copilotkit (CopilotKit)

- **Folder:** `knowledge-base/references/copilotkit/`
- **Lifecycle:** cloned
- **Repo:** https://github.com/CopilotKit/CopilotKit
- **License:** `MIT`
- **License-gate decision:** auto-approved-permissive
- **Last release / last commit:** 2026-07-03
- **Stars / forks at clone time:** 35723 / 4422

### Why this peer is here

The counterpoint protocol — AG-UI (Agent–User Interaction), an event standard between agents and UIs adopted by Google, LangChain, AWS, Microsoft, Mastra. Studying it lets us choose `UIMessageStream` vs AG-UI **consciously** (M1 protocol ADR) rather than by default, and informs generative UI + HITL.

### What to study in it

- The AG-UI event protocol (`@copilotkit/runtime`) vs the ai-sdk UIMessageStream — the design tradeoffs.
- `@copilotkit/react-core` hooks + generative UI (agent renders React components in chat).
- Human-in-the-loop action-render pattern.

### Supports ROADMAP milestone(s)

- M1 — *because:* the protocol counterpoint the M1 ADR must weigh.
- M4 — *because:* generative UI + HITL patterns for the harness.

### Clone command used

```bash
git clone --depth 1 --filter=blob:none https://github.com/CopilotKit/CopilotKit knowledge-base/references/copilotkit/
```

---

## cloudflare-agents-starter (cloudflare/agents-starter)

- **Folder:** `knowledge-base/references/cloudflare-agents-starter/`
- **Lifecycle:** cloned
- **Repo:** https://github.com/cloudflare/agents-starter
- **License:** `MIT`
- **License-gate decision:** auto-approved-permissive
- **Last release / last commit:** 2026-06-28
- **Stars / forks at clone time:** 1286 / 261

### Why this peer is here

A compact, focused reference for the three tool patterns (server-side auto-execute, client-side, and **human-in-the-loop approval**) plus WebSocket persistence and a streaming reasoning display — the core of Eixo C's harness surface.

### What to study in it

- The three tool patterns, especially the HITL-approval flow (pause → approve → resume).
- WS message persistence + automatic reconnection (statefull session for resume).
- Reasoning-as-it-streams display.

### Supports ROADMAP milestone(s)

- M4 — *because:* HITL-approval + tool patterns are the harness core.
- M2 — *because:* statefull session/persistence informs the agent-route surface.

### Clone command used

```bash
git clone --depth 1 --filter=blob:none https://github.com/cloudflare/agents-starter knowledge-base/references/cloudflare-agents-starter/
```

---

## openai-agents-js (openai/openai-agents-js)

- **Folder:** `knowledge-base/references/openai-agents-js/`
- **Lifecycle:** cloned
- **Repo:** https://github.com/openai/openai-agents-js
- **License:** `MIT`
- **License-gate decision:** auto-approved-permissive
- **Last release / last commit:** 2026-07-02
- **Stars / forks at clone time:** 3320 / 835

### Why this peer is here

A clean reference for harness design over a provider: agents, sessions (conversation history), human-in-the-loop, handoffs, guardrails, and tracing. Informs the M4 harness surface (note the intentional overlap with `@theokit/sdk` — study for surface/ergonomics, not to duplicate the runtime).

### What to study in it

- Session (conversation-history) + human-in-the-loop mechanisms.
- Guardrails + tracing as harness cross-cutting concerns.
- The adapter posture: how a harness wraps a provider without becoming the runtime.

### Supports ROADMAP milestone(s)

- M4 — *because:* sessions / HITL / guardrails design for the harness.

### Clone command used

```bash
git clone --depth 1 --filter=blob:none https://github.com/openai/openai-agents-js knowledge-base/references/openai-agents-js/
```

---

## Skipped peers (license gate)

> Peers identified during SOTA discovery but rejected at the license gate.
> Listed here so the decision is auditable and not repeated next time.

| Peer | Repo | License | Reason for skip |
|---|---|---|---|
| (none) | — | — | All 7 curated peers passed the license gate (Apache-2.0 / MIT); none skipped. |

Candidates considered but not curated (kept out to respect the ≤8 cap, not for license reasons): `agno-agi/agent-ui`, `langchain-ai/agent-chat-ui`, `voltagent/voltagent`, `openai/codex` (Rust, not TS), `mariozechner/pi` (TUI overlaps opencode). Add via `/roadmap-feature` + a fresh clone if a later milestone needs them.

---

## Cleanup protocol

- **Remove a peer:** delete its folder under `knowledge-base/references/` AND remove its entry from this catalog in the same commit.
- **Update a peer (refresh clone):** `cd knowledge-base/references/{peer}/ && git pull` — record the new commit SHA in this catalog.
- **Replace a peer with a better one:** treat as remove + add. Do NOT rename folders; symbolic continuity is meaningless when the underlying repo changed.
