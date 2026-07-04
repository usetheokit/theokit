# ADR 0036 — Canonical agent wire protocol: keep UIMessageStream, reject AG-UI

**Status:** Accepted
**Date:** 2026-07-04
**Cycle:** ai-first-canonical-protocol (M1 — all part types + AG-UI ADR)
**Context source:** blueprint `ai-first-canonical-protocol` ADR-2; plan `ai-first-canonical-protocol-plan.md` D2

## Context

M0 shipped `translateToUIMessageStream` — a pure mapping from theokit's
`AgentStreamEvent` bridge stream to Vercel ai-sdk's **`UIMessageStream`** protocol
(text-only). M1 widens that mapping to tool and reasoning chunks so
`@ai-sdk/react`'s `useChat` renders a tool-call card and reasoning with no custom
adapter.

Before widening the wire, the initiative must record **which protocol is
canonical** for a theokit agent surface. Two candidates:

- **`UIMessageStream`** (ai-sdk-native) — the protocol M0 already emits, pinned to
  `ai@^7.0.14`. The producer (`translateToUIMessageStream`) and the consumer
  (`readUIMessageStream` / `parseJsonEventStream`, the same code `useChat` runs)
  come from the same pinned major → **zero protocol skew**. It is the exact wire
  the ROADMAP wedge ("AI-first, like ai-sdk") targets.
- **AG-UI** (`@ag-ui/*`) — a protocol-agnostic, cross-vendor agent-UI event
  protocol (SSE/event-based). Attractive for non-ai-sdk client interop, but
  currently **pre-1.0** (`@ag-ui/client 0.0.57`) and pulls extra runtime deps
  (`@ag-ui/encoder` + `rxjs`).

## Decision

**Keep `UIMessageStream` as theokit's canonical agent wire protocol. Do NOT add an
`@ag-ui/*` surface.**

M1's translator emits ai-sdk `UIMessageChunk`s (text + reasoning + tool) validated
against ai-sdk's own `uiMessageChunkSchema`. No second wire format is introduced.

## Rationale

1. **Zero skew.** M0 already ships `UIMessageStream` with the exact pinned producer
   (`ai@^7.0.14`); producer and consumer share the same major, so a version bump
   fails loudly in the integration test rather than silently drifting.
2. **Wedge alignment.** The ROADMAP positioning is "the app your agent lives in,
   AI-first like ai-sdk". `UIMessageStream` IS that wire; adopting a second,
   protocol-agnostic wire dilutes the wedge for zero current demand.
3. **Maturity + cost.** AG-UI is pre-1.0 (`@ag-ui/client 0.0.57`) and adds
   `@ag-ui/encoder` + `rxjs` to the dependency tree — new maintenance surface with
   no shipped TheoKit app requiring cross-vendor client interop (G13 — feature-creep
   prevention).

## Alternatives considered

- **Adopt AG-UI as the canonical protocol (replace `UIMessageStream`)** — REJECTED.
  Pre-1.0 (breaking-change risk), pulls `rxjs`, and its cross-vendor value is not
  needed by any shipped TheoKit app. Replacing the ai-sdk-native wire would also
  discard the zero-skew property M0 established.
- **Ship both wires (UIMessageStream + an AG-UI adapter)** — REJECTED. Two wire
  formats double the protocol maintenance surface (mapping, tests, version pins)
  for zero current demand (G11/G13). One canonical wire is the KISS choice.

## Consequences

- theokit's agent surface stays ai-sdk-native: `useChat` consumes theokit agents
  directly, no bespoke client adapter.
- The M1 unit + integration oracle is ai-sdk's `uiMessageChunkSchema` (ai@7); the
  deterministic E2E drives the real ai-sdk consumer, so any future `ai` bump that
  changes the wire fails the suite loudly (`ui-message-stream-e2e.test.ts`).
- No new runtime dependency is added (`rxjs` / `@ag-ui/*` stay out of the tree).
- `assistant-ui` is likewise NOT adopted as a test dependency — it pins `ai@^6`
  (a different major) and serves only as a visual render bar.

## Re-evaluation trigger

Revisit ONLY when **both** hold: (a) a shipped TheoKit app needs non-ai-sdk client
interop (a concrete cross-vendor consumer, not a hypothetical), AND (b) `@ag-ui/*`
reaches ≥ 1.0 with a public maintenance plan. If both hold, ship AG-UI as an
**opt-in adapter** alongside `UIMessageStream` — never as a replacement of the
canonical ai-sdk-native wire.
