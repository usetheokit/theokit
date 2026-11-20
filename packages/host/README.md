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

Install an agent app as a login service and restart it through its supervisor. Only Linux (`systemd --user`) exists today; `serviceBackend` throws `UnsupportedPlatformError` for any other platform.

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
- The unit stops at logout unless lingering is on: run `loginctl enable-linger <user>` to keep it running.

Restart from inside the app:

```ts
await waitForPredecessor(process.env) // first thing in a successor: waits for the old pid to exit
// later, when a setting that needs a restart changes:
const next = await restartSelf({ startEnv: originalEnv })
if (next.kind === 'exit') process.exit(next.code) // 75: the supervisor starts the app again
```

`isSupervised` is true for `INVOCATION_ID` on Linux and for `XPC_SERVICE_NAME` other than `0` on macOS. Otherwise `restartSelf` spawns a detached successor (it gets `THEOKIT_HOST_RESTART_AFTER_PID`) and resolves with its pid. `restartSelf` is asynchronous because Node reports a failed spawn through the child's `error` event after `spawn` returns: it rejects with a `RestartError` whose `cause` is that actual error (or the error `spawn` threw). On a platform other than Linux or macOS it rejects with `UnsupportedPlatformError`.

## License

Apache-2.0
