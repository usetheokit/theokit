# Standalone consumer

Installs the **released** `@theokit/agents` from the npm registry, with no `workspace:` link, and
runs `loginWithApiKey`, `ensureFreshCredential` and `refreshOAuthTokens` from `@theokit/agents/auth`.

```sh
cd apps/theocode/standalone
pnpm install --frozen-lockfile
pnpm test
```

TheoCode itself links `@theokit/agents` with `workspace:*`; the pins in `released.json` are the releases
that TheoCode's workspace copy is checked against.

`package.json` is derived from TheoCode's own manifests (root and `packages/*`) by
`sync-manifest.mjs`: every dependency they declare is carried over, and each `workspace:*` framework
package takes the released version in `released.json`. `@theocode/*` packages are source and are
left out. Never edit the dependencies in `package.json` by hand.

To move a release pin, or after changing a TheoCode manifest:

1. Edit `released.json` (exact versions only; the script rejects ranges).
2. Run `node sync-manifest.mjs` to regenerate `package.json`.
3. Run `pnpm install` to update `pnpm-lock.yaml`.
4. Commit `released.json`, `package.json` and `pnpm-lock.yaml` together.

`node sync-manifest.mjs --check` and `sync-manifest.test.mjs` fail on drift.
