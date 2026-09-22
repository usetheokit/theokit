---
'theokit': patch
---

Every agent route of a freshly scaffolded, production-built app answered 500. Fixed
(usetheokit/theokit#871).

Measured against the published 0.70.0, from nothing, with the three documented commands and no file
modified:

```
npm create theokit@latest clean-app -- --yes
npx theokit build        # exit 0
npx theokit start

GET /api/agents/chat/approvals
  -> 500  Cannot find module '<root>/src/src/server/agents/chat.ts'
```

`src` was doubled. The asymmetry lived in one file: `generateManifest` is TOLD the project root and
encodes agent paths as `relative(projectRoot, …)`, while `loadManifest` was not told and GUESSED it
as `dirname(serverDir)`. The guess is right for `<root>/server` and wrong by exactly one level for
`<root>/src/server` — which is what `create-theokit` scaffolds, so the wrong case was the default
case.

The reader is now told the root, symmetric with the writer; `theokit start` passes the `cwd` it
already held. The parameter defaults to the old derivation, so a caller that genuinely has only a
server dir is unchanged.

After the fix, on the same scaffolded app: `GET /api/agents/chat/approvals` answers 200, and
`POST /api/agents/chat` answers 403 from the CSRF gate — the route is reached and its policy runs,
where before the 500 happened before any policy was consulted.
