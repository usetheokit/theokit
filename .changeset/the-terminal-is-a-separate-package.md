---
'@theokit/agents': major
---

`@theokit/agents/pty` is gone. The PTY backend now lives in `@theokit/agents-pty`, and installing `@theokit/agents` no longer compiles a terminal.

`@theokit/sdk-pty` declares `"install": "node scripts/prebuild.js || node-gyp rebuild"` — a native step that downloads a prebuild or falls back to a C++ compile. As a hard dependency of this package, **every consumer paid it**, including every web application that will never open a terminal. Measured: installing `@theokit/agents` alone took **6.7 s** with it and **1.4 s** without, and in a scaffolded app that was most of the gap in time to first green run (30.40 ± 7.50 s against Next.js's 14.93 ± 0.91 s) — with our build faster and our dependency tree smaller.

**To upgrade**, if you import the subpath:

```diff
-import { PtyInteractiveBackend } from '@theokit/agents/pty'
+import { PtyInteractiveBackend } from '@theokit/agents-pty'
```

plus `npm install @theokit/agents-pty`.

You do not have to find this note to know: `@theokit/agents/pty` still resolves, and using anything from it throws with the two lines above. It imports nothing, so keeping it costs no dependency and no native build — the failure is a sentence rather than an `ERR_MODULE_NOT_FOUND` you have to diagnose.

The surface is identical — the same six symbols, and the new package's test asserts they are the upstream identities rather than a wrapper. Nothing else changes.

If you do not import it, you install 5.3 s faster and there is nothing to do.

**Why a package and not an optional peer.** That was tried and reverted: a peer means *the host provides it*, and the M63 boundary forbids an application from importing `@theokit/sdk*` at all — so it would ask a consumer to declare exactly what it may not use. A sibling package is something the consumer genuinely does import, with no inversion. Recorded in `docs/adr/0004-the-terminal-is-a-separate-package.md`, along with the two alternatives rejected (a lazy `import()`, which defers nothing that is being measured, and documenting the cost, which is read after the decision it would inform).
