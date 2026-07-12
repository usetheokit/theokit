# Code mode (`createCodeMode`) — security boundary & threat model

**Status:** M29 (ADR-0041); M40 (ADR-0049) added generated `instructions`. `createCodeMode` lets an
agent compose the available tools *in code* run inside an isolation boundary, instead of one tool call
at a time.

```ts
import { createCodeMode } from 'theokit/server'

const { tool: runCode, instructions } = createCodeMode({
  tools: [addTool, searchTool],        // the ONLY functions the code can call
  sandbox: myVettedSandbox,            // INJECTED — you supply a vetted isolation boundary
  onPermissionRequest: ({ tool, args }) => ({ granted: isAllowed(tool, args) }),
})
// pass `runCode` to the agent as a tool, and add `instructions` to its system prompt:
//   new Agent({ instructions: ['You are a helpful assistant.', instructions], tools: { run_code: runCode } })
```

> **Breaking change (M40, ADR-0049):** `createCodeMode` now returns `{ tool, instructions }` instead
> of the tool directly. Migrate `const runCode = createCodeMode(...)` →
> `const { tool: runCode, instructions } = createCodeMode(...)`, and add `instructions` to the agent's
> system prompt. `instructions` is GENERATED from your `tools` allow-list — it teaches the model that
> its code runs in a sandbox, lists the available `api.<name>(input)` calls (only your allow-list), and
> states the return contract (return one structured result; prefer `Promise.all`). It cannot drift
> from the api surface it describes, and each `createCodeMode` instance lists only its own tools
> (least-privilege scoping).

## Responsibility split (read before shipping)

| Concern | Owner |
|---|---|
| Restricted API — only declared `tools` are reachable from the code | **TheoKit** (this module) |
| Permission gate — every tool call passes `onPermissionRequest`; **no default-allow** | **TheoKit** (this module) |
| Isolation — no `fs` / `process` / `require` / network / host globals leak into the code | **The injected `sandbox`** (your responsibility) |

TheoKit **does not ship a sandbox** and adds **no sandbox dependency to core** — the same posture as
the injected deploy adapter and the M17 transport. You inject a vetted boundary.

## The `Sandbox` contract

```ts
interface Sandbox {
  run(code: string, api: CodeModeApi): Promise<unknown>
}
```

`run` executes `code` with access to **only** `api` (the permission-gated restricted tool surface)
and resolves the code's result.

**Vetted options (pick one; do NOT hand-roll):**

- **QuickJS-WASM** (`quickjs-emscripten`) — a WASM JS engine; no native ABI, strong isolation. Preferred
  for portability + the project's native-bindings discipline.
- **isolated-vm** — V8 isolates; strong, but a native binding (ABI concerns).
- **A locked-down Worker** — separate realm + a strict message API; weaker than the above.

**Never** use `node:vm` as the sandbox — it is **not** a security boundary (it shares the host realm;
`this.constructor.constructor('return process')()` escapes trivially). `createCodeMode` cannot detect
a weak sandbox; injecting one is an app-level security bug.

## Threat model

| Threat | Mitigation | Owner |
|---|---|---|
| Model authors code that calls a dangerous tool (e.g. `write_file('/etc/passwd')`) | `onPermissionRequest` denies → the API call throws `CodeModePermissionDeniedError` | TheoKit |
| Model authors code that references a host capability (`require('fs')`, `process.env`) | Not in the restricted API → the sandbox raises a ReferenceError / provides nothing | Injected sandbox |
| Model exfiltrates via a permitted tool | Scope `onPermissionRequest` per `args` (deny suspicious paths/URLs) | App policy |
| Sandbox escape (VM breakout) | Use a vetted sandbox; keep it patched | App + sandbox vendor |
| Resource exhaustion (infinite loop, memory) | The sandbox must enforce CPU/memory/time limits | Injected sandbox |

## Security gate before shipping

Per the M29 DoD (Rule: security never sacrificed): a code-mode surface MUST NOT ship until (1) the
injected sandbox is a vetted engine (not `node:vm`, not hand-rolled), (2) `onPermissionRequest`
enforces a real allow-list (no blanket `{ granted: true }` in production), and (3) the sandbox
enforces time + memory limits. TheoKit guarantees the first two are *wired*; it cannot verify your
sandbox is sound — that is the security review's job.
