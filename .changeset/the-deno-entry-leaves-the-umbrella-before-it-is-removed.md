---
'theokit': patch
---

The Deno entry imports sub-paths instead of the umbrella the framework schedules for removal.

`deno-deploy.ts` emitted `from 'npm:theokit/server'` twice, and `server/index.ts` warns on that import in
the framework's own words: deprecated, "Removal scheduled for 0.x+2". A warning is a nuisance; a scheduled
removal is a dated failure — the entry stops loading on that release, before a request exists, which is
the same shape as a named import of an export a runtime does not have.

It was the only adapter still on the umbrella. Four siblings already use `theokit/server/scan`,
`theokit/server/http` and `theokit/server/rate-limit`, so the mapping was already written down and proven
by a Bun entry that runs.

Verified on Deno 2.9.5 by running the emitted entry: the deprecation warning printed on every start before
and prints zero times now; `GET /api/health` answers 200 with `x-request-id` and `x-trace-id` echoed, and
`GET /` answers 404, which is correct because this adapter delegates the document to the platform's static
handler.

A sweep test now covers every adapter, with the `npm:` prefix included in the pattern — a search written
without it matched nothing while the string was present in six files.
