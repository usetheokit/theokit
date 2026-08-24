---
'theokit': minor
---

Every route file declares who may call it, and absence stops meaning open.

**Breaking**, for every application with routes under `server/routes/`. The route scanner refuses a
file whose HTTP export declares no `policy`, so `theo build`, `theo start`, `theo dev`, `theo routes`
and every deployment adapter fail until each route says something. The error names the file, the URL
it serves and the methods that are silent.

`RouteConfig.policy` shipped optional in 0.49.0, and optional meant a route nobody had thought about
was indistinguishable from a route deliberately left open: both had no policy, and both were served
to anyone. ADR 0001 calls that the fail-open-by-omission class and closes it by making the absence a
build error rather than a silent default. `'public'` is still an answer — it is just an answer
somebody has to write down, which is what turns "how much of this app is open" into a number you can
`grep` for.

```diff
  export const GET = route()
+   .policy('public')
    .handler(() => ({ status: 'ok' }))
    .build()
```

`route()` gained `.policy()` in this release and `defineRoute({ policy, handler })` takes the same
value; `requireOwner` from `theokit/server/define` is the per-record answer. Detection reads the
export's AST, so a `policy` mentioned in a comment or a doc block declares nothing, and a re-export
across a module boundary (`export { GET } from './shared'`) cannot be seen through — both come back
undeclared, which is the deliberate direction: the cost is one explicit declaration, and the
alternative cost is a route reported as protected because the scanner guessed.

The gate is on file-scanned routes only. A `RouteConfig` built in memory and handed to
`executeWebRequest` or `callProcedure` never passes a scanner and is untouched — the runtime still
treats an undeclared policy as "not declared" rather than as denial. Refusing at request time
instead would have turned every existing route in every consumer into a 403 with no build step in
between, arriving one request at a time in production. `MIGRATION.md` has the per-situation guide.
