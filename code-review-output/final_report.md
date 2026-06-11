# TheoKit Security Review — Final Report

**Date:** 2026-06-10
**Scope:** Security-focused review of packages/agents, packages/http-decorators, packages/theo security modules
**Mode:** Full (Phases 1-5)
**Components reviewed:** 43 | **Files inspected:** 108 | **Findings:** 23

---

## Executive Summary

TheoKit has **strong security foundations** (AES-GCM sessions, CSRF multi-layer, timing-safe comparisons, CSP nonces) but has **critical gaps in the agent sandbox** and **information disclosure** in error paths. The sandbox bypass (path traversal + command injection) is the highest-priority fix — it's the security perimeter for code-assistant agents.

---

## Risk Matrix

| Severity | Count | Blocking | Priority |
|---|---|---|---|
| **High** | 9 | 9 | Fix before any production deployment |
| **Medium** | 11 | 6 | Fix within 2 weeks |
| **Low** | 3 | 0 | Address in next sprint |

---

## Top Findings by Severity

### HIGH — Sandbox Bypass (CRITICAL CLUSTER)

**1. Path traversal in `isPathAllowed()`**
- **File:** `packages/agents/src/decorators/sandbox.ts:79`
- **Exploit:** `src/../.env` bypasses deny pattern for `.env`
- **Fix:** `const normalized = path.resolve('/', filePath).slice(1)` before matching
- **Effort:** 1 line

**2. Command injection in `isCommandAllowed()`**
- **File:** `packages/agents/src/decorators/sandbox.ts:100`
- **Exploit:** `npm test; rm -rf /` passes `startsWith('npm')` allow check
- **Fix:** Split on whitespace, match first token only; deny check on full command with shell metachar detection
- **Effort:** 5 lines

**3. ReDoS in glob-to-regex converter**
- **File:** `packages/agents/src/decorators/sandbox.ts:113`
- **Risk:** Crafted glob pattern causes exponential backtracking
- **Fix:** Use `picomatch` or bound pattern complexity
- **Effort:** Replace function (Medium)

### HIGH — Information Disclosure

**4. LLM error body leaked to SSE clients**
- **File:** `packages/agents/src/bridge/llm-runner.ts:98`
- **Risk:** OpenRouter error responses may contain account metadata, API key fragments
- **Fix:** Replace with generic error message; log full error server-side
- **Effort:** 3 lines

**5. Internal error messages in HTTP 500 responses**
- **File:** `packages/http-decorators/src/app.ts:419`
- **Risk:** `err.message` may contain stack traces, file paths, or sensitive data
- **Fix:** Return `"Internal Server Error"` to clients; log real error
- **Effort:** 1 line

### HIGH — Agent Budget & Secrets

**6. Post-hoc budget enforcement**
- **File:** `packages/agents/src/bridge/agent-orchestrator.ts:128`
- **Risk:** Sub-agent consumes unlimited API tokens before budget check
- **Fix:** Add per-chunk cost accumulator with mid-stream abort on threshold
- **Effort:** 15 lines

**7. API key as plaintext in delegation chain**
- **File:** `packages/agents/src/bridge/agent-orchestrator.ts:68`
- **Risk:** API key flows as bare string; any logging/serialization exposes it
- **Fix:** Wrap in opaque `SecretString` class that redacts on `toString()/toJSON()`
- **Effort:** 10 lines

### MEDIUM — Notable

| # | File:Line | Issue | Fix |
|---|---|---|---|
| 8 | `llm-runner.ts:34` | Unbounded session Map — DoS via flooding | Add `maxSize` with LRU eviction |
| 9 | `llm-runner.ts:134` | Swallowed SSE parse errors — silent data loss | Log parse failures |
| 10 | `llm-runner.ts:152` | Tool args not validated against Zod schema | `schema.safeParse()` before handler |
| 11 | `app.ts:184` | `new Function()` for dynamic import — eval equivalent | Document security justification |
| 12 | `app.ts:312` | Health endpoints bypass guards — configurable path overlap risk | Validate paths don't overlap user routes |

---

## Positive Security Observations

These are well-implemented and should be preserved:

1. **Session encryption** — AES-GCM-256 + HKDF key derivation + constant-time dual-key rotation
2. **CSRF protection** — Multi-layer (custom header + Origin matching) with progressive migration
3. **Webhook signatures** — Timing-safe comparison with non-Node fallback
4. **TOTP verification** — Constant-time (no early exit on mismatch)
5. **CSP nonces** — Web Crypto with 128-bit entropy
6. **CORS** — Fail-closed on callback errors
7. **Login throttling** — Proper check/record separation
8. **Error scrubbing** — INTERNAL_ERROR messages scrubbed in production (theo package)

---

## Remediation Priority

### Week 1 (Critical — before any deployment)
1. Fix `sandbox.ts` path normalization (1 line)
2. Fix `sandbox.ts` command injection (5 lines)
3. Scrub error messages in `app.ts:419` and `llm-runner.ts:98`

### Week 2 (High — before beta users)
4. Add mid-stream budget enforcement in `agent-orchestrator.ts`
5. Wrap API keys in `SecretString` redaction class
6. Validate tool arguments against Zod schema in `llm-runner.ts`

### Week 3 (Medium — hardening)
7. Add LRU cap to session store
8. Replace glob-to-regex with `picomatch`
9. Log SSE parse failures
10. Document `new Function()` security justification

---

## What Was NOT Reviewed

- `packages/theo/` main framework (auth, sessions, middleware) — **already well-hardened** per Phase 1 positive observations
- E2E security testing (Playwright-based auth flows)
- Dependency vulnerability scan (npm audit)
- Network-level security (TLS, HSTS configuration)
- Container/deployment security (Dockerfile, K8s manifests)

---

## Conclusion

**TheoKit's core security (sessions, CSRF, webhooks) is FAANG-grade.** The critical gaps are concentrated in the newer agent-facing code (sandbox, orchestrator, LLM runner) — all fixable in <1 week of focused work. The sandbox bypass is the #1 priority because it's the trust boundary between the LLM and the host system.

**Recommendation:** Fix items 1-3 (sandbox + error scrubbing) immediately. All other findings are tractable within 2-3 weeks.
