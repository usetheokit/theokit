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

## `defineInstanceConfig`

Declare an app's per-user config file (`@theokit/host/instance-config`) and get its path, load, write and audit.

```ts
import { defineInstanceConfig } from '@theokit/host/instance-config'
import { homedir } from 'node:os'

const config = defineInstanceConfig({
  app: 'my-agent',
  keys: {
    MY_AGENT_MODEL_KEY: { secret: true },
    MY_AGENT_PORT: { parse: (raw) => Number.parseInt(raw, 10) },
  },
})

config.path(process.env, homedir()) // $MY_AGENT_CONFIG, else $XDG_CONFIG_HOME or ~/.config/my-agent/my-agent.env
config.load(process.env, homedir()) // copies keys the environment does not hold; the environment wins
await config.write(config.path(process.env, homedir()), { MY_AGENT_PORT: '8080' }, { force: false })
config.fix(config.audit(config.path(process.env, homedir())))
```

`MY_AGENT_PROFILE=work` selects `my-agent-work.env`. A missing file named by `MY_AGENT_CONFIG` throws `InstanceConfigError`; a missing default file makes `load` return `undefined`. `write` creates the file 0600 and a directory it creates 0700, replaces atomically, refuses an existing file without `force`, refuses undeclared keys and values with `"`, `\` or a line break, and runs each key's `parse` first. Errors name keys and paths, never values. `audit` reports a file or app-owned directory open beyond its owner; `fix` applies `chmod` and returns the findings it fixed.

## License

Apache-2.0
