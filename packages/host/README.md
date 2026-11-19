# @theokit/host

Node-only utilities for long-running agent apps: a daemon, a personal assistant, a bot host. It holds the process-level pieces such an app needs (login service, config file, ordered start and stop, backups).

It contains no web code and no agent runtime code. Those live in `theokit` and `@theokit/agents`.

This release is the scaffold: the features arrive in follow-up releases.

## `HostError`

Base class for every error `@theokit/host` throws.

```ts
import { HostError } from '@theokit/host'

try {
  throw new HostError('host_example', 'something failed', { cause: new Error('root') })
} catch (error) {
  if (error instanceof HostError) {
    console.log(error.code) // 'host_example': stable and machine-readable
    console.log(error.cause)
  }
}
```

## `@theokit/host/backup`

Back up and restore named directories of an agent app. Needs `@theokit/sdk` (peer) for the atomic manifest write; SQLite databases need Node 22.16 or later.

```ts
import { backup, restore, BackupError } from '@theokit/host/backup'

const roots = { state: '/srv/app/state', workspace: '/srv/app/workspace' } // names: [a-z0-9-]+, absolute paths

await backup({
  roots,
  out: '/srv/backups/2026-11-19', // must be absent or empty, and not overlap a root
  exclude: (root, relativePath) => root === 'state' && relativePath === 'import', // e.g. credentials
  lock: async () => {
    const release = await takeMyLock()
    return async () => release() // acquired before the first read, released after success or failure
  },
})

await restore({ from: '/srv/backups/2026-11-19', roots })
```

- Each root is copied to `<out>/<name>`; `manifest.json` (path, sha256, size per file) is written last, atomically. Directories are 0700 and files 0600.
- A symbolic link in a root makes `backup` reject with a `BackupError` naming it. A failed backup removes its output.
- SQLite files (found by header) are snapshotted with the `node:sqlite` backup API, without their `-wal`, `-shm` and `-journal` files.
- `restore` checks every file against the manifest before writing, refuses manifest paths that leave their root, stages each root beside its target, checks the bytes again, then renames into place. An existing target is kept aside and put back if a later root fails to place.
- The lock protects cooperating writers only; the renames of several roots are not crash-atomic.

## License

Apache-2.0
