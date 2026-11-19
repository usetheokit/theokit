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

## `createHostLifecycle`

Starts services in order and stops them in reverse. If a start fails, the services already started are stopped and a `HostError` (`host_start_failed`) is thrown. `stop()` runs every stop and reports failures in one `HostError` (`host_stop_failed`).

```ts
import { createHostLifecycle } from '@theokit/host'

const host = createHostLifecycle([{ name: 'db', start: openDb, stop: closeDb }])
await host.start()
await host.stop()
```

## License

Apache-2.0
