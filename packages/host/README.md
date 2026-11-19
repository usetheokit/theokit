# @theokit/host

Node-only utilities for long-running agent apps: a daemon, a personal assistant, a bot host. It holds the process-level pieces such an app needs (login service, config file, ordered start and stop, backups).

It contains no web code and no agent runtime code. Those live in `theokit` and `@theokit/agents`.

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

## `@theokit/host/service`

Install an agent app as a login service and restart it through its supervisor. Linux (`systemd --user`) and macOS (launchd LaunchAgent) exist today; `serviceBackend` throws `UnsupportedPlatformError` for any other platform.

```ts
import { serviceBackend, isSupervised, restartSelf, waitForPredecessor } from '@theokit/host/service'

const backend = serviceBackend() // linux -> systemd
await backend.install({
  label: 'my-agent',
  command: '/usr/bin/node',
  args: ['/srv/my-agent/dist/main.js'],
  env: { MY_AGENT_CONFIG: '/home/me/.config/my-agent.json' },
  workingDirectory: '/srv/my-agent',
}) // writes ~/.config/systemd/user/my-agent.service, then daemon-reload, enable --now, restart
console.log(await backend.status('my-agent')) // 'running' | 'stopped' | 'not-installed' | 'unknown'
```

- `install` writes the unit atomically. If a `systemctl` step fails it throws `ServiceCommandError` (with `command` and `exitCode`), puts the previous unit back (or removes the file on a first install) and runs `daemon-reload`.
- A value the unit cannot hold (a line break, a bad label) throws `ServiceDefinitionError` naming the field, never the value. `%` is doubled everywhere and `$` in `ExecStart=`, per systemd.syntax(7).
- macOS: `serviceBackend('darwin', { uid: process.getuid(), logFile })` writes `~/Library/LaunchAgents/<label>.plist` and runs `launchctl bootout` (a missing service is no error) then `launchctl bootstrap gui/<uid>`. `install` without `uid` throws `ServiceDefinitionError`. stdout and stderr go to `logFile`, default `~/Library/Logs/<label>.log`. A failing `bootstrap` removes the plist and throws `ServiceCommandError`. `KeepAlive` restarts the agent only after a non-zero exit, so `restartSelf` (exit code 75) restarts it and a clean stop stays stopped. `uninstall` keeps the plist when `bootout` fails and `launchctl print` does not say the service is absent (exit 113). `restart` runs `launchctl kickstart -k gui/<uid>/<label>`. `launchdPlist(spec, { logFile })` returns the XML-escaped plist text.
- The unit stops at logout unless lingering is on: run `loginctl enable-linger <user>` to keep it running.

Restart from inside the app:

```ts
await waitForPredecessor(process.env) // first thing in a successor: waits for the old pid to exit
// later, when a setting that needs a restart changes:
const next = await restartSelf({ startEnv: originalEnv })
if (next.kind === 'exit') process.exit(next.code) // 75: the supervisor starts the app again
```

`isSupervised` is true for `INVOCATION_ID` on Linux and for `XPC_SERVICE_NAME` other than `0` on macOS. Otherwise `restartSelf` spawns a detached successor (it gets `THEOKIT_HOST_RESTART_AFTER_PID`) and resolves with its pid. `restartSelf` is asynchronous because Node reports a failed spawn through the child's `error` event after `spawn` returns: it rejects with a `RestartError` whose `cause` is that actual error (or the error `spawn` threw). On a platform other than Linux or macOS it rejects with `UnsupportedPlatformError`.

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
- A root that is itself a symbolic link is rejected too. Backups are portable between POSIX systems; a file name holding a backslash (legal on POSIX only) cannot be restored on Windows, where `restore` refuses it.
- SQLite files (found by header) are snapshotted with the `node:sqlite` backup API, without their `-wal`, `-shm` and `-journal` files.
- `restore` checks every file against the manifest before writing, refuses manifest paths that leave their root, stages each root beside its target, checks the bytes again, then renames into place. An existing target is kept aside and put back if a later root fails to place.
- The lock protects cooperating writers only; the renames of several roots are not crash-atomic.

## `createAppHost` (`@theokit/host/app-host`)

Starts an app's services in order, stops them in reverse, and does it once however the app ends: a failed start, `close()` or SIGINT/SIGTERM.

```ts
import { createAppHost } from '@theokit/host/app-host'

const host = createAppHost({
  signals: process,
  exit: (code) => process.exit(code),
  onError: (step, error) => console.error(step, error),
  stopTimeoutMs: 10_000,
})
const store = host.service('store', () => openStore(), (s) => s.close())
const server = host.service('server', () => listen(store()), (s) => s.close())
await host.start() // a failure stops the started services in reverse, then rejects with AppHostStartError
// later: const result = await host.close() // { ok: true } or { ok: false, failed, timedOut }
```

- `service(name, start, stop?)` registers a service; start order is registration order. The returned getter gives the started value and throws before the service has started. Registering after `start()` throws.
- `start()` rejects with `AppHostStartError` (`step`, `cause`, `rollbackFailures`). Calling it twice returns the same promise.
- `close()` stops the started services in reverse, once; later calls return the same promise. A stop that throws is reported through `onError` and the remaining stops still run. One watchdog (`stopTimeoutMs`) covers the whole teardown; stops still pending then are listed in `timedOut` and not run. A `close()` during `start()` waits for the start to settle and stops what started.
- With `signals`, the first SIGINT or SIGTERM runs `close()`, then `exit(0)`, or `exit(1)` if a step failed or timed out. A second signal goes to `onError` and is ignored. Listeners are removed when the teardown ends.

Use `createAppHost` for a supervised service (systemd, a container), where a clean stop exits 0. For a terminal session (Ctrl-C, exit code 130) keep using `createShutdown` from `@theokit/agents/commands`. `@theokit/host` does not import `@theokit/agents`.

## License

Apache-2.0
