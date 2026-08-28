---
'theokit': minor
---

Accept `react-router` 8: the peer range widens from `^7.0.0` to `^7.0.0 || ^8.0.0`.

The pin was aged, not a constraint. Every symbol theokit imports — `Link`, `Outlet`,
`ScrollRestoration`, `createBrowserRouter`, `RouterProvider`, `matchRoutes`, `createStaticHandler`,
`createStaticRouter`, `StaticRouterProvider`, `useLocation` — exists in 8.3.0, and the full suite
passes against it with the same numbers as against 7: 7242 passed, 18 skipped, zero failures.

Found from the consumer side: an app on `theokit@0.58.1` could not take `react-router@8` because
`pnpm install --strict-peer-dependencies` refused with `ERR_PNPM_PEER_DEP_ISSUES`. A peer that
excludes a working major is a constraint the framework imposes on every consumer without having
verified it.

Both majors in the range are exercised rather than merely claimed: the root devDependency moves to
`^8.0.0` so everyday CI runs the new one, and `dep-check`'s floor job already runs the suite at the
bottom of every declared range on the release PR, which covers 7.

Minor rather than patch: the range a consumer may satisfy is larger than before. Nothing that worked
on 7 stops working.
