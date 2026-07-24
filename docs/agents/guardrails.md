# Guardrails

Ship an agent your users can't jailbreak, that never leaks a CPF to the model, and that stops
before a runaway loop burns your budget. Guardrails are pluggable checks that run at the agent's
boundary — on the user's message before it reaches the model, and on the model's output before it
reaches your user.

---

## Quickstart

```ts
import { defineAgent } from '@theokit/agents'
import {
  promptInjectionDetector,
  piiDetector,
  costGuard,
  outputModeration,
} from '@theokit/agents'

export default defineAgent({
  model: 'anthropic/claude-sonnet-4-6',
  guardrails: [
    promptInjectionDetector(),          // blocks known jailbreaks
    piiDetector({ redact: true }),      // redacts CPF / email / phone before the model
    costGuard({ maxTokens: 50_000 }),   // caps cumulative input tokens per run
    outputModeration({ moderate: myModerationFn }), // blocks flagged output before the client
  ],
})
```

Input guards run **fail-fast** before the SDK runtime sees the message. Output guards moderate the
full accumulated response and block it **before any event reaches the client**.

---

## Built-in guards

| Guard | Phase | What it does |
|---|---|---|
| `promptInjectionDetector({ extra? })` | input | Blocks known injection/jailbreak phrases (normalized substring match — ReDoS-free). Add project phrases via `extra`. |
| `piiDetector({ redact?, placeholder? })` | input | Redacts Brazilian CPF, email, and phone to `[REDACTED]` before the model. |
| `unicodeNormalizer()` | input | NFKC-normalizes and strips zero-width / bidi-override characters used to hide instructions. |
| `costGuard({ maxTokens })` | input | Enforces a cumulative input-token budget per run; throws `CostBudgetExceededError` when exceeded. |
| `outputModeration({ moderate })` | output | Runs your injected predicate on the full response; blocks it before the client if flagged. |

Each returns a `Guardrail` — `{ name, checkInput?, checkOutput? }`. Guards that omit a phase are
skipped for that phase.

---

## How it works

Input guards form a pipeline: each guard's `checkInput` runs in order. A `block` throws
`GuardrailViolationError` immediately (fail-fast — the model never sees the message). A `redact`
rewrites the text and threads it to the next guard.

Output guards are different: because "blocked before the client" must be honest, the stream is
**buffered** — every event is held, the accumulated text is moderated, and only on pass are the
events replayed. A block throws before any event is emitted. Streaming is traded for safety only
when an output guard is present; with none, the stream passes through untouched.

The full input pipeline costs **~11µs per request** — negligible next to any LLM call.

---

## Custom guards

A guard is any object matching the `Guardrail` shape. `outputModeration` takes an **injected**
predicate — the SDK-runtime rule (G2) keeps provider calls out of the framework, so you own the
moderation call:

```ts
import type { Guardrail } from '@theokit/agents'

const blocklist: Guardrail = {
  name: 'blocklist',
  checkInput(text) {
    return /\b(competitor-x|internal-secret)\b/i.test(text)
      ? { action: 'block', reason: 'blocked term' }
      : { action: 'allow' }
  },
}
```

`checkInput` / `checkOutput` return `{ action: 'allow' | 'block' | 'redact', reason?, text? }`.
For `redact`, put the transformed text in `text`.

---

## Errors

- `GuardrailViolationError` — thrown when any guard returns `block` (carries `guardName`, `phase`, `reason`).
- `CostBudgetExceededError` — thrown by `costGuard` when the cumulative token budget is exceeded.

---

## `guardrails()` — the capability (M53)

The composable authoring path declares guardrails as a capability, alongside the others:

```ts
import { applyCapabilities, ModelCapability, guardrails } from '@theokit/agents'
import { promptInjectionDetector, piiDetector } from '@theokit/agents'

const compiled = applyCapabilities([
  new ModelCapability('anthropic/claude-sonnet-4-6'),
  guardrails([promptInjectionDetector(), piiDetector({ redact: true })]),
])
```

The declared guards land in `compiled.guardrails` and `AgentRunner` applies them at the framework
boundary — identical to the `defineAgent({ guardrails })` path.

> **Migrating from `@Guardrails`?** The class decorator was removed in `@theokit/agents` v1.0
> (M53). See [`MIGRATION.md`](../../MIGRATION.md).

## Related

- [Using tools](./using-tools.md) — tools are the primitive guardrails protect
- [Overview](./overview.md) — agent fundamentals
- [Feature backlog](./feature-backlog.md) — parity tracker (M9)
