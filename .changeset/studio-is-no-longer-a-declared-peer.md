---
'theokit': patch
---

**`@theokit/studio` is no longer declared as an optional peer dependency.**

Nothing changes at runtime. `/_studio` still mounts when Studio is installed, still no-ops when it
is not, and still warns when an installed copy does not export `theokitStudio()`.

What changes is that this package no longer pins a compatible range for a package it does not
install. The declaration bought one thing — `npm install` refusing an incompatible pair up front —
and charged the release train for it:

> `@theokit/agents@13.0.0-next.0` could not publish. npm resolved this optional peer to the
> published `@theokit/studio@0.3.0`, whose own peer read `@theokit/agents ">=11.0.0 <13"`, and the
> install failed `ERESOLVE`.

The 13 was not even a break. Changesets promotes a peer-dependent to major when a peer takes a minor
bump, and that changelog carries Minor and Patch sections only. So a dev-only route, in a package
this repository never installs, held four packages' release hostage to a second repository's release
cycle.

The runtime already covers what the declaration promised (`integrate-studio.ts`):

- **absent** → no `/_studio`, silently, which is the normal case for an app that never asked for it
- **installed but skewed** → `console.warn` naming the package and telling the reader to check the
  installed version

That is the same information the peer range carried, delivered at the moment it matters, to the
person who actually installed Studio.

**Genuinely lost:** `npm install` no longer refuses an incompatible pair before anything runs.
Anyone pinning both should read that warning as the contract. The docblock in
`integrate-studio.ts` records this so the declaration is not re-added without the trade being
re-made.
