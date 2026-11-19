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
