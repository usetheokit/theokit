---
'theokit': patch
---

An ordinary project stops being warned that every agent route will 404

A nested-layout project with no agents — the layout `create-theokit` scaffolds — was told, on every dev
start and every build that reached this path:

    [theokit] agentsDir "agents" resolves to "<root>/src/agents", which is not a directory, so NO agents
    were found and every /api/agents/* route will 404.

About routes it does not have, and a directory it never configured. Two defects in one line.

`generateManifest` defaulted `projectRoot` to `dirname(serverDir)` and `agentsDir` to `'agents'`. The pair
is correct exactly when the layout is flat, so the guess was `<root>/src` and wrong by one level — and the
default value made `scanAgents` believe a directory HAD been configured. That layer reports a configured
directory resolving to nothing and stays silent when nothing was configured; its docblock says why in its
own words, that "a default erases the difference between 'nobody configured this' and 'somebody configured
agents'". This erased it. A parameter default also applies to an explicit `undefined`, so passing the
absence through was impossible while the default existed.

Both parameters are now supplied by every caller: `projectRoot` is required, and `agentsDir` is optional
WITHOUT a default so the absence reaches the layer that decided to stay quiet.

`loadManifest` in the same file had the same default, and it is the one theokit#871 was about — `Cannot
find module '<root>/src/src/server/agents/chat.ts'`, a 500 on every agent route of a freshly scaffolded
app. That was fixed by passing the root at its one production call site and the default stayed behind, so
any caller omitting it re-created the bug. It is required now too; its production caller was already
correct, so nothing else changed.

Neither function is public API — neither appears in any `.d.ts` this package publishes — so no consumer
signature moved.
