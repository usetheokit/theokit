# Auth Providers in TheoKit

> **TheoKit ships session primitives — NOT OAuth providers.**

TheoKit gives you everything you need to **hold** an authenticated session — encrypted cookies, `requireAuth`, CSRF strict, rate limit per-route, session rotation. It does NOT ship Google / GitHub / Facebook / Microsoft login modules — those are a moving target, and specialist libraries maintain them far better than a single-maintainer framework ever could.

This page walks the three patterns we recommend. Pick the one that matches your scope.

## What TheoKit provides

| Primitive | Purpose | RFC / Spec |
|---|---|---|
| `createSessionManager` | Encrypted session cookies (AES-256-GCM) | — |
| `requireAuth` | Type-narrowing auth guard | — |
| `rotateSession` | Session-fixation mitigation (rotate after login) | OWASP A07:2021 |
| `rotateIfNeeded` | Transparent re-encrypt on secret rotation (timing-safe) | — |
| CSRF strict + nonce CSP | Cross-site protection | — |
| `createRouteRateLimiter` | Per-route + per-user rate limit | — |
| `throttleLoginAttempts` | Brute-force defense per credential | OWASP A07:2021 |
| `generatePkceChallenge` | PKCE for OAuth code flow | RFC 7636 |
| `generateOAuthState` / `verifyOAuthState` | Anti-CSRF state token | RFC 6749 §10.12 |
| `discoverOidcProvider` | OIDC `.well-known/openid-configuration` fetcher | OIDC Discovery 1.0 |
| `generateTotp` / `verifyTotp` | TOTP 2FA | RFC 6238 |
| `generateBackupCodes` / `verifyBackupCode` | 2FA recovery codes | — |

## What TheoKit does NOT provide

- Concrete provider implementations (Google, GitHub, Facebook, etc.) — use a library
- JWT signing / verification — use [`jose`](https://www.npmjs.com/package/jose)
- ID-token verification (JWKS rotation) — use [`jose`](https://www.npmjs.com/package/jose)
- Login / signup UI components — use [TheoUI](https://github.com/usetheo/theokit-ui) or roll your own

## When to choose what

> **Updated 2026-06-03 per [ADR-0025](../adr/0025-lucia-removed-from-tier-1.md):** Lucia was previously named in this matrix. **As of 2026-06-03 Lucia is DEPRECATED on npm** (per discovery `g11-auth-architecture-decision` — `npm view lucia` returns the deprecation tombstone pointing to `lucia-auth.com/lucia-v3/migrate`). The Tier-1 recommendations are now Auth.js (largest provider matrix), Better Auth (modern TS-first DX), and Iron Session (lightweight session-only, replaces the Lucia slot).

| Need | Recommended path |
|---|---|
| 5+ providers (Google, GitHub, Facebook, Microsoft, …) | **Option A — Auth.js** |
| Modern TypeScript-first DX, fewer providers | **Option B — Better Auth** |
| Lightweight session-only, single provider you wire yourself | **Option C — Iron Session + DIY using TheoKit primitives** |
| Just GitHub OAuth, no library overhead | **Option C — DIY using TheoKit primitives** (no extra dep) |
| Hosted IdP (Clerk, Auth0, WorkOS, Stytch) | Use their SDK + TheoKit's `createSessionManager` for the local cookie |
| Bundled TheoKit-maintained provider (Google / GitHub / Magic link) | **Option D — `@theokit/auth-*` packages** (Caminho C — see [ADR-0024](../adr/0024-auth-caminho-c-hybrid.md)) |

---

## Option A — Auth.js (NextAuth)

Auth.js carries the largest provider matrix in the JS ecosystem. Wire it as a route handler and use TheoKit's session manager to hold the resulting user.

```ts
// server/auth.ts
import { Auth } from '@auth/core'
import GitHub from '@auth/core/providers/github'
import Google from '@auth/core/providers/google'

export const authConfig = {
  providers: [
    GitHub({ clientId: process.env.GITHUB_ID!, clientSecret: process.env.GITHUB_SECRET! }),
    Google({ clientId: process.env.GOOGLE_ID!, clientSecret: process.env.GOOGLE_SECRET! }),
  ],
  secret: process.env.AUTH_SECRET!,
}

// server/routes/auth/[...all].ts
import { defineRoute } from 'theokit/server'
import { Auth } from '@auth/core'
import { authConfig } from '../../auth.js'

export const GET = defineRoute({
  async handler({ req }) {
    return Auth(req as unknown as Request, authConfig)
  },
})
export const POST = GET
```

After Auth.js completes the flow, mirror the user into TheoKit's session for fast `requireAuth` checks:

```ts
// In your Auth.js `events.signIn` callback:
events: {
  async signIn({ user }) {
    // ... persist to your DB, then:
    await sessionManager.createSession(res, { userId: user.id, email: user.email })
  }
}
```

---

## Option B — Better Auth

Better Auth is TypeScript-first with a clean DX. Best when you want 1–3 providers and don't need every Auth.js plugin.

```ts
// server/auth.ts
import { betterAuth } from 'better-auth'
import { bearer } from 'better-auth/plugins'

export const auth = betterAuth({
  database: yourDbAdapter,
  emailAndPassword: { enabled: true },
  socialProviders: {
    github: { clientId: process.env.GITHUB_ID!, clientSecret: process.env.GITHUB_SECRET! },
  },
  plugins: [bearer()],
})

// server/routes/auth/[...all].ts
import { defineRoute } from 'theokit/server'
import { auth } from '../../auth.js'

export const GET = defineRoute({
  async handler({ req }) {
    return auth.handler(req as unknown as Request)
  },
})
export const POST = GET
```

---

## Option C — DIY using TheoKit primitives

For a single provider with no extra dependencies, you can roll the flow yourself in ~50 LOC using TheoKit's primitives.

```ts
// server/routes/auth/start.ts
import { defineRoute, generatePkceChallenge, generateOAuthState } from 'theokit/server'
import { z } from 'zod'

export const GET = defineRoute({
  query: z.object({}),
  async handler({ res, ctx }) {
    const { codeVerifier, codeChallenge, codeChallengeMethod } = await generatePkceChallenge()
    const state = generateOAuthState()

    // Persist verifier + state in the session BEFORE redirecting
    await ctx.sessions.createSession(res, {
      // Reuse your session shape — these are temp values for the round-trip.
      pending: { codeVerifier, state },
    } as never)

    const url = new URL('https://github.com/login/oauth/authorize')
    url.searchParams.set('client_id', process.env.GITHUB_ID!)
    url.searchParams.set('redirect_uri', `${process.env.APP_URL}/api/auth/callback`)
    url.searchParams.set('scope', 'read:user user:email')
    url.searchParams.set('state', state)
    url.searchParams.set('code_challenge', codeChallenge)
    url.searchParams.set('code_challenge_method', codeChallengeMethod)

    res.writeHead(302, { Location: url.toString() })
    res.end()
  },
})
```

```ts
// server/routes/auth/callback.ts
import { defineRoute, verifyOAuthState } from 'theokit/server'
import { z } from 'zod'

export const GET = defineRoute({
  query: z.object({ code: z.string(), state: z.string() }),
  async handler({ query, req, res, ctx }) {
    const pending = (await ctx.sessions.getSession(req)) as { pending?: { codeVerifier: string; state: string } } | null
    if (!pending?.pending) {
      res.writeHead(400); res.end('no pending oauth state'); return
    }
    if (!verifyOAuthState(query.state, pending.pending.state)) {
      res.writeHead(403); res.end('state mismatch'); return
    }

    // Exchange code → token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GITHUB_ID,
        client_secret: process.env.GITHUB_SECRET,
        code: query.code,
        code_verifier: pending.pending.codeVerifier,
      }),
    })
    const { access_token } = await tokenRes.json() as { access_token: string }

    // Fetch user, persist to DB...
    const u = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${access_token}` } }).then((r) => r.json())

    // CRITICAL: rotate session after successful auth (OWASP A07 — session fixation)
    await ctx.sessions.rotateSession(req, res)
    // Replace the pending data with the real user session
    await ctx.sessions.createSession(res, { userId: String(u.id), email: u.email })

    res.writeHead(302, { Location: '/dashboard' })
    res.end()
  },
})
```

---

## 2FA — TOTP + backup codes

Once auth is in place, enroll 2FA with TheoKit's RFC 6238 primitives:

```ts
import { generateTotpSecret, totpUri, generateBackupCodes, verifyTotp } from 'theokit/server'

// Enroll
const secret = generateTotpSecret() // 20 random bytes
const uri = totpUri({ secret, issuer: 'YourApp', account: user.email })
// Render `uri` as a QR code; user scans with Authy/Google Authenticator
// Persist `secret` ENCRYPTED-AT-REST in your DB (see security note below)
const codes = await generateBackupCodes()
// Show codes[].plaintext to the user ONCE; store codes[].hash in DB

// Verify on login challenge
const ok = await verifyTotp(submittedCode, { secret })
if (!ok) {
  // Allow falling back to a backup code:
  const result = await verifyBackupCode(submittedCode, storedHashes)
  if (result.valid) {
    await deleteBackupCodeByHash(result.matchedHash!) // REPLAY PROTECTION
  } else {
    return 401
  }
}
```

> **SECURITY:** TOTP secrets are equivalent to passwords. Encrypt at rest using a separate KMS key from your `SESSION_SECRET`. If your DB leaks, ALL 2FA codes are compromised — rotate by forcing all users to re-enroll.

---

## Login throttling

Combine session primitives with `throttleLoginAttempts` to defeat brute-force:

```ts
import { defineRoute, InMemoryStore, checkThrottle, recordAttempt } from 'theokit/server'
import { createHash } from 'node:crypto'
const throttleStore = new InMemoryStore() // swap for Redis adapter in multi-instance prod

export const POST = defineRoute({
  body: z.object({ email: z.string().email(), password: z.string() }),
  async handler({ body, req, res, ctx }) {
    const id = `login:${createHash('sha256').update(body.email.toLowerCase()).digest('base64url').slice(0, 16)}`

    const state = await checkThrottle({ store: throttleStore, identifier: id })
    if (!state.allowed) {
      res.writeHead(429, { 'Retry-After': String(Math.ceil((+state.lockedUntil! - Date.now()) / 1000)) })
      res.end('locked')
      return
    }

    const valid = await verifyPassword(body.email, body.password)
    await recordAttempt({ store: throttleStore, identifier: id }, valid)
    if (!valid) {
      res.writeHead(401); res.end(); return
    }

    // SUCCESS — rotate the session to defeat fixation
    await ctx.sessions.rotateSession(req, res)
    await ctx.sessions.createSession(res, { userId: '...', email: body.email })
    res.writeHead(302, { Location: '/dashboard' })
    res.end()
  },
})
```

---

## Option D — `@theokit/auth-*` first-party providers (Caminho C Hybrid)

Per [ADR-0024](../adr/0024-auth-caminho-c-hybrid.md), TheoKit ships three first-party OAuth/passwordless providers as opt-in npm packages that plug into a thin `defineAuth` orchestrator in `@theokit/sdk/server/auth`. Use this option when you want first-class TheoKit ergonomics without the full Auth.js / Better Auth surface AND the provider you need is one of Google / GitHub / magic-link.

```bash
pnpm add @theokit/plugin-auth @theokit/sdk
# OR install only what you need
pnpm add @theokit/auth-google @theokit/sdk
```

```ts
// server/auth.ts
import { defineAuth } from "@theokit/sdk/server/auth";
import { google, github, magicLink, createMemoryStore } from "@theokit/plugin-auth";
import { createSessionManager } from "theokit/server/auth";

const session = createSessionManager<{ userId: string }>({
  secret: process.env.SESSION_SECRETS!.split(","),
});

export const auth = defineAuth({
  session,
  providers: [
    google({ clientId: ..., clientSecret: ..., redirectUri: ... }),
    github({ clientId: ..., clientSecret: ..., redirectUri: ... }),
    magicLink({ store: createMemoryStore(), callbackBaseUrl: ..., sendEmail: ... }),
  ],
  onSignIn: async ({ profile, provider }) => ({ userId: "..." }),
});
```

The orchestrator uses the same in-house primitives this doc lists above (`generatePkceChallenge`, `generateOAuthState`, `discoverOidcProvider`, `createSessionManager`) so the security posture is identical. The difference is packaging: each provider lives in its own semver-isolated npm package owned by TheoKit core for the Tier-1 set.

**Lock alignment:** Caminho C is the AUTH-DELEGATION lock's own approved evolution path (per the lock's "If we do adopt later" escape-hatch clause). [ADR-0024](../adr/0024-auth-caminho-c-hybrid.md) records the decision rationale.

---

## Reference

- ADR-0024: [Auth architecture — Caminho C (Hybrid)](../adr/0024-auth-caminho-c-hybrid.md)
- ADR-0025: [Lucia removed from Tier-1](../adr/0025-lucia-removed-from-tier-1.md)
- ADR-0026: [`auth-lib-friction` GitHub label for Trigger 2 telemetry](../adr/0026-auth-lib-friction-github-label.md)
- ADR-0027: [Auth-delegation lock — semi-annual re-validation cadence](../adr/0027-auth-lock-semi-annual-revalidation.md)
- Lock origin: [`CLAUDE.md` → "Architectural decisions on record" → AUTH-DELEGATION](../../CLAUDE.md)
- Prior-art audit: [`.claude/knowledge-base/reference/oauth-oidc-delegation.md`](../../.claude/knowledge-base/reference/oauth-oidc-delegation.md) — 793 LOC, 8-framework survey
- G11 discovery blueprint: [`g11-auth-architecture-decision-blueprint.md`](../../../.claude/knowledge-base/discoveries/blueprints/g11-auth-architecture-decision-blueprint.md)
- Working fixtures: [`tests/fixtures/auth-providers/`](../../tests/fixtures/auth-providers)
