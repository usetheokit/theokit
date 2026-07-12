---
slug: ui-across-surfaces
created_at: 2026-07-12
kind: strategic-cross-repo
goal: Unify the PRESENTATION layer across web/terminal/desktop on the EXISTING component libraries (@theokit/ui, @theokit/tui), all fed by the ONE M41-M45 unified client — so the M45 scaffolds render with real components instead of hand-rolled placeholders. Decide the theokit-tauri question.
---

# UI across surfaces — plan (web · terminal · desktop)

## The one-paragraph thesis

M41-M45 unified the **transport/data** layer: one `useAgent`/`createAgentClient` delivers `UIMessage[]`
+ a `UIMessageChunk` stream on every surface. The **presentation** layer is NOT unified — it is fragmented
across three data contracts and, worse, the M45 scaffolds hand-roll it. The fix is NOT to invent new
packages: `@theokit/ui` (React, web + Tauri webview) and `@theokit/tui` (Ink, terminal) already exist and
are published. The work is to (a) feed BOTH from the one unified client (one adapter closes a data-contract
gap), and (b) make the `create-theokit --surface` templates consume the real libraries. `theokit-tauri`
should NOT be created — the desktop is `@theokit/ui` in the webview + a tiny transport helper.

## Baseline — what exists today (verified 2026-07-12)

| Layer | Web | Terminal (TUI) | Desktop (Tauri) |
|---|---|---|---|
| **Transport (M41-45, done)** | `useAgent('/path')` → `UIMessage[]` | `useAgent(InProcessTransport)` | `createAgentClient(ChannelTransport)` |
| **UI library (exists)** | **`@theokit/ui` v1.0.0** (React DOM) | **`@theokit/tui` v0.29.0** (Ink) | *(none — webview is a browser)* |
| **UI data contract** | `UIMessage` (ai SDK) ✅ matches client | `AgentStreamEvent` / `ChatThreadMessage` ❌ SDK-shaped | — |
| **M45 template renders with** | `@theokit/ui` (the default web template) ✅ | hand-rolled Ink `Box`/`Text` ❌ | hand-rolled vanilla JS/DOM ❌ |
| **Reference app (`theo-code-v2`)** | uses `@theokit/ui` ✅ | hand-rolls Ink ❌ | hand-rolls vanilla JS ❌ |

Key facts (Explore-verified):
- `@theokit/ui`'s `ChatMessage` takes `message: UIMessage` — the SAME shape `useAgent().messages` yields.
  It is hard DOM-coupled (`<div>`, Tailwind, injects `<style>` into `document.head`) so it CANNOT run in
  Ink — but it runs UNCHANGED in a Tauri webview (webkit2gtk = a real browser; its `typeof document` guards
  are satisfied).
- `@theokit/tui`'s `ChatThread` takes `ChatThreadMessage[]` (`{id, role, content, markdown?}`) and its
  `useAgentStream` takes `AsyncIterable<AgentStreamEvent>` — its own SDK-shaped event union, NOT the ai
  `UIMessage`/`UIMessageChunk` the unified client emits. It ships 40+ Ink components + a custom renderer +
  a dark/light/no-color theme; 450+ tests; production-ready pre-1.0.
- `theokit-tauri` does not exist. The Rust/Tauri boilerplate lives in `create-theokit`'s `--surface desktop`
  template (M45) — example-grade, per ADR-0045 (Tauri specifics stay out of core packages).

## The GOLD architecture (what we're steering toward)

```
                         one agent (agents/*.ts)
                                  │
     ONE unified client (M41-M45):  UIMessage[]  +  UIMessageChunk stream
                                  │
        ┌─────────────────────────┼─────────────────────────┐
      Web                     Terminal                    Desktop
   @theokit/ui  ✅          @theokit/tui  (Ink)         @theokit/ui  (React in the
   (React DOM)              via a UIMessage adapter     Tauri webview — a browser)
      │ UIMessage✓             │ needs 1 adapter            │ UIMessage✓
   already aligned          (the only real gap)          reuse — no new lib
```

Two axes, cleanly separated: **transport is unified (done)**; **presentation = the native renderer's
component lib per surface, all fed by the same `UIMessage` stream.** The only misalignment is
`@theokit/tui`'s data contract — closed by ONE small adapter.

## Decisions (recommended — the plan's spine)

### D1 — Each surface uses its NATIVE renderer's component library; no new UI library is created.
- Web → `@theokit/ui` (React DOM). Already the case.
- Terminal → `@theokit/tui` (Ink). Exists; wire it in.
- Desktop → `@theokit/ui` (React DOM in the Tauri webview — the webview IS a browser). Reuse, do not
  reinvent. Parsimony rung 4 (reuse installed/published dep).

### D2 — `theokit-tauri` IS created as a package (owner decision 2026-07-12, overriding the parsimony default).
Shipped as **`@theokit/tauri`** — a package in the **theokit monorepo** (`packages/tauri/`), NOT a separate
repo. Rationale for monorepo-package over separate-repo: it is tightly coupled to `ChannelTransport`
(`packages/theo/src/client/`), so same-monorepo avoids a cross-repo version dance and reuses the changesets
release train; it is OPT-IN (an app installs `@theokit/tauri` explicitly; `packages/theo` never imports it),
so ADR-0045 ("core stays Tauri-agnostic") holds — the `@tauri-apps` optional peer lives in `@theokit/tauri`,
never in `theokit`. **What `@theokit/tauri` owns:** the desktop transport glue — `createTauriChannelSource()`
(D4), a `createTauriAgentClient()` convenience (`createAgentClient(new ChannelTransport({ source }))`), the
sidecar JSONL contract types, and (as demand appears) desktop-native helpers (window/menu/tray) that are
neither UI-component (that's `@theokit/ui`) nor runtime (that's the SDK). The Rust/Tauri scaffold stays in
`create-theokit --surface desktop`; `@theokit/tauri` is the runtime glue the scaffolded app installs.

### D3 — Close the `@theokit/tui` ⇄ unified-client data-contract gap with ONE adapter (the only new primitive).
`@theokit/tui` speaks `AgentStreamEvent`/`ChatThreadMessage`; the unified client speaks
`UIMessage`/`UIMessageChunk`. Ship a small adapter so the ONE client feeds `@theokit/tui`:
- `uiMessagesToChatThread(messages: UIMessage[]): ChatThreadMessage[]` — text projection for `<ChatThread>`.
- `uiMessagesToAgentEvents(messages: UIMessage[]): AgentEvent[]` — richer projection (text + tool-invocation
  parts → `AgentToolEvent`) for `<AgentTimeline>`.
Home: a `@theokit/tui/ai-sdk` subpath in the **theokit-tui repo** (it owns its event shape; the adapter is
its concern, and keeps `ai` an optional dep there). Smallest correct scope; NOT a native rewrite of
`@theokit/tui`'s components to `UIMessage` (that is a larger, separate, demand-gated decision).

### D4 — `createTauriChannelSource()` ships in `@theokit/tauri` (per D2), the desktop transport glue.
The Tauri `Channel`/`invoke` → `ChannelPushSource` wiring (M45 hand-rolled it in the template) becomes a
one-call helper: `new ChannelTransport({ source: createTauriChannelSource({ invoke, Channel }) })`. Keeps
the webview app tiny AND keeps `@tauri-apps/api` an OPTIONAL peer of `@theokit/tauri` (injected, never a
hard dep of `theokit` core — same posture as the M42 injected source). ~15 lines + a test.

### D5 — Upgrade the `create-theokit --surface` templates to consume the real libraries.
Replace the M45 hand-rolled placeholders (which were the minimum to prove the transport wiring) with the
real component libs, so a scaffolded app looks/feels like the product from line one.

## Sequenced work (milestones)

Ordered so each step is independently shippable and testable; each is a full CYCLE (discover→plan→
implement→review→release).

### Step A — theokit-tui repo: the `@theokit/tui/ai-sdk` adapter
- Ship `uiMessagesToChatThread` + `uiMessagesToAgentEvents` under a new `@theokit/tui/ai-sdk` subpath.
- `ai` becomes an OPTIONAL peer of theokit-tui (types only; the adapter maps shapes).
- TDD: a `UIMessage[]` with text + a tool-invocation part → the expected `ChatThreadMessage[]` /
  `AgentEvent[]`; malformed/empty parts handled.
- Release: `@theokit/tui` minor.

### Step B — theokit repo: `createTauriChannelSource()` in `theokit/client` (D4)
- Add the helper + its type (structural `{ invoke, Channel }` injected — no `@tauri-apps` core dep).
- TDD: a fake `{ invoke, Channel }` → the source's `start` bridges JSONL lines to `onLine`, `settle` invokes.
- Release: `theokit` minor.

### Step C — M46 (create-theokit): `--surface tui` renders with `@theokit/tui`
- Template `tui/App.tsx`: `const { messages } = useAgent(transport)` → `uiMessagesToAgentEvents(messages)` →
  `<TheoTUIProvider><AgentTimeline events={...}/></TheoTUIProvider>` + `<ChatComposer>`-style input.
- Deps: add `@theokit/tui` (+ its optional peers as needed); drop the hand-rolled Box/Text.
- Reconcile with the M45 tui template (this REPLACES the placeholder).
- Test: scaffold `--surface tui` → assert `@theokit/tui` import + adapter usage + deps; the generated TS
  type-checks against the published libs (the M45-1.1.1 install-validation lesson: verify peers resolve).
- Release: `create-theokit` minor.

### Step D — M47 (create-theokit): `--surface desktop` webview renders with `@theokit/ui` (React)
- Replace the vanilla-JS `frontend/` with a small React app: `main.tsx` mounts a component using
  `useAgent(new ChannelTransport({ source: createTauriChannelSource(invoke, Channel) }))` (D4) and renders
  `<ThemeProvider><ChatThread>{messages.map(m => <ChatMessage message={m}/>)}</ChatThread><ChatComposer/>`.
- Deps: `@theokit/ui`, `react`, `react-dom`, `@theokit/ui`'s peers; keep the Vite build (M45 added it).
- The Rust sidecar/shell (M45) is unchanged — only the webview tier upgrades.
- Test: scaffold `--surface desktop` → assert the React webview + `@theokit/ui` + `useAgent(channelTransport)`
  wiring; TS type-checks.
- Release: `create-theokit` minor.

### Step E (optional) — align the `theo-code-v2` reference apps
Migrate the reference tui/desktop apps to the same real-lib path (they currently hand-roll). NOT required
for the plan's value (the scaffolder is the product surface); do it only if the reference apps are used as
living docs.

## Drawbacks & risks

1. **Data-contract adapter drift.** `@theokit/tui`'s `AgentStreamEvent` and the ai `UIMessage` shapes evolve
   independently. Mitigation: the adapter (Step A) has a compile-time assignability test (mirrors
   theokit-tui's existing `sdk-assignability.test.ts` tripwire) so a shape drift fails typecheck.
2. **Tool-call fidelity in the TUI.** Projecting `UIMessage` tool-invocation parts → `@theokit/tui`'s
   `AgentToolEvent` may lose nuance (streaming tool input deltas). Mitigation: Step A ships the text
   projection first (MVP), tool projection second; document what maps.
3. **@theokit/ui in the webview = a heavier bundle.** React + @theokit/ui + Tailwind in the Tauri webview is
   bigger than the vanilla JS. Mitigation: it is a desktop app (bundle size is not a cold-start cost);
   Vite tree-shakes; the richer UX is the point.
4. **Cross-repo coordination.** Steps A (theokit-tui), B/C/D (theokit + create-theokit) span two repos with
   independent release trains. Mitigation: Step A + B are independent and ship first; C depends on A, D
   depends on B — a clean DAG, no circular coupling.
5. **@theokit/tui optional peers** (`figlet`, `lowlight`) + `react-reconciler` may complicate the scaffolded
   tui app's install (the M45-1.1.1 react-router/ai lesson). Mitigation: Step C's test does the real
   peer-resolution check before release.

## Unresolved questions

- **Q1 — Native `UIMessage` components in `@theokit/tui`?** Instead of an adapter, `@theokit/tui` could gain
  `<UIMessageThread messages={UIMessage[]}>` for true API parity with `@theokit/ui`. Larger scope, owned by
  the theokit-tui repo. Resolution: start with the adapter (D3); revisit native components if the adapter
  proves lossy or if API parity becomes a stated goal. Not blocking.
- **Q2 — Desktop client: `useAgent` (React) vs `createAgentClient` (no-React)?** M45's webview used the
  no-React `createAgentClient`. If the webview becomes React + @theokit/ui (D5/Step D), it uses
  `useAgent(channelTransport)` instead — richer. `createAgentClient` remains for pure node scripts/CLIs
  (M44's real audience). Resolution: React webview uses `useAgent`; no conflict.

## Out of scope (explicitly)

- Creating `theokit-tauri` as a package (D2 — reopen only with 3+ apps needing desktop-native non-UI/non-
  transport primitives + an ADR).
- Rewriting `@theokit/tui` to be `UIMessage`-native (Q1 — adapter first).
- A shared cross-renderer component core (one library that renders to BOTH DOM and Ink). @theokit/ui is hard
  DOM-coupled by design (Tailwind/Radix); a renderer-agnostic core is a large rewrite with no current demand
  — the two-library + one-adapter model is the parsimonious answer.
- Mobile (React Native) surface — no current demand.

## Why this is the parsimonious answer

- **Reuses** two published, tested libraries (`@theokit/ui`, `@theokit/tui`) instead of building new ones
  (rung 4).
- **One** new primitive (the `@theokit/tui/ai-sdk` adapter) + **one** tiny helper (`createTauriChannelSource`)
  — everything else is wiring the scaffolder to consume what exists.
- **No new package** (`theokit-tauri` rejected with a named re-open trigger) — respects G13/ADR-0045/ADR-0023.
- Each surface renders with the component library its renderer demands, all fed by the ONE unified client —
  the honest completion of "write the agent once, render it identically everywhere."
