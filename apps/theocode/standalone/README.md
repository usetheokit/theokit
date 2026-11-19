# Standalone consumer

Installs the **released** `@theokit/agents` from the npm registry, with no `workspace:` link, and
runs `loginWithApiKey`, `ensureFreshCredential` and `refreshOAuthTokens` from `@theokit/agents/auth`.
The empty `pnpm-workspace.yaml` keeps pnpm from joining the repository workspace.

```sh
cd apps/theocode/standalone
pnpm install --frozen-lockfile
pnpm test
```

TheoCode itself links `@theokit/agents` with `workspace:*`; the pin in `released.json` (`16.11.0`) is the release
that TheoCode's workspace copy is checked against. To move it, edit `package.json`, run
`pnpm install`, and commit the new `pnpm-lock.yaml`.

`package.json` is derived from TheoCode's own manifests (root and `packages/*`) by
`sync-manifest.mjs`: every dependency they declare is carried over, and each `workspace:*` framework
package takes the released version in `released.json`. `@theocode/*` packages are source and are
left out. After changing a TheoCode manifest or a release pin, run `node sync-manifest.mjs`, then
`pnpm install`, and commit both files. `node sync-manifest.mjs --check` and `auth.test.mjs` fail on
drift.
