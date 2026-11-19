# Standalone consumer

Maintainer tooling for the standalone consumer's release pins. The consumer itself (auth test,
`pnpm-workspace.yaml`, `released.json`, lockfile) lives in this directory; the commands below
run against it.

```sh
cd apps/theocode/standalone
node sync-manifest.mjs --check
pnpm test   # auth and sync-manifest tests
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

`node sync-manifest.mjs --check` fails on drift against the real manifests; `sync-manifest.test.mjs` verifies the
script's behaviour (regeneration, `--check`, pin validation) on isolated fixtures and does not read the real
manifests.
