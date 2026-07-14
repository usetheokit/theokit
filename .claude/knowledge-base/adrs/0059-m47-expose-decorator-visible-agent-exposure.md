# ADR 0059 — M47: `@Expose` decorator + typed agent handle (visible, surface-agnostic exposure)

**Status:** Accepted (2026-07-14) — design GATE for M47 (accepted at plan time, implemented under the cycle).
**Extends:** #122 (`@Controller`/`@Get` decorator infra in `@theokit/http`), ADR-0050 (M41 unified client),
ADR-0053 (M44 React-free `theokit/client/core`), ADR-0054 (M45 surfaces), ADR-0058 (M46 thread).

## Context

Dogfooding the showcase (M46 wrap-up) surfaced a DX gap: HOW an agent is exposed is invisible to a code
reviewer. `agents/chat.ts` (the pure agent) tells you nothing about the route, CSRF, or auth — those live
in the scanner convention. The frontend link is a magic string `useAgent('/api/agents/chat')` resolved
through gitignored `.theokit` codegen, and the input type is DUPLICATED (`useAgent<{message}>` repeats the
agent's `.input(z.object({message}))`). A reviewer cannot see the agent↔backend↔frontend wire in one read.
The blueprint (`agent-expose-decorator-blueprint.md`, SHIPPABLE 99.7) studied tRPC/Hono (type-only handle,
no magic string), ai-sdk (the magic-string anti-pattern), Fastify (`decorate` scope-binding), and TheoKit's
own #122 + `mountAgent` seams.

## Decision

**D1 (ADR-M47-1) — `@Expose` is a NEW authoring surface over the EXISTING `mountAgent` runtime, not a third
runtime.** `@Expose(agent, opts?)` is an opt-in controller PROPERTY decorator (the zero-config `agents/*.ts`
convention stays the default) that stores `{agent, opts, propertyKey}` under an `EXPOSE_AGENT` metadata key
(the same `Symbol.for()` seam as `@Post`). `walkControllerMetadata` emits an agent-serving `WalkResult`
(verb POST, path = prefix + opts.path??member, `agent` set) per binding. `createDecoratorHandler` (http)
gets an injected `serveAgent` callback and, after running guards (G5), delegates the agent route to it
instead of a JSON method — http stays agent-runtime agnostic (G1/G2). theo wires
`serveAgent = mountAgent(agent, req, resolveProvider().apiKey, 'expose', 'off')` (CSRF enforced once at the
controller boundary). **Rejected:** a parallel agent handler inside `@theokit/http` — it would duplicate
`mountAgent` (G2 breach) and recreate the "two paths" problem.

**D2 (ADR-M47-2) — The typed handle is a client-safe value (`{ path }`) + phantom types, NOT full codegen
of the client.** Types flow via `import type` + generics (tRPC/Hono — no type-codegen); the codegen emits
only a named handle const (`export const chat: AgentHandle<InferAgentInput<_agent_chat>, …>`) whose runtime
value is `agentHandle('/api/agents/chat')`. `useAgent(chat)` binds by the handle's path — NO magic string
(the path is generated from the exposure) and NO duplicated input type (inferred from the phantom generic);
cmd-click on the generated `chat` hops to `agents/chat.ts` via the type-only import. The handle stays
serializable (JSON drops its binder methods). **Rejected:** a hand-written client per agent (duplication);
a full client codegen (tRPC/Hono prove pure inference suffices for the type).

**D3 (ADR-M47-3) — `@Agent` reconciled: 3 authoring surfaces, ONE runtime.** `@Agent` (a class IS the
agent), `@Expose` (binds a separately-built agent), and the file convention all converge on `mountAgent`.
A grep gate proves `@theokit/http` (where `@Expose` lives) ships NO agent streamer — so M47 adds an
authoring surface, not a parallel runtime. They do not "compete" the way the removed `defineAgentEndpoint`
path once did. **Rejected:** keeping a second independent agent runtime (the roadmap root problem).

**D4 — Surface-agnostic via the HANDLE, not the decorator.** `@Expose` declares the HTTP exposure
(route/CSRF/guards — a web concern). The single handle drives all 3 surfaces: web `useAgent(chat)`
(HttpTransport to `chat.path`), TUI `useAgent(chat.inProcess(run))` (InProcessTransport), desktop
`createAgentClient(chat.channel(source))` (ChannelTransport). HTTP assumptions never leak into the core;
in-process binders reuse the M41 transports + request-context (M43).

## Consequences

- Reading one controller (`@Controller('/api/agents') { @Expose(chatAgent,{csrf}) @UseGuards(...) chat }`)
  shows a reviewer the agent, its route, its CSRF, and its auth — the wire is visible.
- The frontend binds `useAgent(chat)` — no magic string, no duplicated type, cmd-click traces to the agent.
- The zero-config convention is unchanged (opt-in). `@UseGuards` widened to a `PropertyDecorator` so
  per-agent auth attaches to an `@Expose` property (back-compat — strictly permissive).
- `@theokit/http` DTS budget bumped 52→55KB for the deliberate `@Expose` surface.

## Alternatives rejected (summary)

- Parallel agent handler in http (D1) — G2 breach.
- Full client codegen / per-agent hand-written client (D2) — inference suffices.
- `@Agent` kept as an independent runtime (D3) — reintroduces "two competing paths".
- Binders as free functions instead of handle methods (D4) — methods keep the DX (`chat.inProcess(run)`)
  while JSON.stringify still yields the serializable `{ path }` core.
