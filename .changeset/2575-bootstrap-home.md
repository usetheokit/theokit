---
'@theokit/agents': patch
---

`@theokit/agents/config` adds `sdkHomeStep` (sets `THEOKIT_HOME` and `THEOKIT_AUTH_HOME` from a directory name or an SDK profile, with `onConflict: 'refuse' | 'env-wins'` and a typed `SdkHomeConflictError`) and `secretRefsStep` (resolves secret references in the environment) for `defineAppBootstrap`.
