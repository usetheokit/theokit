# Coding agents (ACP)

Give your agent a coding agent as a tool — let it ask Claude Code, Amp, or Codex to write a function,
run tests, or refactor a file, while you keep a human gate on every file and shell action. ACP (the
Agent Client Protocol) talks to those coding agents over stdio as newline-delimited JSON.

---

## Quickstart

```ts
import { defineAgent } from '@theokit/agents'
import { createACPTool } from 'theokit/server'

const coder = createACPTool({
  command: 'claude',
  args: ['--output-format', 'json'],
  cwd: process.cwd(),
  name: 'code_agent',
  description: 'Delegate a coding task to Claude Code.',
  onPermissionRequest: async ({ tool }) => {
    // Approve or deny each file/shell action the coding agent requests.
    return { granted: await askHuman(tool) }
  },
})

export default defineAgent({
  model: 'anthropic/claude-sonnet-4-6',
  tools: [coder],
})
```

The model calls `code_agent` with a `{ message }` (the task); the coding agent runs and its response
comes back as the tool result.

---

## Security by default

`onPermissionRequest` is **required** — there is no default-allow. Every file or shell operation the
coding agent wants to perform is routed to your handler, which returns `{ granted: boolean }`. A
coding agent with shell access is powerful; the required gate is the primary safeguard.

Wire it to [human-in-the-loop](./human-in-the-loop.md) to make each permission a human decision.

---

## How it works

Three layers, each usable on its own:

| Layer | What it is |
|---|---|
| `encodeAcpMessage` / `AcpMessageDecoder` (`@theokit/agents`) | The transport-agnostic framing — newline-delimited JSON, buffering a message split across chunks, failing fast on a corrupt frame. |
| `AcpClient` (`@theokit/agents`) | Drives a coding agent over an injected transport: correlates JSON-RPC responses by `id`, dispatches server→client requests (permission requests) to a handler. |
| `createACPTool` + `NodeAcpTransport` (`theokit`) | Spawns the coding agent as a subprocess (`child_process`, an adapter concern) and wraps `AcpClient` as a `CustomTool`. |

The subprocess spawn is the only Node-specific piece; the protocol layers are pure and testable with
an injected transport.

---

## Config

| Field | Description |
|---|---|
| `command` | Executable for the coding agent (`claude`, `amp`, `codex`). |
| `args` | Command-line arguments. |
| `cwd` | Working directory for the spawned agent. |
| `name` / `description` | Tool name + description surfaced to the model. |
| `onPermissionRequest` | **Required** — decide file/shell permission requests. Returns `{ granted }`. |

---

## Related

- [Human-in-the-loop](./human-in-the-loop.md) — the approval flow permission requests wire into
- [Using tools](./using-tools.md) — how tools are exposed to the model
- [Feature backlog](./feature-backlog.md) — parity tracker (M17)
