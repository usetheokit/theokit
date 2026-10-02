---
'theokit': patch
---

The `deno-deploy` target produces output the platform can actually run

Four defects, each measured against the real Deno Deploy platform with a control, and none of them reachable by the test suite or by a build that checks its own output. The build reported success in every case.

**The entry was written where the upload cannot see it.** A dot directory is never carried: deploying `./.theokit/deno/probe.ts` failed the revision while the byte-identical file at `./visible/probe.ts` served HTTP 200. The entry now lands at `theokit-deploy/server.ts` — one directory deep, so the upload root stays the project root, which the entry needs because it scans `<cwd>/src/server` for the project's own route modules. Rooted anywhere else it finds no routes and answers 404 on every path.

**No import map was emitted, so every route failed at import time.** The generated entry reaches the framework through `npm:theokit/...`; a project's own modules import the bare `theokit/server/define`. A prefix mapping cannot bridge them — Deno refuses `"theokit/": "npm:theokit/"` because the portion after the prefix is not URL-joinable onto an `npm:` URL — so each specifier is now mapped exactly. The list is derived from what the project's own sources import rather than from its manifest: a declared dependency nobody imports needs no entry, and a subpath appears in no manifest at all.

**`sloppy-imports` was absent**, and the default template needs it: its agent modules carry six relative imports written with a `.js` extension against files on disk ending `.ts`. Deno refuses that pairing by design.

**The emitted deploy instruction named `deployctl`**, which talks to the previous Deno Deploy platform and answers 401 against a current token. It now names `deno deploy`, and says to exclude `node_modules` — pnpm's is a symlink farm the upload cannot carry, and an entry reaching the framework through `npm:` specifiers needs none of it.

The config is written at the project root because that is the only place the platform reads it: moving it one directory down failed the revision.
