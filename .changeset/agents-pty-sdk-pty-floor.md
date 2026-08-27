---
'@theokit/agents-pty': patch
---

Raise the `@theokit/sdk-pty` floor from `>=0.2.0` to `>=0.3.0`.

This package re-exports five values and one type from `@theokit/sdk-pty`, and two of them — `MaxSessionsError` and `PtyInteractiveBackendOptions` — were first exported in `0.3.0`. The declared range promised an interval where the package cannot build:

```
error TS2305: Module '"@theokit/sdk-pty"' has no exported member 'MaxSessionsError'.
error TS2724: '"@theokit/sdk-pty"' has no exported member named 'PtyInteractiveBackendOptions'.
```

Because the range sits in `dependencies` rather than `peerDependencies`, npm resolved it silently: a consumer got whichever version satisfied `>=0.2.0` and only found out at a call site.

The floor is measured, not inferred — the build fails against a pinned `0.2.0` and passes against a pinned `0.3.0`.
