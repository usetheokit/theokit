---
"@theokit/agents": minor
"theokit": minor
---

Ship an agent by writing one file — the zero-config `agents/<name>.ts` convention (theokit-ai-first M2, Eixo B).

Create a top-level `agents/support.ts` that default-exports `defineAgent({ input, model, system, tools })` and TheoKit auto-serves `POST /api/agents/support` at both `theokit dev` and the built server — streaming the M0/M1 canonical `UIMessageStream`. On the client, `import { useAgent } from '@theo/agents'` gives a typed React hook: `useAgent('support').send(input)` where `input` is inferred end-to-end from the agent's Zod schema via the generated `.theokit/agents.d.ts` — zero manual type wiring. The hook reconstructs the streamed assistant messages with the `ai` package's own `readUIMessageStream` (the exact reader `@ai-sdk/react`'s `useChat` runs — no reinvented parser); `theokit/client` also exports the pure `consumeUIMessageStream` and the base `useAgent(path)`.

`@theokit/agents` gains `defineAgent` — the canonical zero-config surface (ADR 0037) — a pure normalizer to the same SDK-ready shape the `@Agent` class decorator produces, so both surfaces converge on one runtime (`@theokit/sdk` stays the sole agent runtime). New exports: `defineAgent`, `compileAgentModule`, `streamAgentUIMessages`, `AgentDefinitionError`, `InferAgentInput`.

The build scans a top-level `agents/` directory and records each agent in the manifest; dev and prod mount through a single shared `mountAgent` point so they never drift. The request body accepts both the `useChat` shape (`{ messages }`) and a simple `{ message }`. Agent endpoints enforce CSRF (the `X-Theo-Action` header + Origin match, strict by default) at the same mode as routes/actions — a cross-origin POST that would spend LLM tokens is rejected with 403 before it reaches the SDK. A non-agent file or an unknown route fails fast with a typed error. `/api/agents/` is a reserved prefix (a manual route there is shadowed by design, like `/api/__actions/`).

Agents live in a top-level `agents/` (sibling of `server/`) per the LOCKED naming decision (ADR 0037). Non-breaking: additive API on both packages; the existing route/action/ws scanners still ignore `agents/`.
