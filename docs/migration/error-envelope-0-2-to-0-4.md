# Migration guide — error envelope (G5)

> **Status:** additive. Consumers do NOT need to migrate to adopt the
> envelope. Every legacy code path keeps working byte-for-byte. This
> guide documents the new opt-in surfaces so consumer code can adopt
> them at its own pace.

## Why

Before G5, errors crossed the theokit ↔ @theokit/sdk ↔ @theokit/ui
wire boundaries in three incompatible shapes:

- `theokit/server`: ~20 ad-hoc Error classes (`FileTooLargeError`,
  `RouterConventionError`, `AuthRequiredError`, …) with no common envelope.
- `theokit/server` G3 actions: `ActionError` / `ActionInputError` with
  `{ ok: false, error: { code, message, issues? } }` wire shape.
- `@theokit/sdk`: 15+ Error classes (`TheokitAgentError` and family) with
  rich SDK metadata and class-identity contracts.
- `@theokit/ui` `AgentErrorCard`: typed `kind` discriminator with no
  bridge to either layer.

G5 introduces a single canonical envelope **without flattening any of the
class hierarchies**. The pattern follows blueprint Form 4 — Hybrid:
shared code enum + per-domain extension slots + 2-layer SDK boundary
translation. Consumer code can:

- Keep using `try/catch (err instanceof AuthenticationError)` patterns.
- OR switch to `if (env.code === "UNAUTHORIZED")` patterns for cross-layer
  ergonomics.

## What ships now

### theokit/server (canonical envelope home)

```ts
import {
  TheoError,
  type TheoErrorEnvelope,
  type TheoErrorCode,
  type ValidationFieldsExt,
  type RetryableExt,
  type HintExt,
  isRetryable,
} from "theokit/server";
```

Emit a typed error from a route or middleware:

```ts
// Before
import { AuthRequiredError } from "theokit/server";
throw new AuthRequiredError("Token expired");

// After (optional — both still work)
import { TheoError } from "theokit/server";
throw new TheoError({ code: "UNAUTHORIZED", message: "Token expired" });
```

Pull an envelope from any error at the wire boundary:

```ts
import { serverErrorToEnvelope } from "theokit/server";

try {
  // ...
} catch (err) {
  const envelope = serverErrorToEnvelope(err);
  // envelope.code is always a canonical TheoErrorCode
  // envelope.meta.name carries the source class identity for telemetry
  // envelope.ext (RouterConventionError only, today) carries HintExt
}
```

### theokit/client (legacy + envelope on TheoFetchError)

`TheoFetchError` now exposes a typed `envelope` accessor while preserving
every legacy field:

```ts
// Before
try {
  await client.foo.post(body);
} catch (err) {
  if (err instanceof TheoFetchError && err.status === 401) {
    // handle auth
  }
}

// After (opt-in; legacy still works)
try {
  await client.foo.post(body);
} catch (err) {
  if (err instanceof TheoFetchError && err.envelope.code === "UNAUTHORIZED") {
    // handle auth using the canonical envelope
  }
}
```

The envelope is normalized whether the server emits the new
envelope-at-root shape (`{ code, message, ext?, ... }`) or the legacy G3
`{ error: { code, message, issues? } }` shape.

### @theokit/sdk (boundary translation sub-path)

```ts
import {
  toEnvelope,
  fromEnvelope,
  type TheokitErrorEnvelope,
} from "@theokit/sdk/server/errors-envelope";

// Outbound boundary — translate SDK class to envelope before sending
const envelope = toEnvelope(sdkError);
// envelope.code is canonical: UNAUTHORIZED / RATE_LIMITED /
// PROVIDER_KEY_MISSING / AGENT_RUN_ERROR / BUDGET_EXCEEDED / ...
// envelope.ext is RetryableExt when the SDK error carried Retry-After hints

// Inbound boundary — reconstruct SDK class identity from envelope
const sdkError = fromEnvelope(envelope);
// `sdkError instanceof AuthenticationError` still works for common codes.
// Codes that require domain-specific args (BudgetExceededError) fall back
// to UnknownAgentError — still a TheokitAgentError subclass for safe
// `instanceof TheokitAgentError` checks.
```

The internal SDK class hierarchy is **untouched**. Existing user code that
checks `err instanceof RateLimitError` keeps working in-process. The
envelope is only what crosses the wire.

### @theokit/ui (envelope-aware AgentErrorCard)

```tsx
import { AgentErrorCard, kindFromEnvelopeCode } from "@theokit/ui";

// Before (still works)
<AgentErrorCard kind="auth" title="Token expired" />

// After (opt-in)
<AgentErrorCard envelopeCode={env.code} title={env.message} />

// Or use the helper directly when fully controlling kind
<AgentErrorCard kind={kindFromEnvelopeCode(env.code)} title={env.message} />
```

The explicit `kind` prop wins when both are passed (precedence preserves
existing behavior).

## Code map

| Surface | Before | After (additive) |
|---|---|---|
| Throw at server boundary | `throw new AuthRequiredError("…")` | `throw new TheoError({ code: "UNAUTHORIZED", message: "…" })` |
| Catch at server boundary | `if (err instanceof AuthRequiredError)` | `if (env.code === "UNAUTHORIZED")` via `serverErrorToEnvelope(err)` |
| Catch on client | `if (err.status === 401)` | `if (err.envelope.code === "UNAUTHORIZED")` |
| SDK outbound | `throw new RateLimitError("…", { metadata })` | (unchanged internally) + `toEnvelope(err)` at boundary |
| SDK inbound | (no canonical hydration) | `fromEnvelope(env)` returns typed `TheokitAgentError` |
| UI rendering | `<AgentErrorCard kind="auth" />` | `<AgentErrorCard envelopeCode={env.code} />` |

## Codes — quick reference

`TheoErrorCode` is a string-literal union. Use exhaustive `switch`
narrowing in consumer code.

HTTP 4xx: `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`,
`METHOD_NOT_ALLOWED`, `CONFLICT`, `PRECONDITION_FAILED`,
`PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `UNPROCESSABLE_ENTITY`,
`TOO_MANY_REQUESTS`.

HTTP 5xx: `INTERNAL_SERVER_ERROR`, `NOT_IMPLEMENTED`, `BAD_GATEWAY`,
`SERVICE_UNAVAILABLE`, `GATEWAY_TIMEOUT`.

SDK domain: `AGENT_RUN_ERROR`, `PROVIDER_KEY_MISSING`, `BUDGET_EXCEEDED`,
`RATE_LIMITED`, `CREDENTIAL_POOL_EXHAUSTED`.

Use `isRetryable(env)` to derive retry-policy without an envelope field —
canonical retryable codes are documented in `RETRYABLE_CODES`.

## Extensions

Extensions are opt-in slots on `envelope.ext` for per-domain hints:

```ts
import type {
  ValidationFieldsExt,
  RetryableExt,
  HintExt,
} from "theokit/server";

// G3 validation failure — exact dot-notation field map (mirrors G3 EC-7)
const ext: ValidationFieldsExt = {
  fields: { email: ["must be a valid email"] },
};

// Producer assertion that this error is retryable even when code alone
// wouldn't imply it
const retryable: RetryableExt = { retryable: true, retryAfterMs: 5_000 };

// Developer-facing remediation hint
const hint: HintExt = { hint: "Set OPENAI_API_KEY in your .env file" };
```

`retryable` and `hint` are **NOT** base envelope fields — 3/3 of the
reference projects we audited derive retryability from code identity, not
envelope shape. Keep them in `ext` to keep the wire shape minimal.

## Server-only meta

`envelope.meta` is for server-internal context (request IDs, internal
stack traces). Per blueprint ADR D5, the `meta.stack` key is automatically
stripped when `TheoError#toJSON()` runs outside `NODE_ENV=development`. If
you need other server-only fields, document them in a project-local
convention or strip them at your serializer boundary.

## Rollback

This release is additive. To roll back:

- Stop using `TheoError`, the `envelope` accessor, `envelopeCode` prop, or
  the SDK `errors-envelope` sub-path.
- Existing class-identity checks, status codes, and G3 `{ error: {...} }`
  wire shapes all keep working.

No `git revert` is required at the consumer level. At the framework level,
`git revert <G5 commit range>` removes the envelope helpers without
touching legacy behavior.

## Related

- Plan: `.claude/knowledge-base/plans/g5-error-envelope-cross-layer-plan.md`
- Blueprint: `.claude/knowledge-base/discoveries/blueprints/g5-error-envelope-cross-layer-blueprint.md`
- Reference inspirations: trpc `TRPCError` + `errorFormatter` (functional
  type-inferred extension), hono `HTTPException` (cause chain via TC39),
  encore `Error` struct (split external `Details` vs internal `Meta json:"-"`).
