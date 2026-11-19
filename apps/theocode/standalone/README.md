# Standalone consumer

Installs the **released** `@theokit/agents` from the npm registry, with no `workspace:` link, and
runs `loginWithApiKey`, `ensureFreshCredential` and `refreshOAuthTokens` from `@theokit/agents/auth`.
The empty `pnpm-workspace.yaml` keeps pnpm from joining the repository workspace.

```sh
cd apps/theocode/standalone
pnpm install --frozen-lockfile
pnpm test
```

TheoCode itself links `@theokit/agents` with `workspace:*`; the pin here (`16.11.0`) is the release
that TheoCode's workspace copy is checked against. To move it, edit `package.json`, run
`pnpm install`, and commit the new `pnpm-lock.yaml`.
