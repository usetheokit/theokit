# TheoKit Fixtures

Each subdirectory is a minimal TheoKit app used as **test fixtures** by the
integration suite. They are **not standalone runnable** — they have no own
`node_modules` and are consumed by integration tests, not by `pnpm theokit dev`.

Run a fixture's integration test with:

```bash
npx vitest run tests/integration/fixture-<name>.test.ts
```

To scaffold a real standalone app instead, use `npm create theokit` (the
`create-theokit` package), not these fixtures.

## Index

| Fixture | Demonstrates | Phase |
|---|---|---|
| adapter-static | Fixture app exercising the `adapter-static` scenario | — |
| adapter-targets | Fixture app exercising the `adapter-targets` scenario | — |
| agents-dir-ignored | Fixture app exercising the `agents-dir-ignored` scenario | — |
| app-router-basic | Fixture app exercising the `app-router-basic` scenario | — |
| app-router-errors | Fixture app exercising the `app-router-errors` scenario | — |
| app-router-nested-layouts | Fixture app exercising the `app-router-nested-layouts` scenario | — |
| app-router-not-found | Fixture app exercising the `app-router-not-found` scenario | — |
| auth-providers-diy-github | DIY GitHub OAuth wired with TheoKit's RFC-stable PKCE + state + session-rotation primitives (no provider lib) | — |
| auth-providers-with-authjs | Auth.js delegation alongside TheoKit's session primitives (AUTH-DELEGATION posture) | — |
| basic-valid-app | Fixture app exercising the `basic-valid-app` scenario | — |
| batching | Fixture app exercising the `batching` scenario | — |
| cache-basic | Cache primitives (defineCachedRoute / storage) | — |
| cors-enabled | CORS middleware enabled via config | — |
| cron-basic | Scheduled cron jobs | — |
| csp-reports | Content-Security-Policy report-only collection | — |
| custom-transformer | Fixture app exercising the `custom-transformer` scenario | — |
| decorator-fullstack | Fixture app exercising the `decorator-fullstack` scenario | — |
| define-channel | Fixture app exercising the `define-channel` scenario | — |
| define-integration | Fixture app exercising the `define-integration` scenario | — |
| dynamic-routes | Fixture app exercising the `dynamic-routes` scenario | — |
| invalid-config | Fixture app exercising the `invalid-config` scenario | — |
| invalid-no-app | Fixture app exercising the `invalid-no-app` scenario | — |
| jobs-basic | Background jobs (defineJob / queue) | — |
| loading-states | Fixture app exercising the `loading-states` scenario | — |
| middleware-context | Fixture app exercising the `middleware-context` scenario | — |
| multipart-upload | Fixture app exercising the `multipart-upload` scenario | — |
| observability | Fixture app exercising the `observability` scenario | — |
| onda1-hello-theo | Fixture app exercising the `onda1-hello-theo` scenario | — |
| plugin-example | Fixture app exercising the `plugin-example` scenario | — |
| production-build | Fixture app exercising the `production-build` scenario | — |
| rate-limit | Fixture app exercising the `rate-limit` scenario | — |
| rate-limit-per-route | Per-route rate-limit configuration | — |
| react-query-integration | Fixture app exercising the `react-query-integration` scenario | — |
| server-actions-basic | Fixture app exercising the `server-actions-basic` scenario | — |
| server-routes-basic | Fixture app exercising the `server-routes-basic` scenario | — |
| services-both | Fixture app exercising the `services-both` scenario | — |
| services-node-basic | Fixture app exercising the `services-node-basic` scenario | — |
| services-python-basic | Fixture app exercising the `services-python-basic` scenario | — |
| sessions-auth | Fixture app exercising the `sessions-auth` scenario | — |
| ssr-basic | Fixture app exercising the `ssr-basic` scenario | — |
| ssr-streaming | Fixture app exercising the `ssr-streaming` scenario | — |
| template-default | Fixture app exercising the `template-default` scenario | — |
| ui-message-stream-skeleton | Fixture app exercising the `ui-message-stream-skeleton` scenario (M0/M1 UIMessageStream wire) | — |
| theoui-autoinject | Fixture app exercising the `theoui-autoinject` scenario | — |
| typed-client | Fixture app exercising the `typed-client` scenario | — |
| upgrade-readiness-clean | Fixture app exercising the `upgrade-readiness-clean` scenario | — |
| upgrade-readiness-dirty | Fixture app exercising the `upgrade-readiness-dirty` scenario | — |
| webhook-github | GitHub webhook signature verification | — |
| webhook-slack | Slack webhook signature verification | — |
| webhook-stripe | Stripe webhook signature verification | — |
| websocket-basic | Fixture app exercising the `websocket-basic` scenario | — |
