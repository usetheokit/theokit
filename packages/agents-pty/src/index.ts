/**
 * The PTY interactive backend — `@theokit/sdk-pty`'s `PtyInteractiveBackend`, re-exported.
 *
 * ## Why this is a package and not a subpath of `@theokit/agents`
 *
 * It used to be `@theokit/agents/pty`, and that made **every web application compile a terminal**
 * (usetheokit/theokit#460). `@theokit/sdk-pty` declares
 * `"install": "node scripts/prebuild.js || node-gyp rebuild"` — a native step that downloads a
 * prebuild or falls back to a C++ compile — and as a hard dependency of `@theokit/agents` every
 * consumer paid it. Measured 2026-08-20: installing `@theokit/agents` alone took **6.7 s** with it
 * and **1.4 s** without, and in a scaffolded app that difference was most of the gap in the
 * benchmark's time-to-first-green-run (30.40 ± 7.50 s against Next.js's 14.93 ± 0.91 s) — with our
 * build faster and our dependency tree smaller.
 *
 * The obvious fix was tried and reverted: an optional peer would make the APPLICATION declare
 * `@theokit/sdk-pty`, and M63 says an app takes its primitives from `@theokit/agents`, never from
 * `@theokit/sdk*` directly. Two rules, both right, in conflict — an implementation the consumer
 * cannot import must not be a peer, and an application should not compile a terminal it will never
 * open.
 *
 * A sibling package resolves both: the app declares THIS name (not an `@theokit/sdk*` one), so the
 * boundary holds, and `@theokit/agents` returns to a zero-native install.
 *
 * ## Re-export, never a wrapper
 *
 * The surface is `@theokit/sdk-pty`'s, whole and unreduced — the same rule `auth-entry.ts` records:
 * enriching never reduces. Names are enumerated rather than `export *` so a symbol removed upstream
 * fails THIS build with `tsc` pointing at the line, instead of vanishing from the surface and
 * surprising a consumer at a call site.
 */
export {
  clampYield,
  MaxSessionsError,
  PtyInteractiveBackend,
  YIELD_MAX_MS,
  YIELD_MIN_MS,
} from '@theokit/sdk-pty'

export type { PtyInteractiveBackendOptions } from '@theokit/sdk-pty'
