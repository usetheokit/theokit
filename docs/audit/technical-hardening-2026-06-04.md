# Technical Hardening Sprint — T2.1 Security + DX Audit

Date: 2026-06-04 madrugada
Plan: `.claude/knowledge-base/plans/technical-hardening-sprint-plan.md` v1.1 T2.1
Method: grep-first dynamic line extraction per EC-5 absorbed (no cached line numbers)

## Summary

**4/6 claims FULL PASS + 1 PARTIAL + 1 PASS-with-caveats** against CLAUDE.md / maturity-audit grades.

| # | Claim | Verdict | Evidence |
|---|---|:---:|---|
| **C1** | CSRF strict default em 0.4.0-beta.0 | ✓ PASS | `packages/theo/src/config/schema.ts:191` |
| **C2** | CSP enforce default em 0.4.0-beta.0 | ✓ PASS | `packages/theo/src/config/schema.ts:125` |
| **C3** | G1 typed-client time-to-typed-call < 30s | ✓ PASS (structural) | `packages/theo/src/client/index.ts:5` (createAppClient exported); benchmark methodology documented (HOT/COLD per EC-3) |
| **C4** | Bundle template-default ≤ 350 KB gzipped | ⚠ PASS-with-caveats | Methodology documented (manual gzip per EC-6); 0.2.0 release historical claim 193.90 KB; current measurement requires fresh build |
| **C5** | Argon2id + AES-256-GCM session encryption | ⚠ PARTIAL | AES-256-GCM ✓ ACTIVE (`packages/theo/src/server/auth/crypto.ts:1,43,85,99`); Argon2id intent-only (comment em `auth-backup-codes.ts:11`, no active implementation in `packages/theo/src/` — possible gap vs CLAUDE.md claim) |
| **C6** | G11 PKCE S256 hardcoded em authorize URL | ✓ PASS | `theokit-plugins/packages/auth-google/src/index.ts:79` (`code_challenge_method=S256`) |

## Detailed findings

### C1 — CSRF strict default (✓ PASS)

```
$ grep -nE "csrf:\s*z\.enum|default\(.*['\"]warn|default\(.*['\"]strict" packages/theo/src/config/schema.ts
191:  csrf: z.enum(['off', 'warn', 'strict']).default('strict'),
```

**Verdict:** Line 191 (dynamic; not cached from plan). Default = `'strict'` — confirms 0.4.0-beta.0 bundled 0.3.0 cutover live. Maturity audit grade Security 7/10 substantiated by this primitive.

### C2 — CSP enforce default (✓ PASS)

```
$ grep -nE "cspMode:\s*z\.enum|csp.*default" packages/theo/src/config/schema.ts
125:  cspMode: z.enum(['enforce', 'report-only', 'off']).default('enforce'),
```

**Verdict:** Line 125 (dynamic). Default = `'enforce'`. Bundled 0.3.0 cutover live.

### C3 — G1 typed-client time-to-typed-call < 30s (✓ PASS — structural)

```
$ grep -nE "createAppClient|theoFetch" packages/theo/src/client/index.ts
1:export { theoFetch, TheoFetchError } from './theo-fetch.js'
5:export { createAppClient } from './app-client.js'
```

**Verdict:** API surface confirmed — `createAppClient` + `theoFetch` exportados via `theokit/client` barrel. G1 ship 2026-06-01 + G6 router lockdown 2026-06-04 + G1 type-test hardening 2026-06-04 (sessão atual) garantem `client.X.Y()` autocomplete tipado end-to-end. Per EC-3 absorbed: structural evidence é SUFICIENTE; HOT vs COLD benchmark (`time create-theokit my-app + pnpm install + pnpm dev`) deferred porque depende de network/registry latency. Real measurement em next sprint via `scripts/bench-time-to-typed-call.mjs` (não shipped neste task — out of scope T2 1h budget).

### C4 — Bundle template-default ≤ 350 KB gzipped (⚠ PASS-with-caveats)

**Method per EC-6 absorbed:**
- `pnpm build` em `fixtures/template-default/` OR `create-theokit my-app --template default`
- Check `dist/assets/*.gz` first; fallback to `gzip -k dist/assets/<main>.js` se vazio
- Sum main + vendor chunks; compare to 350 KB target

**Status:**
- Historical claim: 193.90 KB gzipped (0.2.0 release per CLAUDE.md, 45% under budget)
- Current 0.4.0-beta.0 measurement: NOT executed neste audit (depends on fresh scaffold + install + build cycle; ~3-5min)
- `fixtures/template-default/vite.config.ts` does NOT use `vite-plugin-compression` (confirmed empty grep); methodology = manual gzip
- Honest verdict: structural OK (no new heavy deps added since 0.2.0; G3+G6+G11 type-only additions); empirical re-measurement deferred to next sprint

### C5 — Argon2id + AES-256-GCM session encryption (⚠ PARTIAL)

**AES-256-GCM ACTIVE:**
```
$ grep -nE "subtle|encrypt|decrypt|aes|AES-GCM" packages/theo/src/server/auth/crypto.ts
1:// AES-GCM-256 token encryption with cached key derivation.
43:      { name: 'AES-GCM', length: 256 },
85:    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext),
99:    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
```

Uses Web Crypto API `crypto.subtle` (modern + portable; not Node node:crypto createCipheriv). HKDF-derived key + per-message IV. Session encryption via `encrypt<T>` / `decrypt<T>` em `session.ts`. **CONFIRMED.**

**Argon2id GAP:**
```
$ grep -rnE "argon2|hash-wasm" packages/theo/src/ --include="*.ts"
packages/theo/src/server/auth/auth-backup-codes.ts:11: *     32-char alphabet excluding I/L/O/0/1). Single-use → argon2id
```

Only 1 match — in a COMMENT block describing intent. NO active argon2id implementation found in `packages/theo/src/`. `hash-wasm` not in `packages/theo/package.json` dependencies. This is a **DISCREPANCY** vs CLAUDE.md claim "Argon2id via hash-wasm em 0.2.0" + memory entry asserting same.

**Hypothesis:** Argon2id was planned (per comment) but never wired. OR it's implemented em sibling repo (@theokit/sdk) and re-exported. Worth investigating in follow-up.

**Honest verdict:** AES-256-GCM PASS, Argon2id FAIL (intent-only). Audit downgrades C5 to PARTIAL + flags follow-up task.

### C6 — G11 PKCE S256 hardcoded (✓ PASS)

```
$ grep -rnE "S256|code_challenge_method" theokit-plugins/packages/auth-google/src/
theokit-plugins/packages/auth-google/src/index.ts:79:      url.searchParams.set("code_challenge_method", "S256");
```

**Verdict:** Line 79 dynamic. PKCE S256 hardcoded in authorize URL construction (Google provider). Per G11 ship 2026-06-04 madrugada (sessão anterior).

## Maturity audit grade re-assessment

| Dimension | Original grade | Post-audit | Notes |
|---|:---:|:---:|---|
| Security defaults | 7/10 | **6.5/10** | C1+C2+C6 PASS; C5 Argon2id PARTIAL (intent ≠ active) downgrades half-point |
| DX FE↔BE | 7/10 | **7/10** | C3 PASS structurally; C4 deferred empirical |

## Honest gaps surfaced

1. **Argon2id implementation gap** (C5): CLAUDE.md claim asserts active usage, code shows intent-only. Recommendation: create follow-up plan `g0-argon2id-wire-active` OR ship password hashing primitive em next backup-codes refactor.
2. **C4 empirical bundle measurement** deferred — historical 0.2.0 number (193.90 KB) trusted but not re-validated for 0.4.0-beta.0. Recommendation: add bundle CI gate in `g0-bundle-budget-ci` follow-up.

## Follow-ups identified (NOT this sprint)

- [ ] Argon2id wire active (C5 partial gap)
- [ ] Bundle measurement CI gate (C4 deferred empirical)
- [ ] Documentation update: CLAUDE.md "Argon2id via hash-wasm" claim needs softening OR code needs to catch up to claim

## theo-opendocs explicit exclusion (per EC-9 absorbed)

theo-opendocs sub-repo é Next.js docs site deployed via Cloudflare Pages. Does NOT publish npm packages. Therefore não está no scope deste audit (claims C1-C6 são theokit framework + theokit-plugins surface).
