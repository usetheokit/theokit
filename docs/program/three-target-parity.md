# Three-Target Parity (Web · Tauri · TUI)

Source of Truth for the constraint that the framework serves three execution targets, not one. Declared by the project owner on 2026-08-19. It is **transversal**: it changes the Definition of Done of every surface milestone rather than adding a milestone of its own.

## The rule

**The core is target-agnostic. Presentation is a per-target adapter.**

A capability belongs to the core when a Tauri app and a terminal client need it as much as a browser does: routing, agents and tools, human-in-the-loop, actions, middleware, auth, cache, observability, error contracts. Core code may not assume a DOM, a `window`, an HTTP hop, or a Node-only API.

A capability belongs to presentation when it exists to render for one target: the HTML document and its `<head>`, hydration, images and fonts, crawler metadata, scroll and focus. These are Web-specific by nature, and saying so is not a concession — it is the boundary working.

## What "100% compatible" means, precisely

It does **not** mean every surface exists on every target. A TUI has no `<head>` to hoist and no layout to shift; demanding metadata parity there would be theatre.

It means three things, and each is testable:

1. **No core capability is reachable from only one target.** If an agent can be invoked, a tool approved, a session authenticated or a run observed from the Web, the same is reachable from Tauri and from a terminal — through the in-process path, not by re-implementing the feature.
2. **One contract, three transports.** The wire shape of a run, an action and an error is the same object regardless of whether it travelled over HTTP, over Tauri IPC, or over an in-process call. A target-specific field in a core contract is a defect.
3. **A target that cannot serve a capability refuses by name.** Silent degradation is the failure mode this rule exists to prevent — the same discipline the route scanner already applies when it rejects `[[...slug]]` with a named error instead of mis-parsing it.

## Consequence for every milestone DoD

Each of the 16 surface milestones MUST declare, in its Definition of done, which of the three it applies to and what the other two do instead:

```
- Applies to: Web, Tauri, TUI
- Tauri: <how it is reached — IPC, in-process, or the same HTTP path>
- TUI: <how it is reached, or an explicit "not applicable — <reason>">
```

`not applicable` is a legitimate and complete answer when the reason is intrinsic (a terminal has no viewport). It is not legitimate when the reason is that nobody wired it.

## Anti-patterns

- **Declaring a target supported because a package exists for it.** `@theokit/tauri` shipping is not evidence that a Tauri app can approve a HITL call. The evidence is an exercised path.
- **Forking the core per target.** A second implementation of the agent loop for the terminal is how the three targets drift into three products.
- **Leaking presentation into the core.** A React import in a code path a TUI must execute is the concrete form this takes.
- **Treating the in-process path as a test-only convenience.** For Tauri and TUI it is the production path.
- **Silent degradation on an unsupported target.** Refuse by name, per rule 3.

## Cross-references

- Presentation adapters that already prove the split: `packages/presenter/src/presenters/` (json, terminal, ui-message-stream)
- The non-HTTP path the rule depends on: `packages/agents/src/in-process-turn.ts`, `packages/theo/src/server/http/in-process-caller.ts`
- Desktop glue: `packages/tauri/src/`
- Milestone contract this constrains: `ROADMAP.md`
- Gate that reads the DoD bullets: `rules/cycle-acceptance.md`
- Boundary discipline this inherits: `rules/architecture.md`

## Current state

Measured 2026-08-19 against the working tree, every claim read from source.

**Web is the complete target. Tauri and TUI are real but partial** — both reach the *agent* slice of the framework (in-process runtime, client, presenter, all genuinely target-agnostic) and do not reach actions, middleware, auth, or SSR. The agent core is already multi-target; the web-framework core is not.

Already agnostic, and the model for the rest:

- `packages/presenter` in full — zero `node:`, zero DOM, three presenters over one canonical `AgentOutputEvent`.
- `packages/agents/src/client/**` and `theokit/client/core` — React-free, verified transitively. `ChannelTransport` / `InProcessTransport` / `HttpTransport` already cover IPC, in-process and HTTP behind one consumer API.
- `@theokit/tauri` — 90 lines that *inject* the Tauri primitives rather than depend on them. A bridge, correctly, not a wrapper.
- `packages/theo/src/cache` — no measured coupling.

Blocking three-target parity:

| Blocker | Breaks | Evidence |
|---|---|---|
| Generated action client calls `fetch` directly with `credentials: 'same-origin'` | TUI, Tauri | `vite-plugin/actions-virtual-module.ts:224` |
| Session typed on `IncomingMessage`/`ServerResponse` + `Set-Cookie` | TUI, Tauri IPC | `server/auth/session.ts:1,49,141` |
| Both middleware runners bound to a transport (`node:http` / `Request`) | TUI, Tauri IPC | `middleware-runner.ts:6-7`, `web-middleware-runner.ts:19` |
| Router entry emits `window` / `document` | TUI | `router/entry.ts:79,125` |
| React-free gate does not walk `@theokit/presenter` | TUI/Node | `tests/unit/create-agent-client.test.ts:197-199` |
| Surface tests assert scaffolded files, never a build or a run | TUI, Tauri | `create-theokit/tests/integration/surface-matrix.test.ts:77-83` |

### The authorization seam, stated precisely

`callProcedure` runs no middleware and no auth. This is **deliberate and documented** (`server/http/in-process-caller.ts:5-6,69`), on tRPC's precedent, and input validation *is* shared with the HTTP path, so there is no validation drift.

The consequence is nonetheless real: authorization has no shared home off-web, so every non-HTTP surface invents its own — and the framework offers no `requireOwner`-style primitive to invent it with. Combined, that means a TUI or Tauri surface reaching a route reaches it without the access rules the same route enforces over HTTP.

That is a design gap to resolve with an ADR — not a bug to file. The question the ADR must answer: does authorization live in a transport-independent context contract that both paths execute, or does each surface remain responsible with a primitive the framework provides? Deciding it is Onda 1 work, because every other target-parity item depends on the answer.

**Not measured:** whether the scaffolded TUI and desktop apps actually build and run. That requires `@theokit/tui` and `@theokit/ui`, which live outside this repository. Until it is, both targets are correct in code and unproven in CI — which is exactly what the north-star app exists to settle (`rules/northstar-app.md`).
