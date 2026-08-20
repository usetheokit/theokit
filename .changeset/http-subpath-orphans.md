---
'theokit': minor
---

`theokit/server/http` exports sixteen symbols that previously existed only behind the deprecated
`theokit/server` umbrella: `executeWebRequest`, `callProcedure`, `ProcedureInputError`,
`ProcedureOutputError`, `validateRouteInput`, `parseRequestBody`, `FileTooLargeError`,
`jsonTransformer`, `superjsonTransformer`, `resolveTransformer`, `createOpenApiHandler`,
`ActionError`, `ActionInputError`, `isActionError`, `isInputError` and `extractUniversalIssues`. The
umbrella's own deprecation message tells consumers to move to a subpath, and for these there was
none.
