---
slug: agent-expose-decorator
generated_by: roadmap-feature
milestone_id: M47
date: 2026-07-14
status: completed
---

# Feature grill — `@Expose` decorator (M47)

## Q1 — What is this feature and why NOW?

**Answer (confirmed — recommended):** An `@Expose` decorator (sibling of the #122 `@Controller`/`@Get`
HTTP decorators) that binds a SEPARATELY-BUILT agent (`agents/<name>.ts`, pure `agent()…build()`) to its
exposure via a controller-style class, so a code reviewer sees in ONE read what is the AGENT (behavior)
vs the EXPOSURE (route, auth, csrf, streaming). **Surface-agnostic** — the single declared exposure feeds
the M41 unified client on all three surfaces: web (HTTP), TUI (in-process), desktop (channel). **Opt-in:**
the zero-config convention stays the default; `@Expose` is the explicit path when you want the exposure
visible + custom auth/csrf/path. It **unifies/replaces** the existing `@Agent` decorator — NOT a third
competing exposure path (the roadmap's root problem was "two competing paths").

**Why now:** dogfooding the showcase surfaced the DX pain — the agent's route/CSRF/auth live in the
scanner convention (far from `agents/chat.ts`), the frontend link is a magic string
`useAgent('/api/agents/chat')` resolved through gitignored `.theokit` codegen, and the input type is
DUPLICATED (`useAgent<{message:string}>` repeats `.input(z.object({message}))`). A reviewer cannot see
the agent↔backend↔frontend wire in one read.

## Q2 — Dependencies (must be [x] before M47 starts)?

**Answer (confirmed — recommended):** M41 (unified `AgentClient` store + `ChatTransport` — the 3-surface
base), M45 (`create-theokit --surface web|tui|desktop` scaffold), M46 (`thread` in the core store). All
`[x]`. Also builds on the #122 decorator/controller infra (`@Controller` in `@theokit/http`) — already in
the repo. Dependencies satisfied → M47 eligible immediately.

## Q3 — Definition of Done (3-5 bullets)?

**Answer (confirmed — recommended, 5 points):**
1. `@Expose` decorator binds a separately-built agent → exposure (path/auth/csrf) in a VISIBLE
   controller-style class.
2. The same declared exposure feeds `useAgent`/`createAgentClient` on all 3 surfaces (web HTTP +
   TUI in-process + desktop channel) — E2E or per-surface test.
3. Typed link with NO magic string and NO duplicated type (cmd-click frontend → `agents/x.ts`; `send`
   inferred from `.input()`).
4. Reconciled with the existing `@Agent` decorator (a grep proves 0 parallel exposure path; the SDK
   runtime G2 invariant intact — exposure/wiring only, no runtime reimplementation).
5. Showcase migrated to demonstrate it (kills the raw-string+duplicated-type anti-pattern) + ADR +
   changeset + docs.

## Q4 — Top 2 NEW risks?

**Answer (confirmed — recommended):**
- **R1 — @Agent reconciliation.** Unifying with the existing `@Agent` decorator without becoming a third
  competing path (the roadmap's root problem was "two competing paths to expose an agent"). The
  migration/deprecation must be clean, not additive.
- **R2 — Surface-agnostic exposure.** Expressing ONE exposure that serves HTTP (CSRF/auth) AND in-process
  (TUI/desktop, no CSRF, request-context via M43) without leaking HTTP assumptions into the core — the
  wrong abstraction breaks a surface.

## DX target (approved by owner 2026-07-14)

```ts
// agents/chat.ts — pure agent (unchanged)
export default agent().input(z.object({ message: z.string() })).model('openai/gpt-4o-mini').tool(weatherTool).build()

// server/agents.controller.ts — the EXPOSURE, visible in one read
@Controller('/api/agents')
export class AgentsController {
  @Expose(chatAgent, { csrf: true })   // → POST /api/agents/chat, streams UIMessageStream
  @UseGuards(requireSession)           // auth visible, not hidden in config
  chat!: typeof chatAgent
}

// frontend — typed, traceable link; SAME handle across surfaces
import { chat } from '@theo/agents'
const { thread, send } = useAgent(chat)            // web (HttpTransport)
const agent = useAgent(chat.inProcess())           // TUI (InProcessTransport)
const client = createAgentClient(chat.channel(src)) // desktop (ChannelTransport)
```

Open design questions deferred to discover/plan: property vs method binding form; path derived-from-name
vs explicit; multi-surface handle shape (`chat.inProcess()`/`chat.channel(src)` vs separate binders).
